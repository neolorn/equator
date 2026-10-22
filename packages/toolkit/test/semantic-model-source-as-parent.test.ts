/**
 * A target locale whose parent is the source locale, and what the graph copies from the project.
 *
 * A locale inherits a message from a parent's catalog, and a message it leaves to a parent is not
 * missing. The source catalog is not such a parent: it is the last resort of every locale, so a
 * regional locale of the source language that omits a message, or has no catalog at all, is
 * reported like any other target.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

function catalog(
  role: 'source' | 'target',
  locale: string,
  body: string,
): Catalog {
  const result = parseCatalog(body, {
    role,
    providerId: 'home',
    scopeId: 'shell',
    locale,
    sourcePath: `i18n/shell/${locale}.yaml`,
  });
  if (!result.ok) throw new Error(`fixture ${locale} failed to parse`);
  return result.value;
}

const source = catalog(
  'source',
  'en',
  'messages:\n  greeting: Hello\n  farewell: Goodbye\n',
);

describe('a regional locale of the source language', () => {
  const configuration = testProjectConfiguration(['en', 'en-AU']);

  it('is reported for a message it omits, though the source has it', () => {
    const result = analyzeCatalogSet({
      configuration,
      catalogs: [
        source,
        catalog('target', 'en-AU', 'messages:\n  greeting: G’day\n'),
      ],
    });
    expect(result.diagnostics.map(({ code, path }) => [code, path])).toEqual([
      ['EQ1307', ['messages', 'farewell']],
    ]);
  });

  it('is reported at the document root when it has no catalog', () => {
    const result = analyzeCatalogSet({ configuration, catalogs: [source] });
    expect(result.diagnostics.map(({ code, path }) => [code, path])).toEqual([
      ['EQ1306', []],
    ]);
    expect(result.diagnostics[0]?.span).toBeUndefined();
  });
});

describe('the graph', () => {
  it('carries the person-name locales the project declares', () => {
    const result = analyzeCatalogSet({
      configuration: testProjectConfiguration(['en', 'en-AU'], {
        personNameLocales: ['en-AU'],
      }),
      catalogs: [source],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.personNameLocales).toEqual(['en-AU']);
  });

  it('carries no extension descriptors where no registry was given', () => {
    const result = analyzeCatalogSet({
      configuration: testProjectConfiguration(['en']),
      catalogs: [source],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extensionDescriptors).toEqual([]);
  });
});
