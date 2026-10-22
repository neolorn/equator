import { describe, expect, it } from 'vitest';

import { parseLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
  type LocalizedInputStatus,
} from '@neolorn/equator/core';

/**
 * A numeric field reads one spelling: the locale's digits, its decimal mark, its grouping where the
 * profile allows grouping, and the currency, unit or percent marker where the profile contracts
 * one. Each case below is a spelling that is one step away from an accepted one, because that is
 * where a parser that guesses turns a typing mistake into an amount.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
// Indian English groups the last three digits and then pairs, so the two group sizes differ.
const EN_IN: FormattingContext = Object.freeze({ locale: 'en-IN' });

function read(
  text: string,
  profile: LocalizedInputProfile,
  context: FormattingContext = EN,
): { readonly status: LocalizedInputStatus; readonly value?: unknown } {
  return parseLocalizedInput(text, profile, context);
}

describe('a numeric field that contracts a marker', () => {
  const REQUIRED: readonly (readonly [string, LocalizedInputProfile])[] = [
    ['currency', { kind: 'money', currency: 'USD', requireCurrency: true }],
    ['unit', { kind: 'measurement', unit: 'kilometer', requireUnit: true }],
    [
      'percent sign',
      { kind: 'percent', scale: 'percent-unit', requirePercentSign: true },
    ],
  ];

  for (const [marker, profile] of REQUIRED) {
    it(`refuses a bare number when the ${marker} is required`, () => {
      expect(read('5', profile).status).toBe('policy-rejected');
    });
  }

  it('reads the amount when the required currency is typed', () => {
    expect(
      read('$5', { kind: 'money', currency: 'USD', requireCurrency: true }),
    ).toMatchObject({
      status: 'valid',
      value: { kind: 'money', currency: 'USD', amount: { value: '5' } },
    });
  });

  it('reads the amount when the required unit is typed', () => {
    expect(
      read('5 km', {
        kind: 'measurement',
        unit: 'kilometer',
        requireUnit: true,
      }),
    ).toMatchObject({
      status: 'valid',
      value: { kind: 'measurement', unit: 'kilometer', amount: { value: '5' } },
    });
  });

  it('reads the amount when the required percent sign is typed', () => {
    expect(
      read('5%', {
        kind: 'percent',
        scale: 'percent-unit',
        requirePercentSign: true,
      }),
    ).toMatchObject({
      status: 'valid',
      value: { kind: 'percent', amount: { value: '5' } },
    });
  });

  it('reads a negative amount written the way the locale writes one', () => {
    expect(
      read('-$5', { kind: 'money', currency: 'USD', requireCurrency: true }),
    ).toMatchObject({ status: 'valid', value: { amount: { value: '-5' } } });
  });

  it('refuses a sign written between the marker and the digits', () => {
    // The locale writes the sign outside the symbol, and a second position for it would be a
    // spelling the paired formatter never produces.
    expect(
      read('$-5', { kind: 'money', currency: 'USD', requireCurrency: true })
        .status,
    ).toBe('invalid');
  });

  it('reports a unit the host cannot write as unsupported, not as mistyped', () => {
    expect(
      read('5', { kind: 'measurement', unit: 'furlong', requireUnit: true }),
    ).toMatchObject({
      status: 'unsupported-capability',
      diagnostic: { code: 'unsupported-input-capability' },
    });
  });

  it('does not ask a plain number for a marker', () => {
    expect(read('5', { kind: 'decimal' })).toMatchObject({
      status: 'valid',
      value: { kind: 'decimal', value: '5' },
    });
    expect(read('5', { kind: 'percentage-points' })).toMatchObject({
      status: 'valid',
      value: { kind: 'percentage-points', amount: { value: '5' } },
    });
  });
});

describe('a numeric field that names a marker without requiring it', () => {
  const NAMED: readonly (readonly [
    string,
    LocalizedInputProfile,
    string,
    object,
  ])[] = [
    [
      'currency',
      { kind: 'money', currency: 'USD' },
      '$5',
      { kind: 'money', currency: 'USD', amount: { value: '5' } },
    ],
    [
      'unit',
      { kind: 'measurement', unit: 'kilometer' },
      '5 km',
      { kind: 'measurement', unit: 'kilometer', amount: { value: '5' } },
    ],
    [
      'percent sign',
      { kind: 'percent', scale: 'percent-unit' },
      '5%',
      { kind: 'percent', scale: 'percent-unit', amount: { value: '5' } },
    ],
  ];

  for (const [marker, profile, marked, value] of NAMED) {
    it(`reads a bare number when the ${marker} is not required`, () => {
      expect(read('5', profile)).toMatchObject({ status: 'valid', value });
    });

    it(`reads a bare negative number when the ${marker} is not required`, () => {
      expect(read('-5', profile)).toMatchObject({
        status: 'valid',
        value: { amount: { value: '-5' } },
      });
    });

    it(`reads the ${marker} when it is typed without being required`, () => {
      expect(read(marked, profile)).toMatchObject({ status: 'valid', value });
    });
  }

  it('reads a bare number in a unit the host cannot write', () => {
    expect(read('5', { kind: 'measurement', unit: 'furlong' })).toMatchObject({
      status: 'valid',
      value: { kind: 'measurement', unit: 'furlong', amount: { value: '5' } },
    });
  });
});

describe('a number with its separators', () => {
  const GROUPED: LocalizedInputProfile = Object.freeze({
    kind: 'decimal',
    allowGrouping: true,
  });

  it('reports a second decimal mark as ambiguous', () => {
    expect(read('1.2.3', { kind: 'decimal' }).status).toBe('ambiguous');
  });

  it('reports a comma after the decimal mark as ambiguous', () => {
    expect(read('1.2,3', GROUPED).status).toBe('ambiguous');
  });

  it('reports a character that is no part of a number as invalid', () => {
    expect(read('1;2', { kind: 'decimal' }).status).toBe('invalid');
  });

  it('reports a number with no integer digits as incomplete', () => {
    expect(read('.5', { kind: 'decimal' }).status).toBe('incomplete');
  });

  it('reports a decimal mark with nothing after it as incomplete', () => {
    expect(read('5.', { kind: 'decimal' }).status).toBe('incomplete');
  });

  it('reports a trailing group separator as incomplete', () => {
    expect(read('1,', GROUPED).status).toBe('incomplete');
  });

  it('reports a leading group separator as incomplete', () => {
    expect(read(',123', GROUPED).status).toBe('incomplete');
  });

  const GROUPINGS: readonly (readonly [
    string,
    string,
    LocalizedInputStatus,
    string?,
    FormattingContext?,
  ])[] = [
    ['full groups', '1,234,567', 'valid', '1234567'],
    ['a short leading group', '12,345', 'valid', '12345'],
    ['a short last group', '1,00', 'invalid'],
    ['a long last group', '1,0000', 'invalid'],
    ['a short middle group', '1,00,000', 'invalid'],
    ['a long leading group', '1234,567', 'invalid'],
    ['pairs before the last three', '12,34,567', 'valid', '1234567', EN_IN],
    ['a triple before the last three', '123,34,567', 'invalid', , EN_IN],
    ['a triple in the middle', '1,234,567', 'invalid', , EN_IN],
  ];

  for (const [title, text, status, value, context] of GROUPINGS) {
    it(`reads ${title} as ${status}`, () => {
      const result = read(text, GROUPED, context);
      expect(result.status).toBe(status);
      if (value !== undefined) {
        expect(result.value).toMatchObject({ value });
      }
    });
  }

  it('reads a fraction beside grouped digits', () => {
    expect(read('1,234.5', GROUPED)).toMatchObject({
      status: 'valid',
      value: { value: '1234.5' },
    });
  });
});

describe('a number against its declared precision', () => {
  const TWO_PLACES: LocalizedInputProfile = Object.freeze({
    kind: 'decimal',
    maximumFractionDigits: 2,
  });

  it('reads as many fraction digits as the profile declares', () => {
    expect(read('1.25', TWO_PLACES)).toMatchObject({
      status: 'valid',
      value: { value: '1.25' },
    });
  });

  it('refuses one fraction digit more than the profile declares', () => {
    expect(read('1.255', TWO_PLACES).status).toBe('policy-rejected');
  });

  it('reads any number of fraction digits when none is declared', () => {
    expect(read('1.2555', { kind: 'decimal' })).toMatchObject({
      status: 'valid',
      value: { value: '1.2555' },
    });
  });
});
