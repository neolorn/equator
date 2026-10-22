/**
 * What a set of catalogs has to be before it is a model, and the order the model comes out in.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 2 makes the compiler core deterministic, so the
 * order a caller hands catalogs over in is not something a graph may vary with: scopes are in code
 * point order of provider and then scope, and the targets of a message in code point order of their
 * locales. A catalog for a locale the project does not declare, a scope with no source catalog, a
 * source catalog with no message and a catalog whose role contradicts its locale are each refused
 * against the catalog that is wrong.
 */
import { describe, expect, it } from 'vitest';

import {
  parseCatalog,
  type Catalog,
  type ToolkitDiagnostic,
} from '../src/index.js';
import { digestCanonicalJson } from '../src/canonical-json.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

const configuration = testProjectConfiguration(['en-US', 'fr', 'de']);

function catalog(
  role: 'source' | 'target',
  locale: string,
  lines: readonly string[],
  providerId = '@example/app',
  scopeId = 'shell',
): Catalog {
  const result = parseCatalog(['messages:', ...lines, ''].join('\n'), {
    role,
    providerId,
    scopeId,
    locale,
    sourcePath: `i18n/${providerId}/${scopeId}/${locale}.yaml`,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

const note = ['  note: Read this'];
const extra = ['  extra: Not in the source'];

/** The code, the pointer and the file of a finding. One at the root of a catalog has no span. */
function located({ code, path, span }: ToolkitDiagnostic): string {
  return `${code} /${path.join('/')} ${span?.sourcePath ?? '(no span)'}`;
}

function findings(catalogs: readonly Catalog[]): readonly string[] {
  return analyzeCatalogSet({ configuration, catalogs }).diagnostics.map(
    located,
  );
}

function scopes(catalogs: readonly Catalog[]) {
  const graph = analyzeCatalogSet({ configuration, catalogs });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  return graph.value.scopes;
}

describe('a catalog set', () => {
  it('is refused when a catalog is for a locale the project does not declare', () => {
    const result = analyzeCatalogSet({
      configuration,
      catalogs: [
        catalog('source', 'en-US', note),
        catalog('target', 'fr', note),
        catalog('target', 'de', note),
        catalog('target', 'ja', extra),
      ],
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.map(
        (diagnostic) => `${diagnostic.severity} ${located(diagnostic)}`,
      ),
    ).toEqual([
      'error EQ1301 / (no span)',
      'error EQ1304 /messages/extra i18n/@example/app/shell/ja.yaml',
      'warning EQ1307 /messages/note i18n/@example/app/shell/ja.yaml',
    ]);
  });

  it('is refused when a scope has no catalog for the source locale', () => {
    expect(
      findings([
        catalog('source', 'en-US', note),
        catalog('target', 'fr', note),
        catalog('target', 'de', note),
        catalog('target', 'fr', note, '@example/app', 'orders'),
      ]),
    ).toEqual(['EQ1301 / (no span)']);
  });

  it('is refused once, and the scope left unread, when the catalog for the source locale declares the target role', () => {
    expect(findings([catalog('target', 'en-US', note)])).toEqual([
      'EQ1301 / (no span)',
    ]);
  });

  it('is refused at the messages of a source catalog that has none', () => {
    // `parseCatalog` refuses a catalog with no message, so one that has none was assembled by a
    // caller.
    const empty: Catalog = {
      ...catalog('source', 'en-US', note),
      messages: {},
    };

    expect(
      analyzeCatalogSet({
        configuration: testProjectConfiguration(['en-US']),
        catalogs: [empty],
      }).diagnostics.map(located),
    ).toEqual(['EQ1301 /messages (no span)']);
  });

  it('refuses a catalog of another locale that declares the source role, and does not read it as a target', () => {
    expect(
      findings([
        catalog('source', 'en-US', note),
        catalog('source', 'fr', [...note, ...extra]),
        catalog('target', 'de', note),
      ]),
    ).toEqual(['EQ1301 / (no span)']);
  });
});

describe('the scopes of a graph', () => {
  const first = catalog('source', 'en-US', note, '@example/app', 'zeta');
  const second = catalog('source', 'en-US', note, '@example/orders', 'alpha');
  const third = catalog('source', 'en-US', note, '@example/orders', 'beta');
  const ordered = [
    '@example/app zeta',
    '@example/orders alpha',
    '@example/orders beta',
  ];

  it.each([
    ['in that order already', [first, second, third]],
    ['in the reverse order', [third, second, first]],
    ['with the providers interleaved', [second, first, third]],
    ['with the scopes of one provider swapped', [first, third, second]],
    ['with the first provider last', [third, first, second]],
    ['with the first provider in the middle', [second, third, first]],
  ])(
    'are in code point order of provider and then scope when the catalogs come %s',
    (_, catalogs) => {
      const lenient = analyzeCatalogSet({
        configuration: testProjectConfiguration(['en-US']),
        catalogs,
      });
      if (!lenient.ok) throw new Error(JSON.stringify(lenient.diagnostics));

      expect(
        lenient.value.scopes.map(
          ({ providerId, scopeId }) => `${providerId} ${scopeId}`,
        ),
      ).toEqual(ordered);
    },
  );
});

describe('the targets of a message', () => {
  it('are in code point order of their locales, whatever order the catalogs come in', () => {
    const [scope] = scopes([
      catalog('target', 'fr', note),
      catalog('source', 'en-US', note),
      catalog('target', 'de', note),
    ]);

    expect(scope?.messages[0]?.targets.map(({ locale }) => locale)).toEqual([
      'de',
      'fr',
    ]);
  });

  it('are reported in code point order of their locales when each invents a message', () => {
    const invented = [...note, ...extra];

    expect(
      findings([
        catalog('target', 'fr', invented),
        catalog('source', 'en-US', note),
        catalog('target', 'de', invented),
      ]),
    ).toEqual([
      'EQ1304 /messages/extra i18n/@example/app/shell/de.yaml',
      'EQ1304 /messages/extra i18n/@example/app/shell/fr.yaml',
    ]);
  });
});

describe('the source fingerprint of a message with a pattern', () => {
  it('is taken over its contract, its canonical source, and the statement that it is not empty', () => {
    const source = catalog('source', 'en-US', note);
    const authored = source.messages['note'];
    if (authored?.kind !== 'message') {
      throw new Error('The fixture message has no pattern');
    }
    const [scope] = scopes([
      source,
      catalog('target', 'fr', note),
      catalog('target', 'de', note),
    ]);

    expect(scope?.messages[0]?.sourceFingerprint).toBe(
      digestCanonicalJson('equator-source-message/1', {
        identity: '@example/app:shell:note',
        resultKind: 'plain',
        inputs: [],
        slots: [],
        source: authored.semantics.canonicalSource,
        empty: false,
      }),
    );
  });
});

describe('the semantic-registry fingerprint of a scope', () => {
  const expected = digestCanonicalJson('equator-scope-semantic-registry/1', {
    builtInKinds: ['link:paired', 'strong:paired'],
    extensions: [],
  });
  const link = '"{#link}Read this{/link}"';
  const strong = '"{#strong}Read this{/strong}"';

  it.each([
    ['first', [`  first: ${link}`, `  second: ${strong}`]],
    ['second', [`  first: ${strong}`, `  second: ${link}`]],
  ])(
    'lists the referenced kinds in code point order when the %s message uses the link',
    (_, lines) => {
      const [scope] = scopes([
        catalog('source', 'en-US', lines),
        catalog('target', 'fr', lines),
        catalog('target', 'de', lines),
      ]);

      expect(scope?.semanticRegistryFingerprint).toBe(expected);
    },
  );
});
