import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * A field's character limit is asked before anything about its locale.
 *
 * Text arrives from whoever is typing, and reading a field in a locale means asking the platform
 * for that locale's digits and separators. Text past the field's limit is refused without that
 * question being put, so the answer for it is the same in every locale, the ones the platform has
 * no digits for included.
 */

/** A locale the platform refuses as a language tag, so it has no digits to read a field in. */
const NO_DIGITS: FormattingContext = Object.freeze({ locale: 'en_US' });

/** A well-formed numbering system no platform has digits for. */
const NO_NUMBERING: FormattingContext = Object.freeze({
  locale: 'en-US',
  numberingSystem: 'zzzz',
});

/** A numbering system that is not an identifier at all. */
const MALFORMED_NUMBERING: FormattingContext = Object.freeze({
  locale: 'en-US',
  numberingSystem: '',
});

/** Each kind of field with no limit of its own, and the limit its kind has. */
const FIELDS: readonly (readonly [LocalizedInputProfile, number])[] = [
  [{ kind: 'decimal' }, 256],
  [{ kind: 'money', currency: 'EUR' }, 256],
  [{ kind: 'measurement', unit: 'meter' }, 256],
  [{ kind: 'percent', scale: 'fraction' }, 256],
  [{ kind: 'percentage-points' }, 256],
  [{ kind: 'plain-date', order: 'year-month-day', separator: '-' }, 64],
  [
    {
      kind: 'plain-time',
      hourCycle: 'h23',
      precision: 'minute',
      separator: ':',
    },
    64,
  ],
  [
    {
      kind: 'plain-date-time',
      date: { order: 'year-month-day', separator: '-' },
      time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
      separator: ' ',
    },
    128,
  ],
  [
    {
      kind: 'time-zone',
      options: [{ timeZone: 'Europe/Paris', labels: ['Paris'] }],
    },
    256,
  ],
  [{ kind: 'duration', pattern: [{ field: 'hours' }, 'h'] }, 256],
  [{ kind: 'instant', syntax: 'rfc3339' }, 64],
] as unknown as readonly (readonly [LocalizedInputProfile, number])[];

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(FIELDS)(
  'text one character past the limit of a field: %j',
  (profile, limit) => {
    const text = '1'.repeat(limit + 1);

    it.each([
      ['a locale the platform has no digits for', NO_DIGITS],
      ['a numbering system the platform has no digits for', NO_NUMBERING],
      ['a numbering system that is not an identifier', MALFORMED_NUMBERING],
    ])('is refused for its length under %s', (_, context) => {
      const result = parseLocalizedInput(text, profile, context);

      expect(result).toMatchObject({
        status: 'policy-rejected',
        text,
        diagnostic: { code: 'invalid-localized-input' },
      });
    });

    it('is refused without a formatter, a locale or plural rules being built', () => {
      const number = vi.spyOn(Intl, 'NumberFormat');
      const locale = vi.spyOn(Intl, 'Locale');
      const plural = vi.spyOn(Intl, 'PluralRules');

      // A locale no other case reads in, so nothing answers from a cache.
      parseLocalizedInput(text, profile, { locale: 'fi-FI' });
      parseLocalizedInput(text, profile, {
        locale: 'fi-FI',
        numberingSystem: 'arab',
      });

      expect(number).not.toHaveBeenCalled();
      expect(locale).not.toHaveBeenCalled();
      expect(plural).not.toHaveBeenCalled();
    });

    it('is read in its locale when it is exactly as long as the limit', () => {
      const result = parseLocalizedInput(
        '1'.repeat(limit),
        profile,
        NO_NUMBERING,
      );

      expect(result.status).toBe('unsupported-capability');
    });
  },
);

describe('a field whose calendar it does not read', () => {
  const HEBREW = {
    kind: 'plain-date',
    order: 'year-month-day',
    separator: '-',
    calendar: 'hebrew',
  } as unknown as LocalizedInputProfile;

  it('refuses text past its limit for its length', () => {
    expect(
      parseLocalizedInput('1'.repeat(65), HEBREW, { locale: 'en-US' }).status,
    ).toBe('policy-rejected');
  });

  it('reports the calendar for text within its limit', () => {
    expect(
      parseLocalizedInput('1'.repeat(64), HEBREW, { locale: 'en-US' }).status,
    ).toBe('unsupported-capability');
  });
});
