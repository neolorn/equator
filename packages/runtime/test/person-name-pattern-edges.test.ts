import { describe, expect, it } from 'vitest';

import {
  type FormattingResult,
  type PersonNameProfileSet,
  type PersonNameValue,
} from '@neolorn/equator/core';
import { formatPersonName, personName } from '../src/formatting.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';

/**
 * The places where a person-name pattern, a name and a profile set do not line up.
 *
 * A pattern asks for a variant the name does not carry, a name has a field that yields no initial,
 * a row lists a language only under one order, a locale tag is one the platform cannot read. Each
 * profile here is written by hand and each expected text is written out, for the reason the
 * pattern suite beside this one gives: an expectation read from the generated table agrees with
 * the formatter by construction.
 */

const ORDERS = ['givenFirst', 'surnameFirst', 'sorting'] as const;
const LENGTHS = ['long', 'medium', 'short'] as const;
const USAGES = ['referring', 'addressing', 'monogram'] as const;
const FORMALITIES = ['formal', 'informal'] as const;

interface Row {
  readonly tag: string;
  readonly pattern: (
    order: (typeof ORDERS)[number],
    length: (typeof LENGTHS)[number],
    usage: (typeof USAGES)[number],
    formality: (typeof FORMALITIES)[number],
  ) => string | undefined;
  readonly initial?: string;
  readonly foreignSpace?: string;
  readonly nativeSpace?: string;
  readonly givenFirst?: readonly string[];
  readonly surnameFirst?: readonly string[];
}

/** Cells in the axis order the generator documents: order, length, usage, formality. */
function profileSet(rows: readonly Row[]): PersonNameProfileSet {
  const patterns: string[] = [];
  const intern = (value: string): number => {
    const existing = patterns.indexOf(value);
    if (existing >= 0) return existing;
    patterns.push(value);
    return patterns.length - 1;
  };
  const encoded = rows.map((row) => {
    const cells: number[] = [];
    for (const order of ORDERS) {
      for (const length of LENGTHS) {
        for (const usage of USAGES) {
          for (const formality of FORMALITIES) {
            const pattern = row.pattern(order, length, usage, formality);
            cells.push(pattern === undefined ? -1 : intern(pattern));
          }
        }
      }
    }
    return [
      row.tag,
      cells,
      intern(row.initial ?? '{0}.'),
      intern('{0} {1}'),
      intern(row.foreignSpace ?? ' '),
      intern(row.nativeSpace ?? ' '),
      1,
      0,
      row.givenFirst ?? ['und'],
      row.surnameFirst ?? [],
    ] as const;
  });
  return {
    profile: 'cldr-48.2/equator-person-names-1',
    patterns,
    rows: encoded,
  } as PersonNameProfileSet;
}

/** A row whose every cell names the row and the order it was read for. */
const marked = (tag: string, extra: Partial<Row> = {}): Row => ({
  tag,
  pattern: (order) => `{given}[${tag}/${order}]{surname}`,
  ...extra,
});

const one = (source: string, extra: Partial<Row> = {}): PersonNameProfileSet =>
  profileSet([{ tag: 'en', pattern: () => source, ...extra }]);

const text = (result: FormattingResult): string => {
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.value.text;
};

const EN = Object.freeze({ locale: 'en' });

/**
 * A name written as an object, the way one read from storage or built by other code arrives.
 * `personName` would refuse the languages and the parts these cases need.
 */
const written = (
  language: string,
  fields: PersonNameValue['fields'],
): PersonNameValue => ({ kind: 'person-name', language, fields });

describe('the order a name is written in', () => {
  it('is given-first when the call asks for it, whatever the lists say', () => {
    const set = profileSet([marked('en', { surnameFirst: ['ja'] })]);
    const suzuki = personName('ja', { given: 'Ichiro', surname: 'Suzuki' });
    // The control: left to the lists, this name is surname-first.
    expect(text(formatPersonName(suzuki, EN, {}, set))).toBe(
      'Ichiro[en/surnameFirst]Suzuki',
    );
    expect(
      text(formatPersonName(suzuki, EN, { order: 'given-first' }, set)),
    ).toBe('Ichiro[en/givenFirst]Suzuki');
    claimCapability('format:formatPersonName');
  });

  it('is given-first for a language the given-first list names, when every other is surname-first', () => {
    const set = profileSet([
      marked('en', { givenFirst: ['en'], surnameFirst: ['und'] }),
    ]);
    expect(
      text(
        formatPersonName(
          personName('en', { given: 'Mary', surname: 'Hamish' }),
          EN,
          {},
          set,
        ),
      ),
    ).toBe('Mary[en/givenFirst]Hamish');
    claimCapability('format:formatPersonName');
  });

  it('is the order of every language for a name whose language begins with a separator', () => {
    // The walk up the name's language stops at its first separator. Past it there is no language
    // left, and an empty entry in a list is not a language to match.
    const set = profileSet([
      marked('en', { givenFirst: ['und'], surnameFirst: [''] }),
    ]);
    expect(
      text(
        formatPersonName(
          written('-x', { given: 'Mary', surname: 'Hamish' }),
          EN,
          {},
          set,
        ),
      ),
    ).toBe('Mary[en/givenFirst]Hamish');
    claimCapability('format:formatPersonName');
  });

  it('is surname-first for a language neither list names, when the row says so of every language', () => {
    const set = profileSet([
      marked('en', { givenFirst: ['en'], surnameFirst: ['und'] }),
    ]);
    expect(
      text(
        formatPersonName(
          personName('de', { given: 'Max', surname: 'Meyer' }),
          EN,
          {},
          set,
        ),
      ),
    ).toBe('Max[en/surnameFirst]Meyer');
    claimCapability('format:formatPersonName');
  });
});

describe('the row a name is formatted by', () => {
  const mary = personName('en', { given: 'Mary', surname: 'Hamish' });

  it('is the interface row when the interface tag has no script to compare', () => {
    // `en_US` is not a tag the platform reads, so there is no script to find different from the
    // name's, and the row is found by the spelling the application gave it.
    const set = profileSet([marked('en_US'), marked('ja')]);
    expect(
      text(
        formatPersonName(
          personName('ja', { given: 'Ichiro', surname: 'Suzuki' }),
          { locale: 'en_US' },
          { order: 'given-first' },
          set,
        ),
      ),
    ).toBe('Ichiro[en_US/givenFirst]Suzuki');
    claimCapability('format:formatPersonName');
  });

  it('is the interface row when the name language has no script to compare', () => {
    // `ja_JP` is not a tag any platform reads, so no host has a script for it, and the name's own
    // row is passed over although the set carries one.
    const set = profileSet([marked('en'), marked('ja_JP')]);
    expect(
      text(
        formatPersonName(
          written('ja_JP', { given: 'Mary', surname: 'Hamish' }),
          EN,
          {},
          set,
        ),
      ),
    ).toBe('Mary[en/givenFirst]Hamish');
    claimCapability('format:formatPersonName');
  });

  it('is the row of the name language when its script is not the interface script', () => {
    // The control for the case above: with a language every platform reads, the name's row is used.
    const set = profileSet([marked('en'), marked('ja')]);
    expect(
      text(
        formatPersonName(
          personName('ja', { given: 'Mary', surname: 'Hamish' }),
          EN,
          { order: 'given-first' },
          set,
        ),
      ),
    ).toBe('Mary[ja/givenFirst]Hamish');
    claimCapability('format:formatPersonName');
  });

  it('is root for a tag that begins with a separator, not a row with an empty tag', () => {
    const set = profileSet([marked('')]);
    expect(text(formatPersonName(mary, { locale: '-x' }, {}, set))).toBe(
      'Mary Hamish',
    );
    claimCapability('format:formatPersonName');
  });

  it('reads an addressing pattern that happens to be the first one in the set', () => {
    // The first cell laid out is given-first, long, referring, formal, so its pattern is the first
    // in the set; the surname-first addressing cell shares it and the referring one does not.
    const set = profileSet([
      {
        tag: 'en',
        pattern: (order, _length, usage) =>
          order === 'givenFirst' || usage === 'addressing'
            ? '{given}[shared]{surname}'
            : `{given}[${order}/${usage}]{surname}`,
      },
    ]);
    expect(
      text(
        formatPersonName(
          mary,
          EN,
          { order: 'surname-first', length: 'long', usage: 'addressing' },
          set,
        ),
      ),
    ).toBe('Mary[shared]Hamish');
    claimCapability('format:formatPersonName');
  });

  it('reports a combination the row has no pattern for', () => {
    const set = profileSet([{ tag: 'en', pattern: () => undefined }]);
    const result = formatPersonName(mary, EN, {}, set);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.diagnostic.code).toBe(
      'unsupported-formatting-capability',
    );
    expect(!result.ok && result.diagnostic.reason).toBe(
      'native-capability-rejected',
    );
    claimCapability('format:formatPersonName');
  });
});

describe('variants a name does not carry', () => {
  it('falls back to the plain field for vocative and genitive', () => {
    expect(
      text(
        formatPersonName(
          personName('en', { given: 'Mary', surname: 'Hamish' }),
          EN,
          {},
          one('{given-vocative} {surname-genitive}'),
        ),
      ),
    ).toBe('Mary Hamish');
    claimCapability('format:formatPersonName');
  });

  it('does not build a core out of a prefix', () => {
    expect(
      text(
        formatPersonName(
          personName('nl', { given: 'Rein', 'surname-prefix': 'van der' }),
          EN,
          {},
          one('{given} {surname-core}'),
        ),
      ),
    ).toBe('Rein');
    claimCapability('format:formatPersonName');
  });

  it('derives a plain surname from a core alone', () => {
    expect(
      text(
        formatPersonName(
          personName('nl', { given: 'Rein', 'surname-core': 'Poel' }),
          EN,
          {},
          one('{given} {surname}'),
        ),
      ),
    ).toBe('Rein Poel');
    claimCapability('format:formatPersonName');
  });

  it('derives a plain surname from a prefix alone', () => {
    expect(
      text(
        formatPersonName(
          personName('nl', { given: 'Rein', 'surname-prefix': 'van der' }),
          EN,
          {},
          one('{surname}, {given}'),
        ),
      ),
    ).toBe('van der, Rein');
    claimCapability('format:formatPersonName');
  });
});

describe('initials and monograms', () => {
  it('leaves a placeholder the initial pattern has no value for as written', () => {
    expect(
      text(
        formatPersonName(
          personName('en', { given: 'Mary', surname: 'Hamish' }),
          EN,
          {},
          one('{given-initial} {surname}', { initial: '{0}.{1}' }),
        ),
      ),
    ).toBe('M.{1} Hamish');
    claimCapability('format:formatPersonName');
  });

  it('writes no initial for a field with no word in it', () => {
    expect(
      text(
        formatPersonName(
          personName('en', { given: '-', surname: 'Hamish' }),
          EN,
          {},
          one('{given-initial} {surname}'),
        ),
      ),
    ).toBe('Hamish');
    claimCapability('format:formatPersonName');
  });

  it('takes a whole grapheme for a monogram, not its first code point', () => {
    // A letter and a combining mark that have no single composed form, so normalizing the name
    // leaves two code points for one written character.
    const marked = `q${String.fromCodePoint(0x301)}`;
    expect(marked.normalize('NFC')).toHaveLength(2);
    expect(
      text(
        formatPersonName(
          personName('en', { given: `${marked}uentin`, surname: 'Hamish' }),
          EN,
          {},
          one('{given-monogram}{surname-monogram}'),
        ),
      ),
    ).toBe(`${marked}H`);
    claimCapability('format:formatPersonName');
  });
});

describe('literals around fields a name does not carry', () => {
  const mary = personName('en', { given: 'Mary', surname: 'Hamish' });

  it('removes a run of empty fields that starts right after a populated one', () => {
    expect(
      text(
        formatPersonName(
          mary,
          EN,
          {},
          one('{given}{given2}|{surname2} {surname}'),
        ),
      ),
    ).toBe('Mary Hamish');
    claimCapability('format:formatPersonName');
  });

  it('makes one character of a longer whitespace run where two literals meet', () => {
    expect(
      text(formatPersonName(mary, EN, {}, one('{given} {given2}  -{surname}'))),
    ).toBe('Mary -Hamish');
    claimCapability('format:formatPersonName');
  });

  it('makes one literal part of an unrecognised placeholder and its neighbours', () => {
    const result = formatPersonName(
      mary,
      EN,
      {},
      one('{given} {nickname} {surname}'),
    );
    expect(result.ok && result.value.semantic).toBe('person-name');
    expect(result.ok && result.value.parts).toEqual([
      { kind: 'given', value: 'Mary', language: 'en', direction: 'ltr' },
      {
        kind: 'literal',
        value: ' {nickname} ',
        language: 'en',
        direction: 'ltr',
      },
      { kind: 'surname', value: 'Hamish', language: 'en', direction: 'ltr' },
    ]);
    claimCapability('format:formatPersonName');
  });

  it('writes no part for a pattern space the locale replaces with nothing', () => {
    const result = formatPersonName(
      mary,
      EN,
      {},
      one('{surname} {given}', { nativeSpace: '' }),
    );
    expect(result.ok && result.value.parts).toEqual([
      { kind: 'surname', value: 'Hamish', language: 'en', direction: 'ltr' },
      { kind: 'given', value: 'Mary', language: 'en', direction: 'ltr' },
    ]);
    claimCapability('format:formatPersonName');
  });

  it('joins a name in the interface language natively when the platform cannot read the interface tag', () => {
    // A trailing separator is not a tag the platform reads, so the base language is the first
    // subtag as written, whatever its casing.
    expect(
      text(
        formatPersonName(
          mary,
          { locale: 'EN-us-' },
          {},
          one('{given} {surname}', { nativeSpace: '', foreignSpace: '+' }),
        ),
      ),
    ).toBe('MaryHamish');
    claimCapability('format:formatPersonName');
  });
});

describe('the ceiling on the parts of a formatted name', () => {
  const PARTS = 65_536;

  it('admits a name of exactly as many parts as the ceiling', () => {
    const result = formatPersonName(
      personName('en', { given: 'M' }),
      EN,
      {},
      one('{given}'.repeat(PARTS)),
    );
    expect(result.ok && result.value.parts).toHaveLength(PARTS);
    claimCapability('format:formatPersonName');
  });

  it('refuses a name of more parts than the ceiling whose text is within it', () => {
    // Two halves of one character, held in two fields: each pair is two parts and one code point,
    // so the parts pass the ceiling while the text is half of it. `personName` refuses half a
    // character, so the name is one written as an object.
    const result = formatPersonName(
      written('en', {
        given: String.fromCharCode(0xd83d),
        surname: String.fromCharCode(0xde00),
      }),
      EN,
      {},
      one('{given}{surname}'.repeat(PARTS / 2 + 1)),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.diagnostic.code).toBe(
      'unsupported-formatting-capability',
    );
    claimCapability('format:formatPersonName');
  });
});
