import { describe, expect, it } from 'vitest';

import { plainTime } from '../src/formatting.js';
import {
  formatLocalizedInput,
  parseLocalizedInput,
} from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
  type LocalizedInputStatus,
  type LocalizedInputValue,
  type PlainTimeValue,
} from '@neolorn/equator/core';

/**
 * A time field is read against a stated clock: which hour cycle, how far the fields go, what
 * separates them, and how the two halves of a twelve-hour day are written. The same profile writes
 * a time back in the spelling it reads, and refuses a time it has no way to spell.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const ARABIC_DIGITS: FormattingContext = Object.freeze({
  locale: 'ar-EG',
  numberingSystem: 'arab',
});

type TimeProfile = Extract<LocalizedInputProfile, { kind: 'plain-time' }>;

const MINUTES: TimeProfile = Object.freeze({
  kind: 'plain-time',
  hourCycle: 'h23',
  precision: 'minute',
  separator: ':',
});
const SECONDS: TimeProfile = Object.freeze({ ...MINUTES, precision: 'second' });
const MILLISECONDS: TimeProfile = Object.freeze({
  ...MINUTES,
  precision: 'fraction',
  fractionalSecondDigits: 3,
});
const MERIDIEM = Object.freeze({
  am: 'AM',
  pm: 'PM',
  position: 'suffix',
  separator: ' ',
} as const);
const TWELVE: TimeProfile = Object.freeze({
  ...MINUTES,
  hourCycle: 'h12',
  dayPeriod: MERIDIEM,
});
const ELEVEN: TimeProfile = Object.freeze({ ...TWELVE, hourCycle: 'h11' });
const TWENTY_FOUR: TimeProfile = Object.freeze({
  ...MINUTES,
  hourCycle: 'h24',
});

function read(
  text: string,
  profile: object = MINUTES,
  context: FormattingContext = EN,
): {
  readonly status: LocalizedInputStatus;
  readonly value?: unknown;
  readonly diagnostic?: unknown;
} {
  return parseLocalizedInput(text, profile as LocalizedInputProfile, context);
}

function write(
  value: PlainTimeValue,
  profile: object = MINUTES,
  context: FormattingContext = EN,
): ReturnType<typeof formatLocalizedInput> {
  return formatLocalizedInput(
    value as LocalizedInputValue<LocalizedInputProfile>,
    profile as LocalizedInputProfile,
    context,
  );
}

function written(
  value: PlainTimeValue,
  profile: object = MINUTES,
  context: FormattingContext = EN,
): string | undefined {
  const result = write(value, profile, context);
  return result.ok ? result.value.text : undefined;
}

type Clock = readonly [number, number, number?, number?];

function expectTime(
  text: string,
  profile: object,
  [hour, minute, second = 0, nanosecond = 0]: Clock,
  context: FormattingContext = EN,
): void {
  expect(read(text, profile, context)).toMatchObject({
    status: 'valid',
    value: { kind: 'plain-time', hour, minute, second, nanosecond },
  });
}

describe('a time read on a 24-hour clock', () => {
  const READ: readonly (readonly [string, object, Clock])[] = [
    ['13:45', MINUTES, [13, 45]],
    ['1:45', MINUTES, [1, 45]],
    ['00:00', MINUTES, [0, 0]],
    ['23:59', MINUTES, [23, 59]],
    ['13:45:09', SECONDS, [13, 45, 9]],
    ['13:45:59', SECONDS, [13, 45, 59]],
    ['13:45:09.123', MILLISECONDS, [13, 45, 9, 123_000_000]],
    ['13:45:09.007', MILLISECONDS, [13, 45, 9, 7_000_000]],
    ['24:00', TWENTY_FOUR, [0, 0]],
    ['23:59', TWENTY_FOUR, [23, 59]],
    ['1:00', TWENTY_FOUR, [1, 0]],
    ['24:00:00', { ...TWENTY_FOUR, precision: 'second' }, [0, 0]],
  ];

  for (const [text, profile, clock] of READ) {
    it(`reads ${text} to the ${(profile as TimeProfile).precision}`, () => {
      expectTime(text, profile, clock);
    });
  }

  it('reads nine fractional digits as nanoseconds', () => {
    expectTime(
      '13:45:09.000000001',
      { ...MILLISECONDS, fractionalSecondDigits: 9 },
      [13, 45, 9, 1],
    );
  });

  it('reads one fractional digit as tenths', () => {
    expectTime(
      '13:45:09.5',
      { ...MILLISECONDS, fractionalSecondDigits: 1 },
      [13, 45, 9, 500_000_000],
    );
  });

  it('reads the digits of the numbering system the context names', () => {
    expectTime('١٣:٤٥', MINUTES, [13, 45], ARABIC_DIGITS);
  });

  it('reads a full stop between hours and minutes', () => {
    // The decimal mark only collides with the separator on a field that reads a fraction.
    expectTime('13.45', { ...MINUTES, separator: '.' }, [13, 45]);
  });

  it('reads a separator of several characters', () => {
    expectTime('13 h 45', { ...MINUTES, separator: ' h ' }, [13, 45]);
  });

  const REFUSED: readonly (readonly [string, object, LocalizedInputStatus])[] =
    [
      ['', MINUTES, 'incomplete'],
      ['13', MINUTES, 'incomplete'],
      ['13:', MINUTES, 'incomplete'],
      [':45', MINUTES, 'incomplete'],
      ['13:4', MINUTES, 'incomplete'],
      ['13:456', MINUTES, 'invalid'],
      ['13::45', MINUTES, 'incomplete'],
      ['123:45', MINUTES, 'invalid'],
      ['13:45:00', MINUTES, 'invalid'],
      ['1x:45', MINUTES, 'invalid'],
      ['13:4x', MINUTES, 'invalid'],
      ['24:00', MINUTES, 'out-of-range'],
      ['13:60', MINUTES, 'out-of-range'],
      ['13:45', SECONDS, 'incomplete'],
      ['13:45:', SECONDS, 'incomplete'],
      ['13:45:9', SECONDS, 'incomplete'],
      ['13:45:099', SECONDS, 'invalid'],
      ['13:45:09:00', SECONDS, 'invalid'],
      ['13:45:0x', SECONDS, 'invalid'],
      ['13:45:60', SECONDS, 'out-of-range'],
      ['13:45:09', MILLISECONDS, 'incomplete'],
      ['13:45:09.', MILLISECONDS, 'incomplete'],
      ['13:45:.123', MILLISECONDS, 'incomplete'],
      ['13:45:09.12', MILLISECONDS, 'incomplete'],
      ['13:45:09.1234', MILLISECONDS, 'invalid'],
      ['13:45:09.1.2', MILLISECONDS, 'invalid'],
      ['13:45:09..1', MILLISECONDS, 'incomplete'],
      ['13:456:09.123', MILLISECONDS, 'invalid'],
      ['13:45:09.12x', MILLISECONDS, 'invalid'],
      ['13:45:9.123', MILLISECONDS, 'incomplete'],
      ['0:30', TWENTY_FOUR, 'out-of-range'],
      ['24:01', TWENTY_FOUR, 'out-of-range'],
      ['25:00', TWENTY_FOUR, 'out-of-range'],
      ['24:00:01', { ...TWENTY_FOUR, precision: 'second' }, 'out-of-range'],
      [
        '24:00:00.001',
        { ...TWENTY_FOUR, precision: 'fraction', fractionalSecondDigits: 3 },
        'out-of-range',
      ],
    ];

  for (const [text, profile, status] of REFUSED) {
    it(`reports "${text}" to the ${(profile as TimeProfile).precision} on ${(profile as TimeProfile).hourCycle} as ${status}`, () => {
      expect(read(text, profile).status).toBe(status);
    });
  }

  it('says a clock field out of range was malformed input', () => {
    expect(read('13:60')).toMatchObject({
      status: 'out-of-range',
      diagnostic: {
        code: 'invalid-localized-input',
        reason: 'malformed-input',
      },
    });
  });
});

describe('a time read on a 12-hour clock', () => {
  const READ: readonly (readonly [string, object, Clock])[] = [
    ['1:05 PM', TWELVE, [13, 5]],
    ['1:05 AM', TWELVE, [1, 5]],
    ['12:00 AM', TWELVE, [0, 0]],
    ['12:00 PM', TWELVE, [12, 0]],
    ['11:59 PM', TWELVE, [23, 59]],
    ['0:30 PM', ELEVEN, [12, 30]],
    ['0:00 AM', ELEVEN, [0, 0]],
    ['11:59 PM', ELEVEN, [23, 59]],
    ['11:59 AM', ELEVEN, [11, 59]],
  ];

  for (const [text, profile, clock] of READ) {
    it(`reads ${text} on ${(profile as TimeProfile).hourCycle}`, () => {
      expectTime(text, profile, clock);
    });
  }

  it('reads a marker written before the time', () => {
    expectTime(
      'PM 1:05',
      { ...TWELVE, dayPeriod: { ...MERIDIEM, position: 'prefix' } },
      [13, 5],
    );
    expectTime(
      'AM 1:05',
      { ...TWELVE, dayPeriod: { ...MERIDIEM, position: 'prefix' } },
      [1, 5],
    );
  });

  it('reads a marker with nothing between it and the time', () => {
    expectTime(
      '1:05PM',
      { ...TWELVE, dayPeriod: { am: 'AM', pm: 'PM', position: 'suffix' } },
      [13, 5],
    );
    expectTime(
      'PM1:05',
      { ...TWELVE, dayPeriod: { am: 'AM', pm: 'PM', position: 'prefix' } },
      [13, 5],
    );
  });

  const REFUSED: readonly (readonly [string, object, LocalizedInputStatus])[] =
    [
      ['1:05', TWELVE, 'incomplete'],
      ['1:05 ', TWELVE, 'incomplete'],
      ['1:05PM', TWELVE, 'incomplete'],
      ['PM 1:05', TWELVE, 'incomplete'],
      ['0:30 AM', TWELVE, 'out-of-range'],
      ['13:00 PM', TWELVE, 'out-of-range'],
      ['12:00 AM', ELEVEN, 'out-of-range'],
      ['12:00 PM', ELEVEN, 'out-of-range'],
      [' PM', TWELVE, 'incomplete'],
    ];

  for (const [text, profile, status] of REFUSED) {
    it(`reports "${text}" on ${(profile as TimeProfile).hourCycle} as ${status}`, () => {
      expect(read(text, profile).status).toBe(status);
    });
  }

  it('reports text ending in both markers as ambiguous', () => {
    // One marker is the tail of the other, so the same text closes with each of them.
    expect(
      read('1:05PM', {
        ...TWELVE,
        dayPeriod: { am: 'M', pm: 'PM', position: 'suffix' },
      }).status,
    ).toBe('ambiguous');
  });

  it('reports text opening with both markers as ambiguous', () => {
    expect(
      read('PM1:05', {
        ...TWELVE,
        dayPeriod: { am: 'P', pm: 'PM', position: 'prefix' },
      }).status,
    ).toBe('ambiguous');
  });
});

describe('a time pattern that does not hold together', () => {
  const REFUSED: readonly (readonly [string, object, string?])[] = [
    ['an unknown hour cycle', { ...MINUTES, hourCycle: 'h25' }],
    ['an empty separator', { ...MINUTES, separator: '' }],
    ['a separator holding a digit', { ...MINUTES, separator: '1' }],
    ['a separator of 17 characters', { ...MINUTES, separator: ':'.repeat(17) }],
    ['an unknown precision', { ...MINUTES, precision: 'hour' }],
    ['no precision', { ...MINUTES, precision: undefined }],
    ['a fraction with no digit count', { ...MINUTES, precision: 'fraction' }],
    [
      'a fraction of zero digits',
      { ...MILLISECONDS, fractionalSecondDigits: 0 },
    ],
    [
      'a fraction of ten digits',
      { ...MILLISECONDS, fractionalSecondDigits: 10 },
    ],
    [
      'a fraction of one and a half digits',
      { ...MILLISECONDS, fractionalSecondDigits: 1.5 },
    ],
    [
      'a digit count without a fraction',
      { ...MINUTES, fractionalSecondDigits: 3 },
    ],
    [
      'a digit count on a seconds field',
      { ...SECONDS, fractionalSecondDigits: 3 },
      '13:45:09',
    ],
    [
      'a fraction split by the decimal mark',
      { ...MILLISECONDS, separator: '.' },
      '13.45.09.123',
    ],
    [
      'a 12-hour clock with no markers',
      { ...MINUTES, hourCycle: 'h12' },
      '1:05',
    ],
    [
      'an 11-hour clock with no markers',
      { ...MINUTES, hourCycle: 'h11' },
      '1:05',
    ],
    ['a 23-hour clock with markers', { ...MINUTES, dayPeriod: MERIDIEM }],
    ['a 24-hour clock with markers', { ...TWENTY_FOUR, dayPeriod: MERIDIEM }],
    ['a morning marker that is not text', dayPeriod({ am: 5 })],
    ['a morning marker that is a list', dayPeriod({ am: ['AM'] })],
    ['an afternoon marker that is a list', dayPeriod({ pm: ['PM'] })],
    ['an afternoon marker that is not text', dayPeriod({ pm: 5 })],
    ['a marker separator that is not text', dayPeriod({ separator: 5 })],
    ['an empty morning marker', dayPeriod({ am: '' })],
    ['an empty afternoon marker', dayPeriod({ pm: '' })],
    ['a morning marker of 33 characters', dayPeriod({ am: 'a'.repeat(33) })],
    ['an afternoon marker of 33 characters', dayPeriod({ pm: 'p'.repeat(33) })],
    ['a morning marker that is not NFC', dayPeriod({ am: 'é' })],
    ['an afternoon marker that is not NFC', dayPeriod({ pm: 'é' })],
    ['one marker for both halves', dayPeriod({ am: 'PM' })],
    ['a marker in an unknown position', dayPeriod({ position: 'middle' })],
    ['a marker with no position', dayPeriod({ position: undefined })],
    [
      'a marker separator of 9 characters',
      dayPeriod({ separator: '_'.repeat(9) }),
    ],
    ['a marker separator that is not NFC', dayPeriod({ separator: 'é' })],
    ['a marker separator holding a digit', dayPeriod({ separator: '1' })],
    ['a minimum that is no time', { ...MINUTES, minimum: rawTime(24, 0) }],
    ['a maximum that is no time', { ...MINUTES, maximum: rawTime(12, 60) }],
    [
      'a minimum after its maximum',
      { ...MINUTES, minimum: plainTime(17, 0), maximum: plainTime(9, 0) },
    ],
  ];

  function dayPeriod(change: object): object {
    return { ...TWELVE, dayPeriod: { ...MERIDIEM, ...change } };
  }

  // A boundary written by hand rather than through `plainTime`, which would refuse to build it.
  function rawTime(hour: number, minute: number): PlainTimeValue {
    return { kind: 'plain-time', hour, minute, second: 0, nanosecond: 0 };
  }

  for (const [title, profile, text] of REFUSED) {
    it(`refuses ${title}`, () => {
      expect(read(text ?? '13:45', profile).status).toBe('policy-rejected');
    });

    it(`does not write under ${title}`, () => {
      expect(write(plainTime(13, 45), profile)).toMatchObject({
        ok: false,
        diagnostic: { code: 'invalid-localized-input' },
      });
    });
  }

  it('accepts markers of 32 characters and a separator of 8', () => {
    const profile = {
      ...TWELVE,
      dayPeriod: {
        am: 'a'.repeat(32),
        pm: 'p'.repeat(32),
        position: 'suffix',
        separator: '_'.repeat(8),
      },
    };
    expectTime(`1:05${'_'.repeat(8)}${'p'.repeat(32)}`, profile, [13, 5]);
  });

  it('accepts a separator of 16 characters', () => {
    const separator = ':'.repeat(16);
    expectTime(`13${separator}45`, { ...MINUTES, separator }, [13, 45]);
  });

  it('accepts a minimum equal to its maximum', () => {
    const noon = plainTime(12, 0);
    expectTime('12:00', { ...MINUTES, minimum: noon, maximum: noon }, [12, 0]);
  });
});

describe('a time against its declared range', () => {
  const minimum = plainTime(9, 0);
  const maximum = plainTime(17, 0);
  const OFFICE = { ...SECONDS, minimum, maximum };

  const RANGED: readonly (readonly [string, LocalizedInputStatus])[] = [
    ['08:59:59', 'out-of-range'],
    ['09:00:00', 'valid'],
    ['12:30:00', 'valid'],
    ['17:00:00', 'valid'],
    ['17:00:01', 'out-of-range'],
  ];

  for (const [text, status] of RANGED) {
    it(`reads ${text} as ${status}`, () => {
      expect(read(text, OFFICE).status).toBe(status);
    });
  }

  it('compares down to the nanosecond', () => {
    const profile = {
      ...MILLISECONDS,
      minimum: plainTime(9, 0, 0, 2_000_000),
      maximum: plainTime(9, 0, 0, 4_000_000),
    };
    expect(read('09:00:00.001', profile).status).toBe('out-of-range');
    expect(read('09:00:00.002', profile).status).toBe('valid');
    expect(read('09:00:00.004', profile).status).toBe('valid');
    expect(read('09:00:00.005', profile).status).toBe('out-of-range');
  });

  it('weighs an hour above any number of minutes', () => {
    const profile = { ...MINUTES, minimum: plainTime(9, 30) };
    expect(read('10:00', profile).status).toBe('valid');
    expect(read('08:59', profile).status).toBe('out-of-range');
  });

  it('weighs a minute above any number of seconds', () => {
    const profile = { ...SECONDS, minimum: plainTime(9, 30, 30) };
    expect(read('09:31:00', profile).status).toBe('valid');
    expect(read('09:29:59', profile).status).toBe('out-of-range');
  });

  it('weighs a second above any number of nanoseconds', () => {
    const profile = {
      ...MILLISECONDS,
      minimum: plainTime(9, 0, 0, 500_000_000),
    };
    expect(read('09:00:01.000', profile).status).toBe('valid');
    expect(read('09:00:00.499', profile).status).toBe('out-of-range');
  });

  it('applies a minimum declared alone', () => {
    expect(read('08:59', { ...MINUTES, minimum }).status).toBe('out-of-range');
    expect(read('23:59', { ...MINUTES, minimum }).status).toBe('valid');
  });

  it('applies a maximum declared alone', () => {
    expect(read('17:01', { ...MINUTES, maximum }).status).toBe('out-of-range');
    expect(read('00:00', { ...MINUTES, maximum }).status).toBe('valid');
  });

  it('does not write a time outside the range', () => {
    expect(write(plainTime(8, 0), { ...MINUTES, minimum })).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-localized-input' },
    });
    expect(written(plainTime(9, 0), { ...MINUTES, minimum })).toBe('09:00');
  });
});

describe('the length of time text', () => {
  const separator = ':'.repeat(16);
  const marker = (length: number): object => ({
    ...TWELVE,
    precision: 'second',
    separator,
    dayPeriod: {
      am: 'a'.repeat(length),
      pm: 'p'.repeat(length),
      position: 'suffix',
      separator: '_'.repeat(8),
    },
  });
  // Two digits, a separator, two digits, a separator, two digits, the marker separator: 46.
  const text = (length: number): string =>
    `01${separator}05${separator}09${'_'.repeat(8)}${'p'.repeat(length - 46)}`;

  it('reads 64 characters when no limit is declared', () => {
    expect(text(64)).toHaveLength(64);
    expectTime(text(64), marker(18), [13, 5, 9]);
  });

  it('refuses 65 characters when no limit is declared', () => {
    expect(read(text(65), marker(19)).status).toBe('policy-rejected');
  });

  it('reads 65 characters under a larger declared limit', () => {
    expectTime(text(65), { ...marker(19), maximumCharacters: 65 }, [13, 5, 9]);
  });

  it('writes 64 characters when no limit is declared', () => {
    expect(written(plainTime(13, 5, 9), marker(18))).toBe(text(64));
  });

  it('does not write 65 characters when no limit is declared', () => {
    expect(write(plainTime(13, 5, 9), marker(19))).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-localized-input' },
    });
  });

  it('writes 65 characters under a larger declared limit', () => {
    expect(
      written(plainTime(13, 5, 9), { ...marker(19), maximumCharacters: 80 }),
    ).toBe(text(65));
  });
});

describe('a time written in the spelling its profile reads', () => {
  const WRITTEN: readonly (readonly [Clock, object, string])[] = [
    [[13, 45], MINUTES, '13:45'],
    [[1, 5], MINUTES, '01:05'],
    [[0, 0], MINUTES, '00:00'],
    [[13, 45, 9], SECONDS, '13:45:09'],
    [[13, 45, 0], SECONDS, '13:45:00'],
    [[13, 45, 9, 123_000_000], MILLISECONDS, '13:45:09.123'],
    [[13, 45, 9, 7_000_000], MILLISECONDS, '13:45:09.007'],
    [[13, 45, 9], MILLISECONDS, '13:45:09.000'],
    [[13, 5], TWELVE, '01:05 PM'],
    [[1, 5], TWELVE, '01:05 AM'],
    [[0, 0], TWELVE, '12:00 AM'],
    [[12, 0], TWELVE, '12:00 PM'],
    [[11, 59], TWELVE, '11:59 AM'],
    [[12, 30], ELEVEN, '00:30 PM'],
    [[0, 0], ELEVEN, '00:00 AM'],
    [[23, 59], ELEVEN, '11:59 PM'],
    [[11, 59], ELEVEN, '11:59 AM'],
    [[0, 0], TWENTY_FOUR, '24:00'],
    [[23, 59], TWENTY_FOUR, '23:59'],
    [[1, 0], TWENTY_FOUR, '01:00'],
    [
      [13, 5],
      { ...TWELVE, dayPeriod: { ...MERIDIEM, position: 'prefix' } },
      'PM 01:05',
    ],
    [
      [13, 5],
      { ...TWELVE, dayPeriod: { am: 'AM', pm: 'PM', position: 'suffix' } },
      '01:05PM',
    ],
    [
      [13, 45, 9, 1],
      { ...MILLISECONDS, fractionalSecondDigits: 9 },
      '13:45:09.000000001',
    ],
  ];

  for (const [[hour, minute, second, nanosecond], profile, text] of WRITTEN) {
    it(`writes ${text} on ${(profile as TimeProfile).hourCycle}`, () => {
      const value = plainTime(hour, minute, second, nanosecond);
      expect(written(value, profile)).toBe(text);
      // What was written is read back to the value it came from.
      expect(read(text, profile)).toMatchObject({ status: 'valid', value });
    });
  }

  it('writes the digits of the numbering system the context names', () => {
    expect(written(plainTime(13, 45), MINUTES, ARABIC_DIGITS)).toBe('١٣:٤٥');
  });

  it('describes what it wrote', () => {
    const value = plainTime(13, 45);
    expect(write(value)).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'plain-time',
        text: '13:45',
        parts: [{ kind: 'literal', value: '13:45' }],
        locale: 'en-US',
        language: 'en-US',
        direction: 'ltr',
        source: value,
      },
    });
  });

  it('names the direction of a right-to-left locale', () => {
    expect(write(plainTime(13, 45), MINUTES, ARABIC_DIGITS)).toMatchObject({
      ok: true,
      value: { locale: 'ar-EG', language: 'ar-EG', direction: 'rtl' },
    });
  });

  const UNWRITABLE: readonly (readonly [string, Clock, object])[] = [
    ['seconds on a minutes field', [13, 45, 9], MINUTES],
    ['nanoseconds on a minutes field', [13, 45, 0, 1], MINUTES],
    ['nanoseconds on a seconds field', [13, 45, 9, 1], SECONDS],
    [
      'a fourth fractional digit on a field of three',
      [13, 45, 9, 123_400_000],
      MILLISECONDS,
    ],
    [
      'a ninth fractional digit on a field of three',
      [13, 45, 9, 1],
      MILLISECONDS,
    ],
    ['half past midnight on a clock that starts at one', [0, 30], TWENTY_FOUR],
  ];

  for (const [
    title,
    [hour, minute, second, nanosecond],
    profile,
  ] of UNWRITABLE) {
    it(`does not write ${title}`, () => {
      expect(
        write(plainTime(hour, minute, second, nanosecond), profile),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: 'invalid-localized-input' },
      });
    });
  }

  it('does not write a time whose fields the text would change', () => {
    // Half a minute has no spelling in a field of whole minutes, and the nearest spelling is
    // another time.
    const value: PlainTimeValue = {
      kind: 'plain-time',
      hour: 13,
      minute: 5.5,
      second: 0,
      nanosecond: 0,
    };
    expect(write(value)).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-localized-input' },
    });
  });

  it('does not write a value of another kind as a time', () => {
    expect(
      formatLocalizedInput(
        { kind: 'time-zone', id: 'Europe/Paris' } as never,
        MINUTES,
        EN,
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-localized-input' },
    });
  });
});
