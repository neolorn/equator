import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';
import { applyOutputPlan } from '../src/output-host.js';
import { createOutputPlan } from '../src/output-plan.js';
import { initializeProject } from '../src/project-host.js';

/**
 * The generated root and the work root are two separate trees, and neither sits inside a tree
 * that belongs to someone else: the authored catalogs, a dependency, or the build output.
 *
 * Each is disposable and each is cleaned by deleting what its own manifest lists, so a root inside
 * another root, or inside a tree a package manager or a bundler rewrites, is one where a clean or
 * an install removes the other's files.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

const OWNER_ID = `sha256-${'A'.repeat(43)}`;

describe('the generated root and the work root', () => {
  it('are refused when one is, contains, or lies inside the other', async () => {
    const owner = await temporary('root-separation-');
    const plan = createOutputPlan([
      { path: 'index.ts', contents: 'export {};\n' },
    ]);
    if (!plan.ok) throw new Error(JSON.stringify(plan.diagnostics));
    for (const [generatedRoot, workRoot] of [
      ['.equator', '.equator'],
      ['.equator/generated', '.equator'],
      ['src/generated/i18n', 'src/generated/i18n/.work'],
    ] as const) {
      const applied = await applyOutputPlan({
        ownerRoot: owner,
        generatedRoot: resolve(owner, generatedRoot),
        workRoot: resolve(owner, workRoot),
        ownerId: OWNER_ID,
        plan: plan.value,
      });
      expect(applied.ok, `${generatedRoot} and ${workRoot}`).toBe(false);
      expect(applied.diagnostics[0]?.code).toBe('EQ1601');
    }
    expect(await readdir(owner)).toEqual([]);
  });

  it('is not placed inside a dependency or the build output', async () => {
    for (const applicationRoot of [
      'node_modules/application',
      'dist/application',
    ]) {
      const owner = await temporary('root-placement-');
      await write(
        owner,
        'package.json',
        `${JSON.stringify({ name: '@example/placement', private: true, type: 'module' }, null, 2)}\n`,
      );
      await write(
        owner,
        'angular.json',
        `${JSON.stringify(
          {
            projects: {
              application: {
                projectType: 'application',
                root: applicationRoot,
                architect: {
                  build: {
                    options: {
                      tsConfig: `${applicationRoot}/tsconfig.app.json`,
                      outputPath: 'dist/application',
                    },
                  },
                },
              },
            },
          },
          null,
          2,
        )}\n`,
      );
      await write(
        owner,
        `${applicationRoot}/tsconfig.app.json`,
        `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
      );
      await write(
        owner,
        `${applicationRoot}/src/app.ts`,
        "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
      );
      // Refused when the owner is set up, and again by a run over a configuration written by hand.
      const initialized = await initializeProject({
        project: owner,
        configuration: {
          sourceLocale: 'en-US',
          defaultLocale: 'en-US',
          locales: ['en-US'],
        },
      });
      expect(initialized.ok, applicationRoot).toBe(false);
      expect(initialized.diagnostics.map(({ code }) => code)).toContain(
        'EQ1601',
      );
      await write(
        owner,
        'equator.config.json',
        `${JSON.stringify({ schemaVersion: 1, sourceLocale: 'en-US', defaultLocale: 'en-US', locales: ['en-US'] }, null, 2)}\n`,
      );
      await write(
        owner,
        'i18n/shell/en-US.yaml',
        'messages:\n  app-title: Placement\n',
      );

      const generated = await generateProject({ project: owner });
      expect(generated.ok, applicationRoot).toBe(false);
      expect(generated.diagnostics.map(({ code }) => code)).toContain('EQ1601');
      await expect(
        readdir(resolve(owner, applicationRoot, 'src/generated/i18n')),
        applicationRoot,
      ).rejects.toThrow();
    }
  });
});
