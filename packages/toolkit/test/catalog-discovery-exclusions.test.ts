import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject, parseCatalog } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

import { testProjectConfiguration } from './fixtures.js';

/**
 * Catalogs are found by convention in the owner's own catalog directory and nowhere else.
 *
 * Each excluded tree below holds a file shaped exactly like a catalog the convention accepts, so
 * the only thing keeping it out is where it lies: build output, a dependency, and a project nested
 * inside this one.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

async function owner(prefix: string, catalog: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify({ name: '@example/discovery', private: true, type: 'module' }, null, 2)}\n`,
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
  await write(root, 'i18n/shell/en-US.yaml', catalog);
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

const LEAKED = 'messages:\n  app-title: Leaked\n  leaked: Leaked\n';

describe('catalog discovery', () => {
  it('reads no catalog-shaped file outside the owner catalog directory', async () => {
    const root = await owner('discovery-', 'messages:\n  app-title: Owned\n');
    // The work root is not among them: it refuses any file it did not write, so a catalog there
    // fails the run before discovery is asked about it.
    for (const tree of [
      'dist',
      'dist/browser',
      'node_modules/@example/dependency',
      'projects/nested',
    ]) {
      await write(root, `${tree}/i18n/shell/en-US.yaml`, LEAKED);
      await write(root, `${tree}/i18n/leaked/en-US.yaml`, LEAKED);
    }
    await write(
      root,
      'projects/nested/package.json',
      `${JSON.stringify({ name: '@example/nested', private: true }, null, 2)}\n`,
    );

    const generated = await generateProject({ project: root });
    expect(generated.ok, JSON.stringify(generated.diagnostics)).toBe(true);
    if (!generated.ok) return;
    const { graph } = generated.value.compilation;
    expect(graph.scopes.map(({ scopeId }) => scopeId)).toEqual(['shell']);
    expect(
      graph.scopes.flatMap(({ messages }) =>
        messages.map(({ messageId }) => messageId),
      ),
    ).toEqual(['app-title']);
    expect(JSON.stringify(generated.value.compilation.artifacts)).not.toContain(
      'Leaked',
    );
  });
});

describe('two catalogs with one complete identity', () => {
  it('fail, the same way whichever arrives first', () => {
    const parsed = [
      'messages:\n  title: First\n',
      'messages:\n  title: Second\n',
    ].map((text, index) => {
      const catalog = parseCatalog(text, {
        role: 'source',
        providerId: '@example/app',
        scopeId: 'shell',
        locale: 'en-US',
        sourcePath: `copy-${index}/en-US.yaml`,
      });
      if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
      return catalog.value;
    });
    const answers = [parsed, [...parsed].reverse()].map((catalogs) => {
      const result = analyzeCatalogSet({
        configuration: testProjectConfiguration(['en-US']),
        catalogs,
      });
      expect(result.ok).toBe(false);
      return result.diagnostics
        .filter(({ severity }) => severity === 'error')
        .map(({ code, summary }) => `${code} ${summary}`);
    });
    expect(answers[0]).toEqual([
      'EQ1301 Scope @example/app/shell has two catalogs for locale "en-US": copy-0/en-US.yaml and copy-1/en-US.yaml.',
    ]);
    expect(answers[1]).toEqual(answers[0]);
  });
});
