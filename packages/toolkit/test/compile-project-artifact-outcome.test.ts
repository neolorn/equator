import { describe, expect, it } from 'vitest';

import {
  compileProject,
  parseCatalog,
  type Catalog,
  type CompileProjectRequest,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * What `compileProject` does with the outcome of the last step, the one that compiles the catalogs
 * and plans the output: a refusal there is the compilation's refusal, and a warning from a step
 * that succeeded is among the compilation's diagnostics. The recovery selection reaches that step
 * in code point order, so what it refuses does not vary with the order a caller wrote.
 */

const title = 'messages:\n  app-title: Probe\n';

function catalog(scopeId: string, body: string = title): Catalog {
  const parsed = parseCatalog(body, {
    role: 'source',
    providerId: '@example/app',
    scopeId,
    locale: 'en-US',
    sourcePath: `i18n/${scopeId}/en-US.yaml`,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function request(
  overrides: Partial<CompileProjectRequest> = {},
): CompileProjectRequest {
  return {
    owner: {
      providerId: '@example/app',
      generatedRootPath: 'src/generated/i18n',
    },
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog('shell')],
    ...overrides,
  };
}

describe('an output plan that cannot be made', () => {
  it('is returned as the refusal of the compilation', () => {
    // A scope takes its module's name from its own, and `routes.ts` is a module the compiler
    // writes, so the contracts are generated and the output plan that would hold both is refused.
    const compiled = compileProject(request({ catalogs: [catalog('routes')] }));

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map(({ code }) => code)).toEqual(['EQ1503']);
  });

  it('is not what a scope with a name of its own gets, as the control', () => {
    expect(compileProject(request()).ok).toBe(true);
  });
});

describe('a warning from compiling the artifacts', () => {
  // Klingon is a well-formed language subtag the pinned release carries no person-name patterns
  // for.
  const uncovered = 'tlh';

  it('is among the diagnostics of a compilation that succeeded', () => {
    const compiled = compileProject(
      request({
        configuration: testProjectConfiguration(['en-US'], {
          personNameLocales: [uncovered],
        }),
      }),
    );

    expect(compiled.ok).toBe(true);
    expect(
      compiled.diagnostics.map(({ code, severity, path }) => ({
        code,
        severity,
        path,
      })),
    ).toEqual([
      { code: 'EQ1004', severity: 'warning', path: ['personNameLocales'] },
    ]);
  });

  it('is absent when every declared locale has patterns, as the control', () => {
    const compiled = compileProject(
      request({
        configuration: testProjectConfiguration(['en-US'], {
          personNameLocales: ['ja'],
        }),
      }),
    );

    expect(compiled.ok).toBe(true);
    expect(compiled.diagnostics).toEqual([]);
  });
});

describe('recovery messages the payload refuses', () => {
  // Plain text with no input, and a slot declared without being placed: a recovery representation
  // carries no slots, so the selection is refused under the code every invalid recovery root gets.
  const withSlots = [
    'messages:',
    '  later:',
    '    message: Try again later',
    '    slots:',
    '      emphasis: strong',
    '  earlier:',
    '    message: Something went wrong',
    '    slots:',
    '      emphasis: strong',
    '',
  ].join('\n');

  it('are refused one by one in code point order, however the request ordered them', () => {
    const compiled = compileProject(
      request({
        catalogs: [catalog('shell', withSlots)],
        recoveryMessageIdentities: [
          '@example/app:shell:later',
          '@example/app:shell:earlier',
        ],
      }),
    );

    expect(compiled.ok).toBe(false);
    expect(
      compiled.diagnostics.map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: 'EQ1501', path: ['recovery', '@example/app:shell:earlier'] },
      { code: 'EQ1501', path: ['recovery', '@example/app:shell:later'] },
    ]);
  });
});
