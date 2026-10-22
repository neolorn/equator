import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  compileProject,
  parseCatalog,
  type CompileProjectRequest,
  type ToolkitDiagnostic,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * Two options of the analysis a compilation is asked to run, which reach the pass or do nothing:
 * the cap on how many of the application's own findings are reported, and the type packages the
 * program is built with.
 */

const projectRoot = resolve('fixtures/semantic-analysis/analysis-options');
const appPath = resolve(projectRoot, 'src/app.ts');

// Two findings of the application's own, each on a line of its own.
const twoFindings = [
  "export const first: number = 'one';",
  "export const second: number = 'two';",
  '',
].join('\n');

function analysisDiagnostics(
  contents: string,
  options: Partial<NonNullable<CompileProjectRequest['analysis']>> = {},
): readonly ToolkitDiagnostic[] {
  const parsed = parseCatalog('messages:\n  app-title: Probe\n', {
    role: 'source',
    providerId: '@example/app',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const compiled = compileProject({
    owner: {
      providerId: '@example/app',
      generatedRootPath: 'src/generated/i18n',
    },
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [parsed.value],
    analysis: {
      projectRoot,
      rootNames: [appPath],
      sources: [{ path: appPath, contents }],
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.Preserve,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
      },
      ...options,
    },
  });
  return compiled.diagnostics.filter(({ code }) => code === 'EQ1401');
}

const located = (diagnostics: readonly ToolkitDiagnostic[]) =>
  diagnostics.filter(({ span }) => span?.sourcePath === 'src/app.ts');
const unlocated = (diagnostics: readonly ToolkitDiagnostic[]) =>
  diagnostics.filter(({ span }) => span === undefined);

describe('the cap on the findings a compilation reports from application source', () => {
  it('leaves two findings alone when no cap is passed', () => {
    const diagnostics = analysisDiagnostics(twoFindings);

    expect(located(diagnostics)).toHaveLength(2);
    expect(unlocated(diagnostics)).toEqual([]);
  });

  it('reports one finding and a notice that there were more under a cap of one', () => {
    const diagnostics = analysisDiagnostics(twoFindings, { maxDiagnostics: 1 });

    expect(located(diagnostics)).toHaveLength(1);
    expect(
      unlocated(diagnostics).map(({ severity }) => ({ severity })),
    ).toEqual([{ severity: 'warning' }]);
  });
});

describe('the type packages a compilation builds the program with', () => {
  const clean = 'export const name = 1;\n';

  it('are whatever the compiler options select when none are named', () => {
    expect(analysisDiagnostics(clean)).toEqual([]);
  });

  it('are the ones the request names, so one that is not installed is reported', () => {
    // A type package nothing installs has no file to locate the finding in, and it does not block.
    const diagnostics = analysisDiagnostics(clean, {
      typeNames: ['equator-analysis-options-absent-types'],
    });

    expect(located(diagnostics)).toEqual([]);
    expect(
      unlocated(diagnostics).map(({ severity }) => ({ severity })),
    ).toEqual([{ severity: 'warning' }]);
  });
});
