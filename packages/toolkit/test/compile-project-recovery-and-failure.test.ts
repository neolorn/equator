import { describe, expect, it } from 'vitest';

import {
  TOOLKIT_EVENT_CODES,
  compileProject,
  parseCatalog,
  type Catalog,
  type CompileProjectRequest,
  type ToolkitObservabilityEvent,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * Two things `compileProject` does with nothing but catalogs in memory: carry a recovery selection
 * into both files that hold it, and report a compilation that produced nothing as a failure.
 */

const RECOVERY = '@example/app:shell:recovery.unavailable';

function catalog(body: string): Catalog {
  const parsed = parseCatalog(body, {
    role: 'source',
    providerId: '@example/app',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
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
    catalogs: [
      catalog(
        [
          'messages:',
          '  app-title: Probe',
          '  recovery.unavailable: Something went wrong',
          '',
        ].join('\n'),
      ),
    ],
    ...overrides,
  };
}

function plannedFile(
  overrides: Partial<CompileProjectRequest>,
  name: string,
): string {
  const compiled = compileProject(request(overrides));
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const file = compiled.value.artifacts.outputPlan.files.find(
    ({ path }) => path === name || path.endsWith(`/${name}`),
  );
  if (file === undefined) throw new Error(`${name} was not planned`);
  return file.contents;
}

describe('a recovery message passed to compileProject', () => {
  it('is named in the generated recovery roots', () => {
    expect(
      plannedFile({ recoveryMessageIdentities: [RECOVERY] }, 'recovery.ts'),
    ).toContain(JSON.stringify(RECOVERY));
    // The control: with nothing selected the same file names nothing.
    expect(plannedFile({}, 'recovery.ts')).not.toContain(
      JSON.stringify(RECOVERY),
    );
  });

  it('is compiled into the recovery payload', () => {
    expect(
      plannedFile(
        { recoveryMessageIdentities: [RECOVERY] },
        'recovery-payload.ts',
      ),
    ).toContain(RECOVERY);
    expect(plannedFile({}, 'recovery-payload.ts')).not.toContain(RECOVERY);
  });

  it('is refused by name when no message has its identity', () => {
    const compiled = compileProject(
      request({ recoveryMessageIdentities: ['@example/app:shell:absent'] }),
    );

    expect(compiled.ok).toBe(false);
    expect(
      compiled.diagnostics.map(({ code, summary }) => ({ code, summary })),
    ).toEqual([
      {
        code: 'EQ1501',
        summary:
          'Recovery identity "@example/app:shell:absent" must resolve to one plain message without inputs or slots.',
      },
    ]);
  });
});

describe('a compilation that fails while a sink is listening', () => {
  it('returns its diagnostics and reports the failure with the first code', () => {
    const events: ToolkitObservabilityEvent[] = [];
    const compiled = compileProject(
      request({
        // No message with this identity exists, which the recovery roots refuse.
        recoveryMessageIdentities: ['@example/app:shell:absent'],
        observability: { emit: (event) => void events.push(event) },
      }),
    );

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map(({ code }) => code)).toEqual(['EQ1501']);
    expect(
      events.map(({ code, status, diagnosticCode }) => ({
        code,
        status,
        diagnosticCode,
      })),
    ).toEqual([
      {
        code: TOOLKIT_EVENT_CODES.compilation,
        status: 'started',
        diagnosticCode: undefined,
      },
      {
        code: TOOLKIT_EVENT_CODES.compilation,
        status: 'failed',
        diagnosticCode: compiled.diagnostics[0]?.code,
      },
    ]);
  });

  it('reports the failure in the compilation phase, as it reported the start', () => {
    const events: ToolkitObservabilityEvent[] = [];
    const compiled = compileProject(
      request({
        recoveryMessageIdentities: ['@example/app:shell:absent'],
        observability: { emit: (event) => void events.push(event) },
      }),
    );

    expect(compiled.ok).toBe(false);
    expect(events.map(({ status, phase }) => ({ status, phase }))).toEqual([
      { status: 'started', phase: 'compilation' },
      { status: 'failed', phase: 'compilation' },
    ]);
  });
});
