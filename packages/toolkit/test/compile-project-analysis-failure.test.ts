import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { compileProject, parseCatalog } from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * A compilation whose analysis of the application failed.
 *
 * The catalogs of such a project compile on their own, so everything after the analysis could run
 * and produce artifacts. It does not: an application the analysis refused has no usages, routes or
 * boundaries to generate from, and the compilation fails with what the analysis found.
 */

const projectRoot = resolve('fixtures/semantic-analysis/analysis-failure');
const appPath = resolve(projectRoot, 'src/app.ts');

function compile(contents: string) {
  const parsed = parseCatalog('messages:\n  app-title: Probe\n', {
    role: 'source',
    providerId: '@example/app',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileProject({
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
    },
  });
}

const component = (metadata: string): string =>
  [
    "import { Component } from '@angular/core';",
    '',
    `@Component({ selector: 'app-probe', ${metadata} })`,
    'export class ProbeComponent {}',
    '',
  ].join('\n');

describe('a compilation whose application has a component with no template to read', () => {
  it('fails with the finding and returns no artifacts', () => {
    const compiled = compile(component("templateUrl: './absent.html'"));

    expect(compiled.ok).toBe(false);
    expect(
      compiled.diagnostics
        .filter(({ severity }) => severity === 'error')
        .map(({ code }) => code),
    ).toEqual(['EQ1402']);
    expect('value' in compiled).toBe(false);
  });

  it('succeeds once the template is one the analysis can read', () => {
    // The control: the same component with its template written inline compiles.
    const compiled = compile(component("template: '<p>Probe</p>'"));

    expect(
      compiled.diagnostics.filter(({ severity }) => severity === 'error'),
    ).toEqual([]);
    expect(compiled.ok).toBe(true);
  });
});
