import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';
import { cleanProject, uninstallProject } from '../src/project-host.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.ts';

/**
 * Removing Equator from an application.
 *
 * `clean` means "remove build output" everywhere else (`cargo clean`, `make clean`,
 * `ng cache clean` all leave project configuration alone) so it keeps that meaning and this is
 * a separate command. A flag that turns "remove build output" into "remove the tool" is one that
 * eventually runs in a pipeline by accident.
 *
 * Two rules give this its shape. Authored catalogs are the consumer's content and survive unless
 * their removal is asked for by name; deleting a project's translations as a side effect of
 * uninstalling a tool would be indefensible. And only what Equator wrote is taken back: a `#i18n`
 * specifier somebody repointed, or a script somebody edited, is theirs now.
 */

const temporaryRoots: string[] = [];

async function write(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

interface ProjectOptions {
  /** A `#i18n` specifier the consumer has repointed at something of their own. */
  readonly repointed?: boolean;
  /** An Equator script the consumer has edited. */
  readonly editedScript?: boolean;
  /** A script of the consumer's own, beside Equator's. */
  readonly ownScript?: boolean;
}

async function project(options: ProjectOptions = {}): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'uninstall-'));
  temporaryRoots.push(root);

  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: '@example/uninstall',
        version: '0.0.0',
        private: true,
        type: 'module',
        imports: {
          '#i18n': options.repointed
            ? './src/hand-written/index.ts'
            : './src/generated/i18n/index.ts',
          '#i18n/*': './src/generated/i18n/*.ts',
        },
        scripts: {
          'equator:generate': options.editedScript
            ? 'equator generate --project . --json'
            : 'equator generate',
          'equator:check': 'equator check',
          ...(options.ownScript === true ? { build: 'ng build' } : {}),
        },
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'equator.config.json',
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
      },
      null,
      2,
    )}\n`,
  );
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
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  await write(root, 'src/app.ts', 'export const marker = 1;\n');
  await write(
    root,
    'i18n/shell/en-US.yaml',
    'messages:\n  app-title: Equator\n',
  );
  return root;
}

async function manifest(
  root: string,
): Promise<Readonly<Record<string, unknown>>> {
  return JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8'),
  ) as Readonly<Record<string, unknown>>;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('uninstalling Equator', () => {
  it('takes back what Equator wrote and leaves the content alone', async () => {
    const root = await project({ ownScript: true });
    expect((await generateProject({ project: root })).ok).toBe(true);

    const result = await uninstallProject({ project: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await manifest(root);
    expect(after['imports']).toBeUndefined();
    expect(after['scripts']).toEqual({ build: 'ng build' });
    expect(after['name']).toBe('@example/uninstall');

    expect(await exists(resolve(root, 'equator.config.json'))).toBe(false);
    expect(await exists(resolve(root, 'src/generated/i18n/index.ts'))).toBe(
      false,
    );

    // The consumer's translations. Removing these as a side effect would be indefensible.
    expect(await exists(resolve(root, 'i18n/shell/en-US.yaml'))).toBe(true);
    expect(result.value.catalogs).toEqual([]);
    claimCapability('cli:uninstall');
  });

  it('leaves a repointed specifier and an edited script exactly as they are', async () => {
    const root = await project({ repointed: true, editedScript: true });

    const result = await uninstallProject({ project: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await manifest(root);
    expect(after['imports']).toEqual({
      '#i18n': './src/hand-written/index.ts',
    });
    expect(after['scripts']).toEqual({
      'equator:generate': 'equator generate --project . --json',
    });

    // Named rather than reverted, so nothing about it is a surprise.
    expect(result.value.retained).toEqual([
      'imports.#i18n',
      'scripts.equator:generate',
    ]);
    claimCapability('cli:uninstall');
  });

  it('removes authored catalogs only when asked by name', async () => {
    const root = await project();

    const result = await uninstallProject({
      project: root,
      catalogs: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.catalogs).toEqual(['i18n/shell/en-US.yaml']);
    expect(await exists(resolve(root, 'i18n/shell/en-US.yaml'))).toBe(false);
    claimCapability('cli:uninstall');
  });

  it('changes nothing under --dry-run', async () => {
    const root = await project();
    const before = await readFile(resolve(root, 'package.json'), 'utf8');

    const result = await uninstallProject({
      project: root,
      dryRun: true,
      catalogs: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.changed).toBe(true);
    expect(result.value.removed).toContain('equator.config.json');
    expect(await readFile(resolve(root, 'package.json'), 'utf8')).toBe(before);
    expect(await exists(resolve(root, 'equator.config.json'))).toBe(true);
    expect(await exists(resolve(root, 'i18n/shell/en-US.yaml'))).toBe(true);
    claimCapability('cli:uninstall');
  });

  it('leaves a manifest that holds nothing of Equator untouched', async () => {
    // Reachable through `--project`, which takes any directory: nothing of Equator's is here, so
    // the application's own file keeps every byte, spacing included.
    const root = await mkdtemp(resolve(tmpdir(), 'uninstall-'));
    temporaryRoots.push(root);
    const compact = '{"name":"@example/plain","scripts":{"build":"ng build"}}';
    await write(root, 'package.json', compact);

    const result = await uninstallProject({ project: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.changed).toBe(false);
    expect(result.value.removed).toEqual([]);
    expect(await readFile(resolve(root, 'package.json'), 'utf8')).toBe(compact);
    claimCapability('cli:uninstall');
  });

  it("writes the manifest back in the application's own indentation and line endings", async () => {
    const root = await project({ ownScript: true });
    const tabbed =
      `${JSON.stringify(await manifest(root), null, '\t')}\n`.replaceAll(
        '\n',
        '\r\n',
      );
    await write(root, 'package.json', tabbed);

    const result = await uninstallProject({ project: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await readFile(resolve(root, 'package.json'), 'utf8')).toBe(
      '{\r\n\t"name": "@example/uninstall",\r\n\t"version": "0.0.0",\r\n\t"private": true,\r\n\t"type": "module",\r\n\t"scripts": {\r\n\t\t"build": "ng build"\r\n\t}\r\n}\r\n',
    );
    claimCapability('cli:uninstall');
  });

  it('is not what clean does', async () => {
    // The distinction the two commands exist to keep. `clean` removes build output; project
    // configuration is not build output.
    const root = await project();
    expect((await generateProject({ project: root })).ok).toBe(true);

    expect((await cleanProject({ project: root })).ok).toBe(true);

    expect(await exists(resolve(root, 'equator.config.json'))).toBe(true);
    expect((await manifest(root))['imports']).toBeDefined();
    expect(await exists(resolve(root, 'i18n/shell/en-US.yaml'))).toBe(true);
    expect(await exists(resolve(root, 'src/generated/i18n/index.ts'))).toBe(
      false,
    );
    claimCapability('cli:clean');
  });
});
