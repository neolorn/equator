/**
 * Two families that would be generated under one name.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 10 fails a generated-name collision
 * before generation. A catalog cannot hold one: a family name is lower-case, and the generated name
 * raises a letter exactly where a hyphen stood, so two names that differ give two generated names.
 * The check is the analysis's own, for a catalog no parser produced, and it is asked of the
 * analysis here with a family named `orderX` beside `order-x`.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

const configuration = testProjectConfiguration(['en-US']);

/** A catalog as a file gives it, with one family named `order-x`. */
function parsed(): Catalog {
  const catalog = parseCatalog(
    [
      'messages:',
      '  monthly.basic: Basic, monthly',
      '  yearly.basic: Basic, yearly',
      'families:',
      '  order-x: "monthly.{tier}"',
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
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  return catalog.value;
}

/** The same catalog with a second family over the other messages, under the name given. */
function withFamily(name: string): Catalog {
  const catalog = parsed();
  return {
    ...catalog,
    families: {
      ...catalog.families,
      [name]: { template: 'yearly.{tier}', segments: {} },
    },
  } as Catalog;
}

describe('two families generated under one name', () => {
  it('are refused by the analysis for a catalog that holds both', () => {
    const analyzed = analyzeCatalogSet({
      configuration,
      catalogs: [withFamily('orderX')],
    });

    expect(analyzed.ok).toBe(false);
    expect(
      analyzed.diagnostics.map(({ code, summary, path }) => ({
        code,
        summary,
        path,
      })),
    ).toEqual([
      {
        code: 'EQ1305',
        summary:
          'Open families "order-x" and "orderX" collide at generated name "orderX".',
        path: ['families', 'orderX'],
      },
    ]);
  });

  it('are both taken where the second has a generated name of its own', () => {
    const analyzed = analyzeCatalogSet({
      configuration,
      catalogs: [withFamily('order-y')],
    });

    expect(analyzed.diagnostics).toEqual([]);
    expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) return;
    expect(analyzed.value.scopes[0]?.families.map(({ name }) => name)).toEqual([
      'order-x',
      'order-y',
    ]);
  });
});
