/**
 * Plural coverage where the target is not shaped like the source, and the row a malformed locale
 * selects.
 *
 * A translation may drop the selection altogether, or select on fewer values than the source does.
 * Either way no variant supplies the categories the target grammar requires at the source's plural
 * position, so the finding is the same one a target with too few variants gets, reported against
 * the message.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import {
  analyzeCatalogSet,
  pluralCategoriesForLocale,
} from '../src/semantic-model.js';
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

function coverageFindings(
  source: readonly string[],
  target: readonly string[],
): readonly (readonly (string | number)[] | undefined)[] {
  const result = analyzeCatalogSet({
    configuration,
    catalogs: [
      catalog('source', 'en-US', source),
      catalog('target', 'ar-EG', target),
    ],
  });
  expect(result.ok).toBe(true);
  return result.diagnostics
    .filter(({ code }) => code === 'EQ1308')
    .map(({ path }) => path);
}

describe('plural coverage of a target shaped unlike its source', () => {
  it('is reported against the message when the target does not select at all', () => {
    expect(
      coverageFindings(
        [
          'messages:',
          '  cart.items: |-',
          '    .input {$count :number}',
          '    .match $count',
          '    one {{1 item}}',
          '    * {{{$count} items}}',
        ],
        ['messages:', '  cart.items: "{$count} items"'],
      ),
    ).toEqual([['messages', 'cart.items']]);
  });

  it('is reported when the target has no selector at the plural position', () => {
    expect(
      coverageFindings(
        [
          'messages:',
          '  cart.items: |-',
          '    .input {$tone :string}',
          '    .input {$count :number}',
          '    .match $tone $count',
          '    formal one {{One item}}',
          '    * * {{{$count} items}}',
        ],
        [
          'messages:',
          '  cart.items: |-',
          '    .input {$tone :string}',
          '    .match $tone',
          '    formal {{Items}}',
          '    * {{Items}}',
        ],
      ),
    ).toEqual([['messages', 'cart.items']]);
  });
});

describe('the row a locale selects', () => {
  it('is none for a locale that begins with a separator', () => {
    // Truncation stops at the first subtag, so what remains is never the empty key.
    expect(pluralCategoriesForLocale({ '': ['other'] }, '-fr')).toBeUndefined();
  });
});
