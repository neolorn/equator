import { describe, expect, it } from 'vitest';

import {
  type FormattingResult,
  type PersonNameProfileSet,
  type PersonNameValue,
} from '@neolorn/equator/core';
import { formatPersonName } from '../src/formatting.js';

/**
 * A monogram of a name whose language tag the platform cannot read.
 *
 * A monogram is the first written character of a field, and the platform's segmenter is what
 * finds where that character ends. The segmenter is made for the name's own language, so a name
 * read from storage with a tag the platform refuses has no segmenter to ask. The field then gives
 * its first code point, and a field with no text gives nothing, where a throw would take the whole
 * name with it.
 */

/** One row for `en` whose every cell is `pattern`, in the layout the generator documents. */
const one = (pattern: string): PersonNameProfileSet =>
  ({
    profile: 'cldr-48.2/equator-person-names-1',
    patterns: [pattern, '{0}.', '{0} {1}', ' '],
    rows: [
      [
        'en',
        Array.from({ length: 54 }, () => 0),
        1,
        2,
        3,
        3,
        1,
        0,
        ['und'],
        [],
      ],
    ],
  }) as unknown as PersonNameProfileSet;

/** A name written as an object, the way one read from storage arrives. */
const written = (
  language: string,
  fields: PersonNameValue['fields'],
): PersonNameValue => ({ kind: 'person-name', language, fields });

const text = (result: FormattingResult): string => {
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.value.text;
};

const EN = Object.freeze({ locale: 'en' });

/** An underscore where a hyphen belongs, which the platform refuses as a language tag. */
const UNREADABLE = 'ja_JP';

describe('a monogram of a name in a language the platform cannot read', () => {
  it('is asked of a tag the platform refuses a segmenter for', () => {
    expect(() => new Intl.Segmenter(UNREADABLE)).toThrow(RangeError);
  });

  it('is the first code point of the field', () => {
    expect(
      text(
        formatPersonName(
          written(UNREADABLE, { given: 'Mary', surname: 'Hamish' }),
          EN,
          {},
          one('{given-monogram}{surname-monogram}'),
        ),
      ),
    ).toBe('MH');
  });

  it('is a whole code point outside the basic plane, not half of one', () => {
    const given = `${String.fromCodePoint(0x20bb7)}野`;

    expect(
      text(
        formatPersonName(
          written(UNREADABLE, { given, surname: 'Hamish' }),
          EN,
          {},
          one('{given-monogram}|{surname}'),
        ),
      ),
    ).toBe(`${String.fromCodePoint(0x20bb7)}|Hamish`);
  });

  it('is nothing for a field the name does not carry', () => {
    expect(
      text(
        formatPersonName(
          written(UNREADABLE, { surname: 'Hamish' }),
          EN,
          {},
          one('{given-monogram}|{surname}'),
        ),
      ),
    ).toBe('Hamish');
  });
});
