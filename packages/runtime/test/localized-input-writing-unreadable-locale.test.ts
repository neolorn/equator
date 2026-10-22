import { describe, expect, it } from 'vitest';

import {
  decimal,
  duration,
  plainDate,
  plainDateTime,
  plainTime,
} from '../src/formatting.js';
import { formatLocalizedInput } from '../src/localized-input.js';
import {
  type LocalizedInputProfile,
  type LocalizedInputValue,
} from '@neolorn/equator/core';

/**
 * Writing a field's value under a locale the host refuses.
 *
 * A date, a time and a duration are written digit by digit in the locale's own digits, which the
 * host's number formatter is asked for. A locale tag the host throws on has none, so there is
 * nothing to write the value in. That is a capability the host lacks and not a fault in the value
 * or in the field's profile, so the write reports it as one and names the host's refusal as the
 * reason, as a number written under the same locale does and as reading the same field does.
 */

/** An underscore where a hyphen belongs, which the host refuses as a locale. */
const REFUSED = 'en_US';

const DATE: LocalizedInputProfile = {
  kind: 'plain-date',
  order: 'year-month-day',
  separator: '-',
};
const TIME: LocalizedInputProfile = {
  kind: 'plain-time',
  hourCycle: 'h23',
  precision: 'minute',
  separator: ':',
};
const DATE_TIME: LocalizedInputProfile = {
  kind: 'plain-date-time',
  date: { order: 'year-month-day', separator: '-' },
  time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
  separator: ' ',
};
const HOURS: LocalizedInputProfile = {
  kind: 'duration',
  pattern: [{ field: 'hours', maximumIntegerDigits: 2 }],
};

const write = (
  value: unknown,
  profile: LocalizedInputProfile,
  locale = REFUSED,
) =>
  formatLocalizedInput(
    value as LocalizedInputValue<LocalizedInputProfile>,
    profile,
    { locale },
  );

const LACKING = {
  ok: false,
  diagnostic: {
    code: 'unsupported-formatting-capability',
    outcome: 'operational-failure',
    message: expect.stringMatching(/\S/u) as unknown as string,
    targetLocale: REFUSED,
    reason: 'native-capability-rejected',
  },
};

describe('a value written under a locale the host refuses', () => {
  it('is under a tag the host’s number formatter throws on', () => {
    expect(() => new Intl.NumberFormat(REFUSED)).toThrow(RangeError);
  });

  it('is reported for a number as a capability the host lacks', () => {
    expect(write(decimal('5'), { kind: 'decimal' })).toStrictEqual(LACKING);
  });

  it.each([
    ['a date', plainDate(2024, 2, 3), DATE, '2024-02-03'],
    ['a time', plainTime(1, 2), TIME, '01:02'],
    [
      'a date and time',
      plainDateTime(plainDate(2024, 2, 3), plainTime(1, 2)),
      DATE_TIME,
      '2024-02-03 01:02',
    ],
    ['a duration', duration({ hours: 5 }), HOURS, '5'],
  ])(
    'is reported for %s as the same capability, with the same reason',
    (_name, value, profile, text) => {
      expect(write(value, profile, 'en-US')).toMatchObject({
        ok: true,
        value: { text },
      });
      expect(write(value, profile)).toStrictEqual(LACKING);
    },
  );

  it('is still reported as a fault in the profile where the profile is the fault', () => {
    const written = write(plainTime(1, 2), {
      ...TIME,
      separator: '',
    } as LocalizedInputProfile);

    expect(written).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-localized-input' },
    });
    expect(Object.keys((written as typeof LACKING).diagnostic)).not.toContain(
      'reason',
    );
  });
});

describe('a value that is not one, written under a locale the host accepts', () => {
  it.each([
    [
      'a date',
      {
        kind: 'plain-date',
        calendar: 'iso8601',
        year: 2024,
        month: 13,
        day: 1,
      },
      DATE,
    ],
    [
      'a time',
      { kind: 'plain-time', hour: 25, minute: 0, second: 0, nanosecond: 0 },
      TIME,
    ],
  ])(
    'is reported for %s as a fault in the value, with no reason',
    (_name, value, profile) => {
      const written = write(value, profile, 'en-US');

      expect(written).toMatchObject({
        ok: false,
        diagnostic: { code: 'invalid-localized-input' },
      });
      expect(Object.keys((written as typeof LACKING).diagnostic)).not.toContain(
        'reason',
      );
    },
  );
});
