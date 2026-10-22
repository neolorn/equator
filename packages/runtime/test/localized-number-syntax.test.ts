import { describe, expect, it } from 'vitest';

import {
  decimal,
  measurement,
  money,
  percent,
  percentagePoints,
} from '../src/formatting.js';
import { parseLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * A numeric field reads what its locale writes and nothing else.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 6: the numeric input profile covers
 * localized digits, signs, grouping, decimal separators, and explicitly contracted percent,
 * currency, and unit forms. The spellings below are the ones the platform's own formatter produces
 * for each locale, written out with escapes because several of them cannot be seen.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
// The same locale asked to write Arabic-Indic digits, which changes every mark around them too.
const EN_ARAB: FormattingContext = Object.freeze({
  locale: 'en-US',
  numberingSystem: 'arab',
});
const DE: FormattingContext = Object.freeze({ locale: 'de-DE' });
const AR: FormattingContext = Object.freeze({ locale: 'ar-EG' });
const FA: FormattingContext = Object.freeze({ locale: 'fa-IR' });
const SV: FormattingContext = Object.freeze({ locale: 'sv-SE' });
const EN_IN: FormattingContext = Object.freeze({ locale: 'en-IN' });

const DECIMAL: LocalizedInputProfile = Object.freeze({ kind: 'decimal' });
const GROUPED: LocalizedInputProfile = Object.freeze({
  kind: 'decimal',
  allowGrouping: true,
});
const USD: LocalizedInputProfile = Object.freeze({
  kind: 'money',
  currency: 'USD',
  requireCurrency: true,
});
const EUR: LocalizedInputProfile = Object.freeze({
  kind: 'money',
  currency: 'EUR',
  requireCurrency: true,
});
const KILOMETERS: LocalizedInputProfile = Object.freeze({
  kind: 'measurement',
  unit: 'kilometer',
  requireUnit: true,
});
const FRACTION: LocalizedInputProfile = Object.freeze({
  kind: 'percent',
  scale: 'fractional',
  requirePercentSign: true,
});
const PERCENT_UNIT: LocalizedInputProfile = Object.freeze({
  kind: 'percent',
  scale: 'percent-unit',
  requirePercentSign: true,
});

const ALM = '\u061C';
const LRM = '\u200E';
const NBSP = '\u00A0';
const TRUE_MINUS = '\u2212';

/**
 * A locale asked to write Arabic-Indic digits.
 *
 * A case that takes one names a locale no other case reads, so what it observes is that locale
 * being learned and never an answer remembered from an earlier case.
 */
function arabicIndic(locale: string): FormattingContext {
  return Object.freeze({ locale, numberingSystem: 'arab' });
}

/** The value read, or the status that says why there is none. */
function reading(
  text: string,
  profile: LocalizedInputProfile,
  context: FormattingContext = EN,
): unknown {
  const result = parseLocalizedInput(text, profile, context);
  return result.status === 'valid' ? result.value : result.status;
}

describe("a number typed in a numbering system's digits", () => {
  it('is read in the numbering system the context names', () => {
    expect(reading('\u0661\u0662', DECIMAL, EN_ARAB)).toEqual(decimal('12'));
  });

  it('is not read in the digits the context did not ask for', () => {
    expect(reading('12', DECIMAL, EN_ARAB)).toBe('invalid');
    expect(reading('\u0661\u0662', DECIMAL, EN)).toBe('invalid');
  });

  it('keeps one locale apart under each numbering system it is asked for', () => {
    const latin = { locale: 'en-US', numberingSystem: 'latn' };
    const persian = { locale: 'en-US', numberingSystem: 'arabext' };
    expect(reading('12', DECIMAL, EN)).toEqual(decimal('12'));
    expect(reading('\u0661\u0662', DECIMAL, EN_ARAB)).toEqual(decimal('12'));
    expect(reading('\u06F1\u06F2', DECIMAL, persian)).toEqual(decimal('12'));
    expect(reading('12', DECIMAL, latin)).toEqual(decimal('12'));
    expect(reading('\u0661\u0662', DECIMAL, EN_ARAB)).toEqual(decimal('12'));
    expect(reading('12', DECIMAL, EN)).toEqual(decimal('12'));
  });

  it('takes its decimal mark from the numbering system', () => {
    const context = arabicIndic('en-GB');
    expect(reading('\u0661\u066B\u0665', DECIMAL, context)).toEqual(
      decimal('1.5'),
    );
    expect(reading('\u0661.\u0665', DECIMAL, context)).toBe('ambiguous');
  });

  it('takes its group mark from the numbering system', () => {
    const context = arabicIndic('en-AU');
    expect(reading('\u0661\u066C\u0662\u0663\u0664', GROUPED, context)).toEqual(
      decimal('1234'),
    );
    expect(reading('\u0661,\u0662\u0663\u0664', GROUPED, context)).toBe(
      'ambiguous',
    );
  });

  it('takes the marks around its sign from the numbering system', () => {
    const context = arabicIndic('en-CA');
    expect(reading(`${ALM}-\u0661`, DECIMAL, context)).toEqual(decimal('-1'));
    expect(reading(`${ALM}+\u0661`, DECIMAL, context)).toEqual(decimal('1'));
  });
});

describe('the sign on a localized number', () => {
  it.each([
    ['an ASCII hyphen in English', '-5', EN, '-5'],
    ['a plus in English', '+5', EN, '5'],
    ['the true minus Swedish writes', `${TRUE_MINUS}5`, SV, '-5'],
    ['a plus in Swedish', '+5', SV, '5'],
  ] as const)('reads %s', (_label, text, context, expected) => {
    expect(reading(text, DECIMAL, context)).toEqual(decimal(expected));
  });

  it('does not read a minus the locale does not write', () => {
    expect(reading('-5', DECIMAL, SV)).toBe('invalid');
  });

  it.each([
    ['a mark before an Arabic minus', `${ALM}-\u0661`, AR, '-1'],
    ['a mark before an Arabic plus', `${ALM}+\u0661`, AR, '1'],
    [
      'marks on both sides of a Persian minus',
      `${LRM}${TRUE_MINUS}${LRM}\u06F1`,
      FA,
      '-1',
    ],
    ['a mark before a Persian minus', `${LRM}${TRUE_MINUS}\u06F1`, FA, '-1'],
  ] as const)('accepts %s', (_label, text, context, expected) => {
    expect(reading(text, DECIMAL, context)).toEqual(decimal(expected));
  });

  it('reads a sign typed without the mark the locale writes before it', () => {
    const context = Object.freeze({ locale: 'ar-SA', numberingSystem: 'arab' });
    expect(reading('+\u0661', DECIMAL, context)).toEqual(decimal('1'));
    expect(reading('-\u0661', DECIMAL, context)).toEqual(decimal('-1'));
  });

  it('does not accept a mark that decorates no sign', () => {
    expect(reading(`${ALM}\u0661`, DECIMAL, AR)).toBe('invalid');
    expect(reading(`${LRM}5`, DECIMAL, EN)).toBe('invalid');
  });

  it('reads an unsigned number as positive', () => {
    expect(reading('5', DECIMAL)).toEqual(decimal('5'));
    expect(reading('\u0661', DECIMAL, AR)).toEqual(decimal('1'));
  });
});

describe('a sign on a duration field', () => {
  const clock = (sign: 'forbidden' | 'optional' | 'required') =>
    ({
      kind: 'duration',
      pattern: [{ field: 'hours' }, ':', { field: 'minutes' }],
      sign,
    }) as LocalizedInputProfile;

  it('is refused where the field forbids one, and only where one was typed', () => {
    expect(reading('-1:30', clock('forbidden'))).toBe('policy-rejected');
    expect(reading('+1:30', clock('forbidden'))).toBe('policy-rejected');
    expect(reading('1:30', clock('forbidden'))).toMatchObject({
      sign: 1,
      hours: 1,
      minutes: 30,
    });
  });

  it('is waited for where the field requires one', () => {
    expect(reading('1:30', clock('required'))).toBe('incomplete');
    expect(reading('+1:30', clock('required'))).toMatchObject({ sign: 1 });
    expect(reading('-1:30', clock('required'))).toMatchObject({ sign: -1 });
  });
});

describe('the grouping of a localized number', () => {
  it('follows the three-digit groups English writes', () => {
    expect(reading('1,234,567', GROUPED, EN)).toEqual(decimal('1234567'));
    expect(reading('12,34,567', GROUPED, EN)).toBe('invalid');
  });

  it('follows the two-digit groups Indian English writes above the thousand', () => {
    expect(reading('12,34,567', GROUPED, EN_IN)).toEqual(decimal('1234567'));
    expect(reading('1,234,567', GROUPED, EN_IN)).toBe('invalid');
    expect(reading('1,23,45', GROUPED, EN_IN)).toBe('invalid');
  });
});

describe('an amount of money typed with its currency', () => {
  it.each([
    ['a symbol in front', '$5.00', EN, USD, '5'],
    ['a sign and a symbol in front', '-$5.00', EN, USD, '-5'],
    ['a symbol behind', `5,00${NBSP}\u20AC`, DE, EUR, '5'],
    [
      'a sign in front and a symbol behind',
      `-5,00${NBSP}\u20AC`,
      DE,
      EUR,
      '-5',
    ],
    ['a fraction', '$12.34', EN, USD, '12.34'],
    [
      'the placement the asked-for digits bring with them',
      `\u0661\u066B\u0665\u0660${NBSP}$`,
      EN_ARAB,
      USD,
      '1.5',
    ],
    [
      'the marked minus the asked-for digits bring with them',
      `${ALM}-\u0661\u066B\u0665\u0660${NBSP}$`,
      EN_ARAB,
      USD,
      '-1.5',
    ],
  ] as const)('is read with %s', (_label, text, context, profile, expected) => {
    const currency = profile === USD ? 'USD' : 'EUR';
    expect(reading(text, profile, context)).toEqual(
      money(decimal(expected), currency),
    );
  });

  it('is not read with the symbol on the side the locale does not put it', () => {
    expect(reading('5.00$', USD, EN)).toBe('policy-rejected');
    expect(reading(`\u20AC${NBSP}5,00`, EUR, DE)).toBe('policy-rejected');
    expect(reading('$\u0661\u066B\u0665\u0660', USD, EN_ARAB)).toBe(
      'policy-rejected',
    );
  });

  it('is not read with half of what the locale puts behind it', () => {
    expect(reading(`5,00${NBSP}`, EUR, DE)).toBe('policy-rejected');
    expect(reading('5,00\u20AC', EUR, DE)).toBe('policy-rejected');
  });

  it('is incomplete while only the symbol has been typed', () => {
    expect(reading('$', USD, EN)).toBe('incomplete');
    expect(reading(`${NBSP}\u20AC`, EUR, DE)).toBe('incomplete');
  });

  it('is refused without the symbol only where the field requires it', () => {
    expect(reading('5.00', USD, EN)).toBe('policy-rejected');
    const bare = { kind: 'money', currency: 'USD' } as LocalizedInputProfile;
    expect(reading('5.00', bare, EN)).toEqual(money(decimal('5'), 'USD'));
    expect(reading('-5.00', bare, EN)).toEqual(money(decimal('-5'), 'USD'));
    expect(reading('$5.00', bare, EN)).toEqual(money(decimal('5'), 'USD'));
  });
});

describe('a quantity typed with its unit', () => {
  it.each([
    ['the unit behind', '5 km', '5'],
    ['a sign in front and the unit behind', '-5 km', '-5'],
    ['a fraction', '2.5 km', '2.5'],
  ] as const)('is read with %s', (_label, text, expected) => {
    expect(reading(text, KILOMETERS, EN)).toEqual(
      measurement(decimal(expected), 'kilometer'),
    );
  });

  it('is read in the spelling the locale writes for one of the unit', () => {
    const days = { kind: 'measurement', unit: 'day' } as LocalizedInputProfile;
    expect(reading('1 day', days, EN)).toEqual(
      measurement(decimal('1'), 'day'),
    );
  });

  it('is refused without the unit', () => {
    expect(reading('5', KILOMETERS, EN)).toBe('policy-rejected');
    expect(reading('5 ', KILOMETERS, EN)).toBe('policy-rejected');
    expect(reading('km', KILOMETERS, EN)).toBe('policy-rejected');
  });

  it('is reported unsupported for a unit the host does not know', () => {
    const profile = {
      kind: 'measurement',
      unit: 'not-a-unit',
      requireUnit: true,
    } as LocalizedInputProfile;
    expect(reading('5 km', profile, EN)).toBe('unsupported-capability');
  });
});

describe('a percentage typed with its sign', () => {
  it.each([
    ['25%', '0.25'],
    ['5%', '0.05'],
    ['-5%', '-0.05'],
    ['250%', '2.5'],
    ['12.5%', '0.125'],
    ['1234%', '12.34'],
    ['0.5%', '0.005'],
    ['100%', '1'],
  ] as const)('reads %s as the fraction %s', (text, expected) => {
    expect(reading(text, FRACTION, EN)).toEqual(
      percent(decimal(expected), 'fractional'),
    );
  });

  it.each([
    ['25%', '25'],
    ['-5%', '-5'],
    ['0.5%', '0.5'],
  ] as const)('reads %s as %s on the percent-unit scale', (text, expected) => {
    expect(reading(text, PERCENT_UNIT, EN)).toEqual(
      percent(decimal(expected), 'percent-unit'),
    );
  });

  it('is read with the space German puts before the sign', () => {
    expect(reading(`25${NBSP}%`, PERCENT_UNIT, DE)).toEqual(
      percent(decimal('25'), 'percent-unit'),
    );
    expect(reading('25%', PERCENT_UNIT, DE)).toBe('policy-rejected');
  });

  it('is refused without the sign', () => {
    expect(reading('25', FRACTION, EN)).toBe('policy-rejected');
  });
});

describe('a field with no currency, unit, or percent contract', () => {
  it.each([
    ['a percent sign', '5%'],
    ['a currency symbol', '$5'],
    ['a unit', '5 km'],
  ] as const)('does not read a number carrying %s', (_label, text) => {
    expect(reading(text, DECIMAL, EN)).toBe('invalid');
  });

  it('does not read a percent sign on a percentage-point field', () => {
    const points = { kind: 'percentage-points' } as LocalizedInputProfile;
    expect(reading('5%', points, EN)).toBe('invalid');
    expect(reading('5', points, EN)).toEqual(percentagePoints(decimal('5')));
  });
});
