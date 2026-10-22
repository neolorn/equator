import { describe, expect, it } from 'vitest';

import {
  formatPlainDateTime,
  formatPlainTime,
  plainDate,
  plainDateTime,
  plainTime,
} from '../src/formatting.js';
import { type FormattingContext } from '@neolorn/equator/core';

/**
 * The fields a plain time and a plain date-time are written with where the caller names none.
 *
 * A formatter handed no fields writes a date, so a plain time formatted without options would come
 * out as the first of January 1970. The defaults are what keep it a time: hours, minutes and
 * seconds, with the numeric date fields before them for a plain date-time. Every expected text and
 * part is asked of the platform with those fields at the moment the value names in UTC.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

const native = (options: Intl.DateTimeFormatOptions, milliseconds: number) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: 'UTC',
  });
  return {
    text: formatter.format(milliseconds),
    parts: formatter
      .formatToParts(milliseconds)
      .map(({ type, value }) => ({ kind: type, value })),
  };
};

const kinds = (parts: readonly { readonly kind: string }[]) =>
  parts.map(({ kind }) => kind).filter((kind) => kind !== 'literal');

describe('a plain time formatted without options', () => {
  // 13:05:09
  const value = plainTime(13, 5, 9);
  const moment = Date.UTC(1970, 0, 1, 13, 5, 9);

  it('is written as its hour, minute and second', () => {
    const expected = native(
      { hour: 'numeric', minute: 'numeric', second: 'numeric' },
      moment,
    );

    expect(kinds(expected.parts)).toStrictEqual([
      'hour',
      'minute',
      'second',
      'dayPeriod',
    ]);
    expect(formatPlainTime(value, EN)).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'plain-time',
        text: expected.text,
        parts: expected.parts,
        locale: 'en-US',
        language: 'en-US',
        direction: 'ltr',
        source: value,
      },
    });
  });
});

describe('a plain date-time formatted without options', () => {
  // 2024-03-14T13:05:09
  const value = plainDateTime(plainDate(2024, 3, 14), plainTime(13, 5, 9));
  const moment = Date.UTC(2024, 2, 14, 13, 5, 9);

  it('is written as its numeric date and its hour, minute and second', () => {
    const expected = native(
      {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      },
      moment,
    );

    expect(kinds(expected.parts)).toStrictEqual([
      'month',
      'day',
      'year',
      'hour',
      'minute',
      'second',
      'dayPeriod',
    ]);
    expect(formatPlainDateTime(value, EN)).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'plain-date-time',
        text: expected.text,
        parts: expected.parts,
        locale: 'en-US',
        language: 'en-US',
        direction: 'ltr',
        source: value,
      },
    });
  });
});
