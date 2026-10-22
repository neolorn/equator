import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkProject, generateProject } from '../src/index.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';

/**
 * Two promises the tooling rules make.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 10: for an owner that selects an application
 * runtime, a missing or invalid recovery root is a protected correctness error in both generate
 * and a bare check. The rule depends on the analysis telling that an owner has selected one;
 * without it, an owner that authors recovery copy and never selects it passes both commands with no
 * diagnostics, and the first anyone learns of it is a blank page. An application's error-page scope
 * is exactly such a recovery surface, and it is the one nobody exercises until it is needed.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 6: an unused source message is a grouped
 * source-located advisory. Reachability is already collected and load-bearing, driving message
 * usages, recovery-root detection and route extraction, so the advisory adds no analysis, only the
 * report that lets an owner see what its catalogs are still carrying.
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

/**
 * Which spelling composes the runtime.
 *
 * `generated` is what every real application writes: the wrapper Equator generates into `#i18n`.
 * `package` is the direct `provideLocalizationSetup()` call, for an application with a reason to
 * assemble the setup itself. Detection has to recognize both, and a detector that recognizes only
 * one spelling is blind to every application that writes the other.
 */
type CompositionSpelling = 'generated' | 'package';

interface ProjectOptions {
  /** Compose the Equator application runtime, the way an Angular application does. */
  readonly application: boolean;
  readonly spelling?: CompositionSpelling;
  /** Select a recovery message through the provider feature. */
  readonly selectsRecovery: boolean;
  /** Author messages nothing reads. */
  readonly unusedMessages: number;
}

async function project(options: ProjectOptions): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'reachability-'));
  temporaryRoots.push(root);

  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: 'reachability',
        private: true,
        type: 'module',
        imports: {
          '#i18n': './src/generated/i18n/index.ts',
          '#i18n/*': './src/generated/i18n/*.ts',
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

  // Message ids are `[a-z][a-z0-9]*` segments joined by hyphens, so a hyphen must be followed by a
  // letter: `orphan-0` is not a message id.
  const unused = Array.from(
    { length: options.unusedMessages },
    (_, index) =>
      `  orphan-${String.fromCharCode(97 + index)}: Nobody reads this.`,
  );
  await write(
    root,
    'i18n/shell/en-US.yaml',
    [
      'messages:',
      '  app-title: Reachability probe',
      '  recovery.unavailable: Localization is temporarily unavailable.',
      ...unused,
      '',
    ].join('\n'),
  );

  // A stub of the Equator package. The detector resolves the symbol and requires its declaration to
  // come from inside @neolorn/equator, so a declaration file at that path is what the analysis
  // needs, and it declares the API that exists. A stub that declares a name the package does not
  // export, such as `provideLocalization`, keeps this test passing against a function nobody can
  // call while detection is broken for every real consumer.
  await write(
    root,
    'node_modules/@neolorn/equator/index.d.ts',
    [
      'export declare function provideLocalizationSetup(',
      '  setup: unknown,',
      '  ...features: readonly unknown[]',
      '): unknown;',
      'export declare function withRecoveryMessage(',
      '  options: { readonly message: unknown; readonly retryLabel?: unknown },',
      '): { readonly ɵkind: "recovery-message" };',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'node_modules/@neolorn/equator/package.json',
    `${JSON.stringify(
      { name: '@neolorn/equator', version: '0.0.0', types: './index.d.ts' },
      null,
      2,
    )}\n`,
  );

  await write(
    root,
    'src/app.ts',
    [
      "import { messages } from '#i18n/shell';",
      ...(options.application
        ? options.spelling === 'package'
          ? [
              "import { provideLocalizationSetup, withRecoveryMessage } from '@neolorn/equator';",
            ]
          : [
              "import { provideLocalization } from '#i18n';",
              "import { withRecoveryMessage } from '@neolorn/equator';",
            ]
        : []),
      '',
      'export const title = messages.appTitle.messageId;',
      ...(options.application
        ? [
            ...(options.spelling === 'package'
              ? ['export const providers = provideLocalizationSetup(', '  {},']
              : ['export const providers = provideLocalization(']),
            ...(options.selectsRecovery
              ? [
                  '  withRecoveryMessage({ message: messages.recovery.unavailable }),',
                ]
              : []),
            ');',
          ]
        : []),
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

describe('an owner that composes the application runtime', () => {
  it('is told when it selects no recovery message', async () => {
    const root = await project({
      application: true,
      selectsRecovery: false,
      unusedMessages: 0,
    });

    const generated = await generateProject({ project: root });
    const generateCodes = generated.diagnostics.map(({ code }) => code);
    expect(generateCodes).toContain('EQ1310');

    // "in both generate and bare check": a release gate runs check, so an error only generate
    // reports is an error the gate never sees.
    const checked = await checkProject({ project: root });
    expect(checked.diagnostics.map(({ code }) => code)).toContain('EQ1310');
    claimCapability('cli:generate');
    claimCapability('cli:check');
  });

  it('recognizes the direct provideLocalizationSetup spelling too', async () => {
    const root = await project({
      application: true,
      spelling: 'package',
      selectsRecovery: false,
      unusedMessages: 0,
    });

    const generated = await generateProject({ project: root });

    expect(generated.diagnostics.map(({ code }) => code)).toContain('EQ1310');
    claimCapability('cli:generate');
  });

  it('is silent once it selects one', async () => {
    const root = await project({
      application: true,
      selectsRecovery: true,
      unusedMessages: 0,
    });

    const generated = await generateProject({ project: root });

    expect(generated.diagnostics.map(({ code }) => code)).not.toContain(
      'EQ1310',
    );
    claimCapability('cli:generate');
  });

  it('says nothing to an owner that composes no application runtime', async () => {
    // A library, or a server-side consumer using the framework-neutral context, has no provider
    // array to select recovery in. Demanding one there would be demanding the impossible.
    const root = await project({
      application: false,
      selectsRecovery: false,
      unusedMessages: 0,
    });

    const generated = await generateProject({ project: root });

    expect(generated.diagnostics.map(({ code }) => code)).not.toContain(
      'EQ1310',
    );
    claimCapability('cli:generate');
  });
});

describe('source messages nothing reaches', () => {
  it('are reported once per scope, not once per message', async () => {
    // A catalog that has drifted has drifted by dozens; dozens of separate advisories would bury
    // the errors underneath them.
    const root = await project({
      application: true,
      selectsRecovery: true,
      unusedMessages: 4,
    });

    const generated = await generateProject({ project: root });
    const advisories = generated.diagnostics.filter(
      ({ code }) => code === 'EQ1311',
    );

    expect(advisories).toHaveLength(1);
    expect(advisories[0]?.severity).toBe('info');
    expect(advisories[0]?.summary).toContain('4 source messages');
    expect(advisories[0]?.summary).toContain('"orphan-a"');
    claimCapability('cli:generate');
  });

  it('never block a build', async () => {
    // `specs/10-compiler-and-tooling.spec.md` section 6: friendly mode does not delete, fail the
    // compilation, create tombstones, or require waivers. An advisory that stops a build is not
    // an advisory.
    const root = await project({
      application: true,
      selectsRecovery: true,
      unusedMessages: 4,
    });

    expect((await generateProject({ project: root })).ok).toBe(true);
    expect((await checkProject({ project: root })).ok).toBe(true);
    claimCapability('cli:generate');
    claimCapability('cli:check');
  });

  it('say nothing when every message is reached', async () => {
    const root = await project({
      application: true,
      selectsRecovery: true,
      unusedMessages: 0,
    });

    const generated = await generateProject({ project: root });

    expect(generated.diagnostics.map(({ code }) => code)).not.toContain(
      'EQ1311',
    );
    claimCapability('cli:generate');
  });
});
