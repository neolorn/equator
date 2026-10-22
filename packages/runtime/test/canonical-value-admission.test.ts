import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import {
  decimal,
  duration,
  instant,
  measurement,
  money,
  percent,
  percentagePoints,
  plainDate,
  plainTime,
  timeZone,
  zonedDateTime,
} from '../src/formatting.js';
import { RUNTIME_LIMITS } from '../src/runtime-safety.js';

/**
 * What the value factories admit, and what a refusal carries.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 2 has every domain value normalized
 * where it is created, so two spellings of one number are one stored value and nothing reaches a
 * formatter that a formatter cannot read. Each factory is therefore a list of refusals, and each
 * case here stands on one side of one of them.
 */

function refusal(create: () => unknown): LocalizationError {
  let thrown: unknown;
  try {
    create();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LocalizationError);
  return thrown as LocalizationError;
}

const LONGEST = RUNTIME_LIMITS.canonicalNumberCodeUnits;

describe('a refused canonical value', () => {
  it('is reported as an operational failure of the message input', () => {
    const failure = refusal(() => decimal('1e5'));

    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
  });

  // A diagnostic is logged and compared field by field, so a reason that was not given is absent
  // and not a key holding nothing. The same holds for the error's cause.
  it('carries neither a reason nor a cause when its own grammar refused', () => {
    const failure = refusal(() => decimal('1e5'));

    expect('reason' in failure.diagnostic).toBe(false);
    expect(Object.hasOwn(failure, 'cause')).toBe(false);
  });

  it('carries a reason and no cause when the pinned time-zone table refused', () => {
    const failure = refusal(() => timeZone('Mars/Olympus_Mons'));

    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.reason).toBe('malformed-input');
    expect(Object.hasOwn(failure, 'cause')).toBe(false);
  });
});

describe('a decimal', () => {
  it.each([
    ['0', '0'],
    ['10', '10'],
    ['007', '7'],
    ['000', '0'],
    ['00.5', '0.5'],
    ['0.50', '0.5'],
    ['1.000', '1'],
    ['100.001', '100.001'],
    ['-12.5', '-12.5'],
    ['-007.50', '-7.5'],
    ['-0', '0'],
    ['-0.0', '0'],
    ['-000', '0'],
  ])('stores %s as %s', (written, stored) => {
    expect(decimal(written)).toEqual({ kind: 'decimal', value: stored });
  });

  it.each([
    ['nothing', ''],
    ['a plus sign', '+1'],
    ['an exponent', '1e5'],
    ['grouping', '1,000'],
    ['a point with no fraction', '1.'],
    ['a point with no integer', '.5'],
    ['text after the digits', '1.5x'],
    ['text before the digits', 'x1.5'],
    ['a sign after the digits', '1-'],
  ])('refuses %s', (_, written) => {
    expect(refusal(() => decimal(written)).diagnostic.code).toBe(
      'invalid-message-input',
    );
  });

  it('refuses a number that is not a string of digits', () => {
    refusal(() => decimal(5 as unknown as string));
  });

  it('admits a spelling exactly as long as the bound', () => {
    const written = `1${'0'.repeat(LONGEST - 1)}`;

    expect(decimal(written).value).toBe(written);
  });

  it('refuses a spelling one code unit past the bound', () => {
    refusal(() => decimal(`1${'0'.repeat(LONGEST)}`));
  });
});

describe('an instant', () => {
  it.each([
    ['0', '0'],
    ['7', '7'],
    ['1700000000000000000', '1700000000000000000'],
    ['-1700000000000000000', '-1700000000000000000'],
    ['-0', '0'],
  ])('stores %s as %s', (written, stored) => {
    expect(instant(written)).toEqual({
      kind: 'instant',
      epochNanoseconds: stored,
    });
  });

  it.each([
    ['nothing', ''],
    ['a plus sign', '+1'],
    ['a leading zero', '01'],
    ['a fraction', '1.5'],
    ['text after the digits', '1x'],
    ['text before the digits', 'x1'],
    ['text among the digits', '1x1'],
  ])('refuses %s', (_, written) => {
    expect(refusal(() => instant(written)).diagnostic.code).toBe(
      'invalid-message-input',
    );
  });

  it('refuses a number that is not a string of digits', () => {
    refusal(() => instant(5 as unknown as string));
  });

  it('admits a count exactly as long as the bound', () => {
    const written = `1${'0'.repeat(LONGEST - 1)}`;

    expect(instant(written).epochNanoseconds).toBe(written);
  });

  it('refuses a count one code unit past the bound', () => {
    refusal(() => instant(`1${'0'.repeat(LONGEST)}`));
  });
});

describe('a plain date', () => {
  it('is counted in the ISO calendar unless another is named', () => {
    const date = plainDate(2024, 2, 29);

    expect(date).toEqual({
      kind: 'plain-date',
      year: 2024,
      month: 2,
      day: 29,
      calendar: 'iso8601',
    });
    expect(Object.isFrozen(date)).toBe(true);
  });

  it.each([
    [2024, 1, 1],
    [2024, 12, 31],
    [1, 1, 1],
  ])('admits the ISO date %d-%d-%d', (year, month, day) => {
    expect(plainDate(year, month, day)).toMatchObject({ year, month, day });
  });

  it.each([
    ['the thirtieth of February', 2024, 2, 30],
    ['the twenty-ninth of February in a common year', 2023, 2, 29],
    ['the thirty-first of April', 2024, 4, 31],
    ['a year the platform cannot count to', 300_000, 1, 1],
  ])('refuses %s', (_, year, month, day) => {
    expect(refusal(() => plainDate(year, month, day)).diagnostic.code).toBe(
      'invalid-message-input',
    );
  });

  // Only an ISO date and a Gregorian one, which count the same days, are checked against a
  // calendar the platform can count in, so the cases below name another one: there the field
  // ranges are the whole check.
  it('does not hold another calendar to the ISO month lengths', () => {
    expect(plainDate(1445, 2, 30, 'islamic-civil')).toEqual({
      kind: 'plain-date',
      year: 1445,
      month: 2,
      day: 30,
      calendar: 'islamic-civil',
    });
  });

  it.each([
    ['month 12', 1445, 12, 1],
    ['day 31', 1445, 1, 31],
  ])('admits %s in any calendar', (_, year, month, day) => {
    expect(plainDate(year, month, day, 'islamic-civil')).toMatchObject({
      month,
      day,
    });
  });

  it.each([
    ['month 0', 1445, 0, 1],
    ['month 13', 1445, 13, 1],
    ['day 0', 1445, 1, 0],
    ['day 32', 1445, 1, 32],
    ['a fractional year', 1445.5, 1, 1],
    ['a fractional month', 1445, 1.5, 1],
    ['a fractional day', 1445, 1, 1.5],
  ])('refuses %s in any calendar', (_, year, month, day) => {
    refusal(() => plainDate(year, month, day, 'islamic-civil'));
  });

  it.each(['roc', 'gregory', 'islamic-civil', 'ethiopic-amete-alem', 'zzzzzz'])(
    'admits the calendar name %s, which the host is not asked about',
    (calendar) => {
      expect(plainDate(1, 1, 1, calendar).calendar).toBe(calendar);
    },
  );

  // One syntax for a value's calendar: what a zoned date-time refuses, a plain date refuses.
  it.each([
    ['empty', ''],
    ['one character', 'x'],
    ['a subtag of two characters', 'ab'],
    ['a subtag of nine characters', 'gregorian'],
    ['64 long', 'a'.repeat(64)],
    ['in upper case', 'GREGORY'],
    ['in mixed case', 'Hebrew'],
    ['led by a hyphen', '-hebrew'],
    ['ended by a hyphen', 'hebrew-'],
    ['joined by two hyphens', 'islamic--civil'],
    ['spaced', 'islamic civil'],
    ['led by a space', ' hebrew'],
    ['ended by a space', 'hebrew '],
    ['not text', 5],
  ])('refuses a calendar name that is %s', (_, calendar) => {
    refusal(() => plainDate(1, 1, 1, calendar as string));
    refusal(() => zonedDateTime(instant('0'), 'UTC', calendar as string));
  });
});

describe('a plain time', () => {
  it('has no seconds and no nanoseconds unless they are given', () => {
    const time = plainTime(9, 30);

    expect(time).toEqual({
      kind: 'plain-time',
      hour: 9,
      minute: 30,
      second: 0,
      nanosecond: 0,
    });
    expect(Object.isFrozen(time)).toBe(true);
  });

  it('admits the first and the last moment of a day', () => {
    expect(plainTime(0, 0, 0, 0)).toMatchObject({ hour: 0, nanosecond: 0 });
    expect(plainTime(23, 59, 59, 999_999_999)).toEqual({
      kind: 'plain-time',
      hour: 23,
      minute: 59,
      second: 59,
      nanosecond: 999_999_999,
    });
  });

  it.each([
    ['hour 24', 24, 0, 0, 0],
    ['hour -1', -1, 0, 0, 0],
    ['minute 60', 0, 60, 0, 0],
    ['minute -1', 0, -1, 0, 0],
    ['second 60', 0, 0, 60, 0],
    ['second -1', 0, 0, -1, 0],
    ['a whole second of nanoseconds', 0, 0, 0, 1_000_000_000],
    ['nanosecond -1', 0, 0, 0, -1],
    ['a fractional hour', 1.5, 0, 0, 0],
    ['a fractional minute', 0, 1.5, 0, 0],
    ['a fractional second', 0, 0, 1.5, 0],
    ['a fractional nanosecond', 0, 0, 0, 1.5],
  ])('refuses %s', (_, hour, minute, second, nanosecond) => {
    expect(
      refusal(() => plainTime(hour, minute, second, nanosecond)).diagnostic
        .code,
    ).toBe('invalid-message-input');
  });
});

describe('a time zone', () => {
  it('is a frozen value of its own kind', () => {
    const zone = timeZone('Europe/Berlin');

    expect(zone).toEqual({ kind: 'time-zone', id: 'Europe/Berlin' });
    expect(Object.isFrozen(zone)).toBe(true);
  });

  // The pinned release still declares this name as a zone, so the table's answer stands whatever
  // the host calls it. Hosts differ here: some answer with America/New_York.
  it('keeps a name the pinned release declares over the host spelling', () => {
    expect(timeZone('EST5EDT').id).toBe('EST5EDT');
  });

  // A name is one of the pinned table's or it is refused, so a name of any length and in any
  // normalization form gets the one answer.
  it.each([
    ['an empty identity', ''],
    ['an identity of 100,000 code units', 'A'.repeat(100_000)],
    [
      'an identity that is not in normalization form C',
      `Ame${String.fromCodePoint(0x301)}rica/New_York`,
    ],
  ])('refuses %s as a name the table does not carry', (_title, id) => {
    const failure = refusal(() => timeZone(id));

    expect(failure.diagnostic.reason).toBe('malformed-input');
    expect(Object.hasOwn(failure, 'cause')).toBe(false);
  });
});

const DURATION_FIELDS = [
  'years',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
] as const;

describe('a duration', () => {
  it('runs forward unless told otherwise', () => {
    expect(duration({ hours: 1, minutes: 30 })).toEqual({
      kind: 'duration',
      sign: 1,
      years: 0,
      months: 0,
      weeks: 0,
      days: 0,
      hours: 1,
      minutes: 30,
      seconds: decimal('0'),
    });
  });

  it('runs backward when its sign says so', () => {
    expect(duration({ days: 2 }, -1).sign).toBe(-1);
  });

  it('admits an empty duration with a zero sign', () => {
    expect(duration({}, 0).sign).toBe(0);
  });

  it.each([1, -1] as const)(
    'refuses an empty duration with the sign %d',
    (sign) => {
      refusal(() => duration({}, sign));
    },
  );

  it.each(DURATION_FIELDS)('admits %s alone with a direction', (field) => {
    expect(duration({ [field]: 3 })[field]).toBe(3);
  });

  it.each(DURATION_FIELDS)('refuses %s alone with a zero sign', (field) => {
    refusal(() => duration({ [field]: 3 }, 0));
  });

  it('admits seconds alone with a direction', () => {
    expect(duration({ seconds: decimal('0.5') }).seconds.value).toBe('0.5');
  });

  it('refuses seconds alone with a zero sign', () => {
    refusal(() => duration({ seconds: decimal('0.5') }, 0));
  });

  it('refuses a sign that is not a direction', () => {
    refusal(() => duration({ hours: 1 }, 2 as unknown as 1));
  });

  it.each([
    ['a negative count', -1],
    ['a fractional count', 1.5],
    ['a count that is not a number', Number.NaN],
    ['an unbounded count', Number.POSITIVE_INFINITY],
  ])('refuses %s in a field', (_, count) => {
    refusal(() => duration({ hours: count }));
  });

  it('refuses negative seconds, because the direction is the sign', () => {
    refusal(() => duration({ seconds: decimal('-1') }));
    refusal(() => duration({ seconds: decimal('-1') }, -1));
  });
});

describe('money', () => {
  it('keeps the amount and the currency together', () => {
    const amount = decimal('12.50');

    expect(money(amount, 'USD')).toEqual({
      kind: 'money',
      amount,
      currency: 'USD',
    });
  });

  it.each(['', 'usd', 'US', 'USDA', 'AUSD', 'U$D', '840'])(
    'refuses the currency code "%s"',
    (currency) => {
      expect(refusal(() => money(decimal('1'), currency)).diagnostic.code).toBe(
        'invalid-message-input',
      );
    },
  );
});

describe('a measurement', () => {
  it.each(['kilometer', 'kilometer-per-hour', 'a'.repeat(64)])(
    'keeps the amount and the unit %s together',
    (unit) => {
      const amount = decimal('3');

      expect(measurement(amount, unit)).toEqual({
        kind: 'measurement',
        amount,
        unit,
      });
    },
  );

  it.each([
    ['empty', ''],
    ['capitalized', 'Kilometer'],
    ['capital first', 'Xmeter'],
    ['capital last', 'meterX'],
    ['spaced', 'square meter'],
    ['65 long', 'a'.repeat(65)],
  ])('refuses a unit that is %s', (_, unit) => {
    expect(refusal(() => measurement(decimal('1'), unit)).diagnostic.code).toBe(
      'invalid-message-input',
    );
  });
});

describe('a proportion', () => {
  it('is a percent on the fractional scale unless told otherwise', () => {
    const amount = decimal('0.5');

    expect(percent(amount)).toEqual({
      kind: 'percent',
      amount,
      scale: 'fractional',
    });
    expect(percent(amount, 'percent-unit').scale).toBe('percent-unit');
  });

  it('is percentage points when it is a difference', () => {
    const amount = decimal('2');

    expect(percentagePoints(amount)).toEqual({
      kind: 'percentage-points',
      amount,
    });
  });
});
