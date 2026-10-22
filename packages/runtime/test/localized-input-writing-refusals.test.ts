import { describe, expect, it } from 'vitest';

import { plainDate, plainDateTime, plainTime } from '../src/formatting.js';
import { formatLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type FormattingResult,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * Writing a field answers with text or with a reported failure. A value read from storage or built
 * by other code can be anything, and so can the locale of a context, so each case here hands the
 * writer something its types rule out and reads the answer it gives instead of a throw.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const NOT_A_LOCALE: FormattingContext = Object.freeze({ locale: 'not a tag' });

const REFUSED = { ok: false, diagnostic: { code: 'invalid-localized-input' } };
// A locale the platform has no digits for is a capability it lacks, not a fault in the value.
const LACKING = {
  ok: false,
  diagnostic: {
    code: 'unsupported-formatting-capability',
    reason: 'native-capability-rejected',
  },
};

const DATE: LocalizedInputProfile = {
  kind: 'plain-date',
  order: 'year-month-day',
  separator: '-',
};
const TIME = { hourCycle: 'h23', precision: 'minute', separator: ':' } as const;
const DATE_TIME: LocalizedInputProfile = {
  kind: 'plain-date-time',
  date: { order: 'year-month-day', separator: '-' },
  time: TIME,
  separator: ' ',
};

// The value is typed as anything, which is what the writer is given by a caller outside the types.
const write = (
  value: unknown,
  profile: LocalizedInputProfile,
  context: FormattingContext = EN,
): FormattingResult => formatLocalizedInput(value as never, profile, context);

describe('a field written in a locale that is not a language tag', () => {
  it('reports a date instead of throwing', () => {
    expect(write(plainDate(2026, 3, 14), DATE, NOT_A_LOCALE)).toMatchObject(
      LACKING,
    );
  });

  it('reports a date and time instead of throwing', () => {
    expect(
      write(
        plainDateTime(plainDate(2026, 3, 14), plainTime(9, 30)),
        DATE_TIME,
        NOT_A_LOCALE,
      ),
    ).toMatchObject(LACKING);
  });

  it('writes the same values in a locale that is one', () => {
    expect(write(plainDate(2026, 3, 14), DATE)).toMatchObject({
      ok: true,
      value: { text: '2026-03-14' },
    });
    expect(
      write(plainDateTime(plainDate(2026, 3, 14), plainTime(9, 30)), DATE_TIME),
    ).toMatchObject({ ok: true, value: { text: '2026-03-14 09:30' } });
  });
});

describe('a value that is not of the shape its kind declares', () => {
  const amount = { kind: 'decimal', value: '5' };

  it.each<[string, unknown, LocalizedInputProfile]>([
    ['nothing at all', undefined, { kind: 'decimal' }],
    ['null', null, { kind: 'decimal' }],
    ['a text', '5', { kind: 'decimal' }],
    [
      'money with no amount',
      { kind: 'money', currency: 'USD' },
      { kind: 'money', currency: 'USD' },
    ],
    [
      'money whose amount is a text',
      { kind: 'money', currency: 'USD', amount: '5' },
      { kind: 'money', currency: 'USD' },
    ],
    [
      'a measurement with no amount',
      { kind: 'measurement', unit: 'day' },
      { kind: 'measurement', unit: 'day' },
    ],
    [
      'a percentage with no amount',
      { kind: 'percent', scale: 'percent-unit' },
      { kind: 'percent', scale: 'percent-unit' },
    ],
    [
      'a percentage whose amount is not a number',
      {
        kind: 'percent',
        scale: 'percent-unit',
        amount: { kind: 'decimal', value: 'abc' },
      },
      { kind: 'percent', scale: 'percent-unit' },
    ],
    [
      'percentage points with no amount',
      { kind: 'percentage-points' },
      { kind: 'percentage-points' },
    ],
    [
      'an instant with no count',
      { kind: 'instant' },
      { kind: 'instant', syntax: 'rfc3339' },
    ],
    [
      'an instant whose count is not a whole number',
      { kind: 'instant', epochNanoseconds: '1.5' },
      { kind: 'instant', syntax: 'rfc3339' },
    ],
    [
      'an instant whose count is not a number',
      { kind: 'instant', epochNanoseconds: 'abc' },
      { kind: 'instant', syntax: 'rfc3339' },
    ],
    [
      'a duration with no seconds',
      {
        kind: 'duration',
        sign: 1,
        years: 0,
        months: 1,
        weeks: 0,
        days: 0,
        hours: 0,
        minutes: 0,
      },
      { kind: 'duration', pattern: [{ field: 'months' }, 'mo'] },
    ],
  ])('is reported and not thrown: %s', (_, value, profile) => {
    expect(write(value, profile)).toMatchObject(REFUSED);
  });

  it('is told apart from a value of the declared shape', () => {
    expect(
      write(
        { kind: 'money', currency: 'USD', amount },
        { kind: 'money', currency: 'USD' },
      ),
    ).toMatchObject({ ok: true });
  });
});

describe('a temporal value written by hand with a field that is not a number', () => {
  const MINUTES: LocalizedInputProfile = { kind: 'plain-time', ...TIME };

  it.each<[string, unknown, LocalizedInputProfile]>([
    [
      'a time whose second is a text',
      { kind: 'plain-time', hour: 9, minute: 30, second: '0', nanosecond: 0 },
      MINUTES,
    ],
    [
      'a time whose nanosecond is a text',
      { kind: 'plain-time', hour: 9, minute: 30, second: 0, nanosecond: '0' },
      MINUTES,
    ],
    [
      'a time whose hour is a text',
      { kind: 'plain-time', hour: '9', minute: 30, second: 0, nanosecond: 0 },
      MINUTES,
    ],
    [
      'a time with no minute',
      { kind: 'plain-time', hour: 9, second: 0, nanosecond: 0 },
      MINUTES,
    ],
    [
      'a date whose day is a text',
      {
        kind: 'plain-date',
        year: 2026,
        month: 3,
        day: '14',
        calendar: 'iso8601',
      },
      DATE,
    ],
    [
      'a date whose year is a text',
      {
        kind: 'plain-date',
        year: '2026',
        month: 3,
        day: 14,
        calendar: 'iso8601',
      },
      DATE,
    ],
    [
      'a date and time whose day is a text',
      {
        kind: 'plain-date-time',
        date: {
          kind: 'plain-date',
          year: 2026,
          month: 3,
          day: '14',
          calendar: 'iso8601',
        },
        time: plainTime(9, 30),
      },
      DATE_TIME,
    ],
    [
      'a date and time whose second is a text',
      {
        kind: 'plain-date-time',
        date: plainDate(2026, 3, 14),
        time: {
          kind: 'plain-time',
          hour: 9,
          minute: 30,
          second: '0',
          nanosecond: 0,
        },
      },
      DATE_TIME,
    ],
  ])('is reported: %s', (_, value, profile) => {
    expect(write(value, profile)).toMatchObject(REFUSED);
  });

  it('is told apart from the same values with numbers in their fields', () => {
    expect(write(plainTime(9, 30), MINUTES)).toMatchObject({
      ok: true,
      value: { text: '09:30' },
    });
  });
});

describe('a value of another currency, unit or scale than its profile', () => {
  // The profile is broken in a second way, which the platform would report with a code of its
  // own. The value not being the profile's is what the caller got wrong first.
  const amount = { kind: 'decimal', value: '5' };

  it.each<[string, unknown, LocalizedInputProfile]>([
    [
      'money in another currency',
      { kind: 'money', currency: 'USD', amount },
      { kind: 'money', currency: 'EUR', maximumFractionDigits: -1 },
    ],
    [
      'a measurement in another unit',
      { kind: 'measurement', unit: 'inch', amount },
      { kind: 'measurement', unit: 'kilometer', maximumFractionDigits: -1 },
    ],
    [
      'a percentage on another scale',
      { kind: 'percent', scale: 'fractional', amount },
      { kind: 'percent', scale: 'percent-unit', maximumFractionDigits: -1 },
    ],
  ])('is reported as not matching it: %s', (_, value, profile) => {
    expect(write(value, profile)).toMatchObject(REFUSED);
  });

  it('is the report of the platform when the value is of the profile', () => {
    expect(
      write(
        { kind: 'money', currency: 'EUR', amount },
        { kind: 'money', currency: 'EUR', maximumFractionDigits: -1 },
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: 'unsupported-formatting-capability' },
    });
  });
});
