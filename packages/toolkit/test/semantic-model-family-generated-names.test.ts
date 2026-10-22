/**
 * The generated name of a family, which is what two families may not share.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 10 fails a generated-name collision, and
 * section 9 maps a kebab-case name to lower camel case: each hyphen goes and the letter after it is
 * raised. The raised letter is what keeps `plan-a` apart from `plana`, so the two are two families.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

type Analysis =
  | { readonly families: readonly string[] }
  | { readonly refused: readonly string[] };

function analyze(first: string, second: string): Analysis {
  const catalog = parseCatalog(
    [
      'messages:',
      '  monthly.basic: Basic, monthly',
      '  yearly.basic: Basic, yearly',
      'families:',
      `  ${first}: "monthly.{tier}"`,
      `  ${second}: "yearly.{tier}"`,
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
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
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

describe('two families whose names differ only by a hyphen', () => {
  it('are both accepted, under two generated names', () => {
    expect(analyze('plan-a', 'plana')).toEqual({
      families: ['plan-a', 'plana'],
    });
  });
});
