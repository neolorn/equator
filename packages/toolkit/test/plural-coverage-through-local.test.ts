import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

const configuration = testProjectConfiguration(['en-US', 'ar-EG']);

function catalog(
  role: 'source' | 'target',
  locale: string,
  lines: readonly string[],
): Catalog {
  const result = parseCatalog([...lines, ''].join('\n'), {
    role,
    providerId: 'home',
    scopeId: 'shell',
    locale,
    sourcePath: `i18n/shell/${locale}.yaml`,
  });
  if (!result.ok) throw new Error(`fixture ${locale} failed to parse`);
  return result.value;
}

function missingCategories(message: readonly string[]): number {
  const lines = ['messages:', '  cart.items: |-', ...message];
  const result = analyzeCatalogSet({
    configuration,
    catalogs: [
      catalog('source', 'en-US', lines),
      catalog('target', 'ar-EG', lines),
    ],
  });
  expect(result.ok).toBe(true);
  return result.diagnostics.filter(({ code }) => code === 'EQ1308').length;
}

const direct = [
  '    .input {$count :number}',
  '    .match $count',
  '    one {{1}}',
  '    * {{n}}',
];

// A `.local` bound to a variable with no function of its own selects as that variable does, so a
// translation that omits a category is as incomplete as one that selects on the input itself.
describe('plural coverage of a selector bound through .local', () => {
  it('reports what selecting on the input itself reports', () => {
    const expected = missingCategories(direct);
    expect(expected).toBeGreaterThan(0);
    expect(
      missingCategories([
        '    .input {$count :number}',
        '    .local $c = {$count}',
        '    .match $c',
        '    one {{1}}',
        '    * {{n}}',
      ]),
    ).toBe(expected);
  });

  it('follows a chain of bindings to the function', () => {
    expect(
      missingCategories([
        '    .input {$count :number}',
        '    .local $a = {$count}',
        '    .local $b = {$a}',
        '    .match $b',
        '    one {{1}}',
        '    * {{n}}',
      ]),
    ).toBe(missingCategories(direct));
  });

  it('reads the function a binding names over the one it was bound from', () => {
    expect(
      missingCategories([
        '    .input {$count :number}',
        '    .local $c = {$count :number select=exact}',
        '    .match $c',
        '    1 {{1}}',
        '    * {{n}}',
      ]),
    ).toBe(0);
  });
});
