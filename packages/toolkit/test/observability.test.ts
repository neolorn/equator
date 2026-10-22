import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TOOLKIT_EVENT_CODES,
  TOOLKIT_OBSERVABILITY_PROFILE,
  applyAuthoredChangePlan,
  compileProject,
  createMigrationPlan,
  exportXliff22,
  importXliff22,
  parseCatalog,
  parseConfiguration,
  type Catalog,
  type CatalogParseOptions,
  type ProjectConfiguration,
  type ToolkitObservabilityEvent,
  type ToolkitObservabilitySink,
} from '../src/index.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function catalog(source: string, options: CatalogParseOptions): Catalog {
  const result = parseCatalog(source, options);
  if (!result.ok) throw new Error('Catalog fixture failed.');
  return result.value;
}

function configuration(): ProjectConfiguration {
  const result = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
    }),
  );
  if (!result.ok) throw new Error('Configuration fixture failed.');
  return result.value;
}

const source = catalog(
  [
    'messages:',
    '  private-message: SOURCE PRIVATE PAYLOAD 7f8f',
    '  recovery.unavailable: SOURCE RECOVERY PAYLOAD 1a2b',
    '',
  ].join('\n'),
  {
    role: 'source',
    providerId: '@example/app',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/private-source.yaml',
  },
);

const target = catalog(
  [
    'messages:',
    '  private-message: TARGET PRIVATE PAYLOAD 9c0d',
    '  recovery.unavailable: TARGET RECOVERY PAYLOAD 3e4f',
    '',
  ].join('\n'),
  {
    role: 'target',
    providerId: '@example/app',
    scopeId: 'shell',
    locale: 'ar-EG',
    sourcePath: 'i18n/shell/private-target.yaml',
  },
);

function recordingSink(events: ToolkitObservabilityEvent[]) {
  return Object.freeze({
    emit(event: ToolkitObservabilityEvent): void {
      events.push(event);
    },
  }) satisfies ToolkitObservabilitySink;
}

describe('Equator toolkit observability', () => {
  it('emits exact content-free interchange and compiler events', () => {
    const interchangeEvents: ToolkitObservabilityEvent[] = [];
    const exported = exportXliff22({
      source,
      target,
      observability: recordingSink(interchangeEvents),
    });
    expect(exported.ok).toBe(true);
    expect(interchangeEvents).toEqual([
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.interchange,
        phase: 'interchange',
        status: 'started',
        providerId: '@example/app',
        scopeId: 'shell',
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.interchange,
        phase: 'interchange',
        status: 'succeeded',
        providerId: '@example/app',
        scopeId: 'shell',
        locale: 'ar-EG',
        count: 2,
      },
    ]);

    const compilerEvents: ToolkitObservabilityEvent[] = [];
    const compiled = compileProject({
      owner: {
        providerId: '@example/test-owner',
        generatedRootPath: 'src/generated/i18n',
      },
      configuration: configuration(),
      catalogs: [source, target],
      recoveryMessageIdentities: ['@example/app:shell:recovery.unavailable'],
      observability: recordingSink(compilerEvents),
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compilerEvents).toEqual([
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.compilation,
        phase: 'compilation',
        status: 'started',
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.compilation,
        phase: 'compilation',
        status: 'succeeded',
        count: compiled.value.artifacts.outputPlan.files.length,
      },
    ]);

    const serialized = JSON.stringify([
      ...interchangeEvents,
      ...compilerEvents,
    ]);
    expect(serialized).not.toContain('PRIVATE PAYLOAD');
    expect(serialized).not.toContain('private-source.yaml');
    expect(serialized).not.toContain('private-target.yaml');
    claimCapability('capability:xliff');
  });

  it('contains thrown sinks without changing the interchange result', () => {
    const expected = exportXliff22({ source, target });
    const actual = exportXliff22({
      source,
      target,
      observability: {
        emit(): void {
          throw new Error('sink unavailable');
        },
      },
    });
    expect(actual).toEqual(expected);
    claimCapability('capability:xliff');
  });

  it('suppresses duplicate failures for the same sink and safe context', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const events: ToolkitObservabilityEvent[] = [];
    const observability = recordingSink(events);
    const request = {
      document: '<not-xliff/>',
      source,
      observability,
    } as const;

    expect(importXliff22(request).ok).toBe(false);
    expect(importXliff22(request).ok).toBe(false);
    expect(events).toEqual([
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.interchange,
        phase: 'interchange',
        status: 'started',
        providerId: '@example/app',
        scopeId: 'shell',
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.interchange,
        phase: 'interchange',
        status: 'failed',
        diagnosticCode: 'EQ1802',
        providerId: '@example/app',
        scopeId: 'shell',
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.interchange,
        phase: 'interchange',
        status: 'started',
        providerId: '@example/app',
        scopeId: 'shell',
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(request.document);
    claimCapability('capability:xliff');
  });

  it('reports migration completion and unchanged replay without plan content', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'observability-'));
    temporaryRoots.push(root);
    const path = resolve(root, 'equator.config.json');
    const before = '{"schemaVersion":1}\n';
    const after = '{"schemaVersion":1,"sourceLocale":"en-US"}\n';
    await writeFile(path, before, 'utf8');
    const plan = createMigrationPlan({
      id: 'observability-migration',
      domain: 'configuration',
      fromVersion: '1',
      toVersion: '1.1',
      changes: [{ path: 'equator.config.json', before, after }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const events: ToolkitObservabilityEvent[] = [];
    const observability = recordingSink(events);

    const applied = await applyAuthoredChangePlan({
      ownerRoot: root,
      plan: plan.value,
      observability,
    });
    const replayed = await applyAuthoredChangePlan({
      ownerRoot: root,
      plan: plan.value,
      observability,
    });
    expect(applied).toMatchObject({ ok: true, value: { changed: true } });
    expect(replayed).toMatchObject({ ok: true, value: { changed: false } });
    expect(events).toEqual([
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.migration,
        phase: 'migration',
        status: 'started',
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.migration,
        phase: 'migration',
        status: 'succeeded',
        count: 1,
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.migration,
        phase: 'migration',
        status: 'started',
      },
      {
        profile: TOOLKIT_OBSERVABILITY_PROFILE,
        code: TOOLKIT_EVENT_CODES.migration,
        phase: 'migration',
        status: 'unchanged',
        count: 0,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(root);
    expect(JSON.stringify(events)).not.toContain(after);
  });
});
