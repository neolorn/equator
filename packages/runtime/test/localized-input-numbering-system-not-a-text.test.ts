import { describe, expect, it } from 'vitest';

import { decimal } from '../src/formatting.js';
import {
  formatLocalizedInput,
  parseLocalizedInput,
} from '../src/localized-input.js';

/**
 * A context is built by the application, from a setting or a stored preference, and the numbering
 * system in it can be anything that was stored. Something that is not a text is not an identifier,
 * whatever it would spell if it were turned into one: `null` and `true` spell four letters, and a
 * list of one identifier spells that identifier.
 */

const NOT_A_TEXT: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['true', true],
  ['a number', 5],
  ['a list holding an identifier', ['latn']],
  ['an object', {}],
];

describe('a numbering system that is not a text', () => {
  it.each(NOT_A_TEXT)('refuses to read under %s', (_name, numberingSystem) => {
    const context = { locale: 'en-US', numberingSystem };
    expect(
      parseLocalizedInput('5', { kind: 'decimal' }, context as never),
    ).toMatchObject({
      status: 'policy-rejected',
      diagnostic: { code: 'invalid-configuration' },
    });
  });

  it.each(NOT_A_TEXT)('refuses to write under %s', (_name, numberingSystem) => {
    const context = { locale: 'en-US', numberingSystem };
    expect(
      formatLocalizedInput(decimal('5'), { kind: 'decimal' }, context as never),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-configuration' },
    });
  });

  it('reads and writes under the identifier the list held', () => {
    const context = { locale: 'en-US', numberingSystem: 'latn' };
    expect(
      parseLocalizedInput('5', { kind: 'decimal' }, context),
    ).toMatchObject({ status: 'valid', value: { value: '5' } });
    expect(
      formatLocalizedInput(decimal('5'), { kind: 'decimal' }, context),
    ).toMatchObject({ ok: true, value: { text: '5' } });
  });
});
