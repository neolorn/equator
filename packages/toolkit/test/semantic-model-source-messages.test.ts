/**
 * What a scope's analysis says about its source messages as a list.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 2 makes the compiler core deterministic, and the
 * order a catalog happens to hold its messages in is not something a graph may vary with. The
 * messages of a scope are in code point order of their ids, and each carries a source fingerprint
 * taken over its contract and its source, which for a message declared empty is the statement that
 * it is empty.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { digestCanonicalJson } from '../src/canonical-json.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

function source(lines: readonly string[]): Catalog {
  const parsed = parseCatalog(['messages:', ...lines, ''].join('\n'), {
    role: 'source',
    providerId: '@example/app',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function messages(catalog: Catalog) {
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog],
  });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  const [scope] = graph.value.scopes;
  if (scope === undefined) throw new Error('The fixture has no scope');
  return scope.messages;
}

describe('the source messages of a scope', () => {
  it('are in code point order of their ids, whatever order the catalog holds them in', () => {
    const parsed = source([
      '  apple: First',
      '  mango: Second',
      '  mango.ripe: Third',
      '  zebra: Last',
    ]);
    // `parseCatalog` orders the messages it reads, so a catalog that holds them in another order
    // was assembled by a caller.
    const catalog: Catalog = {
      ...parsed,
      messages: Object.fromEntries(
        ['zebra', 'apple', 'mango.ripe', 'mango'].map((id) => [
          id,
          parsed.messages[id],
        ]),
      ) as Catalog['messages'],
    };
    expect(Object.keys(catalog.messages)).toEqual([
      'zebra',
      'apple',
      'mango.ripe',
      'mango',
    ]);

    expect(messages(catalog).map(({ messageId }) => messageId)).toEqual([
      'apple',
      'mango',
      'mango.ripe',
      'zebra',
    ]);
  });
});

describe('the source fingerprint of a message declared empty', () => {
  it('is taken over its contract, no source, and the statement that it is empty', () => {
    const [note] = messages(source(['  note:', '    empty: true']));

    expect(note?.sourceFingerprint).toBe(
      digestCanonicalJson('equator-source-message/1', {
        identity: '@example/app:shell:note',
        resultKind: 'plain',
        inputs: [],
        slots: [],
        source: null,
        empty: true,
      }),
    );
  });
});
