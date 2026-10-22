import { describe, expect, it } from 'vitest';

import { plainDate } from '../src/formatting.js';
import { parseLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
  type LocalizedInputStatus,
  type PlainDateValue,
} from '@neolorn/equator/core';

/**
 * A date field is read against a pattern the application states: the order of the three fields,
 * what separates them, the calendar, and the earliest and latest date. Nothing about the pattern
 * is guessed, so a pattern that does not hold together is refused as the profile's fault before
 * any text is read, and text that does not fit it is reported by what is wrong with it.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const ARABIC_DIGITS: FormattingContext = Object.freeze({
  locale: 'ar-EG',
  numberingSystem: 'arab',
});

type DateProfile = Extract<LocalizedInputProfile, { kind: 'plain-date' }>;

const ISO: DateProfile = Object.freeze({
  kind: 'plain-date',
  order: 'year-month-day',
  separator: '-',
});

function read(
  text: string,
  profile: object = ISO,
  context: FormattingContext = EN,
): {
  readonly status: LocalizedInputStatus;
  readonly value?: unknown;
  readonly diagnostic?: unknown;
} {
  return parseLocalizedInput(text, profile as LocalizedInputProfile, context);
}

// A boundary written by hand rather than through `plainDate`, which would refuse to build it.
function rawDate(
  year: number,
  month: number,
  day: number,
  calendar = 'iso8601',
): PlainDateValue {
  return { kind: 'plain-date', year, month, day, calendar };
}

describe('a date read in its declared field order', () => {
  it('reads year, month, day', () => {
    expect(read('2024-01-02')).toMatchObject({
      status: 'valid',
      value: {
        kind: 'plain-date',
        year: 2024,
        month: 1,
        day: 2,
        calendar: 'iso8601',
      },
    });
  });

  it('reads day, month, year', () => {
    expect(
      read('02/01/2024', { ...ISO, order: 'day-month-year', separator: '/' }),
    ).toMatchObject({
      status: 'valid',
      value: { year: 2024, month: 1, day: 2 },
    });
  });

  it('reads month, day, year', () => {
    expect(
      read('01/02/2024', { ...ISO, order: 'month-day-year', separator: '/' }),
    ).toMatchObject({
      status: 'valid',
      value: { year: 2024, month: 1, day: 2 },
    });
  });

  it('reads a separator of several characters', () => {
    expect(read('2024 / 01 / 02', { ...ISO, separator: ' / ' })).toMatchObject({
      status: 'valid',
      value: { year: 2024, month: 1, day: 2 },
    });
  });

  it('reads the Gregorian calendar and names it on the value', () => {
    expect(read('2024-01-02', { ...ISO, calendar: 'gregory' })).toMatchObject({
      status: 'valid',
      value: { year: 2024, month: 1, day: 2, calendar: 'gregory' },
    });
  });

  it('reads the digits of the numbering system the context names', () => {
    expect(read('٢٠٢٤-٠١-٠٢', ISO, ARABIC_DIGITS)).toMatchObject({
      status: 'valid',
      value: { year: 2024, month: 1, day: 2 },
    });
  });

  it('does not read digits of another numbering system', () => {
    expect(read('2024-01-02', ISO, ARABIC_DIGITS).status).toBe('invalid');
  });
});

describe('a date pattern that does not hold together', () => {
  const REFUSED: readonly (readonly [string, object])[] = [
    ['an order outside the three', { ...ISO, order: 'year-day-month' }],
    ['an empty separator', { ...ISO, separator: '' }],
    ['a separator holding a digit', { ...ISO, separator: '1' }],
    ['a separator of 17 characters', { ...ISO, separator: '/'.repeat(17) }],
    ['a separator that is not NFC', { ...ISO, separator: 'é' }],
    ['a separator that is not text', { ...ISO, separator: ['-'] }],
    ['a calendar name starting off-grammar', { ...ISO, calendar: '!hebrew' }],
    ['a calendar name ending off-grammar', { ...ISO, calendar: 'hebrew!' }],
    ['an empty calendar name', { ...ISO, calendar: '' }],
    ['a calendar name in upper case', { ...ISO, calendar: 'GREGORY' }],
    ['a calendar name of one character', { ...ISO, calendar: 'g' }],
    ['a calendar name of nine characters', { ...ISO, calendar: 'gregorian' }],
    ['a minimum that is no date', { ...ISO, minimum: rawDate(2023, 2, 30) }],
    ['a maximum that is no date', { ...ISO, maximum: rawDate(2025, 2, 30) }],
    [
      'a Gregorian minimum that is no date',
      { ...ISO, calendar: 'gregory', minimum: rawDate(2023, 2, 30, 'gregory') },
    ],
    ['a minimum with a month of 13', { ...ISO, minimum: rawDate(2023, 13, 1) }],
    [
      'a minimum in another calendar',
      { ...ISO, minimum: rawDate(2024, 1, 1, 'gregory') },
    ],
    [
      'a maximum in another calendar',
      { ...ISO, maximum: rawDate(2024, 12, 31, 'gregory') },
    ],
    [
      'a minimum after its maximum',
      { ...ISO, minimum: rawDate(2025, 1, 1), maximum: rawDate(2024, 1, 1) },
    ],
  ];

  for (const [title, profile] of REFUSED) {
    it(`refuses ${title}`, () => {
      // The text fits the separator each profile declares, so only the profile can be at fault.
      const separator = (profile as { separator: unknown }).separator;
      const joined =
        typeof separator === 'string' && separator.length > 0 ? separator : '-';
      const text = ['2024', '06', '01'].join(joined);
      expect(read(text, profile).status).toBe('policy-rejected');
    });
  }

  it('reports a well-formed calendar it cannot read as unsupported', () => {
    expect(read('2024-01-02', { ...ISO, calendar: 'hebrew' })).toMatchObject({
      status: 'unsupported-capability',
      diagnostic: { code: 'unsupported-input-capability' },
    });
  });

  it('does not judge another calendar by Gregorian month lengths', () => {
    // The thirtieth day of a second month exists in calendars this parser cannot read, so the
    // bound is not the profile's mistake and the missing capability is what gets reported.
    expect(
      read('5784-02-30', {
        ...ISO,
        calendar: 'hebrew',
        minimum: rawDate(5784, 2, 30, 'hebrew'),
      }).status,
    ).toBe('unsupported-capability');
  });

  it('accepts a separator of 16 characters', () => {
    const separator = '/'.repeat(16);
    expect(
      read(['2024', '01', '02'].join(separator), { ...ISO, separator }).status,
    ).toBe('valid');
  });

  it('accepts a minimum equal to its maximum', () => {
    const day = plainDate(2024, 1, 2);
    expect(
      read('2024-01-02', { ...ISO, minimum: day, maximum: day }).status,
    ).toBe('valid');
  });

  it('accepts Gregorian bounds on a Gregorian field', () => {
    expect(
      read('2024-01-02', {
        ...ISO,
        calendar: 'gregory',
        minimum: plainDate(2024, 1, 1, 'gregory'),
        maximum: plainDate(2024, 12, 31, 'gregory'),
      }).status,
    ).toBe('valid');
  });
});

describe('a date against its declared range', () => {
  const minimum = plainDate(2024, 1, 10);
  const maximum = plainDate(2024, 3, 20);

  const RANGED: readonly (readonly [string, string, LocalizedInputStatus])[] = [
    ['the day before the minimum', '2024-01-09', 'out-of-range'],
    ['the minimum itself', '2024-01-10', 'valid'],
    ['a later day in an earlier month of range', '2024-02-05', 'valid'],
    ['the maximum itself', '2024-03-20', 'valid'],
    ['the day after the maximum', '2024-03-21', 'out-of-range'],
    ['the year before', '2023-02-15', 'out-of-range'],
    ['the year after', '2025-02-15', 'out-of-range'],
  ];

  for (const [title, text, status] of RANGED) {
    it(`reads ${title} as ${status}`, () => {
      expect(read(text, { ...ISO, minimum, maximum }).status).toBe(status);
    });
  }

  it('applies a minimum declared alone', () => {
    expect(read('2024-01-09', { ...ISO, minimum }).status).toBe('out-of-range');
    expect(read('2030-01-01', { ...ISO, minimum }).status).toBe('valid');
  });

  it('applies a maximum declared alone', () => {
    expect(read('2024-03-21', { ...ISO, maximum }).status).toBe('out-of-range');
    expect(read('1999-01-01', { ...ISO, maximum }).status).toBe('valid');
  });
});

describe('date text that does not fit the pattern', () => {
  const TEXTS: readonly (readonly [string, string, LocalizedInputStatus])[] = [
    ['two fields', '2024-01', 'incomplete'],
    ['a trailing separator', '2024-01-', 'incomplete'],
    ['an empty middle field', '2024--02', 'incomplete'],
    ['an empty field among four', '2024-01--02', 'incomplete'],
    ['four fields', '2024-01-02-03', 'invalid'],
    ['a letter in a field', '2024-0x-02', 'invalid'],
    ['a year of two digits', '24-01-02', 'invalid'],
    ['a year of five digits', '02024-01-02', 'invalid'],
    ['the 29th of February in a common year', '2023-02-29', 'out-of-range'],
    ['a month of 13', '2024-13-01', 'out-of-range'],
    ['a day of zero', '2024-01-00', 'out-of-range'],
  ];

  for (const [title, text, status] of TEXTS) {
    it(`reports ${title} as ${status}`, () => {
      expect(read(text).status).toBe(status);
    });
  }

  it('reads the 29th of February in a leap year', () => {
    expect(read('2024-02-29')).toMatchObject({
      status: 'valid',
      value: { year: 2024, month: 2, day: 29 },
    });
  });

  it('reports a Gregorian date that does not exist as out of range', () => {
    expect(read('2023-02-30', { ...ISO, calendar: 'gregory' }).status).toBe(
      'out-of-range',
    );
  });

  it('reports a day or a month too large to be a date as a date that does not exist', () => {
    // Twenty digits is past what a number holds exactly, and four hundred is past every number.
    for (const field of ['9'.repeat(20), '9'.repeat(400)]) {
      for (const text of [`2024-01-${field}`, `2024-${field}-01`]) {
        expect(read(text, { ...ISO, maximumCharacters: 500 })).toMatchObject({
          status: 'out-of-range',
          diagnostic: { reason: 'malformed-input' },
        });
      }
    }
  });

  it('refuses a bound whose fields are not whole numbers', () => {
    for (const bound of [
      rawDate(2024.5, 1, 2),
      rawDate(2024, 1.5, 2),
      rawDate(2024, 1, 2.5),
    ]) {
      expect(read('2024-01-02', { ...ISO, minimum: bound }).status).toBe(
        'policy-rejected',
      );
    }
  });

  it('reads the year by its position in a day-first field', () => {
    expect(
      read('02/01/24', { ...ISO, order: 'day-month-year', separator: '/' })
        .status,
    ).toBe('invalid');
  });

  it('says a date that does not exist was malformed input', () => {
    expect(read('2023-02-29')).toMatchObject({
      status: 'out-of-range',
      diagnostic: {
        code: 'invalid-localized-input',
        reason: 'malformed-input',
      },
    });
  });
});

describe('the length of date text', () => {
  // Leading zeros keep the text a real date at any length.
  const padded = (length: number): string =>
    `2024-01-${'2'.padStart(length - 8, '0')}`;

  it('reads 64 characters when no limit is declared', () => {
    expect(read(padded(64))).toMatchObject({
      status: 'valid',
      value: { day: 2 },
    });
  });

  it('refuses 65 characters when no limit is declared', () => {
    expect(read(padded(65)).status).toBe('policy-rejected');
  });

  it('reads text exactly as long as the declared limit', () => {
    expect(read('2024-01-02', { ...ISO, maximumCharacters: 10 }).status).toBe(
      'valid',
    );
  });

  it('reads more than 64 characters under a larger declared limit', () => {
    expect(read(padded(70), { ...ISO, maximumCharacters: 70 }).status).toBe(
      'valid',
    );
  });
});
