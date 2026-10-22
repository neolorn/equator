/**
 * A scope that declares no message family, and what its generated module says about families.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 3 lets a release generate a registry
 * only for content that exists, so a scope with no family carries no family registry, empty or
 * otherwise. `generated-scope-helpers.test.ts` asserts the opposite today, which is why this case
 * is kept in a file of its own.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, parseConfiguration } from '../src/index.js';
import { generateContracts } from '../src/generated-contracts.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

function shellModule(): string {
  const configuration = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    }),
  );
  if (!configuration.ok) throw new Error('Configuration fixture failed');
  const catalog = parseCatalog('messages:\n  nav.home: Home\n', {
    role: 'source',
    providerId: '@example/empty-registry',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
  });
  if (!catalog.ok) throw new Error('Catalog fixture failed');
  const graph = analyzeCatalogSet({
    configuration: configuration.value,
    catalogs: [catalog.value],
  });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  const contracts = generateContracts(graph.value);
  if (!contracts.ok) throw new Error(JSON.stringify(contracts.diagnostics));
  const file = contracts.value.find(({ path }) => path === 'shell.ts');
  if (file === undefined) throw new Error('no shell.ts was generated');
  return file.contents;
}

describe('a scope with no message family', () => {
  it('generates no family registry', () => {
    const contents = shellModule();

    expect(contents).toContain('export const messages = ');
    expect(contents).not.toMatch(/\bexport const families\b/u);
  });
});
