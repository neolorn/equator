import { describe, expect, it } from 'vitest';

import {
  type FormattingContext,
  type FormattingResult,
} from '@neolorn/equator/core';

import {
  formatPlainDate,
  formatPlainDateTime,
  plainDate,
  plainDateTime,
  plainTime,
} from '../src/formatting.js';

/**
 * The calendar an ISO plain date is written in.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4 resolves the calendar as it resolves
 * every other part of the formatting context: the one the call names, else the context's, else the
 * locale's. An instant is written that way, and a date with no zone is no different. Every expected
 * text is asked of the platform with the same options at noon of the day in UTC.
 */

const BUDDHIST: FormattingContext = Object.freeze({
  locale: 'en-US',
  calendar: 'buddhist',
});
const DATE = { dateStyle: 'long' } as const;
const DATE_AND_TIME = { dateStyle: 'long', timeStyle: 'short' } as const;

const host = (locale: string, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    Date.UTC(2026, 2, 14, 12),
  );

const text = (result: FormattingResult): string => {
  expect(result).toMatchObject({ ok: true });
  return result.ok ? result.value.text : '';
};

const MARCH_14 = plainDate(2026, 3, 14);
const AT_NOON = plainTime(12, 0);

describe('the calendar an ISO plain date is written in', () => {
  it('differs between the calendars the cases below tell apart', () => {
    const written = new Set([
      host('en-US', DATE),
      host('en-US', { ...DATE, calendar: 'buddhist' }),
      host('en-US', { ...DATE, calendar: 'hebrew' }),
    ]);

    expect(written.size).toBe(3);
  });

  it('is the one the context names', () => {
    expect(text(formatPlainDate(MARCH_14, BUDDHIST, DATE))).toBe(
      host('en-US', { ...DATE, calendar: 'buddhist' }),
    );
  });

  it('is the one the context names, for a date and a time together', () => {
    expect(
      text(
        formatPlainDateTime(
          plainDateTime(MARCH_14, AT_NOON),
          BUDDHIST,
          DATE_AND_TIME,
        ),
      ),
    ).toBe(host('en-US', { ...DATE_AND_TIME, calendar: 'buddhist' }));
  });

  it('is the one the call names over the context', () => {
    expect(
      text(
        formatPlainDate(MARCH_14, BUDDHIST, { ...DATE, calendar: 'hebrew' }),
      ),
    ).toBe(host('en-US', { ...DATE, calendar: 'hebrew' }));
    expect(
      text(
        formatPlainDateTime(plainDateTime(MARCH_14, AT_NOON), BUDDHIST, {
          ...DATE_AND_TIME,
          calendar: 'hebrew',
        }),
      ),
    ).toBe(host('en-US', { ...DATE_AND_TIME, calendar: 'hebrew' }));
  });

  it('is the one of the locale where the context names none or names iso8601', () => {
    const thai = host('th-TH', DATE);

    expect(thai).not.toBe(host('th-TH', { ...DATE, calendar: 'gregory' }));
    expect(text(formatPlainDate(MARCH_14, { locale: 'th-TH' }, DATE))).toBe(
      thai,
    );
    expect(
      text(
        formatPlainDate(
          MARCH_14,
          { locale: 'th-TH', calendar: 'iso8601' },
          DATE,
        ),
      ),
    ).toBe(thai);
    expect(
      text(
        formatPlainDateTime(
          plainDateTime(MARCH_14, AT_NOON),
          { locale: 'th-TH', calendar: 'iso8601' },
          DATE_AND_TIME,
        ),
      ),
    ).toBe(host('th-TH', DATE_AND_TIME));
  });
});
