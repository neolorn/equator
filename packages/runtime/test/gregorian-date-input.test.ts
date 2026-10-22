import { describe, expect, it } from 'vitest';

import { plainDate } from '../src/formatting.js';
import {
  formatLocalizedInput,
  parseLocalizedInput,
} from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
  type PlainDateValue,
} from '@neolorn/equator/core';

/**
 * A date field under the Gregorian calendar reads and writes only dates that exist.
 *
 * `plainDate` asks that of a Gregorian date as of an ISO one when it builds either, and a value or
 * a bound can also reach the field as an object nobody built. The field answers the same for both:
 * of the text it reads, of the value it writes, and of the bounds its profile declares.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

const GREGORIAN: LocalizedInputProfile = {
  kind: 'plain-date',
  order: 'year-month-day',
  separator: '-',
  calendar: 'gregory',
};

// Written as an object: `plainDate` refuses a Gregorian date that does not exist, and some below
// do not.
const gregorian = (year: number, month: number, day: number): PlainDateValue =>
  Object.freeze({ kind: 'plain-date', year, month, day, calendar: 'gregory' });

describe('a Gregorian date read from a field', () => {
  it.each([
    ['the thirtieth of February', '2026-02-30'],
    ['the thirty-first of April', '2026-04-31'],
    ['the twenty-ninth of February outside a leap year', '2026-02-29'],
    ['a thirteenth month', '2026-13-01'],
    ['a month of zero', '2026-00-31'],
    ['a day of zero', '2026-03-00'],
  ])('is out of range for %s', (_, text) => {
    expect(parseLocalizedInput(text, GREGORIAN, EN)).toMatchObject({
      status: 'out-of-range',
      text,
      diagnostic: { reason: 'malformed-input' },
    });
  });

  it.each([
    ['the twenty-eighth of February', '2026-02-28', gregorian(2026, 2, 28)],
    ['the twenty-ninth in a leap year', '2024-02-29', gregorian(2024, 2, 29)],
    ['the thirty-first of December', '2026-12-31', gregorian(2026, 12, 31)],
  ])('is read for %s', (_, text, value) => {
    expect(parseLocalizedInput(text, GREGORIAN, EN)).toStrictEqual({
      status: 'valid',
      text,
      value,
    });
  });
});

describe('a Gregorian date written for a field', () => {
  it('is reported when it does not exist', () => {
    expect(
      formatLocalizedInput(gregorian(2026, 2, 30), GREGORIAN, EN),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-localized-input' },
    });
  });

  it('is written when it does', () => {
    expect(
      formatLocalizedInput(gregorian(2024, 2, 29), GREGORIAN, EN),
    ).toMatchObject({ ok: true, value: { text: '2024-02-29' } });
  });
});

describe('the bounds a date profile declares', () => {
  const bounded = (
    calendar: string,
    minimum: PlainDateValue,
  ): LocalizedInputProfile => ({
    kind: 'plain-date',
    order: 'year-month-day',
    separator: '-',
    calendar,
    minimum,
  });

  it('make the profile invalid when a Gregorian bound does not exist', () => {
    expect(
      parseLocalizedInput(
        '2026-03-14',
        bounded('gregory', gregorian(2026, 2, 30)),
        EN,
      ).status,
    ).toBe('policy-rejected');
  });

  it('are admitted when a Gregorian bound exists', () => {
    expect(
      parseLocalizedInput(
        '2026-03-14',
        bounded('gregory', gregorian(2026, 2, 28)),
        EN,
      ).status,
    ).toBe('valid');
  });

  it('make the profile invalid when a bound holds a field that is no field of a date', () => {
    const bound = { kind: 'plain-date', year: 2026, month: 13, day: 1 };
    expect(
      parseLocalizedInput(
        '2026-03-14',
        bounded('gregory', { ...bound, calendar: 'gregory' } as PlainDateValue),
        EN,
      ).status,
    ).toBe('policy-rejected');
  });

  it('are not judged by the Gregorian calendar under a calendar that is neither', () => {
    // The thirtieth day of the second month exists in calendars this field does not read, so the
    // profile is not called invalid for it; the calendar is what the field cannot do.
    expect(
      parseLocalizedInput(
        '2026-03-14',
        bounded('islamic', plainDate(1447, 2, 30, 'islamic')),
        EN,
      ).status,
    ).toBe('unsupported-capability');
  });
});
