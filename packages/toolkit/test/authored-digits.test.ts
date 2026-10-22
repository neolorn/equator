import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { compileLocalArtifacts } from '../src/compiled-artifacts.js';
import { generateContracts } from '../src/generated-contracts.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

import { testProjectConfiguration } from './fixtures.js';

/**
 * The digits inside an authored value are the consumer's content, and pass through untouched.
 *
 * Each value below is a run of digits that must survive translation exactly as written: a stock
 * code, a telephone number, a version string, and digits of two numbering systems that are not the
 * locale's own. No step from parsing to the compiled catalog may report on them or rewrite them.
 */

const VALUES = {
  sku: 'Part ABC-00123',
  phone: 'Call +1 555 0100',
  version: 'Version 2.10.3',
  arabic: 'رقم ١٢٣٤',
  devanagari: 'कोड १२३४',
} as const;

function catalog(role: 'source' | 'target', locale: string): Catalog {
  const parsed = parseCatalog(
    `messages:\n${Object.entries(VALUES)
      .map(([key, value]) => `  ${key}: "${value}"`)
      .join('\n')}\n`,
    {
      role,
      providerId: '@example/app',
      scopeId: 'shell',
      locale,
      sourcePath: `i18n/shell/${locale}.yaml`,
    },
  );
  expect(parsed.diagnostics).toEqual([]);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

describe('digits in an authored catalog value', () => {
  it('are neither reported nor rewritten between the catalog and the compiled output', () => {
    const catalogs = [catalog('source', 'en-US'), catalog('target', 'ar-EG')];
    const graph = analyzeCatalogSet({
      configuration: testProjectConfiguration(['en-US', 'ar-EG']),
      catalogs,
    });
    expect(graph.diagnostics).toEqual([]);
    if (!graph.ok) return;
    const contracts = generateContracts(graph.value, {
      recoveryMessageIdentities: [],
    });
    if (!contracts.ok) throw new Error(JSON.stringify(contracts.diagnostics));
    const compiled = compileLocalArtifacts({
      owner: {
        providerId: '@example/app',
        generatedRootPath: 'src/generated/i18n',
      },
      graph: graph.value,
      catalogs,
      contractFiles: contracts.value,
      recoveryMessageIdentities: [],
    });
    expect(compiled.diagnostics).toEqual([]);
    if (!compiled.ok) return;
    for (const locale of ['en-US', 'ar-EG']) {
      const chunk = compiled.value.outputPlan.files.filter(
        ({ path }) => path.includes(locale) && path.endsWith('.ts'),
      );
      expect(chunk.length, locale).toBeGreaterThan(0);
      const text = chunk.map(({ contents }) => contents).join('\n');
      for (const value of Object.values(VALUES)) {
        expect(text, `${locale} ${value}`).toContain(value);
      }
    }
  });
});
