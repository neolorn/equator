import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolkitResult } from '../src/index.js';
import { initializeProject, watchProject } from '../src/project-host.js';
import { WAIT_BOUND_MS } from './fixtures.js';

/**
 * Watch reconciles fully at startup, treats every filesystem event as a hint to reconcile again,
 * and ends a burst of edits on the latest content.
 *
 * The platform watcher is replaced by one the test fires by hand, and catalog reads can be held
 * open, because the platform's event timing and the moment a generation reads its inputs are what
 * these properties are about, and neither is repeatable on a real filesystem. Every wait carries
 * its own deadline, so a missing cycle is reported as a failed assertion within seconds.
 */

const control = vi.hoisted(() => ({
  listener: undefined as
    ((event: string, fileName: string | null) => void) | undefined,
  onRead: undefined as ((path: string) => Promise<void>) | undefined,
  onClose: undefined as ((emitClose: () => void) => void) | undefined,
  watcher: undefined as
    { emit(event: string, ...values: unknown[]): boolean } | undefined,
}));

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  const { EventEmitter: Emitter } =
    await vi.importActual<typeof import('node:events')>('node:events');
  return {
    ...actual,
    watch: (
      _path: string,
      _options: unknown,
      listener: (event: string, fileName: string | null) => void,
    ) => {
      control.listener = listener;
      const watcher = new Emitter() as InstanceType<typeof Emitter> & {
        close(): void;
      };
      watcher.close = () => {
        control.listener = undefined;
        // Node reports the close on the next tick; a test that holds it back decides when.
        const emitClose = () => watcher.emit('close');
        if (control.onClose === undefined) process.nextTick(emitClose);
        else control.onClose(emitClose);
      };
      control.watcher = watcher;
      return watcher;
    },
  };
});

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const hook = control.onRead;
      if (hook === undefined) return handle;
      const path = String(args[0]);
      const close = handle.close.bind(handle);
      // After the close, so the hook acts once the reader has everything it will read.
      handle.close = async () => {
        await close();
        await hook(path);
      };
      return handle;
    },
  };
});

const roots: string[] = [];

afterEach(async () => {
  control.listener = undefined;
  control.onRead = undefined;
  control.onClose = undefined;
  control.watcher = undefined;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

const pause = (milliseconds: number): Promise<void> =>
  new Promise((done) => setTimeout(done, milliseconds));

async function until(
  condition: () => boolean,
  deadline: number,
): Promise<boolean> {
  const end = Date.now() + deadline;
  while (Date.now() < end) {
    if (condition()) return true;
    await pause(20);
  }
  return condition();
}

const catalog = (title: string): string => `messages:\n  app-title: ${title}\n`;

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'watch-reconciliation-'));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify({ name: '@example/watch', private: true, type: 'module' }, null, 2)}\n`,
  );
  const initialized = await initializeProject({
    project: root,
    configuration: {
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    },
  });
  expect(initialized.ok).toBe(true);
  await write(
    root,
    'tsconfig.app.json',
    `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
  );
  await write(
    root,
    'src/app.ts',
    "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
  );
  await write(root, 'i18n/shell/en-US.yaml', catalog('Started'));
  return root;
}

async function generatedText(root: string): Promise<string> {
  const generated = resolve(root, 'src/generated/i18n');
  const { readFile } =
    await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
  const entries = await readdir(generated, {
    recursive: true,
    withFileTypes: true,
  });
  const texts = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(resolve(entry.parentPath, entry.name), 'utf8')),
  );
  return texts.join('\n');
}

function start(root: string, debounceMilliseconds: number) {
  const controller = new AbortController();
  const results: ToolkitResult<unknown>[] = [];
  const watched = watchProject({
    project: root,
    signal: controller.signal,
    debounceMilliseconds,
    onCycle: ({ sequence, result }) => {
      expect(sequence).toBe(results.length + 1);
      results.push(result);
    },
  });
  const finish = async () => {
    controller.abort();
    const result = await watched;
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  };
  return { results, finish };
}

function fire(fileName: string | null): void {
  expect(control.listener).toBeDefined();
  control.listener?.('change', fileName);
}

describe('watch', () => {
  it('reconciles at startup without an event, and again on an event that names no file', async () => {
    const root = await project();
    const { results, finish } = start(root, 20);
    try {
      expect(await until(() => results.length >= 1, WAIT_BOUND_MS)).toBe(true);
      expect(results[0]?.ok, JSON.stringify(results[0]?.diagnostics)).toBe(
        true,
      );
      expect(await generatedText(root)).toContain('Started');

      // Some platforms report an overflowed or dropped event without a name, and the only safe
      // answer to not knowing what changed is to reconcile everything.
      await write(root, 'i18n/shell/en-US.yaml', catalog('Unnamed'));
      fire(null);
      expect(await until(() => results.length >= 2, WAIT_BOUND_MS)).toBe(true);
      expect(results[1]?.ok).toBe(true);
      expect(await generatedText(root)).toContain('Unnamed');
    } finally {
      await finish();
    }
  });

  it('waits out the events of a write in progress and generates once from the finished file', async () => {
    const root = await project();
    const { results, finish } = start(root, 1_000);
    try {
      expect(await until(() => results.length >= 1, WAIT_BOUND_MS)).toBe(true);

      await write(root, 'i18n/shell/en-US.yaml', catalog('Half'));
      fire('i18n/shell/en-US.yaml');
      await pause(400);
      await write(root, 'i18n/shell/en-US.yaml', catalog('Whole and finished'));
      fire('i18n/shell/en-US.yaml');

      expect(await until(() => results.length >= 2, WAIT_BOUND_MS)).toBe(true);
      // Quiet for longer than the debounce, so a cycle started by the first event alone would
      // have had its chance to appear.
      await pause(1_500);
      expect(results.length).toBe(2);
      expect(results[1]?.ok).toBe(true);
      const text = await generatedText(root);
      expect(text).toContain('Whole and finished');
      expect(text).not.toMatch(/\bHalf\b/u);
    } finally {
      await finish();
    }
  });

  it('ends a burst of edits on the latest content when one arrives during a generation', async () => {
    const root = await project();
    const catalogPath = resolve(root, 'i18n/shell/en-US.yaml');
    const { results, finish } = start(root, 20);
    try {
      expect(await until(() => results.length >= 1, WAIT_BOUND_MS)).toBe(true);

      // The third version lands after the second generation has read the catalog and before it
      // publishes, which is the case where finishing the running cycle alone would publish stale
      // content.
      let held = false;
      control.onRead = async (path) => {
        if (held || resolve(path) !== catalogPath) return;
        held = true;
        await write(root, 'i18n/shell/en-US.yaml', catalog('Third'));
        fire('i18n/shell/en-US.yaml');
        await pause(200);
      };
      await write(root, 'i18n/shell/en-US.yaml', catalog('Second'));
      fire('i18n/shell/en-US.yaml');

      expect(await until(() => results.length >= 3, WAIT_BOUND_MS)).toBe(true);
      expect(held).toBe(true);
      // The generation that read the second version sees its input change before publishing and
      // withholds it, and the rerun publishes the third.
      expect(results[1]?.diagnostics.map(({ code }) => code)).toEqual([
        'EQ1602',
      ]);
      expect(results[2]?.ok, JSON.stringify(results[2]?.diagnostics)).toBe(
        true,
      );
      const text = await generatedText(root);
      expect(text).toContain('Third');
      expect(text).not.toContain('Second');
    } finally {
      await finish();
    }
  });

  it('ignores what an application with a root of its own generates and builds', async () => {
    const root = await project();
    // The same application moved under a root of its own, building to a folder of its choosing.
    await rm(resolve(root, 'tsconfig.app.json'));
    await rm(resolve(root, 'src'), { recursive: true });
    await write(
      root,
      'angular.json',
      `${JSON.stringify({ version: 1, projects: { app: { root: 'projects/app', projectType: 'application', architect: { build: { options: { tsConfig: 'projects/app/tsconfig.app.json', outputPath: 'build/app' } } } } } }, null, 2)}\n`,
    );
    await write(
      root,
      'projects/app/tsconfig.app.json',
      `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
    );
    await write(
      root,
      'projects/app/src/app.ts',
      "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
    );
    const { readFile } =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    const manifest = JSON.parse(
      await readFile(resolve(root, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    manifest['imports'] = {
      '#i18n': './projects/app/src/generated/i18n/index.ts',
      '#i18n/*': './projects/app/src/generated/i18n/*.ts',
    };
    await write(root, 'package.json', `${JSON.stringify(manifest, null, 2)}\n`);
    const { results, finish } = start(root, 20);
    try {
      expect(await until(() => results.length >= 1, WAIT_BOUND_MS)).toBe(true);
      expect(results[0]?.ok, JSON.stringify(results[0]?.diagnostics)).toBe(
        true,
      );

      // A cycle is seen as it starts, by the files it opens, rather than when it reports.
      const opened: string[] = [];
      control.onRead = (path) => {
        opened.push(path);
        return Promise.resolve();
      };
      for (const path of [
        'projects/app/src/generated/i18n/shell.ts',
        'build/app/browser/main.js',
        'projects/app/node_modules/some-package/index.js',
      ]) {
        fire(path);
        expect(
          await until(() => opened.length > 0, 1_000),
          `an event for ${path} started a generation: ${opened.join(', ')}`,
        ).toBe(false);
      }

      // The same watch still answers an edit, so the quiet above is the rule and not a dead watch.
      await write(root, 'i18n/shell/en-US.yaml', catalog('Nested'));
      fire('i18n/shell/en-US.yaml');
      expect(await until(() => opened.length > 0, WAIT_BOUND_MS)).toBe(true);
      expect(await until(() => results.length >= 2, WAIT_BOUND_MS)).toBe(true);
    } finally {
      await finish();
    }
  });

  it('returns only after the platform watcher reports that it closed', async () => {
    const root = await project();
    let emitClose: (() => void) | undefined;
    control.onClose = (emit) => {
      emitClose = emit;
    };
    const controller = new AbortController();
    let cycles = 0;
    let returned = false;
    const watched = watchProject({
      project: root,
      signal: controller.signal,
      debounceMilliseconds: 20,
      onCycle: () => {
        cycles += 1;
      },
    }).then((result) => {
      returned = true;
      return result;
    });
    expect(await until(() => cycles >= 1, WAIT_BOUND_MS)).toBe(true);

    controller.abort();
    expect(await until(() => emitClose !== undefined, 5_000)).toBe(true);
    // Long enough for anything that did not wait on the close to have returned.
    await pause(200);
    expect(returned).toBe(false);

    emitClose?.();
    const result = await watched;
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  });

  it('returns the watcher error without waiting for a close the platform never reports', async () => {
    const root = await project();
    control.onClose = () => undefined;
    const controller = new AbortController();
    let cycles = 0;
    const watched = watchProject({
      project: root,
      signal: controller.signal,
      debounceMilliseconds: 20,
      onCycle: () => {
        cycles += 1;
      },
    });
    expect(await until(() => cycles >= 1, WAIT_BOUND_MS)).toBe(true);

    control.watcher?.emit('error', new Error('planted watcher failure'));
    const result = await watched;
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.map(({ summary }) => summary).join('\n'),
    ).toContain('planted watcher failure');
  });
});
