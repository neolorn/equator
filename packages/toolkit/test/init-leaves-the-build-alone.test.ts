import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';

/**
 * Setting a project up adds commands the application may call, and changes nothing about how the
 * application builds or installs.
 *
 * A lifecycle script runs whenever the package manager or another script reaches it, so adding one
 * is adding a hook; and the build configuration, the compiler configuration and the dependency
 * lists are the application's, which a tool that edited them would own from then on.
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

// The scripts npm runs on its own: install and publish hooks, and a pre or post hook of any script
// the package already has.
const INSTALL_AND_PUBLISH_HOOKS = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'dependencies',
]);

describe('init', () => {
  it('adds commands and no hook, and leaves the build, compiler and dependency configuration alone', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'init-build-'));
    roots.push(root);
    const manifestBefore = {
      name: '@example/init-build',
      private: true,
      type: 'module',
      scripts: { build: 'ng build', test: 'ng test', start: 'ng serve' },
      dependencies: { '@angular/core': '^22.0.0' },
      devDependencies: { typescript: '~6.0.0' },
    };
    await write(
      root,
      'package.json',
      `${JSON.stringify(manifestBefore, null, 2)}\n`,
    );
    const untouched = {
      'angular.json': `${JSON.stringify(
        {
          projects: {
            application: {
              projectType: 'application',
              root: '',
              architect: {
                build: {
                  options: {
                    tsConfig: 'tsconfig.app.json',
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
      'tsconfig.app.json': `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
      'tsconfig.json': `${JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }, null, 2)}\n`,
    };
    for (const [path, text] of Object.entries(untouched))
      await write(root, path, text);
    await write(
      root,
      'src/app.ts',
      "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
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
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Build\n',
    );
    expect((await generateProject({ project: root })).ok).toBe(true);

    for (const [path, text] of Object.entries(untouched)) {
      expect(await readFile(resolve(root, path), 'utf8'), path).toBe(text);
    }
    const manifest = JSON.parse(
      await readFile(resolve(root, 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
      dependencies: unknown;
      devDependencies: unknown;
      peerDependencies?: unknown;
      optionalDependencies?: unknown;
    };
    expect(manifest.dependencies).toEqual(manifestBefore.dependencies);
    expect(manifest.devDependencies).toEqual(manifestBefore.devDependencies);
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
    for (const [name, command] of Object.entries(manifestBefore.scripts)) {
      expect(manifest.scripts[name], name).toBe(command);
    }
    const added = Object.keys(manifest.scripts).filter(
      (name) => !(name in manifestBefore.scripts),
    );
    expect(added.length).toBeGreaterThan(0);
    for (const name of Object.keys(manifest.scripts)) {
      expect(INSTALL_AND_PUBLISH_HOOKS.has(name), name).toBe(false);
      const hooked = /^(?:pre|post)(.+)$/u.exec(name)?.[1];
      expect(hooked !== undefined && hooked in manifest.scripts, name).toBe(
        false,
      );
    }
    // Every added command is one the application calls by name, and none runs another script.
    for (const name of added) {
      expect(name.startsWith('equator:'), name).toBe(true);
      expect(manifest.scripts[name], name).toMatch(/^equator [a-z]+$/u);
    }
  });
});
