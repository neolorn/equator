import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolkitResult } from '../src/index.js';
import { initializeProject, watchProject } from '../src/project-host.js';
import { WAIT_BOUND_MS } from './fixtures.js';

/**
 * A filesystem event says something may have changed. A cycle that rereads the inputs and finds
 * what the cycle before it settled generates nothing and reports nothing, whether that cycle
 * generated from them or refused them, and a cycle that something other than its inputs stopped
 * runs again.
 *
 * The platform watcher is replaced by one the test fires by hand, because an event with no change
 * behind it is what these properties are about and a real filesystem raises one only on some
 * platforms. A cycle is seen as it rereads, by the catalog it opens, so the quiet that follows is
 * a cycle that ran and found nothing to do rather than an event nobody answered.
 */

const control = vi.hoisted(() => ({
  listener: undefined as
    ((event: string, fileName: string | null) => void) | undefined,
  onRead: undefined as ((path: string) => void) | undefined,
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
        process.nextTick(() => watcher.emit('close'));
      };
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
      control.onRead?.(String(args[0]));
      return handle;
    },
  };
});

const roots: string[] = [];

afterEach(async () => {
  control.listener = undefined;
  control.onRead = undefined;
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

const CATALOG = 'i18n/shell/en-US.yaml';
const TRANSLATION_STATE = '.equator-translation-state.json';

const catalog = (title: string): string => `messages:\n  app-title: ${title}\n`;

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'watch-unchanged-inputs-'));
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
  await write(root, CATALOG, catalog('Started'));
  return root;
}

function start(root: string) {
  const controller = new AbortController();
  const results: ToolkitResult<unknown>[] = [];
  const events: string[] = [];
  const watched = watchProject({
    project: root,
    signal: controller.signal,
    debounceMilliseconds: 20,
    observability: {
      emit: ({ phase, status }) => {
        events.push(`${phase} ${status}`);
      },
    },
    onCycle: ({ sequence, result }) => {
      expect(sequence).toBe(results.length + 1);
      results.push(result);
    },
  });
  const finish = async () => {
    controller.abort();
    const result = await watched;
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (result.ok) expect(result.value.cycles).toBe(results.length);
  };
  return { results, events, finish };
}

/**
 * Fires one event and waits for the cycle it schedules to reread the catalog, then for longer than
 * a generation takes, so a cycle that was going to report has reported.
 */
async function fireAndLetTheCycleRun(
  root: string,
  fileName: string | null,
): Promise<void> {
  const catalogPath = resolve(root, ...CATALOG.split('/'));
  let reread = false;
  control.onRead = (path) => {
    if (resolve(path) === catalogPath) reread = true;
  };
  expect(control.listener).toBeDefined();
  control.listener?.('change', fileName);
  expect(
    await until(() => reread, WAIT_BOUND_MS),
    'the event started no cycle, so the quiet after it says nothing',
  ).toBe(true);
  control.onRead = undefined;
  await pause(1_500);
}

function fire(fileName: string): void {
  expect(control.listener).toBeDefined();
  control.listener?.('change', fileName);
}

describe('watch', () => {
  it('generates nothing and reports nothing when an event finds the inputs unchanged', async () => {
    const root = await project();
    const { results, events, finish } = start(root);
    try {
      expect(await until(() => results.length >= 1, WAIT_BOUND_MS)).toBe(true);
      expect(results[0]?.ok, JSON.stringify(results[0]?.diagnostics)).toBe(
        true,
      );
      const reported = events.length;
      expect(reported).toBeGreaterThan(0);

      // A named event, as a read that the platform reports as a change is, and an unnamed one, as
      // an overflow is. Neither has a change behind it.
      await fireAndLetTheCycleRun(root, CATALOG);
      await fireAndLetTheCycleRun(root, null);
      // The same bytes written again, as an editor's save without an edit writes them.
      await write(root, CATALOG, catalog('Started'));
      await fireAndLetTheCycleRun(root, CATALOG);
      expect(results.length).toBe(1);
      expect(events.slice(reported)).toEqual([]);

      // The same watch answers an edit, with the next sequence number.
      await write(root, CATALOG, catalog('Edited'));
      fire(CATALOG);
      expect(await until(() => results.length >= 2, WAIT_BOUND_MS)).toBe(true);
      expect(results[1]?.ok, JSON.stringify(results[1]?.diagnostics)).toBe(
        true,
      );
    } finally {
      await finish();
    }
  });

  it('reports a refusal once, and generates when the inputs it refused are put back', async () => {
    const root = await project();
    const { results, events, finish } = start(root);
    try {
      expect(await until(() => results.length >= 1, WAIT_BOUND_MS)).toBe(true);

      await write(
        root,
        CATALOG,
        `${catalog('Started')}  broken: "unterminated\n`,
      );
      fire(CATALOG);
      expect(await until(() => results.length >= 2, WAIT_BOUND_MS)).toBe(true);
      expect(results[1]?.ok).toBe(false);
      const reported = events.length;

      await fireAndLetTheCycleRun(root, CATALOG);
      expect(results.length).toBe(2);
      expect(events.slice(reported)).toEqual([]);

      // The first cycle generated from these same inputs, and the cycle before this one refused
      // others, so this is a change and not a repeat.
      await write(root, CATALOG, catalog('Started'));
      fire(CATALOG);
      expect(await until(() => results.length >= 3, WAIT_BOUND_MS)).toBe(true);
      expect(results[2]?.ok, JSON.stringify(results[2]?.diagnostics)).toBe(
        true,
      );
    } finally {
      await finish();
    }
  });

  it('runs again over the same inputs after a cycle that something other than its inputs stopped', async () => {
    const root = await project();
    const { results, finish } = start(root);
    try {
      expect(await until(() => results.length >= 1, WAIT_BOUND_MS)).toBe(true);

      // A record a merge left unreadable stops the generation after its inputs were accepted.
      await write(root, TRANSLATION_STATE, '<<<<<<< ours\n');
      await write(root, CATALOG, catalog('Edited'));
      fire(CATALOG);
      expect(await until(() => results.length >= 2, WAIT_BOUND_MS)).toBe(true);
      expect(results[1]?.diagnostics.map(({ code }) => code)).toEqual([
        'EQ1702',
      ]);

      // Resolving the record changes no input, and the edit before it is still unpublished.
      await rm(resolve(root, TRANSLATION_STATE));
      fire(TRANSLATION_STATE);
      expect(await until(() => results.length >= 3, WAIT_BOUND_MS)).toBe(true);
      expect(results[2]?.ok, JSON.stringify(results[2]?.diagnostics)).toBe(
        true,
      );
    } finally {
      await finish();
    }
  });
});
