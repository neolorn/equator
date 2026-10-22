import { describe, expect, it } from 'vitest';

import {
  formatPlainDateTime,
  formatPlainTime,
  formatZonedDateTime,
  instant,
  plainDate,
  plainDateTime,
  plainTime,
  zonedDateTime,
} from '../src/formatting.js';
import { type FormattingContext } from '@neolorn/equator/core';

/**
 * What formatting a plain time, a plain date-time and a zoned date-time hands back.
 *
 * A plain value has no zone, so its fields are the fields written: the hour asked for is the hour
 * shown, to the millisecond, whatever zone the host is in. Every expected text and every expected
 * part is asked of the platform with the same arguments at the moment the fields name in UTC, so
 * nothing here is a spelling that locale data may revise.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

/** A numbering system no platform carries, so the context asks for digits that do not exist. */
const NO_SUCH_DIGITS: FormattingContext = Object.freeze({
  locale: 'en-US',
  numberingSystem: 'zzzz',
});

const REFUSED = {
  ok: false,
  diagnostic: {
    code: 'unsupported-formatting-capability',
    outcome: 'operational-failure',
    targetLocale: 'en-US',
  },
};

const native = (
  locale: string,
  options: Intl.DateTimeFormatOptions,
  milliseconds: number,
) => {
  const formatter = new Intl.DateTimeFormat(locale, {
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

const TO_THE_MILLISECOND: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  fractionalSecondDigits: 3,
};

describe('a plain time', () => {
  // 13:05:09.007
  const value = plainTime(13, 5, 9, 7_000_000);
  const moment = Date.UTC(1970, 0, 1, 13, 5, 9, 7);

  it('is written at its own fields, to the millisecond', () => {
    const result = formatPlainTime(value, EN, TO_THE_MILLISECOND);
    const expected = native('en-US', TO_THE_MILLISECOND, moment);

    expect(expected.text).toContain('007');
    expect(result).toStrictEqual({
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

  it('is refused where it is finer than a millisecond', () => {
    expect(formatPlainTime(plainTime(13, 5, 9, 500), EN)).toMatchObject(
      REFUSED,
    );
  });

  it('is refused under a zone other than UTC, and written under UTC', () => {
    expect(
      formatPlainTime(value, EN, {
        hour: 'numeric',
        timeZone: 'America/New_York',
      }),
    ).toMatchObject(REFUSED);
    expect(
      formatPlainTime(value, EN, { hour: 'numeric', timeZone: 'UTC' }),
    ).toMatchObject({
      ok: true,
      value: { text: native('en-US', { hour: 'numeric' }, moment).text },
    });
  });

  it('is refused under a numbering system the platform has no data for', () => {
    expect(formatPlainTime(value, NO_SUCH_DIGITS)).toMatchObject({
      ...REFUSED,
      diagnostic: {
        ...REFUSED.diagnostic,
        reason: 'native-capability-rejected',
      },
    });
  });

  it('takes the hour cycle the context names', () => {
    const options = { hour: 'numeric', minute: 'numeric' } as const;
    const result = formatPlainTime(
      value,
      { locale: 'en-US', hourCycle: 'h23' },
      options,
    );
    const expected = native('en-US', { ...options, hourCycle: 'h23' }, moment);

    expect(expected.text).not.toBe(native('en-US', options, moment).text);
    expect(result).toMatchObject({ ok: true, value: { text: expected.text } });
  });
});

describe('a plain date-time', () => {
  // 2024-03-14T13:05:09.007
  const value = plainDateTime(
    plainDate(2024, 3, 14),
    plainTime(13, 5, 9, 7_000_000),
  );
  const moment = Date.UTC(2024, 2, 14, 13, 5, 9, 7);
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    ...TO_THE_MILLISECOND,
  };

  it('is written at its own fields, to the millisecond', () => {
    const result = formatPlainDateTime(value, EN, options);
    const expected = native('en-US', options, moment);

    expect(expected.text).toContain('007');
    expect(result).toStrictEqual({
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

  it('is refused where its time is finer than a millisecond', () => {
    expect(
      formatPlainDateTime(
        plainDateTime(plainDate(2024, 3, 14), plainTime(13, 5, 9, 500)),
        EN,
      ),
    ).toMatchObject(REFUSED);
  });

  it('is refused where its date is in a calendar other than the ISO one', () => {
    expect(
      formatPlainDateTime(
        plainDateTime(plainDate(5784, 6, 4, 'hebrew'), plainTime(13, 5)),
        EN,
      ),
    ).toMatchObject(REFUSED);
  });

  it('is refused under a zone other than UTC, and written under UTC', () => {
    expect(
      formatPlainDateTime(value, EN, {
        hour: 'numeric',
        timeZone: 'America/New_York',
      }),
    ).toMatchObject(REFUSED);
    expect(
      formatPlainDateTime(value, EN, { hour: 'numeric', timeZone: 'UTC' }),
    ).toMatchObject({
      ok: true,
      value: { text: native('en-US', { hour: 'numeric' }, moment).text },
    });
  });

  it('is refused under a numbering system the platform has no data for', () => {
    expect(formatPlainDateTime(value, NO_SUCH_DIGITS)).toMatchObject({
      ...REFUSED,
      diagnostic: {
        ...REFUSED.diagnostic,
        reason: 'native-capability-rejected',
      },
    });
  });

  it('takes the hour cycle the context names', () => {
    const fields = { hour: 'numeric', minute: 'numeric' } as const;
    const result = formatPlainDateTime(
      value,
      { locale: 'en-US', hourCycle: 'h23' },
      fields,
    );
    const expected = native('en-US', { ...fields, hourCycle: 'h23' }, moment);

    expect(expected.text).not.toBe(native('en-US', fields, moment).text);
    expect(result).toMatchObject({ ok: true, value: { text: expected.text } });
  });
});

describe('a zoned date-time', () => {
  // 2024-03-14T12:00:00Z
  const value = zonedDateTime(instant('1710417600000000000'), 'Asia/Tokyo');
  const options = { hour: 'numeric', minute: 'numeric' } as const;

  it('is reported as a zoned date-time whose source is the value, not its instant', () => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      ...options,
      timeZone: 'Asia/Tokyo',
    });
    const result = formatZonedDateTime(value, EN, options);

    expect(result).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'zoned-date-time',
        text: formatter.format(1_710_417_600_000),
        parts: formatter
          .formatToParts(1_710_417_600_000)
          .map(({ type, value: part }) => ({ kind: type, value: part })),
        locale: 'en-US',
        language: 'en-US',
        direction: 'ltr',
        source: value,
      },
    });
    expect(result.ok && result.value.source).toBe(value);
  });

  it('hands back the refusal its instant is formatted to', () => {
    expect(formatZonedDateTime(value, NO_SUCH_DIGITS, options)).toMatchObject({
      ...REFUSED,
      diagnostic: {
        ...REFUSED.diagnostic,
        reason: 'native-capability-rejected',
      },
    });
  });
});
