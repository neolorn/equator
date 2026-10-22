import { describe, expect, it } from 'vitest';

import { parseLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * Text is measured before it is read. The bound is the smaller of what the profile declares and
 * what the runtime allows, a profile that declares a bound the runtime cannot honour is refused
 * the same way as text that is too long, and each profile kind is then handed to its own reader.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const RUNTIME_CEILING = 65_536;

function decimalWithLimit(maximumCharacters: number): LocalizedInputProfile {
  return { kind: 'decimal', maximumCharacters };
}

describe('the bound on localized input text', () => {
  it('reads text exactly as long as the declared limit', () => {
    expect(parseLocalizedInput('12345', decimalWithLimit(5), EN)).toMatchObject(
      { status: 'valid', value: { value: '12345' } },
    );
  });

  it('refuses text one character over the declared limit', () => {
    expect(parseLocalizedInput('123456', decimalWithLimit(5), EN).status).toBe(
      'out-of-range',
    );
  });

  it('accepts a declared limit equal to the runtime ceiling', () => {
    expect(
      parseLocalizedInput('1', decimalWithLimit(RUNTIME_CEILING), EN).status,
    ).toBe('valid');
  });

  it('refuses a declared limit above the runtime ceiling', () => {
    expect(
      parseLocalizedInput('1', decimalWithLimit(RUNTIME_CEILING + 1), EN)
        .status,
    ).toBe('out-of-range');
  });

  it('refuses a declared limit of zero even for empty text', () => {
    expect(parseLocalizedInput('', decimalWithLimit(0), EN).status).toBe(
      'out-of-range',
    );
  });

  for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`refuses a declared limit of ${limit}`, () => {
      expect(parseLocalizedInput('1', decimalWithLimit(limit), EN).status).toBe(
        'out-of-range',
      );
    });
  }

  it('counts an astral character once', () => {
    const profile: LocalizedInputProfile = {
      kind: 'time-zone',
      maximumCharacters: 2,
      options: [{ timeZone: 'Europe/Paris', labels: ['\u{1F5FC}\u{1F950}'] }],
    };
    expect(parseLocalizedInput('\u{1F5FC}\u{1F950}', profile, EN).status).toBe(
      'valid',
    );
  });

  for (const text of [42, null, undefined, ['1']]) {
    it(`answers ${String(JSON.stringify(text))} given as text without throwing`, () => {
      const result = parseLocalizedInput(
        text as unknown as string,
        { kind: 'decimal' },
        EN,
      );
      // What was given is not text, so there is none to echo back.
      expect(result).toMatchObject({ status: 'out-of-range', text: '' });
    });
  }
});

describe('the reader a profile selects', () => {
  const READINGS: readonly (readonly [LocalizedInputProfile, string])[] = [
    [{ kind: 'decimal' }, '5'],
    [{ kind: 'money', currency: 'USD', requireCurrency: true }, '$5'],
    [{ kind: 'measurement', unit: 'kilometer', requireUnit: true }, '5 km'],
    [
      { kind: 'percent', scale: 'percent-unit', requirePercentSign: true },
      '5%',
    ],
    [{ kind: 'percentage-points' }, '5'],
    [
      { kind: 'plain-date', order: 'year-month-day', separator: '-' },
      '2024-01-02',
    ],
    [
      {
        kind: 'plain-time',
        hourCycle: 'h23',
        precision: 'minute',
        separator: ':',
      },
      '13:45',
    ],
    [
      {
        kind: 'plain-date-time',
        date: { order: 'year-month-day', separator: '-' },
        time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
        separator: ' ',
      },
      '2024-01-02 13:45',
    ],
    [
      {
        kind: 'time-zone',
        options: [{ timeZone: 'Europe/Paris', labels: ['Paris'] }],
      },
      'Paris',
    ],
    [
      {
        kind: 'duration',
        pattern: [{ field: 'hours' }, ':', { field: 'minutes' }],
      },
      '1:30',
    ],
    [{ kind: 'instant', syntax: 'rfc3339' }, '2024-01-02T03:04:05Z'],
  ];

  for (const [profile, text] of READINGS) {
    it(`reads a ${profile.kind} value under a ${profile.kind} profile`, () => {
      expect(parseLocalizedInput(text, profile, EN)).toMatchObject({
        status: 'valid',
        text,
        value: { kind: profile.kind },
      });
    });
  }
});
