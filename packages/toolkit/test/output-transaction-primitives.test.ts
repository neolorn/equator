import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateProject } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';

/**
 * Publishing a generation replaces files one at a time, and never swaps a directory or a link.
 *
 * Renaming a nonempty directory over another is atomic on some filesystems and refused or
 * non-atomic on others, and a symbolic link needs a privilege Windows withholds by default, so a
 * transaction built on either works on the machine it was written on and nowhere else. Observed at
 * the filesystem calls themselves, across a first generation, an edit and a removed scope, so every
 * branch the transaction takes is one the observation sees.
 */

const observed = vi.hoisted(() => ({
  renames: [] as { source: string; directory: boolean }[],
  links: [] as string[],
}));

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const link =
    (name: string) =>
    (...args: unknown[]): Promise<unknown> => {
      observed.links.push(`${name} ${String(args[0])}`);
      return Reflect.apply(
        actual[name as 'symlink'] as (...values: unknown[]) => Promise<unknown>,
        actual,
        args,
      );
    };
  return {
    ...actual,
    rename: async (source: string, target: string) => {
      const metadata = await actual.lstat(source).catch(() => undefined);
      observed.renames.push({
        source,
        directory: metadata?.isDirectory() === true,
      });
      return actual.rename(source, target);
    },
    symlink: link('symlink'),
    link: link('link'),
  };
});

const roots: string[] = [];

afterEach(async () => {
  observed.renames.length = 0;
  observed.links.length = 0;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

describe('the output transaction', () => {
  it('replaces files through siblings and never renames a directory or switches a link', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'transaction-primitives-'));
    roots.push(root);
    await write(
      root,
      'package.json',
      `${JSON.stringify({ name: '@example/transaction', private: true, type: 'module' }, null, 2)}\n`,
    );
    const initialized = await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
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
    for (const scope of ['shell', 'extra']) {
      await write(
        root,
        `i18n/${scope}/en-US.yaml`,
        'messages:\n  app-title: First\n',
      );
      await write(
        root,
        `i18n/${scope}/ar-EG.yaml`,
        'messages:\n  app-title: الأول\n',
      );
    }

    expect((await generateProject({ project: root })).ok).toBe(true);
    await write(
      root,
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Second\n',
    );
    expect((await generateProject({ project: root })).ok).toBe(true);
    await rm(resolve(root, 'i18n/extra'), { recursive: true });
    const last = await generateProject({ project: root });
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    expect(last.value.publication.removed.length).toBeGreaterThan(0);

    // The replacement of an existing file is a rename, so an empty list would mean the observation
    // was not where the transaction writes.
    expect(observed.renames.length).toBeGreaterThan(0);
    expect(
      observed.renames
        .filter(({ directory }) => directory)
        .map(({ source }) => source),
    ).toEqual([]);
    expect(observed.links).toEqual([]);
  });
});
