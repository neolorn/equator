/**
 * The order a catalog's families are read in, which is the order of their names and not the order
 * the catalog holds them in.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 10. A parsed catalog already holds its
 * families by name, and a catalog a caller assembled need not. Either way two orderings of one
 * `families` record are one catalog: they produce the same families in the same order, and where
 * two families collide the same one of the two is refused.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

type Analysis =
  | { readonly families: readonly string[] }
  | { readonly refused: readonly string[] };

/** The catalog of `families`, rebuilt to hold them in the order `held` names them. */
function analyze(
  families: readonly string[],
  held: readonly string[],
): Analysis {
  const parsed = parseCatalog(
    [
      'messages:',
      '  zone.north: North',
      '  area.north: North',
      '  mark.north: North',
      'families:',
      ...families,
      '',
    ].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/family-lab',
      scopeId: 'orders',
      locale: 'en-US',
      sourcePath: 'i18n/orders/en-US.yaml',
    },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const catalog: Catalog = {
    ...parsed.value,
    families: Object.fromEntries(
      held.map((name) => [name, parsed.value.families[name]]),
    ) as Catalog['families'],
  };
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog],
  });
  return graph.ok
    ? {
        families: (graph.value.scopes[0]?.families ?? []).map(
          ({ name }) => name,
        ),
      }
    : {
        refused: graph.diagnostics.map(
          ({ code, path }) => `${code} ${path.join('/')}`,
        ),
      };
}

describe("a catalog's families", () => {
  const distinct = [
    '  zone: "zone.{side}"',
    '  area: "area.{side}"',
    '  mark: "mark.{side}"',
  ];

  it.each([
    ['in name order', ['area', 'mark', 'zone']],
    ['in reverse name order', ['zone', 'mark', 'area']],
    ['in neither order', ['mark', 'zone', 'area']],
  ])('are produced in name order when held %s', (_label, held) => {
    expect(analyze(distinct, held)).toEqual({
      families: ['area', 'mark', 'zone'],
    });
  });
});

describe('two families with one template', () => {
  const twins = ['  first: "zone.{side}"', '  second: "zone.{side}"'];

  it.each([
    ['first', ['first', 'second']],
    ['last', ['second', 'first']],
  ])('are refused at the later name when it is held %s', (_label, held) => {
    expect(analyze(twins, held)).toEqual({
      refused: ['EQ1305 families/second'],
    });
  });
});
