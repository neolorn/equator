import { describe, expect, it } from 'vitest';

import { decimal, duration } from '../src/formatting.js';
import {
  formatLocalizedInput,
  parseLocalizedInput,
} from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
  type LocalizedInputStatus,
  type LocalizedInputValue,
} from '@neolorn/equator/core';

/**
 * A duration field is the sequence a person types: units to read, with literal text between them.
 * Each unit states how wide it may be and what range it holds, the sign is a policy of the field,
 * and the direction of the duration is kept apart from its amounts, so there is no negative zero
 * to read and none to write.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const FR: FormattingContext = Object.freeze({ locale: 'fr-FR' });
const ARABIC_DIGITS: FormattingContext = Object.freeze({
  locale: 'ar-EG',
  numberingSystem: 'arab',
});

const TWO_DIGIT_MINUTES = Object.freeze({
  field: 'minutes',
  minimumIntegerDigits: 2,
  maximumIntegerDigits: 2,
} as const);
const CLOCK = Object.freeze({
  kind: 'duration',
  pattern: [{ field: 'hours' }, ':', TWO_DIGIT_MINUTES],
} as const);
const ISO_HOURS = Object.freeze({
  kind: 'duration',
  pattern: ['PT', { field: 'hours' }, 'H'],
} as const);
const SECONDS = Object.freeze({
  kind: 'duration',
  pattern: [{ field: 'seconds', maximumFractionDigits: 3 }, ' s'],
} as const);
const EVERY_UNIT = Object.freeze({
  kind: 'duration',
  pattern: [
    { field: 'years' },
    'y ',
    { field: 'months' },
    'mo ',
    { field: 'weeks' },
    'w ',
    { field: 'days' },
    'd ',
    { field: 'hours' },
    'h ',
    { field: 'minutes' },
    'min ',
    { field: 'seconds', maximumFractionDigits: 1 },
    's',
  ],
} as const);

function read(
  text: string,
  profile: object = CLOCK,
  context: FormattingContext = EN,
): {
  readonly status: LocalizedInputStatus;
  readonly value?: unknown;
  readonly diagnostic?: unknown;
} {
  return parseLocalizedInput(text, profile as LocalizedInputProfile, context);
}

function write(
  value: unknown,
  profile: object = CLOCK,
  context: FormattingContext = EN,
): ReturnType<typeof formatLocalizedInput> {
  return formatLocalizedInput(
    value as LocalizedInputValue<LocalizedInputProfile>,
    profile as LocalizedInputProfile,
    context,
  );
}

function written(
  value: unknown,
  profile: object = CLOCK,
  context: FormattingContext = EN,
): string | undefined {
  const result = write(value, profile, context);
  return result.ok ? result.value.text : undefined;
}

function field(change: object): object {
  return { kind: 'duration', pattern: [{ field: 'hours', ...change }] };
}

function secondsField(change: object): object {
  return { kind: 'duration', pattern: [{ field: 'seconds', ...change }] };
}

const REFUSED_WRITE = {
  ok: false,
  diagnostic: { code: 'invalid-localized-input' },
};

describe('a duration read from its declared pattern', () => {
  it('reads each unit into its own field', () => {
    expect(read('1:30')).toStrictEqual({
      status: 'valid',
      text: '1:30',
      value: duration({ hours: 1, minutes: 30 }),
    });
  });

  it('reads every unit a pattern can hold', () => {
    expect(read('1y 2mo 3w 4d 5h 6min 7.5s', EVERY_UNIT)).toMatchObject({
      status: 'valid',
      value: duration({
        years: 1,
        months: 2,
        weeks: 3,
        days: 4,
        hours: 5,
        minutes: 6,
        seconds: decimal('7.5'),
      }),
    });
  });

  it('reads literals before and after a unit', () => {
    expect(read('PT5H', ISO_HOURS)).toMatchObject({
      status: 'valid',
      value: duration({ hours: 5 }),
    });
  });

  it('reads a fraction of a second', () => {
    expect(read('1.25 s', SECONDS)).toMatchObject({
      status: 'valid',
      value: { seconds: { kind: 'decimal', value: '1.25' }, sign: 1 },
    });
  });

  it('reads the decimal mark of the locale', () => {
    expect(read('1,25 s', SECONDS, FR)).toMatchObject({
      status: 'valid',
      value: { seconds: { value: '1.25' } },
    });
    expect(read('1.25 s', SECONDS, FR).status).toBe('invalid');
  });

  it('reads the digits of the numbering system the context names', () => {
    expect(read('١:٣٠', CLOCK, ARABIC_DIGITS)).toMatchObject({
      status: 'valid',
      value: duration({ hours: 1, minutes: 30 }),
    });
  });

  it('reads all zeros as a duration with no direction', () => {
    expect(read('0:00')).toMatchObject({
      status: 'valid',
      value: duration({}, 0),
    });
  });

  it('reads fifteen digits in a unit that declares no width', () => {
    expect(read('999999999999999:00')).toMatchObject({
      status: 'valid',
      value: { hours: 999_999_999_999_999 },
    });
  });

  const REFUSED: readonly (readonly [string, object, LocalizedInputStatus])[] =
    [
      ['', CLOCK, 'incomplete'],
      ['1', CLOCK, 'incomplete'],
      ['1:', CLOCK, 'incomplete'],
      [':30', CLOCK, 'incomplete'],
      ['1:3', CLOCK, 'incomplete'],
      ['1:300', CLOCK, 'policy-rejected'],
      ['1:3x', CLOCK, 'invalid'],
      ['x:30', CLOCK, 'invalid'],
      ['1:30:', CLOCK, 'invalid'],
      ['1.5:30', CLOCK, 'invalid'],
      ['1234567890123456:00', CLOCK, 'policy-rejected'],
      ['P', ISO_HOURS, 'incomplete'],
      ['PT', ISO_HOURS, 'incomplete'],
      ['PT5', ISO_HOURS, 'incomplete'],
      ['XT5H', ISO_HOURS, 'invalid'],
      ['PT5Hx', ISO_HOURS, 'invalid'],
      ['PTH', ISO_HOURS, 'incomplete'],
      ['5H', ISO_HOURS, 'invalid'],
      ['1.25', SECONDS, 'incomplete'],
      ['1. s', SECONDS, 'incomplete'],
      ['.5 s', SECONDS, 'incomplete'],
      ['1.2345 s', SECONDS, 'policy-rejected'],
      ['1.2.3 s', SECONDS, 'invalid'],
      ['1.x s', SECONDS, 'invalid'],
      ['x.5 s', SECONDS, 'invalid'],
    ];

  for (const [text, profile, status] of REFUSED) {
    it(`reports "${text}" as ${status}`, () => {
      expect(read(text, profile).status).toBe(status);
    });
  }

  it('refuses a fraction of a second where the unit declares none', () => {
    expect(read('1.5', secondsField({})).status).toBe('policy-rejected');
    expect(read('1', secondsField({}))).toMatchObject({
      status: 'valid',
      value: { seconds: { value: '1' } },
    });
  });

  it('reads as many fraction digits as the unit declares', () => {
    expect(read('1.234 s', SECONDS)).toMatchObject({
      status: 'valid',
      value: { seconds: { value: '1.234' } },
    });
  });
});

describe('the sign of a duration', () => {
  const policy = (sign: string): object => ({ ...CLOCK, sign });

  const SIGNED: readonly (readonly [
    string,
    string | undefined,
    LocalizedInputStatus,
    (-1 | 0 | 1)?,
  ])[] = [
    ['1:30', undefined, 'valid', 1],
    ['-1:30', undefined, 'policy-rejected'],
    ['+1:30', undefined, 'policy-rejected'],
    ['1:30', 'optional', 'valid', 1],
    ['-1:30', 'optional', 'valid', -1],
    ['+1:30', 'optional', 'valid', 1],
    ['1:30', 'forbidden', 'valid', 1],
    ['-1:30', 'forbidden', 'policy-rejected'],
    ['+1:30', 'forbidden', 'policy-rejected'],
    ['1:30', 'required', 'incomplete'],
    ['+1:30', 'required', 'valid', 1],
    ['-1:30', 'required', 'valid', -1],
    ['+0:00', 'required', 'valid', 0],
    ['-0:00', 'required', 'policy-rejected'],
    ['-0:00', 'optional', 'policy-rejected'],
    ['-', 'optional', 'incomplete'],
    ['+', 'required', 'incomplete'],
  ];

  for (const [text, sign, status, direction] of SIGNED) {
    it(`reads "${text}" as ${status} when the sign is ${sign ?? 'undeclared'}`, () => {
      const result = read(text, sign === undefined ? CLOCK : policy(sign));
      expect(result.status).toBe(status);
      if (direction !== undefined) {
        expect(result.value).toMatchObject({ sign: direction });
      }
    });
  }

  it('counts a non-zero second as an amount', () => {
    expect(read('-0.5 s', { ...SECONDS, sign: 'optional' })).toMatchObject({
      status: 'valid',
      value: { sign: -1, seconds: { value: '0.5' } },
    });
  });
});

describe('a duration unit against its declared range', () => {
  const RANGED = {
    kind: 'duration',
    pattern: [
      { field: 'hours', minimum: decimal('1'), maximum: decimal('12') },
      ':',
      { ...TWO_DIGIT_MINUTES, maximum: decimal('59') },
    ],
  };

  const CASES: readonly (readonly [string, LocalizedInputStatus])[] = [
    ['0:30', 'out-of-range'],
    ['1:30', 'valid'],
    ['12:59', 'valid'],
    ['13:00', 'out-of-range'],
    ['1:60', 'out-of-range'],
  ];

  for (const [text, status] of CASES) {
    it(`reads ${text} as ${status}`, () => {
      expect(read(text, RANGED).status).toBe(status);
    });
  }

  it('compares a fraction of a second', () => {
    const profile = secondsField({
      maximumFractionDigits: 1,
      minimum: decimal('0.5'),
      maximum: decimal('1.5'),
    });
    expect(read('0.4', profile).status).toBe('out-of-range');
    expect(read('0.5', profile).status).toBe('valid');
    expect(read('1.5', profile).status).toBe('valid');
    expect(read('1.6', profile).status).toBe('out-of-range');
  });

  it('does not write an amount outside its range', () => {
    expect(write(duration({ hours: 13 }), RANGED)).toMatchObject(REFUSED_WRITE);
    expect(write(duration({ minutes: 30 }), RANGED)).toMatchObject(
      REFUSED_WRITE,
    );
    expect(written(duration({ hours: 12, minutes: 59 }), RANGED)).toBe('12:59');
    expect(written(duration({ hours: 1 }), RANGED)).toBe('1:00');
  });
});

describe('a duration pattern that does not hold together', () => {
  const pattern = (...tokens: readonly unknown[]): object => ({
    kind: 'duration',
    pattern: tokens,
  });
  const raw = (value: string): object => ({ kind: 'decimal', value });

  const REFUSED: readonly (readonly [string, object, FormattingContext?])[] = [
    ['a pattern that is not a list', { kind: 'duration', pattern: 'hours' }],
    ['an empty pattern', pattern()],
    ['a sign policy outside the three', { ...CLOCK, sign: 'sometimes' }],
    ['an empty literal', pattern({ field: 'hours' }, '')],
    ['a literal of 65 characters', pattern({ field: 'hours' }, 'h'.repeat(65))],
    ['a literal that is not NFC', pattern({ field: 'hours' }, 'é')],
    ['two literals in a row', pattern({ field: 'hours' }, ' ', 'h')],
    ['a literal holding a digit', pattern({ field: 'hours' }, 'h2')],
    ['a literal holding the decimal mark', pattern({ field: 'hours' }, 'h.')],
    ['a literal holding the minus sign', pattern({ field: 'hours' }, 'h-')],
    ['a literal holding the plus sign', pattern({ field: 'hours' }, 'h+')],
    [
      'a literal holding a mark the locale writes beside a sign',
      pattern({ field: 'hours' }, 'h؜'),
      ARABIC_DIGITS,
    ],
    ['a token that is null', pattern({ field: 'hours' }, ':', null)],
    ['a token that is a number', pattern({ field: 'hours' }, ':', 5)],
    ['two units in a row', pattern({ field: 'hours' }, { field: 'minutes' })],
    ['one unit twice', pattern({ field: 'hours' }, ':', { field: 'hours' })],
    ['no unit at all', pattern('h')],
    ['a unit outside the seven', pattern({ field: 'centuries' })],
    ['a unit named in the singular', pattern({ field: 'hour' })],
    ['a unit that is not text', pattern({ field: 7 })],
    ['a unit left out', pattern({})],
    ['a unit named by a list', pattern({ field: ['hours'] })],
    ['a minimum width of zero', field({ minimumIntegerDigits: 0 })],
    [
      'a minimum width of 16',
      field({ minimumIntegerDigits: 16, maximumIntegerDigits: 16 }),
    ],
    ['a minimum width of one and a half', field({ minimumIntegerDigits: 1.5 })],
    ['a maximum width of 16', field({ maximumIntegerDigits: 16 })],
    ['a maximum width of one and a half', field({ maximumIntegerDigits: 1.5 })],
    [
      'a maximum width below the minimum',
      field({ minimumIntegerDigits: 3, maximumIntegerDigits: 2 }),
    ],
    [
      'a fraction on a unit that is not seconds',
      field({ maximumFractionDigits: 1 }),
    ],
    [
      'a fraction of zero digits on a unit that is not seconds',
      field({ maximumFractionDigits: 0 }),
    ],
    [
      'a fraction of minus one digits',
      secondsField({ maximumFractionDigits: -1 }),
    ],
    ['a fraction of ten digits', secondsField({ maximumFractionDigits: 10 })],
    [
      'a fraction of one and a half digits',
      secondsField({ maximumFractionDigits: 1.5 }),
    ],
    ['a minimum that is not canonical', field({ minimum: raw('01') })],
    ['a maximum that is not canonical', field({ maximum: raw('1.0') })],
    ['a minimum that is not a number', field({ minimum: raw('one') })],
    ['a negative minimum', field({ minimum: decimal('-1') })],
    ['a negative maximum', field({ maximum: decimal('-1') })],
    [
      'a fractional minimum on a whole unit',
      field({ minimum: decimal('0.5') }),
    ],
    [
      'a fractional maximum on a whole unit',
      field({ maximum: decimal('1.5') }),
    ],
    [
      'a minimum above its maximum',
      field({ minimum: decimal('5'), maximum: decimal('4') }),
    ],
  ];

  for (const [title, profile, context] of REFUSED) {
    it(`refuses ${title}`, () => {
      expect(read('1', profile, context ?? EN).status).toBe('policy-rejected');
      // The profile is judged before the text, so an empty field fares no better.
      expect(read('', profile, context ?? EN).status).toBe('policy-rejected');
    });

    it(`does not write under ${title}`, () => {
      expect(
        write(duration({ hours: 1 }), profile, context ?? EN),
      ).toMatchObject(REFUSED_WRITE);
    });
  }

  const ACCEPTED: readonly (readonly [string, object, string])[] = [
    [
      'a width of exactly 15',
      field({ minimumIntegerDigits: 15 }),
      '000000000000001',
    ],
    [
      'a minimum width equal to the maximum',
      field({ minimumIntegerDigits: 2, maximumIntegerDigits: 2 }),
      '01',
    ],
    [
      'a fraction of nine digits',
      secondsField({ maximumFractionDigits: 9 }),
      '1.000000001',
    ],
    [
      'a fraction of zero digits on seconds',
      secondsField({ maximumFractionDigits: 0 }),
      '1',
    ],
    [
      'a fractional range on seconds',
      secondsField({
        maximumFractionDigits: 1,
        minimum: decimal('0.5'),
        maximum: decimal('1.5'),
      }),
      '1',
    ],
    [
      'a minimum equal to its maximum',
      field({ minimum: decimal('1'), maximum: decimal('1') }),
      '1',
    ],
    ['a minimum of zero', field({ minimum: decimal('0') }), '1'],
    [
      'a literal of 64 characters',
      pattern({ field: 'hours' }, 'h'.repeat(64)),
      `1${'h'.repeat(64)}`,
    ],
    [
      'a pattern that opens with a literal',
      pattern('h', { field: 'hours' }),
      'h1',
    ],
  ];

  for (const [title, profile, text] of ACCEPTED) {
    it(`accepts ${title}`, () => {
      expect(read(text, profile).status).toBe('valid');
    });
  }
});

describe('the length of duration text', () => {
  const filler = 'a'.repeat(64);
  const long = (lastLiteral: number): object => ({
    kind: 'duration',
    pattern: [
      { field: 'days' },
      filler,
      { field: 'hours' },
      filler,
      { field: 'minutes' },
      filler,
      { field: 'seconds' },
      'b'.repeat(lastLiteral),
    ],
  });
  // Four single digits and three literals of 64 characters: 196 before the last literal.
  const text = (length: number): string =>
    `1${filler}2${filler}3${filler}4${'b'.repeat(length - 196)}`;
  const value = duration({
    days: 1,
    hours: 2,
    minutes: 3,
    seconds: decimal('4'),
  });

  it('reads 256 characters when no limit is declared', () => {
    expect(text(256)).toHaveLength(256);
    expect(read(text(256), long(60))).toMatchObject({ status: 'valid', value });
  });

  it('refuses 257 characters when no limit is declared', () => {
    expect(read(text(257), long(61)).status).toBe('policy-rejected');
  });

  it('reads 257 characters under a larger declared limit', () => {
    expect(
      read(text(257), { ...long(61), maximumCharacters: 257 }),
    ).toMatchObject({ status: 'valid', value });
  });

  it('writes 256 characters when no limit is declared', () => {
    expect(written(value, long(60))).toBe(text(256));
  });

  it('does not write 257 characters when no limit is declared', () => {
    expect(write(value, long(61))).toMatchObject(REFUSED_WRITE);
  });

  it('writes 257 characters under a larger declared limit', () => {
    expect(written(value, { ...long(61), maximumCharacters: 300 })).toBe(
      text(257),
    );
  });
});

describe('a duration written in the spelling its profile reads', () => {
  const WRITTEN: readonly (readonly [string, unknown, object, string])[] = [
    ['hours and minutes', duration({ hours: 1, minutes: 30 }), CLOCK, '1:30'],
    [
      'a unit padded to its width',
      duration({ hours: 1, minutes: 5 }),
      CLOCK,
      '1:05',
    ],
    ['a unit left at zero', duration({ hours: 2 }), CLOCK, '2:00'],
    [
      'a backward duration',
      duration({ hours: 1, minutes: 30 }, -1),
      { ...CLOCK, sign: 'optional' },
      '-1:30',
    ],
    ['no time at all', duration({}, 0), CLOCK, '0:00'],
    [
      'a required plus sign',
      duration({ hours: 1, minutes: 30 }),
      { ...CLOCK, sign: 'required' },
      '+1:30',
    ],
    [
      'a required sign on a backward duration',
      duration({ hours: 1 }, -1),
      { ...CLOCK, sign: 'required' },
      '-1:00',
    ],
    [
      'a required sign on no time at all',
      duration({}, 0),
      { ...CLOCK, sign: 'required' },
      '+0:00',
    ],
    [
      'no sign where one is forbidden',
      duration({ hours: 1 }),
      { ...CLOCK, sign: 'forbidden' },
      '1:00',
    ],
    [
      'no time at all where a sign is forbidden',
      duration({}, 0),
      { ...CLOCK, sign: 'forbidden' },
      '0:00',
    ],
    ['its literals', duration({ hours: 5 }), ISO_HOURS, 'PT5H'],
    [
      'a fraction of a second',
      duration({ seconds: decimal('1.25') }),
      SECONDS,
      '1.25 s',
    ],
    ['whole seconds', duration({ seconds: decimal('7') }), SECONDS, '7 s'],
    [
      'every unit',
      duration({
        years: 1,
        months: 2,
        weeks: 3,
        days: 4,
        hours: 5,
        minutes: 6,
        seconds: decimal('7.5'),
      }),
      EVERY_UNIT,
      '1y 2mo 3w 4d 5h 6min 7.5s',
    ],
  ];

  for (const [title, value, profile, text] of WRITTEN) {
    it(`writes ${title}`, () => {
      expect(written(value, profile)).toBe(text);
      // What was written is read back to the value it came from.
      expect(read(text, profile)).toMatchObject({ status: 'valid', value });
    });
  }

  it('writes the digits of the numbering system the context names', () => {
    expect(
      written(duration({ hours: 1, minutes: 30 }), CLOCK, ARABIC_DIGITS),
    ).toBe('١:٣٠');
  });

  it('writes the decimal mark of the locale', () => {
    expect(written(duration({ seconds: decimal('1.25') }), SECONDS, FR)).toBe(
      '1,25 s',
    );
  });

  it('describes what it wrote', () => {
    const value = duration({ hours: 1, minutes: 30 });
    expect(write(value)).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'duration',
        text: '1:30',
        parts: [{ kind: 'literal', value: '1:30' }],
        locale: 'en-US',
        language: 'en-US',
        direction: 'ltr',
        source: value,
      },
    });
  });

  const UNWRITABLE: readonly (readonly [string, unknown, object])[] = [
    [
      'an amount in a unit the pattern leaves out',
      duration({ days: 1, hours: 1 }),
      CLOCK,
    ],
    [
      'seconds the pattern leaves out',
      duration({ hours: 1, seconds: decimal('0.5') }),
      CLOCK,
    ],
    [
      'a backward duration where a sign is forbidden',
      duration({ hours: 1 }, -1),
      { ...CLOCK, sign: 'forbidden' },
    ],
    [
      'a backward duration where no sign is declared',
      duration({ hours: 1 }, -1),
      CLOCK,
    ],
    [
      'an amount wider than its unit',
      duration({ hours: 1, minutes: 100 }),
      CLOCK,
    ],
    [
      'more fraction digits than the unit declares',
      duration({ seconds: decimal('1.2345') }),
      SECONDS,
    ],
    [
      'a fraction where the unit declares none',
      duration({ seconds: decimal('1.5') }),
      secondsField({}),
    ],
    [
      'seconds that are not in canonical form',
      {
        ...duration({ seconds: decimal('1.5') }),
        seconds: { kind: 'decimal', value: '1.50' },
      },
      SECONDS,
    ],
    ['a direction on no time at all', { ...duration({}, 0), sign: 1 }, CLOCK],
    [
      'no direction on some time',
      { ...duration({ hours: 1 }), sign: 0 },
      CLOCK,
    ],
    [
      'half an hour in the hours unit',
      { ...duration({ hours: 1 }), hours: 1.5 },
      CLOCK,
    ],
    [
      'an amount that is not a number',
      { ...duration({ hours: 1 }), hours: Number.NaN },
      CLOCK,
    ],
    ['a value of another kind', { kind: 'decimal', value: '5' }, CLOCK],
  ];

  for (const [title, value, profile] of UNWRITABLE) {
    it(`does not write ${title}`, () => {
      expect(write(value, profile)).toMatchObject(REFUSED_WRITE);
    });
  }
});

describe('a duration unit that is unfinished', () => {
  it('is incomplete while what is typed so far is digits', () => {
    expect(read('.5 s', SECONDS).status).toBe('incomplete');
    expect(read('5. s', SECONDS).status).toBe('incomplete');
    expect(read('. s', SECONDS).status).toBe('incomplete');
  });

  it('is invalid once what is typed is not digits, which more typing does not mend', () => {
    expect(read('.x s', SECONDS).status).toBe('invalid');
    expect(read('x. s', SECONDS).status).toBe('invalid');
  });
});
