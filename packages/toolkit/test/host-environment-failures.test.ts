import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkProject, generateProject, watchProject } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';

/**
 * What the Node host answers when the project on disk is not what it expects.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 13 makes the incremental cache disposable: a
 * cache that cannot be used is ignored and recomputed, never a failure. Section 9 refuses a linked
 * root. Each case below makes the directory wrong the way the host names it and reads the answer
 * from the public function, which is a result in every one of them.
 */

const watchers = vi.hoisted(() => ({ opened: 0, closed: 0 }));

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return {
    ...actual,
    watch: (...args: Parameters<typeof actual.watch>) => {
      const watcher = actual.watch(...args);
      watchers.opened += 1;
      watcher.once('close', () => {
        watchers.closed += 1;
      });
      return watcher;
    },
  };
});

const roots: string[] = [];

afterEach(async () => {
  watchers.opened = 0;
  watchers.closed = 0;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(
  root: string,
  path: string,
  contents: string | Buffer,
): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, contents);
}

async function owner(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'host-environment-'));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify({ name: '@example/environment', private: true, type: 'module' }, null, 2)}\n`,
  );
  const initialized = await initializeProject({
    project: root,
    configuration: {
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    },
  });
  expect(initialized.ok, JSON.stringify(initialized.diagnostics)).toBe(true);
  await write(root, 'i18n/shell/en-US.yaml', 'messages:\n  app-title: Owned\n');
  await write(
    root,
    'tsconfig.app.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'preserve',
          moduleResolution: 'bundler',
          resolvePackageJsonImports: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'src/app.ts',
    "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
  );
  return root;
}

async function generated(): Promise<string> {
  const root = await owner();
  const first = await generateProject({ project: root });
  expect(first.ok, JSON.stringify(first.diagnostics)).toBe(true);
  return root;
}

/** A directory moved aside and replaced by a link to where it went. */
async function linkInPlaceOf(root: string, path: string): Promise<void> {
  const aside = resolve(root, `${path.replaceAll('/', '-')}-aside`);
  await rename(resolve(root, ...path.split('/')), aside);
  // A junction, which Windows lets any account create; elsewhere the type is ignored.
  await symlink(aside, resolve(root, ...path.split('/')), 'junction');
}

function advisories(result: {
  readonly diagnostics: readonly {
    readonly code: string;
    readonly severity: string;
    readonly summary: string;
  }[];
}) {
  return result.diagnostics.map(({ code, severity, summary }) => ({
    code,
    severity,
    summary,
  }));
}

const CACHE = '.equator/cache/compiler-state.json';

describe('an incremental cache that cannot be used', () => {
  it('is ignored and recomputed when it is past its size', async () => {
    const root = await generated();
    await write(root, CACHE, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));

    const again = await generateProject({ project: root });

    expect(again.ok).toBe(true);
    expect(advisories(again)).toEqual([
      {
        code: 'EQ1703',
        severity: 'info',
        summary:
          'Equator ignored an oversized incremental compiler cache and will recompute it.',
      },
    ]);
    // The generation wrote the cache again, so the next one reads it and says nothing.
    const settled = await generateProject({ project: root });
    expect(advisories(settled)).toEqual([]);
  });

  it.each(['ownerId', 'identity'])(
    'is ignored and recomputed when its %s is not well-formed Unicode',
    async (member) => {
      const root = await generated();
      const text = await readFile(resolve(root, CACHE), 'utf8');
      const unpaired = `${String.fromCharCode(92)}ud800`;
      const damaged = text.replace(
        new RegExp(`"${member}": "([^"]*)"`, 'u'),
        (_whole, value: string) => `"${member}": "${value}${unpaired}"`,
      );
      expect(damaged).not.toBe(text);
      await write(root, CACHE, damaged);

      const checked = await checkProject({ project: root });

      expect(checked.ok).toBe(true);
      expect(advisories(checked)).toEqual([
        {
          code: 'EQ1703',
          severity: 'info',
          summary:
            'Equator ignored an incompatible incremental compiler cache and will recompute it.',
        },
      ]);
    },
  );

  it('is ignored by a check and refused by a generation when it lies behind a link', async () => {
    const root = await generated();
    await linkInPlaceOf(root, '.equator/cache');

    const checked = await checkProject({ project: root });
    expect(checked.ok).toBe(true);
    expect(advisories(checked)).toEqual([
      {
        code: 'EQ1703',
        severity: 'info',
        summary:
          'Equator ignored a linked incremental compiler cache and will recompute it.',
      },
    ]);

    // A generation writes in the work root, and a work root holding a link is not one it owns.
    const refused = await generateProject({ project: root });
    expect(refused.ok).toBe(false);
    expect(refused.diagnostics.map(({ code }) => code)).toEqual(['EQ1602']);
    expect(await readdir(resolve(root, '.equator'))).not.toContain(
      'generation.lock',
    );
  });
});

describe('a source directory that is a link', () => {
  it('is reported as the project it is, by a generation and by a check', async () => {
    const root = await owner();
    await linkInPlaceOf(root, 'src');

    for (const result of [
      await generateProject({ project: root }),
      await checkProject({ project: root }),
    ]) {
      expect(result.ok).toBe(false);
      expect(advisories(result)).toEqual([
        {
          code: 'EQ1702',
          severity: 'error',
          summary:
            'The selected TypeScript graph contains root "src/app.ts" behind the link "src", and Equator reads no linked project content.',
        },
      ]);
    }
  });
});

describe('a generation lock another run holds', () => {
  it('refuses the generation and is left where it was', async () => {
    const root = await generated();
    await write(
      root,
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Moved\n',
    );
    await write(root, '.equator/generation.lock', '');

    const refused = await generateProject({ project: root });

    expect(refused.ok).toBe(false);
    expect(refused.diagnostics.map(({ code }) => code)).toEqual(['EQ1602']);
    expect(await readdir(resolve(root, '.equator'))).toContain(
      'generation.lock',
    );
  });
});

describe('a watch whose signal cannot be listened to', () => {
  it('passes the error on with its watcher closed', async () => {
    const root = await generated();
    const signal = {
      aborted: false,
      addEventListener: () => {
        throw new Error('this signal takes no listener');
      },
    };

    await expect(
      watchProject({ project: root, signal: signal as never }),
    ).rejects.toThrow('this signal takes no listener');

    expect(watchers).toEqual({ opened: 1, closed: 1 });
  });
});
