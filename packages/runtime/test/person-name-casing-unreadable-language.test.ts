import { describe, expect, it } from 'vitest';

import {
  type FormattingResult,
  type PersonNameProfileSet,
  type PersonNameValue,
} from '@neolorn/equator/core';
import { formatPersonName } from '../src/formatting.js';

/**
 * The casing of a name whose language tag the platform cannot read.
 *
 * A pattern may ask for a field in capitals, or with its first character capitalized, and the
 * capitals are the name's own language's: a Turkish name capitalizes `i` to a dotted capital. The
 * platform is asked by the name's tag, and a name read from storage with a tag the platform refuses
 * has no language to ask in. The field is then cased as a name of no stated language is, by the
 * mapping that belongs to no locale, where a throw would take the whole name with it.
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
const UNREADABLE = 'tr_TR';

describe('the casing of a name in a language the platform cannot read', () => {
  it('is asked of a tag the platform refuses to case by', () => {
    expect(() => 'i'.toLocaleUpperCase(UNREADABLE)).toThrow(RangeError);
  });

  it('writes a field in the capitals of no stated language', () => {
    expect(
      text(
        formatPersonName(
          written(UNREADABLE, { given: 'ali', surname: 'veli' }),
          EN,
          {},
          one('{given} {surname-allCaps}'),
        ),
      ),
    ).toBe('ali VELI');
  });

  it('capitalizes the first character of a field the same way', () => {
    expect(
      text(
        formatPersonName(
          written(UNREADABLE, { given: 'ilkay', surname: 'veli' }),
          EN,
          {},
          one('{given-initialCap} {surname}'),
        ),
      ),
    ).toBe('Ilkay veli');
  });

  it('writes the monogram the shipped patterns ask for in capitals', () => {
    expect(
      text(
        formatPersonName(
          written(UNREADABLE, { given: 'mary', surname: 'hamish' }),
          EN,
          { usage: 'monogram' },
        ),
      ),
    ).toBe('MH');
  });

  it('still cases by the language of a name whose tag the platform reads', () => {
    expect(
      text(
        formatPersonName(
          written('tr', { given: 'ali', surname: 'veli' }),
          EN,
          {},
          one('{given} {surname-allCaps}'),
        ),
      ),
    ).toBe('ali VELİ');
  });
});
