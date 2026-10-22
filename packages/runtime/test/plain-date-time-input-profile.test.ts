import { describe, expect, it } from 'vitest';

import { plainDate, plainDateTime, plainTime } from '../src/formatting.js';
import {
  formatLocalizedInput,
  parseLocalizedInput,
} from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
  type LocalizedInputStatus,
  type LocalizedInputValue,
  type PlainDateTimeValue,
} from '@neolorn/equator/core';

/**
 * A field holding a date and a time is two stated patterns and what joins them. The text is cut at
 * the first joiner, each half is read by its own pattern, and a refusal from either half is the
 * refusal of the whole. The range is a range of moments, so the time only decides between two
 * readings of the same day.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

type DateTimeProfile = Extract<
  LocalizedInputProfile,
  { kind: 'plain-date-time' }
>;

const DATE = Object.freeze({
  order: 'year-month-day',
  separator: '-',
} as const);
const TIME = Object.freeze({
  hourCycle: 'h23',
  precision: 'minute',
  separator: ':',
} as const);
const STAMP: DateTimeProfile = Object.freeze({
  kind: 'plain-date-time',
  date: DATE,
  time: TIME,
  separator: ' ',
});

function read(
  text: string,
  profile: object = STAMP,
): { readonly status: LocalizedInputStatus; readonly value?: unknown } {
  return parseLocalizedInput(text, profile as LocalizedInputProfile, EN);
}

function write(
  value: unknown,
  profile: object = STAMP,
): ReturnType<typeof formatLocalizedInput> {
  return formatLocalizedInput(
    value as LocalizedInputValue<LocalizedInputProfile>,
    profile as LocalizedInputProfile,
    EN,
  );
}

function moment(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): PlainDateTimeValue {
  return plainDateTime(
    plainDate(year, month, day),
    plainTime(hour, minute, second),
  );
}

const REFUSED_WRITE = {
  ok: false,
  diagnostic: { code: 'invalid-localized-input' },
};

describe('a date and a time read from one field', () => {
  it('reads each half by its own pattern', () => {
    expect(read('2024-01-02 13:45')).toMatchObject({
      status: 'valid',
      value: {
        kind: 'plain-date-time',
        date: { kind: 'plain-date', year: 2024, month: 1, day: 2 },
        time: { kind: 'plain-time', hour: 13, minute: 45, second: 0 },
      },
    });
  });

  it('reads a joiner of several characters', () => {
    expect(
      read('2024-01-02 at 13:45', { ...STAMP, separator: ' at ' }),
    ).toMatchObject({
      status: 'valid',
      value: { date: { day: 2 }, time: { hour: 13 } },
    });
  });

  it('cuts at the first joiner, leaving later ones to the time', () => {
    const profile = {
      ...STAMP,
      time: {
        hourCycle: 'h12',
        precision: 'minute',
        separator: ':',
        dayPeriod: { am: 'AM', pm: 'PM', position: 'suffix', separator: ' ' },
      },
    };
    expect(read('2024-01-02 1:05 PM', profile)).toMatchObject({
      status: 'valid',
      value: { time: { hour: 13, minute: 5 } },
    });
  });

  it('reads the calendar the date pattern names', () => {
    expect(
      read('2024-01-02 13:45', {
        ...STAMP,
        date: { ...DATE, calendar: 'gregory' },
      }),
    ).toMatchObject({
      status: 'valid',
      value: { date: { calendar: 'gregory' } },
    });
  });

  const REFUSED: readonly (readonly [string, LocalizedInputStatus])[] = [
    ['', 'incomplete'],
    ['2024-01-02', 'incomplete'],
    ['2024-01-02 ', 'incomplete'],
    [' 13:45', 'incomplete'],
    ['2 13:45', 'incomplete'],
    ['2024-01 13:45', 'incomplete'],
    ['2024-01-02 13', 'incomplete'],
    ['2024-0x-02 13:45', 'invalid'],
    ['2024-01-02 1x:45', 'invalid'],
    ['2024-13-01 13:45', 'out-of-range'],
    ['2024-01-02 25:00', 'out-of-range'],
    ['2024-01-02 13:45 ', 'invalid'],
  ];

  for (const [text, status] of REFUSED) {
    it(`reports "${text}" as ${status}`, () => {
      expect(read(text).status).toBe(status);
    });
  }

  it('reports a joiner with nothing after it as incomplete', () => {
    expect(read('2024-01-02 at ', { ...STAMP, separator: ' at ' }).status).toBe(
      'incomplete',
    );
    expect(
      read('2024-01-02 at 1', { ...STAMP, separator: ' at ' }).status,
    ).toBe('incomplete');
  });

  it('reports an unreadable calendar from the date half', () => {
    expect(
      read('2024-01-02 13:45', {
        ...STAMP,
        date: { ...DATE, calendar: 'hebrew' },
      }).status,
    ).toBe('unsupported-capability');
  });
});

describe('a date-time pattern that does not hold together', () => {
  // Bounds written by hand, because the constructors would refuse to build them.
  const noDate = {
    kind: 'plain-date-time',
    date: {
      kind: 'plain-date',
      year: 2023,
      month: 2,
      day: 30,
      calendar: 'iso8601',
    },
    time: plainTime(12, 0),
  };
  const noTime = {
    kind: 'plain-date-time',
    date: plainDate(2024, 1, 1),
    time: { kind: 'plain-time', hour: 24, minute: 0, second: 0, nanosecond: 0 },
  };
  const otherCalendar = plainDateTime(
    plainDate(2024, 1, 1, 'gregory'),
    plainTime(12, 0),
  );

  const REFUSED: readonly (readonly [string, object])[] = [
    [
      'a date pattern with an unknown order',
      { ...STAMP, date: { ...DATE, order: 'day-year-month' } },
    ],
    [
      'a time pattern with an unknown clock',
      { ...STAMP, time: { ...TIME, hourCycle: 'h25' } },
    ],
    ['an empty joiner', { ...STAMP, separator: '' }],
    ['a joiner holding a digit', { ...STAMP, separator: '1' }],
    ['a joiner equal to the date separator', { ...STAMP, separator: '-' }],
    ['a minimum whose date does not exist', { ...STAMP, minimum: noDate }],
    ['a minimum whose time does not exist', { ...STAMP, minimum: noTime }],
    ['a maximum whose date does not exist', { ...STAMP, maximum: noDate }],
    ['a maximum whose time does not exist', { ...STAMP, maximum: noTime }],
    ['a minimum in another calendar', { ...STAMP, minimum: otherCalendar }],
    ['a maximum in another calendar', { ...STAMP, maximum: otherCalendar }],
    [
      'a minimum on a later day than its maximum',
      {
        ...STAMP,
        minimum: moment(2024, 1, 3, 9, 0),
        maximum: moment(2024, 1, 2, 17, 0),
      },
    ],
    [
      'a minimum later the same day than its maximum',
      {
        ...STAMP,
        minimum: moment(2024, 1, 2, 17, 0),
        maximum: moment(2024, 1, 2, 9, 0),
      },
    ],
  ];

  for (const [title, profile] of REFUSED) {
    it(`refuses ${title}`, () => {
      expect(read('2024-01-02 13:45', profile).status).toBe('policy-rejected');
      // The profile is judged before the text, so text with no joiner in it fares no better.
      expect(read('x', profile).status).toBe('policy-rejected');
    });

    it(`does not write under ${title}`, () => {
      expect(write(moment(2024, 1, 2, 13, 45), profile)).toMatchObject(
        REFUSED_WRITE,
      );
    });
  }

  it('accepts a minimum equal to its maximum', () => {
    const only = moment(2024, 1, 2, 13, 45);
    expect(
      read('2024-01-02 13:45', { ...STAMP, minimum: only, maximum: only })
        .status,
    ).toBe('valid');
  });

  it('accepts a minimum on an earlier day at a later hour than its maximum', () => {
    expect(
      read('2024-01-02 13:45', {
        ...STAMP,
        minimum: moment(2024, 1, 1, 23, 0),
        maximum: moment(2024, 1, 3, 1, 0),
      }).status,
    ).toBe('valid');
  });
});

describe('a date-time against its declared range', () => {
  const minimum = moment(2024, 1, 2, 9, 0);
  const maximum = moment(2024, 1, 3, 17, 0);

  const RANGED: readonly (readonly [string, LocalizedInputStatus])[] = [
    ['2024-01-01 12:00', 'out-of-range'],
    ['2024-01-02 08:59', 'out-of-range'],
    ['2024-01-02 09:00', 'valid'],
    ['2024-01-02 23:59', 'valid'],
    ['2024-01-03 08:00', 'valid'],
    ['2024-01-03 17:00', 'valid'],
    ['2024-01-03 17:01', 'out-of-range'],
    ['2024-01-04 00:00', 'out-of-range'],
  ];

  for (const [text, status] of RANGED) {
    it(`reads ${text} as ${status}`, () => {
      expect(read(text, { ...STAMP, minimum, maximum }).status).toBe(status);
    });
  }

  it('applies a minimum declared alone', () => {
    expect(read('2024-01-02 08:59', { ...STAMP, minimum }).status).toBe(
      'out-of-range',
    );
    expect(read('2030-01-01 00:00', { ...STAMP, minimum }).status).toBe(
      'valid',
    );
  });

  it('applies a maximum declared alone', () => {
    expect(read('2024-01-03 17:01', { ...STAMP, maximum }).status).toBe(
      'out-of-range',
    );
    expect(read('1999-01-01 23:59', { ...STAMP, maximum }).status).toBe(
      'valid',
    );
  });

  it('does not write a moment outside the range', () => {
    expect(
      write(moment(2024, 1, 2, 8, 59), { ...STAMP, minimum }),
    ).toMatchObject(REFUSED_WRITE);
  });
});

describe('the length of date-time text', () => {
  const dash = '-'.repeat(16);
  const colon = ':'.repeat(16);
  const joiner = '_'.repeat(16);
  const long = (markerLength: number): object => ({
    kind: 'plain-date-time',
    date: { order: 'year-month-day', separator: dash },
    time: {
      hourCycle: 'h12',
      precision: 'second',
      separator: colon,
      dayPeriod: {
        am: 'a'.repeat(markerLength),
        pm: 'p'.repeat(markerLength),
        position: 'suffix',
        separator: '~'.repeat(8),
      },
    },
    separator: joiner,
  });
  // The date is padded with leading zeros to 64 characters, the joiner takes 16, the time 38 and
  // the marker separator 8: 126 before the marker.
  const text = (length: number): string =>
    `2024${dash}01${dash}${'2'.padStart(26, '0')}${joiner}01${colon}05${colon}09${'~'.repeat(8)}${'p'.repeat(length - 126)}`;
  const value = moment(2024, 1, 2, 13, 5, 9);

  it('reads 128 characters when no limit is declared', () => {
    expect(text(128)).toHaveLength(128);
    expect(read(text(128), long(2))).toMatchObject({ status: 'valid', value });
  });

  it('refuses 129 characters when no limit is declared', () => {
    expect(read(text(129), long(3)).status).toBe('policy-rejected');
  });

  it('reads 129 characters under a larger declared limit', () => {
    expect(
      read(text(129), { ...long(3), maximumCharacters: 129 }),
    ).toMatchObject({ status: 'valid', value });
  });

  // The limit is the field's. A half is a part of the text the field already measured, so it is as
  // long as the field's limit leaves room for.
  const roomy = { ...long(32), maximumCharacters: 200 };

  it('reads a time half longer than a time field would read alone', () => {
    const half = `01${colon}05${colon}09${'~'.repeat(8)}${'p'.repeat(32)}`;
    expect(half.length).toBeGreaterThan(64);
    expect(read(`2024${dash}01${dash}02${joiner}${half}`, roomy)).toMatchObject(
      {
        status: 'valid',
        value,
      },
    );
  });

  it('reads a date half longer than a date field would read alone', () => {
    const half = `2024${dash}01${dash}${'2'.padStart(27, '0')}`;
    expect(half).toHaveLength(65);
    expect(
      read(`${half}${joiner}01${colon}05${colon}09${'~'.repeat(8)}pp`, {
        ...long(2),
        maximumCharacters: 200,
      }),
    ).toMatchObject({ status: 'valid', value });
  });

  it('writes a moment whose time half is longer than a time field would write alone', () => {
    const written = write(value, roomy);
    expect(written).toMatchObject({ ok: true });
    expect(
      read((written as { value: { text: string } }).value.text, roomy),
    ).toMatchObject({ status: 'valid', value });
  });

  it('reports a long half that is not a time as what it is, and not as over a limit', () => {
    expect(
      read(`2024${dash}01${dash}02${joiner}${'x'.repeat(70)}`, long(2)).status,
    ).toBe('incomplete');
  });

  it('takes no limit from a half', () => {
    const limited = long(2) as { date: object; time: object };
    for (const limit of [3, -1, 'none']) {
      const profile = {
        ...limited,
        date: { ...limited.date, maximumCharacters: limit },
        time: { ...limited.time, maximumCharacters: limit },
      };
      expect(read(text(128), profile)).toMatchObject({
        status: 'valid',
        value,
      });
      expect(write(value, profile)).toMatchObject({ ok: true });
    }
  });
});

describe('a date-time written in the spelling its profile reads', () => {
  it('writes the date, the joiner and the time', () => {
    const value = moment(2024, 1, 2, 13, 45);
    expect(write(value)).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'plain-date-time',
        text: '2024-01-02 13:45',
        parts: [{ kind: 'literal', value: '2024-01-02 13:45' }],
        locale: 'en-US',
        language: 'en-US',
        direction: 'ltr',
        source: value,
      },
    });
  });

  it('writes a Gregorian moment under a Gregorian date pattern', () => {
    const value = plainDateTime(
      plainDate(2024, 1, 2, 'gregory'),
      plainTime(13, 45),
    );
    expect(
      write(value, { ...STAMP, date: { ...DATE, calendar: 'gregory' } }),
    ).toMatchObject({ ok: true, value: { text: '2024-01-02 13:45' } });
  });

  it('does not write a moment in a calendar the pattern does not name', () => {
    const value = plainDateTime(
      plainDate(2024, 1, 2, 'gregory'),
      plainTime(13, 45),
    );
    expect(write(value)).toMatchObject(REFUSED_WRITE);
    expect(
      write(moment(2024, 1, 2, 13, 45), {
        ...STAMP,
        date: { ...DATE, calendar: 'gregory' },
      }),
    ).toMatchObject(REFUSED_WRITE);
  });

  it('does not write seconds the time pattern has no field for', () => {
    expect(write(moment(2024, 1, 2, 13, 45, 9))).toMatchObject(REFUSED_WRITE);
  });

  it('does not write a moment whose fields the text would change', () => {
    const value = {
      kind: 'plain-date-time',
      date: plainDate(2024, 1, 2),
      time: {
        kind: 'plain-time',
        hour: 13,
        minute: 5.5,
        second: 0,
        nanosecond: 0,
      },
    };
    expect(write(value)).toMatchObject(REFUSED_WRITE);
  });

  for (const other of [
    plainDate(2024, 1, 2),
    plainTime(13, 45),
    { kind: 'decimal', value: '5' },
  ]) {
    it(`does not write a ${other.kind} value as a date-time`, () => {
      expect(write(other)).toMatchObject(REFUSED_WRITE);
    });
  }
});
