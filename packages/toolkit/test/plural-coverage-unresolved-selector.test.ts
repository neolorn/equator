/**
 * Plural coverage of a selector whose bindings reach no function.
 *
 * `parseCatalog` refuses a `.match` selector that reaches no function, so a catalog that holds one
 * was assembled by a caller. Such a selector has no category system to check a target against, and
 * the analysis reads it that way: it reports no missing category and it ends.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

const configuration = testProjectConfiguration(['en-US', 'ar-EG']);

function parsed(role: 'source' | 'target', locale: string): Catalog {
  const result = parseCatalog(
    [
      'messages:',
      '  cart.items: |-',
      '    .input {$count :number}',
      '    .local $c = {$count}',
      '    .match $c',
      '    one {{1}}',
      '    * {{n}}',
      '',
    ].join('\n'),
    {
      role,
      providerId: 'home',
      scopeId: 'shell',
      locale,
      sourcePath: `i18n/shell/${locale}.yaml`,
    },
  );
  if (!result.ok) throw new Error(`fixture ${locale} failed to parse`);
  return result.value;
}

/** The parsed catalog, selecting on `$c`, with its declarations replaced. */
function declaring(
  catalog: Catalog,
  declarations: readonly unknown[],
): Catalog {
  const message = catalog.messages['cart.items'];
  if (message?.kind !== 'message') throw new Error('Catalog fixture failed');
  return {
    ...catalog,
    messages: {
      'cart.items': {
        ...message,
        semantics: { ...message.semantics, declarations },
      },
    },
  } as unknown as Catalog;
}

/**
 * How many missing-category findings the Arabic target draws. Both catalogs carry the same
 * declarations, so the target differs from the source in nothing but its locale.
 */
function missingCategories(declarations: readonly unknown[]): number {
  const result = analyzeCatalogSet({
    configuration,
    catalogs: [
      declaring(parsed('source', 'en-US'), declarations),
      declaring(parsed('target', 'ar-EG'), declarations),
    ],
  });
  expect(result.ok).toBe(true);
  return result.diagnostics.filter(({ code }) => code === 'EQ1308').length;
}

const local = (name: string | undefined, value: object): unknown => ({
  kind: 'local',
  name,
  value: { kind: 'expression', attributes: {}, ...value },
});
const variable = (name: string): object => ({
  operand: { kind: 'variable', name },
});
const numberFunction = { function: { name: 'number', options: {} } };

describe('plural coverage of a selector assembled by a caller', () => {
  it('reports the missing categories where the bindings reach a function', () => {
    expect(
      missingCategories([
        local('c', variable('count')),
        local('count', { ...variable('total'), ...numberFunction }),
      ]),
    ).toBe(1);
  });

  it('reports nothing where the bindings lead back to the selector', () => {
    expect(
      missingCategories([local('c', variable('d')), local('d', variable('c'))]),
    ).toBe(0);
    expect(missingCategories([local('c', variable('c'))])).toBe(0);
  });

  it('reports nothing where a binding names a variable nothing declares', () => {
    expect(missingCategories([local('c', variable('count'))])).toBe(0);
  });

  it('reports nothing where nothing declares the selector', () => {
    expect(missingCategories([])).toBe(0);
  });

  it('reports nothing where the binding has neither an operand nor a function', () => {
    expect(missingCategories([local('c', {})])).toBe(0);
  });

  it('reports nothing where the binding is a literal with no function', () => {
    expect(
      missingCategories([
        local('c', { operand: { kind: 'literal', value: '1' } }),
      ]),
    ).toBe(0);
  });

  it('does not continue a chain that ended into a declaration that has no name', () => {
    expect(
      missingCategories([
        local('c', variable('count')),
        local(undefined, numberFunction),
      ]),
    ).toBe(0);
  });
});
