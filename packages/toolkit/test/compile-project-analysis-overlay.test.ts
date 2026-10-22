import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  compileProject,
  parseCatalog,
  type Catalog,
  type CompileProjectRequest,
  type ToolkitDiagnostic,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * The overlay `compileProject` analyses an application through, read from the application's side.
 *
 * The pass runs before anything is written, so every `#i18n` import the application makes is
 * answered by the overlay. What the overlay declares is therefore what the application's own lines
 * are checked against: a module it leaves empty, or a recovery selection it leaves out, comes back
 * as a finding in source that is right.
 */

const RECOVERY = '@example/app:shell:recovery.unavailable';

const projectRoot = resolve('fixtures/semantic-analysis/analysis-overlay');
const appPath = resolve(projectRoot, 'src/app.ts');
const runtimeTypesPath = resolve(projectRoot, 'src/runtime-types.d.ts');

// The runtime's types as an installed application has them, declared here because the overlay's
// declaration modules import them by the package's name.
const runtimeTypes = [
  "declare module '@neolorn/equator' {",
  '  export interface CatalogLoaders {',
  "    readonly loaders: 'loaders';",
  '  }',
  '  export interface CatalogSetDescriptor {',
  "    readonly set: 'set';",
  '  }',
  '  export interface PersonNameProfileSet {',
  "    readonly names: 'names';",
  '  }',
  '  export interface RecoveryRepresentation {',
  "    readonly representation: 'representation';",
  '  }',
  '}',
  '',
].join('\n');

function catalog(): Catalog {
  const parsed = parseCatalog(
    [
      'messages:',
      '  app-title: Probe',
      '  recovery.unavailable: Something went wrong',
      '',
    ].join('\n'),
    {
      role: 'source',
      providerId: '@example/app',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function compileWith(
  app: readonly string[],
  overrides: Partial<CompileProjectRequest> = {},
): ReturnType<typeof compileProject> {
  return compileProject({
    owner: {
      providerId: '@example/app',
      generatedRootPath: 'src/generated/i18n',
    },
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog()],
    analysis: {
      projectRoot,
      rootNames: [appPath, runtimeTypesPath],
      sources: [
        { path: appPath, contents: [...app, ''].join('\n') },
        { path: runtimeTypesPath, contents: runtimeTypes },
      ],
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.Preserve,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
      },
    },
    ...overrides,
  });
}

function findingsInTheApplication(
  app: readonly string[],
  overrides: Partial<CompileProjectRequest> = {},
): readonly ToolkitDiagnostic[] {
  return compileWith(app, overrides).diagnostics.filter(
    ({ span }) => span?.sourcePath === 'src/app.ts',
  );
}

describe('an application importing a module the overlay declares', () => {
  it.each([
    {
      specifier: '#i18n/catalog-set',
      name: 'catalogSet',
      reading: "export const read: 'set' = catalogSet.set;",
    },
    {
      specifier: '#i18n/catalog-loaders',
      name: 'catalogLoaders',
      reading: "export const read: 'loaders' = catalogLoaders.loaders;",
    },
    {
      specifier: '#i18n/person-names',
      name: 'personNames',
      reading: "export const read: 'names' = personNames.names;",
    },
    {
      specifier: '#i18n/recovery-payload',
      name: 'recoveryPayload',
      reading:
        "export const read: 'representation' | undefined = recoveryPayload[0]?.representation;",
    },
  ])(
    'reads $name from $specifier with the type the runtime gives it',
    ({ specifier, name, reading }) => {
      expect(
        findingsInTheApplication([
          `import { ${name} } from '${specifier}';`,
          reading,
        ]),
      ).toEqual([]);
    },
  );

  it('is told about a module the overlay does not declare', () => {
    // The control: the same reading reports an import nothing answers.
    const findings = findingsInTheApplication([
      "import { absent } from '#i18n/absent';",
      'export const read: unknown = absent;',
    ]);

    expect(findings.map(({ code }) => code)).toEqual(['EQ1401']);
  });
});

describe('the recovery roots the overlay declares', () => {
  // The roots are a tuple, so its length is a literal type and a root the overlay leaves out is a
  // different type from the one the generation writes.
  const readsOneRoot = [
    "import { recoveryRoots } from '#i18n/recovery';",
    'export const selected: 1 = recoveryRoots.length;',
  ];

  it('name the recovery message the request selected', () => {
    expect(
      findingsInTheApplication(readsOneRoot, {
        recoveryMessageIdentities: [RECOVERY],
      }),
    ).toEqual([]);
  });

  it('name nothing when the request selected nothing', () => {
    expect(
      findingsInTheApplication(readsOneRoot).map(({ code }) => code),
    ).toEqual(['EQ1401']);
  });
});

describe('a recovery selection the overlay cannot be built from', () => {
  it('is returned as the refusal, with the analysis never started', () => {
    const compiled = compileWith(['export const name = 1;'], {
      recoveryMessageIdentities: ['@example/app:shell:absent'],
    });

    expect(compiled.ok).toBe(false);
    expect(
      compiled.diagnostics.map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: 'EQ1501', path: ['recovery', '@example/app:shell:absent'] },
    ]);
  });
});
