import { describe, expect, it } from 'vitest';

import {
  createPseudoCatalog,
  diffCatalogSets,
  exportXliff22,
  importXliff22,
  parseCatalog,
  planMessageRefactor,
  type Catalog,
  type ProjectConfiguration,
  type ToolkitResult,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * A catalog or a configuration an entry point other than the compiler is handed as an object.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 2 has content a caller assembled judged as
 * `parseCatalog` and `parseConfiguration` judge the same content in a file. Each entry point that
 * takes a catalog is handed one whose message body no parser accepts, and one that is not a
 * catalog at all, and is asked for the parser's diagnostic.
 */

const identity = {
  role: 'source' as const,
  providerId: '@example/app',
  scopeId: 'shell',
  locale: 'en-US',
};

function parsed(): Catalog {
  const result = parseCatalog('messages:\n  title: Home\n', identity);
  if (!result.ok) throw new Error('The catalog under test does not parse.');
  return result.value;
}

/** The parsed catalog as an object the caller assembled, with an unclosed placeholder in it. */
function unparsable(): Catalog {
  const catalog = parsed();
  return {
    ...catalog,
    messages: {
      title: { ...catalog.messages['title'], message: 'Home {$' },
    },
  } as unknown as Catalog;
}

const expected = parseCatalog('messages:\n  title: "Home {$"\n', identity);

/** An object with none of a catalog's members. */
const empty = {} as Catalog;

const configuration = testProjectConfiguration(['en-US']);

const entryPoints: readonly (readonly [
  string,
  (catalog: Catalog) => ToolkitResult<unknown>,
])[] = [
  ['exportXliff22', (source) => exportXliff22({ source })],
  [
    'exportXliff22, as the target',
    (target) => exportXliff22({ source: parsed(), target }),
  ],
  ['importXliff22', (source) => importXliff22({ document: '', source })],
  [
    'createPseudoCatalog',
    (source) => createPseudoCatalog(source, { locale: 'en-XA' }),
  ],
  [
    'diffCatalogSets',
    (catalog) =>
      diffCatalogSets({
        before: { configuration, catalogs: [parsed()] },
        after: { configuration, catalogs: [catalog] },
      }),
  ],
  [
    'planMessageRefactor',
    (catalog) =>
      planMessageRefactor({
        from: { ...identity, messageId: 'title' },
        to: { ...identity, messageId: 'heading' },
        catalogs: [catalog],
        analysis: { messageUsages: [] },
        sources: [],
      }),
  ],
];

describe('a catalog an entry point is handed as an object', () => {
  it('is refused by parseCatalog when it is read from a file', () => {
    expect(expected.ok).toBe(false);
    expect(expected.diagnostics.length).toBeGreaterThan(0);
  });

  it.each(entryPoints)(
    'is refused by %s as parseCatalog refuses its message',
    (_name, call) => {
      const result = call(unparsable());
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map(({ code }) => code)).toEqual(
        expected.diagnostics.map(({ code }) => code),
      );
    },
  );

  it.each(entryPoints)(
    'is refused by %s with a diagnostic when it has no members',
    (_name, call) => {
      const result = call(empty);
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toMatch(/^EQ11/u);
    },
  );

  it.each(entryPoints)(
    'is taken by %s as parsed when it parses',
    (_name, call) => {
      // The control: the same calls with the catalog the parser returned are not refused for the
      // catalog. An import of an empty document is refused for the document.
      const result = call(parsed());
      expect(result.diagnostics.map(({ code }) => code)).not.toContain(
        expected.diagnostics[0]?.code,
      );
    },
  );
});

describe('a configuration diffCatalogSets is handed as an object', () => {
  it('is refused as parseConfiguration refuses the same content', () => {
    const assembled = {
      ...configuration,
      sourceLocale: 'not a locale',
    } as ProjectConfiguration;
    const result = diffCatalogSets({
      before: { configuration, catalogs: [parsed()] },
      after: { configuration: assembled, catalogs: [parsed()] },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toMatch(/^EQ10/u);
  });
});
