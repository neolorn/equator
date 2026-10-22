/**
 * Scopes whose names and sizes differ only in ways the identity grammar and the resource ceilings
 * already admit.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 3: a scope may line up with a feature,
 * an owner or a release boundary, so nothing downstream of the grammar may refuse one for what it
 * is called or for how many messages it holds. Each case is carried from the catalog through
 * analysis, contract generation and the output plan, because a refusal at any of those stages
 * refuses the scope.
 */
import { describe, expect, it } from 'vitest';

import {
  parseCatalog,
  parseConfiguration,
  type ProjectConfiguration,
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

function compileScope(
  scopeId: string,
  messageCount = 1,
): { readonly codes: readonly string[]; readonly paths: readonly string[] } {
  const lines = ['messages:'];
  for (let index = 0; index < messageCount; index += 1) {
    lines.push(`  m${index}: Message ${index}`);
  }
  const parsed = parseCatalog(`${lines.join('\n')}\n`, {
    role: 'source',
    providerId: '@neolorn/scope-lab',
    scopeId,
    locale: 'en-US',
    sourcePath: `i18n/${scopeId}/en-US.yaml`,
  });
  if (!parsed.ok)
    return { codes: parsed.diagnostics.map(({ code }) => code), paths: [] };
  const graph = analyzeCatalogSet({
    configuration: configuration(),
    catalogs: [parsed.value],
  });
  if (!graph.ok)
    return { codes: graph.diagnostics.map(({ code }) => code), paths: [] };
  const contracts = generateContracts(graph.value);
  if (!contracts.ok) {
    return { codes: contracts.diagnostics.map(({ code }) => code), paths: [] };
  }
  const compiled = compileLocalArtifacts({
    owner: {
      providerId: '@neolorn/scope-lab',
      generatedRootPath: 'src/generated/i18n',
    },
    graph: graph.value,
    catalogs: [parsed.value],
    contractFiles: contracts.value,
  });
  if (!compiled.ok) {
    return { codes: compiled.diagnostics.map(({ code }) => code), paths: [] };
  }
  return {
    codes: [],
    paths: compiled.value.outputPlan.files.map(({ path }) => path),
  };
}

describe('a scope is not refused for its name or its breadth', () => {
  it('compiles every shape of name the scope grammar admits', () => {
    const names = [
      'a',
      'x1',
      // Many parts, and one long enough to name a whole feature area.
      'billing-invoices-overdue-reminders-escalation-policy-v2',
      Array.from({ length: 40 }, (_, index) => `p${index}`).join('-'),
      // Words that mean something to the script the generated module is written in.
      'constructor',
      'prototype',
      'default',
      'import',
    ];
    for (const name of names) {
      const result = compileScope(name);
      expect({ name, codes: result.codes }).toEqual({ name, codes: [] });
      expect(result.paths).toContain(`${name}.ts`);
    }
  });
});
