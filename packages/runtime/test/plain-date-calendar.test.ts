import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LocalizationError,
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
import { parseLocalizedInput } from '../src/localized-input.js';

/**
 * The calendar a plain date is counted in, and the calendar it is written in.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 2 has a plain date counted in the ISO
 * calendar or in `gregory`, which count the same days, and section 4 has it written in the calendar
 * the call names, else the one the value names, else the context's, else the locale's. A date in
 * any other calendar is a value the formatter reports it cannot write. Every expected text is asked
 * of the platform with the same options at noon of the day in UTC.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const BUDDHIST: FormattingContext = Object.freeze({
  locale: 'en-US',
  calendar: 'buddhist',
});
const DATE = { dateStyle: 'long' } as const;
const DATE_AND_TIME = { dateStyle: 'long', timeStyle: 'short' } as const;

const noon = (year: number, month: number, day: number): number => {
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
};

const host = (
  locale: string,
  options: Intl.DateTimeFormatOptions,
  milliseconds = noon(2026, 3, 14),
): string =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    milliseconds,
  );

const text = (result: FormattingResult): string => {
  expect(result).toMatchObject({ ok: true });
  return result.ok ? result.value.text : '';
};

const MARCH_14 = plainDate(2026, 3, 14);
const MARCH_14_GREGORIAN = plainDate(2026, 3, 14, 'gregory');
const AT_NOON = plainTime(12, 0);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a plain date counted in gregory', () => {
  it('is the same day as the ISO date of the same fields', () => {
    expect(text(formatPlainDate(MARCH_14_GREGORIAN, EN, DATE))).toBe(
      text(formatPlainDate(MARCH_14, EN, DATE)),
    );
    expect(text(formatPlainDate(MARCH_14_GREGORIAN, EN))).toBe(
      host('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }),
    );
  });

  it('is the same day before the historical changeover of calendars', () => {
    // The tenth of October 1582 is a day of the proleptic calendar and of no historical one.
    expect(text(formatPlainDate(plainDate(1582, 10, 10, 'gregory'), EN))).toBe(
      host(
        'en-US',
        { year: 'numeric', month: 'numeric', day: 'numeric' },
        noon(1582, 10, 10),
      ),
    );
    expect(text(formatPlainDate(plainDate(1582, 10, 10, 'gregory'), EN))).toBe(
      '10/10/1582',
    );
  });

  it('is written in gregory under a locale of another calendar', () => {
    expect(
      text(formatPlainDate(MARCH_14_GREGORIAN, { locale: 'th-TH' }, DATE)),
    ).toBe(host('th-TH', { ...DATE, calendar: 'gregory' }));
  });

  it('is written in gregory over the calendar the context names', () => {
    expect(text(formatPlainDate(MARCH_14_GREGORIAN, BUDDHIST, DATE))).toBe(
      host('en-US', { ...DATE, calendar: 'gregory' }),
    );
    expect(
      text(
        formatPlainDateTime(
          plainDateTime(MARCH_14_GREGORIAN, AT_NOON),
          { locale: 'th-TH', calendar: 'buddhist' },
          DATE_AND_TIME,
        ),
      ),
    ).toBe(host('th-TH', { ...DATE_AND_TIME, calendar: 'gregory' }));
  });

  it('is written in the calendar the call names', () => {
    expect(
      text(
        formatPlainDate(MARCH_14_GREGORIAN, EN, {
          ...DATE,
          calendar: 'buddhist',
        }),
      ),
    ).toBe(host('en-US', { ...DATE, calendar: 'buddhist' }));
  });

  it.each([
    ['the thirtieth of February', 2024, 2, 30],
    ['the twenty-ninth of February in a common year', 2023, 2, 29],
    ['the thirty-first of April', 2024, 4, 31],
  ])('is refused where it is %s', (_title, year, month, day) => {
    let thrown: unknown;
    try {
      plainDate(year, month, day, 'gregory');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LocalizationError);
    expect((thrown as LocalizationError).diagnostic.code).toBe(
      'invalid-message-input',
    );
  });

  it('is admitted on the twenty-ninth of February in a leap year', () => {
    expect(plainDate(2024, 2, 29, 'gregory')).toStrictEqual({
      kind: 'plain-date',
      year: 2024,
      month: 2,
      day: 29,
      calendar: 'gregory',
    });
  });

  it('is reported where the host answers gregory with another calendar', () => {
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(
      Intl.DateTimeFormat.prototype,
      'resolvedOptions',
    ).mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolved.call(this), calendar: 'buddhist' };
    });
    const unsupported = {
      ok: false,
      diagnostic: {
        code: 'unsupported-formatting-capability',
        outcome: 'operational-failure',
        targetLocale: 'en-US',
        reason: 'native-capability-rejected',
      },
    };

    // What the host answered for a formatter is kept with it, so each shape of options here is
    // one no other test has built a formatter for.
    const date = { dateStyle: 'full' } as const;
    const dateAndTime = { dateStyle: 'full', timeStyle: 'medium' } as const;

    expect(formatPlainDate(MARCH_14_GREGORIAN, EN, date)).toMatchObject(
      unsupported,
    );
    expect(
      formatPlainDateTime(
        plainDateTime(MARCH_14_GREGORIAN, AT_NOON),
        EN,
        dateAndTime,
      ),
    ).toMatchObject(unsupported);
    // An ISO date names no calendar to hold the host to.
    expect(formatPlainDate(MARCH_14, EN, date)).toMatchObject({ ok: true });
  });

  it('is what a date field of a gregory profile reads, and the formatter writes it', () => {
    const read = parseLocalizedInput(
      '2026-03-14',
      {
        kind: 'plain-date',
        order: 'year-month-day',
        separator: '-',
        calendar: 'gregory',
      },
      EN,
    );

    expect(read).toMatchObject({
      status: 'valid',
      value: { calendar: 'gregory' },
    });
    expect(
      text(
        formatPlainDate(
          (read as { value: typeof MARCH_14_GREGORIAN }).value,
          EN,
          DATE,
        ),
      ),
    ).toBe(host('en-US', DATE));
  });
});

describe('a plain date counted in a calendar that is neither', () => {
  it.each(['hebrew', 'buddhist', 'islamic-civil', 'zzzzzz'])(
    'is reported by the formatter and not thrown, in %s',
    (calendar) => {
      const refused = {
        ok: false,
        diagnostic: {
          code: 'unsupported-formatting-capability',
          outcome: 'operational-failure',
          targetLocale: 'en-US',
        },
      };

      expect(
        formatPlainDate(plainDate(2026, 3, 14, calendar), EN),
      ).toMatchObject(refused);
      expect(
        formatPlainDateTime(
          plainDateTime(plainDate(2026, 3, 14, calendar), AT_NOON),
          EN,
        ),
      ).toMatchObject(refused);
    },
  );

  it('keeps fields its own calendar may have and the ISO calendar does not', () => {
    expect(plainDate(1445, 2, 30, 'islamic-civil').day).toBe(30);
  });
});
