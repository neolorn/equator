import { describe, expect, it } from 'vitest';

import { decimal, money, percent } from '../src/formatting.js';
import { parseLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * What a numeric field declares about its range, its precision and its length, and what a reading
 * reports when the text or the declaration falls outside it.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 6: a parser states its range and
 * precision, and a result is one of seven statuses of which only the valid one carries a value.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

/** The value read, or the status that says why there is none. */
function reading(text: string, profile: object): unknown {
  const result = parseLocalizedInput(
    text,
    profile as LocalizedInputProfile,
    EN,
  );
  return result.status === 'valid' ? result.value : result.status;
}

function between(minimum?: string, maximum?: string): object {
  return {
    kind: 'decimal',
    ...(minimum === undefined ? {} : { minimum: decimal(minimum) }),
    ...(maximum === undefined ? {} : { maximum: decimal(maximum) }),
  };
}

describe('what a numeric reading hands back', () => {
  it('is the text and the value, and nothing else, when it is valid', () => {
    expect(parseLocalizedInput('42', { kind: 'decimal' }, EN)).toStrictEqual({
      status: 'valid',
      text: '42',
      value: decimal('42'),
    });
  });

  it('is the text and an input diagnostic for its locale when it is not', () => {
    expect(parseLocalizedInput('12x', { kind: 'decimal' }, EN)).toStrictEqual({
      status: 'invalid',
      text: '12x',
      diagnostic: {
        code: 'invalid-localized-input',
        outcome: 'operational-failure',
        message: expect.any(String) as string,
        targetLocale: 'en-US',
      },
    });
  });

  it('names a missing capability, not bad input, when the host cannot express the field', () => {
    const profile = {
      kind: 'measurement',
      unit: 'not-a-unit',
      requireUnit: true,
    } as const;
    expect(parseLocalizedInput('5', profile, EN)).toStrictEqual({
      status: 'unsupported-capability',
      text: '5',
      diagnostic: {
        code: 'unsupported-input-capability',
        outcome: 'operational-failure',
        message: expect.any(String) as string,
        targetLocale: 'en-US',
      },
    });
  });

  it('says the host refused, when the host refuses the locale itself', () => {
    const context = { locale: 'not a locale' };
    expect(
      parseLocalizedInput('5', { kind: 'decimal' }, context),
    ).toStrictEqual({
      status: 'unsupported-capability',
      text: '5',
      diagnostic: {
        code: 'unsupported-input-capability',
        outcome: 'operational-failure',
        message: expect.any(String) as string,
        targetLocale: 'not a locale',
        reason: 'native-capability-rejected',
      },
    });
  });
});

describe('the declared range of a numeric field', () => {
  it.each([
    ['the minimum itself', '5', '5', undefined],
    ['the maximum itself', '5', undefined, '5'],
    ['a value between the two', '7', '5', '10'],
    ['the one value a closed range holds', '5', '5', '5'],
    ['a longer number above a shorter minimum', '12', '5', undefined],
    ['a whole number under a fractional maximum', '2', undefined, '2.5'],
    ['a fraction under a whole maximum', '2.5', undefined, '3'],
    ['a fraction under a finer maximum', '2.5', undefined, '2.55'],
    ['a finer fraction above a minimum', '2.55', '2.5', undefined],
    ['a fraction equal to a whole bound', '3.0', '3', '3'],
    ['a negative above a negative minimum', '-5', '-10', undefined],
    ['a negative under a negative maximum', '-7', undefined, '-6'],
    ['a negative under a positive maximum', '-5', undefined, '2'],
    ['a negative fraction above its minimum', '-0.25', '-0.5', undefined],
    ['zero above a negative minimum', '0', '-0.5', undefined],
  ] as const)('accepts %s', (_label, text, minimum, maximum) => {
    expect(reading(text, between(minimum, maximum))).toEqual(
      decimal(text === '3.0' ? '3' : text),
    );
  });

  it.each([
    ['a value below the minimum', '4', '5', undefined],
    ['a value above the maximum', '6', undefined, '5'],
    ['a whole number above a fractional maximum', '3', undefined, '2.5'],
    ['a fraction above a whole maximum', '3.5', undefined, '3'],
    ['a finer fraction above a maximum', '2.56', undefined, '2.5'],
    ['a fraction just above a finer maximum', '2.6', undefined, '2.55'],
    ['a fraction below a finer minimum', '2.5', '2.55', undefined],
    ['a finer fraction below a minimum', '2.45', '2.5', undefined],
    ['a whole number below a fractional minimum', '2', '2.5', undefined],
    ['a negative below a negative minimum', '-11', '-10', undefined],
    ['a negative above a negative maximum', '-5', undefined, '-6'],
    ['a negative below a positive minimum', '-5', '2', undefined],
    ['a positive above a negative maximum', '5', undefined, '-2'],
    ['a negative fraction below its minimum', '-0.5', '-0.25', undefined],
  ] as const)('reports %s out of range', (_label, text, minimum, maximum) => {
    expect(reading(text, between(minimum, maximum))).toBe('out-of-range');
  });

  it('is applied to a fractional percentage after it has been scaled', () => {
    const profile = {
      kind: 'percent',
      scale: 'fractional',
      minimum: decimal('0.1'),
      maximum: decimal('0.5'),
    };
    expect(reading('50%', profile)).toEqual(
      percent(decimal('0.5'), 'fractional'),
    );
    expect(reading('10%', profile)).toEqual(
      percent(decimal('0.1'), 'fractional'),
    );
    expect(reading('51%', profile)).toBe('out-of-range');
    expect(reading('9%', profile)).toBe('out-of-range');
  });

  it('is applied to an amount of money', () => {
    const profile = { kind: 'money', currency: 'USD', maximum: decimal('10') };
    expect(reading('$10.00', profile)).toEqual(money(decimal('10'), 'USD'));
    expect(reading('$10.01', profile)).toBe('out-of-range');
  });
});

describe('a numeric field whose declaration cannot be met', () => {
  it.each([
    ['a minimum above its maximum', between('6', '5')],
    ['a finer minimum above its maximum', between('2.55', '2.5')],
    [
      'a negative count of fraction digits',
      { kind: 'decimal', maximumFractionDigits: -1 },
    ],
    [
      'a fractional count of fraction digits',
      { kind: 'decimal', maximumFractionDigits: 1.5 },
    ],
    [
      'a count of fraction digits that is not a number',
      { kind: 'decimal', maximumFractionDigits: Number.NaN },
    ],
    ['a lower-case currency code', { kind: 'money', currency: 'usd' }],
    [
      'a currency code with something in front',
      { kind: 'money', currency: 'aUSD' },
    ],
    [
      'a currency code with something behind',
      { kind: 'money', currency: 'USDa' },
    ],
    ['a two-letter currency code', { kind: 'money', currency: 'US' }],
    ['a capitalized unit', { kind: 'measurement', unit: 'Kilometer' }],
    [
      'a unit with something in front',
      { kind: 'measurement', unit: 'Akilometer' },
    ],
    [
      'a unit with something behind',
      { kind: 'measurement', unit: 'kilometerA' },
    ],
    ['an empty unit', { kind: 'measurement', unit: '' }],
  ] as const)('is rejected as policy for %s', (_label, profile) => {
    expect(reading('1', profile)).toBe('policy-rejected');
  });

  it('is rejected before the text is looked at', () => {
    const negative = { kind: 'decimal', maximumFractionDigits: -1 };
    expect(reading('x', negative)).toBe('policy-rejected');
    expect(reading('1 2', between('6', '5'))).toBe('policy-rejected');
  });

  it.each([
    ['a minimum alone', between('1', undefined)],
    ['a maximum alone', between(undefined, '9')],
    ['a minimum equal to its maximum', between('5', '5')],
    ['a minimum below its maximum', between('4.5', '5.55')],
    [
      'no fraction digits at all',
      { kind: 'decimal', maximumFractionDigits: 0 },
    ],
    ['two fraction digits', { kind: 'decimal', maximumFractionDigits: 2 }],
    ['a length of one character', { kind: 'decimal', maximumCharacters: 1 }],
    ['a longer length', { kind: 'decimal', maximumCharacters: 12 }],
  ] as const)('is read under %s', (_label, profile) => {
    expect(reading('5', profile)).toEqual(decimal('5'));
  });

  it('holds a field to its own kind, whatever else the declaration carries', () => {
    // A profile built by spreading another kind's keeps keys its own kind never reads.
    expect(
      reading('5', { kind: 'decimal', unit: 'Not A Unit', currency: 'nope' }),
    ).toEqual(decimal('5'));
    expect(
      reading('$5.00', { kind: 'money', currency: 'USD', unit: 'Not A Unit' }),
    ).toEqual(money(decimal('5'), 'USD'));
  });
});

describe('the length of a numeric field', () => {
  it('counts the text as it is read, after composition', () => {
    // One character as typed, two once normalized: the field holds one.
    expect(reading('\u0958', { kind: 'decimal', maximumCharacters: 1 })).toBe(
      'policy-rejected',
    );
    expect(reading('\u0958', { kind: 'decimal', maximumCharacters: 2 })).toBe(
      'invalid',
    );
  });

  it('reads text exactly as long as the field allows', () => {
    expect(reading('55', { kind: 'decimal', maximumCharacters: 2 })).toEqual(
      decimal('55'),
    );
  });

  it('stops at 256 characters where the field declares no length', () => {
    expect(reading('1'.repeat(256), { kind: 'decimal' })).toEqual(
      decimal('1'.repeat(256)),
    );
    expect(reading('1'.repeat(257), { kind: 'decimal' })).toBe(
      'policy-rejected',
    );
  });
});

describe('an empty numeric field', () => {
  it.each([
    ['a plain number', { kind: 'decimal' }],
    ['an amount of money', { kind: 'money', currency: 'USD' }],
    ['a quantity', { kind: 'measurement', unit: 'kilometer' }],
    ['a percentage', { kind: 'percent', scale: 'fractional' }],
    [
      'an amount of money that requires its currency',
      { kind: 'money', currency: 'USD', requireCurrency: true },
    ],
    [
      'a percentage that requires its sign',
      { kind: 'percent', scale: 'fractional', requirePercentSign: true },
    ],
  ] as const)('is incomplete for %s', (_label, profile) => {
    expect(reading('', profile)).toBe('incomplete');
  });

  // The profile and the locale are judged before the text, the empty text included: a field that
  // cannot be read at all says so before anybody types in it.
  it('is refused under a profile whose declaration cannot be met', () => {
    expect(reading('', between('6', '5'))).toBe('policy-rejected');
  });

  it('is an unsupported capability in a locale with no digits to read', () => {
    expect(
      parseLocalizedInput('', { kind: 'decimal' }, { locale: 'not a locale' }),
    ).toMatchObject({
      status: 'unsupported-capability',
      text: '',
      diagnostic: { reason: 'native-capability-rejected' },
    });
  });
});
