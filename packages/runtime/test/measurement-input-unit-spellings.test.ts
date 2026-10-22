import { describe, expect, it } from 'vitest';

import { decimal, measurement } from '../src/formatting.js';
import {
  formatLocalizedInput,
  parseLocalizedInput,
} from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * A measurement field reads the unit the way the locale writes it beside a number, and a locale
 * writes it more than one way: English writes `1 day` and `5 days`, Arabic has a spelling for each
 * of six plural categories, and writes one day and two days as a word with no number in it.
 *
 * The spellings are the host's. The English ones are stable enough to state; the Arabic ones are
 * taken from the host in each case, so that a host with other locale data is held to the same
 * property instead of to a copy of one edition's words.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const AR: FormattingContext = Object.freeze({ locale: 'ar-EG' });

const DAYS: LocalizedInputProfile = { kind: 'measurement', unit: 'day' };
const DAYS_REQUIRED: LocalizedInputProfile = {
  kind: 'measurement',
  unit: 'day',
  requireUnit: true,
};

/** How the host writes a count of days, and whether the spelling carries the number. */
function hostSpelling(
  locale: string,
  count: number,
): { readonly text: string; readonly numbered: boolean } {
  const parts = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'day',
    useGrouping: false,
  }).formatToParts(count);
  return {
    text: parts.map(({ value }) => value).join(''),
    numbered: parts.some(({ type }) => type === 'integer'),
  };
}

const AR_DIGIT_FIVE = new Intl.NumberFormat('ar-EG', {
  useGrouping: false,
}).format(5);

describe('the spellings of a unit a measurement field reads', () => {
  const ENGLISH: readonly (readonly [string, string])[] = [
    ['1 day', '1'],
    ['5 days', '5'],
    ['0 days', '0'],
    ['1.5 days', '1.5'],
    ['-1 day', '-1'],
    ['-5 days', '-5'],
  ];

  for (const [text, value] of ENGLISH) {
    it(`reads "${text}" in en-US`, () => {
      expect(parseLocalizedInput(text, DAYS_REQUIRED, EN)).toMatchObject({
        status: 'valid',
        value: { kind: 'measurement', unit: 'day', amount: { value } },
      });
    });
  }

  it('reads every numbered spelling the host writes in ar-EG', () => {
    const spellings = new Set<string>();
    for (const count of [0, 3, 5, 10, 11, 26, 99, 100, 102, 1.5]) {
      for (const signed of [count, -count]) {
        if (Object.is(signed, -0)) continue;
        const { text, numbered } = hostSpelling('ar-EG', signed);
        if (!numbered) continue;
        spellings.add(text.replace(/[\p{Nd}\p{Cf}\p{Po}\p{Pd}\p{Sm}]/gu, ''));
        expect(
          parseLocalizedInput(text, DAYS_REQUIRED, AR),
          `${String(signed)} written as ${JSON.stringify(text)}`,
        ).toMatchObject({
          status: 'valid',
          value: { amount: { value: String(signed) } },
        });
      }
    }
    // More than one spelling, or the loop above held a single suffix to itself.
    expect(spellings.size).toBeGreaterThan(1);
  });
});

describe('a measurement field in a locale that writes a unit without its number', () => {
  it('finds a host spelling of one day that carries no number in ar-EG', () => {
    expect(hostSpelling('ar-EG', 1).numbered).toBe(false);
  });

  it('reads a bare number as the number it is in ar-EG', () => {
    expect(parseLocalizedInput(AR_DIGIT_FIVE, DAYS, AR)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '5' } },
    });
  });

  it('reads a bare number as the number it is in en-US', () => {
    expect(parseLocalizedInput('5', DAYS, EN)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '5' } },
    });
  });

  it('refuses a bare number where the unit is required in ar-EG', () => {
    expect(parseLocalizedInput(AR_DIGIT_FIVE, DAYS_REQUIRED, AR).status).toBe(
      'policy-rejected',
    );
  });

  it('refuses a bare number where the unit is required in en-US', () => {
    expect(parseLocalizedInput('5', DAYS_REQUIRED, EN).status).toBe(
      'policy-rejected',
    );
  });

  it('does not read the spelling that carries no number in ar-EG', () => {
    const { text } = hostSpelling('ar-EG', 1);
    expect(parseLocalizedInput(text, DAYS, AR).status).not.toBe('valid');
    expect(parseLocalizedInput(text, DAYS_REQUIRED, AR).status).toBe(
      'policy-rejected',
    );
  });

  it('reports one day instead of writing a spelling it cannot read in ar-EG', () => {
    expect(
      formatLocalizedInput(measurement(decimal('1'), 'day'), DAYS, AR),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-localized-input' },
    });
  });

  it('writes five days in the spelling it reads in ar-EG', () => {
    const written = formatLocalizedInput(
      measurement(decimal('5'), 'day'),
      DAYS,
      AR,
    );
    expect(written).toMatchObject({
      ok: true,
      value: { text: hostSpelling('ar-EG', 5).text },
    });
  });

  it('writes one day and five days in the spellings it reads in en-US', () => {
    for (const [value, text] of [
      ['1', '1 day'],
      ['5', '5 days'],
      ['-5', '-5 days'],
    ] as const) {
      expect(
        formatLocalizedInput(measurement(decimal(value), 'day'), DAYS, EN),
      ).toMatchObject({ ok: true, value: { text } });
    }
  });
});

describe('the sign a marker spelling gives a number', () => {
  it('is negative only where the spelling carries a minus sign in en-US', () => {
    expect(parseLocalizedInput('5 days', DAYS, EN)).toMatchObject({
      value: { amount: { value: '5' } },
    });
    expect(parseLocalizedInput('-5 days', DAYS, EN)).toMatchObject({
      value: { amount: { value: '-5' } },
    });
  });

  it('is negative only where the spelling carries a minus sign in ar-EG', () => {
    const five = hostSpelling('ar-EG', 5).text;
    const minusFive = hostSpelling('ar-EG', -5).text;
    expect(parseLocalizedInput(five, DAYS, AR)).toMatchObject({
      value: { amount: { value: '5' } },
    });
    expect(parseLocalizedInput(minusFive, DAYS, AR)).toMatchObject({
      value: { amount: { value: '-5' } },
    });
  });
});

describe('every numbered spelling of a day in every language the host has data for', () => {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const codes: string[] = [];
  for (const first of letters) {
    for (const second of letters) {
      codes.push(`${first}${second}`);
      for (const third of letters) codes.push(`${first}${second}${third}`);
    }
  }
  const languages = Intl.NumberFormat.supportedLocalesOf(codes);
  // One count for each plural category any language declares, found on the supported hosts.
  const counts = [0, 1, 2, 3, 5, 11, 21, 100, 1_000_000, 0.1, 1.5];

  it('finds the host languages', () => {
    expect(languages.length).toBeGreaterThan(100);
  });

  it('is read as the number it was written from', () => {
    const unread: string[] = [];
    for (const locale of languages) {
      const context = { locale };
      for (const count of counts) {
        for (const signed of [count, -count]) {
          if (Object.is(signed, -0)) continue;
          const { text, numbered } = hostSpelling(locale, signed);
          if (!numbered) continue;
          const result = parseLocalizedInput(text, DAYS_REQUIRED, context);
          const read =
            result.status === 'valid'
              ? (result.value as { amount: { value: string } }).amount.value
              : result.status;
          if (read !== String(signed)) {
            unread.push(`${locale} ${String(signed)} ${text} -> ${read}`);
          }
        }
      }
    }
    expect(unread).toEqual([]);
  });
});
