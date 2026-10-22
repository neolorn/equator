import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';

/**
 * The first run of a new project is initialization, then generation at every point after it, with
 * nothing between the steps but the application's own work.
 *
 * The test performs only what a person would: write the compiler configuration and a source file,
 * write a catalog, use it, add a scope, use that. Between those steps there is no clean, no
 * registry, no hand-edited generated file and no manifest of catalogs, so a generation that needed
 * any of them fails here. The files the test writes are listed and compared at the end, so a step
 * that quietly needed another file would also show.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function listing(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      resolve(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll('\\', '/'),
    )
    .filter(
      (path) =>
        !path.startsWith('.equator/') && !path.startsWith('src/generated/'),
    )
    .sort();
}

describe('the first run', () => {
  it('generates after init, after the first catalog, and after a second scope, with no other step', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'first-run-'));
    roots.push(root);
    const written = new Set<string>();
    const write = async (path: string, text: string): Promise<void> => {
      const absolute = resolve(root, ...path.split('/'));
      await mkdir(resolve(absolute, '..'), { recursive: true });
      await writeFile(absolute, text, 'utf8');
      written.add(path);
    };
    const generate = async (step: string) => {
      const generated = await generateProject({ project: root });
      expect(
        generated.ok,
        `${step}: ${JSON.stringify(generated.diagnostics)}`,
      ).toBe(true);
      return generated;
    };

    await write(
      'package.json',
      `${JSON.stringify({ name: '@example/first-run', private: true, type: 'module' }, null, 2)}\n`,
    );
    await write(
      'tsconfig.app.json',
      `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
    );
    await write('src/app.ts', 'export const ready = true;\n');

    const initialized = await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
      },
    });
    expect(initialized.ok).toBe(true);
    // The one file init writes besides the package manifest it edits.
    written.add('equator.config.json');

    // Before a single catalog: success, and only a note saying where the first one goes.
    const empty = await generate('before the first catalog');
    expect(empty.diagnostics.length).toBeGreaterThan(0);
    expect(empty.diagnostics.every(({ severity }) => severity === 'info')).toBe(
      true,
    );
    expect(
      empty.diagnostics.map(({ summary }) => summary).join('\n'),
    ).toContain('i18n/shell/en-US.yaml');

    await write('i18n/shell/en-US.yaml', 'messages:\n  app-title: First run\n');
    await write(
      'src/app.ts',
      "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
    );
    await generate('after the first catalog');

    await write('i18n/account/en-US.yaml', 'messages:\n  sign-in: Sign in\n');
    await write(
      'src/account.ts',
      "import { messages } from '#i18n/account';\n\nexport const signIn = messages.signIn.messageId;\n",
    );
    const second = await generate('after a second scope');
    if (!second.ok) return;
    expect(second.value.publication.changed).toBe(true);

    expect(await listing(root)).toEqual([...written].sort());
  });
});
