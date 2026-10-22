/**
 * Scope names the identity grammar admits and generation refuses, because no module of their own
 * can exist: the names of the modules the compiler writes beside the scope modules, and names a
 * supported platform reserves for a device.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 3 reserves both. A scope's module takes
 * the scope's name in the one namespace a consumer imports generated modules from, so the first
 * kind would be written over a generated module, and Windows gives the second kind to no file.
 */
import { describe, expect, it } from 'vitest';

import {
  parseCatalog,
  parseConfiguration,
  type ProjectConfiguration,
  type ToolkitDiagnostic,
} from '../src/index.js';
import { compileLocalArtifacts } from '../src/compiled-artifacts.js';
import { generateContracts } from '../src/generated-contracts.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

function configuration(): ProjectConfiguration {
  const result = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    }),
  );
  if (!result.ok) throw new Error('Configuration fixture failed');
  return result.value;
}

function refusals(scopeId: string): readonly ToolkitDiagnostic[] {
  const parsed = parseCatalog('messages:\n  title: Title\n', {
    role: 'source',
    providerId: '@neolorn/scope-lab',
    scopeId,
    locale: 'en-US',
    sourcePath: `i18n/${scopeId}/en-US.yaml`,
  });
  if (!parsed.ok) return parsed.diagnostics;
  const graph = analyzeCatalogSet({
    configuration: configuration(),
    catalogs: [parsed.value],
  });
  if (!graph.ok) return graph.diagnostics;
  const contracts = generateContracts(graph.value);
  if (!contracts.ok) return contracts.diagnostics;
  const compiled = compileLocalArtifacts({
    owner: {
      providerId: '@neolorn/scope-lab',
      generatedRootPath: 'src/generated/i18n',
    },
    graph: graph.value,
    catalogs: [parsed.value],
    contractFiles: contracts.value,
  });
  return compiled.ok ? [] : compiled.diagnostics;
}

describe('a scope with a reserved name', () => {
  it('compiles a scope whose name is not reserved, as the control', () => {
    expect(refusals('checkout')).toEqual([]);
  });

  it.each([
    'index',
    'routes',
    'recovery',
    'catalog-set',
    'catalog-loaders',
    'recovery-payload',
    'person-names',
  ])(
    'refuses a scope named %s, which a generated module already is',
    (scopeId) => {
      const diagnostics = refusals(scopeId);
      expect(diagnostics.map(({ code }) => code)).toEqual(['EQ1503']);
      expect(diagnostics[0]?.summary).toContain(`${scopeId}.ts`);
      expect(diagnostics[0]?.summary).toContain('collides with');
    },
  );

  it.each(['con', 'nul', 'aux', 'prn', 'com1', 'lpt9'])(
    'refuses a scope named %s, which a platform reserves for a device',
    (scopeId) => {
      const diagnostics = refusals(scopeId);
      expect(diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of diagnostics) {
        expect(diagnostic.code).toBe('EQ1503');
        expect(diagnostic.summary).toMatch(
          new RegExp(`["/]${scopeId}[./]`, 'u'),
        );
      }
    },
  );
});
