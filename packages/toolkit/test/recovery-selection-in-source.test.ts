import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';

/**
 * A recovery message the application's own source selects.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 10: for an owner that selects an application
 * runtime, an invalid recovery root is a protected correctness error. A recovery message renders
 * when nothing else can, so it is a plain message that takes no inputs. A selection written in
 * source is found by the analysis and not handed to the compiler, so it is judged after the
 * analysis has run, by the same rule and under the same code as one the caller passes.
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

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A project whose source selects `recovery.unavailable`, authored as the given message, with the
 * given members added to its configuration.
 */
async function project(
  recoveryMessage: string,
  configuration: object = {},
): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'recovery-selection-'));
  temporaryRoots.push(root);

  await write(
    root,
    'package.json',
    json({
      name: 'recovery-selection',
      private: true,
      type: 'module',
      imports: {
        '#i18n': './src/generated/i18n/index.ts',
        '#i18n/*': './src/generated/i18n/*.ts',
      },
    }),
  );
  await write(
    root,
    'equator.config.json',
    json({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
      ...configuration,
    }),
  );
  await write(
    root,
    'tsconfig.app.json',
    json({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'preserve',
        moduleResolution: 'bundler',
        resolvePackageJsonImports: true,
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }),
  );
  await write(
    root,
    'i18n/shell/en-US.yaml',
    [
      'messages:',
      '  app-title: Recovery probe',
      `  recovery.unavailable: ${JSON.stringify(recoveryMessage)}`,
      '',
    ].join('\n'),
  );
  await write(
    root,
    'node_modules/@neolorn/equator/index.d.ts',
    [
      'export declare function withRecoveryMessage(',
      '  options: { readonly message: unknown; readonly retryLabel?: unknown },',
      '): { readonly ɵkind: "recovery-message" };',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'node_modules/@neolorn/equator/package.json',
    json({ name: '@neolorn/equator', version: '0.0.0', types: './index.d.ts' }),
  );
  await write(
    root,
    'src/app.ts',
    [
      "import { provideLocalization } from '#i18n';",
      "import { messages } from '#i18n/shell';",
      "import { withRecoveryMessage } from '@neolorn/equator';",
      '',
      'export const title = messages.appTitle.messageId;',
      'export const providers = provideLocalization(',
      '  withRecoveryMessage({ message: messages.recovery.unavailable }),',
      ');',
      '',
    ].join('\n'),
  );

  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('a recovery message selected in source', () => {
  it('is refused as an invalid recovery root when it takes an input', async () => {
    const root = await project('Unavailable for {$name}.');

    const generated = await generateProject({ project: root });

    expect(generated.ok).toBe(false);
    expect(
      generated.diagnostics.map(({ code, path }) => ({ code, path })),
    ).toEqual([
      {
        code: 'EQ1501',
        path: ['recovery', 'recovery-selection:shell:recovery.unavailable'],
      },
    ]);
  });

  describe('in a project whose artifacts compile with a warning', () => {
    // Klingon is a well-formed language subtag the pinned release carries no person-name patterns
    // for, which compiling the artifacts reports as a warning.
    const configuration = { personNameLocales: ['tlh'] };

    it('is refused with nothing from the artifacts, which are never compiled', async () => {
      const root = await project('Unavailable for {$name}.', configuration);

      const generated = await generateProject({ project: root });

      expect(generated.ok).toBe(false);
      expect(
        generated.diagnostics.map(({ code, path }) => ({ code, path })),
      ).toEqual([
        {
          code: 'EQ1501',
          path: ['recovery', 'recovery-selection:shell:recovery.unavailable'],
        },
      ]);
    });

    it('is accepted with that warning when it is plain, as the control', async () => {
      const root = await project(
        'Localization is temporarily unavailable.',
        configuration,
      );

      const generated = await generateProject({ project: root });

      expect(generated.ok).toBe(true);
      expect(
        generated.diagnostics.map(({ code, severity }) => ({ code, severity })),
      ).toEqual([{ code: 'EQ1004', severity: 'warning' }]);
    });
  });

  it('is accepted when it is plain and takes no inputs', async () => {
    // The control: the same selection of a message that can render with nothing to hand.
    const root = await project('Localization is temporarily unavailable.');

    const generated = await generateProject({ project: root });

    expect(
      generated.diagnostics.filter(({ severity }) => severity === 'error'),
    ).toEqual([]);
    expect(generated.ok).toBe(true);
  });
});
