import { describe, expect, it } from 'vitest';

import { instant } from '../src/formatting.js';
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
 * An instant field takes a machine syntax and nothing a locale would write: a four-digit year, a
 * `T`, seconds, up to nine fractional digits, and `Z` or a numeric offset. The value is the count
 * of nanoseconds since the epoch, kept exact in both directions, and what is written is always in
 * UTC.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const INSTANT: LocalizedInputProfile = Object.freeze({
  kind: 'instant',
  syntax: 'rfc3339',
});

// 2024-01-02T03:04:05Z, in seconds since the epoch.
const SECONDS = 1_704_164_645n;
const nanoseconds = (seconds: bigint, fraction = 0n): string =>
  (seconds * 1_000_000_000n + fraction).toString();

function read(
  text: string,
  profile: object = INSTANT,
): {
  readonly status: LocalizedInputStatus;
  readonly value?: unknown;
  readonly diagnostic?: unknown;
} {
  return parseLocalizedInput(text, profile as LocalizedInputProfile, EN);
}

function write(
  value: unknown,
  profile: object = INSTANT,
  context: FormattingContext = EN,
): ReturnType<typeof formatLocalizedInput> {
  return formatLocalizedInput(
    value as LocalizedInputValue<LocalizedInputProfile>,
    profile as LocalizedInputProfile,
    context,
  );
}

const REFUSED_WRITE = {
  ok: false,
  diagnostic: { code: 'invalid-localized-input' },
};

describe('an instant read from RFC 3339 text', () => {
  const READ: readonly (readonly [string, string])[] = [
    ['2024-01-02T03:04:05Z', nanoseconds(SECONDS)],
    ['2024-01-02T03:04:05.5Z', nanoseconds(SECONDS, 500_000_000n)],
    ['2024-01-02T03:04:05.123456789Z', nanoseconds(SECONDS, 123_456_789n)],
    ['2024-01-02T03:04:05.000000001Z', nanoseconds(SECONDS, 1n)],
    ['2024-01-02T03:04:05+00:00', nanoseconds(SECONDS)],
    ['2024-01-02T05:04:05+02:00', nanoseconds(SECONDS)],
    ['2024-01-01T21:34:05-05:30', nanoseconds(SECONDS)],
    ['2024-01-02T17:04:05+14:00', nanoseconds(SECONDS)],
    ['2024-01-01T13:04:05-14:00', nanoseconds(SECONDS)],
    ['2024-01-02T03:49:05+00:45', nanoseconds(SECONDS)],
    ['2024-01-02T03:04:05.5+00:00', nanoseconds(SECONDS, 500_000_000n)],
    ['1970-01-01T00:00:00Z', '0'],
    ['1969-12-31T23:59:59Z', nanoseconds(-1n)],
    ['1969-12-31T23:59:59.5Z', '-500000000'],
    ['2024-02-29T23:59:59Z', nanoseconds(1_709_251_199n)],
    ['0000-01-01T00:00:00Z', nanoseconds(-62_167_219_200n)],
    [
      '9999-12-31T23:59:59.999999999Z',
      nanoseconds(253_402_300_799n, 999_999_999n),
    ],
  ];

  for (const [text, epochNanoseconds] of READ) {
    it(`reads ${text}`, () => {
      expect(read(text)).toStrictEqual({
        status: 'valid',
        text,
        value: { kind: 'instant', epochNanoseconds },
      });
    });
  }

  const REFUSED: readonly (readonly [string, LocalizedInputStatus])[] = [
    ['', 'incomplete'],
    ['2024-01-02T', 'incomplete'],
    ['2024-01-02T03:', 'incomplete'],
    ['2024-01-02T03:04:05.', 'incomplete'],
    ['2024-01-02T03:04:05+', 'incomplete'],
    ['2024-01-02T03:04:05-', 'incomplete'],
    ['2024-01-', 'incomplete'],
    ['2024-01-02', 'invalid'],
    ['2024-01-02T03:04:05', 'invalid'],
    ['2024-01-02t03:04:05Z', 'invalid'],
    ['2024-01-02T03:04:05z', 'invalid'],
    ['2024-01-02 03:04:05Z', 'invalid'],
    ['2024-01-02T03:04Z', 'invalid'],
    ['24-01-02T03:04:05Z', 'invalid'],
    ['2024-1-02T03:04:05Z', 'invalid'],
    ['2024-01-02T3:04:05Z', 'invalid'],
    ['2024-01-02T03:04:05.1234567890Z', 'invalid'],
    ['2024-01-02T03:04:05+0200', 'invalid'],
    ['2024-01-02T03:04:05+02', 'invalid'],
    ['x2024-01-02T03:04:05Z', 'invalid'],
    ['2024-01-02T03:04:05Zx', 'invalid'],
    ['2024-01-02T03:04:05Z\n', 'invalid'],
    ['2024-01-02T24:00:00Z', 'invalid'],
    ['2024-01-02T03:60:00Z', 'invalid'],
    ['2024-01-02T03:04:60Z', 'invalid'],
    ['2023-02-29T03:04:05Z', 'invalid'],
    ['2024-13-01T03:04:05Z', 'invalid'],
    ['2024-01-00T03:04:05Z', 'invalid'],
    ['2024-01-02T03:04:05-00:00', 'policy-rejected'],
    ['2024-01-02T03:04:05+14:01', 'policy-rejected'],
    ['2024-01-02T03:04:05-14:01', 'policy-rejected'],
    ['2024-01-02T03:04:05+15:00', 'policy-rejected'],
    ['2024-01-02T03:04:05+02:60', 'policy-rejected'],
  ];

  for (const [text, status] of REFUSED) {
    it(`reports ${JSON.stringify(text)} as ${status}`, () => {
      expect(read(text).status).toBe(status);
    });
  }

  const ACCEPTED_CLOCKS = [
    '2024-01-02T23:59:59Z',
    '2024-01-02T03:04:05+13:59',
    '2024-01-02T03:04:05+02:59',
  ];

  for (const text of ACCEPTED_CLOCKS) {
    it(`reads the last valid field in ${text}`, () => {
      expect(read(text).status).toBe('valid');
    });
  }

  it('says a date that does not exist was malformed input', () => {
    expect(read('2023-02-29T03:04:05Z')).toMatchObject({
      status: 'invalid',
      diagnostic: {
        code: 'invalid-localized-input',
        reason: 'malformed-input',
      },
    });
  });
});

describe('the syntax an instant profile names', () => {
  const OTHER: readonly (readonly [string, object])[] = [
    ['a syntax other than RFC 3339', { kind: 'instant', syntax: 'iso-week' }],
    ['no syntax', { kind: 'instant' }],
    ['a syntax in another case', { kind: 'instant', syntax: 'RFC3339' }],
    ['a syntax that is not text', { kind: 'instant', syntax: 3339 }],
  ];

  for (const [title, profile] of OTHER) {
    it(`refuses a profile naming ${title}`, () => {
      expect(read('2024-01-02T03:04:05Z', profile)).toMatchObject({
        status: 'policy-rejected',
        diagnostic: { code: 'invalid-localized-input' },
      });
      // The profile is judged before the text, so an empty field fares no better.
      expect(read('', profile).status).toBe('policy-rejected');
    });

    it(`does not write under a profile naming ${title}`, () => {
      expect(write(instant(nanoseconds(SECONDS)), profile)).toMatchObject(
        REFUSED_WRITE,
      );
    });
  }
});

describe('the length of instant text', () => {
  it('reports 64 unreadable characters as invalid when no limit is declared', () => {
    expect(read('x'.repeat(64)).status).toBe('invalid');
  });

  it('refuses 65 characters when no limit is declared', () => {
    expect(read('x'.repeat(65)).status).toBe('policy-rejected');
  });

  it('reads past 64 characters under a larger declared limit', () => {
    expect(
      read('x'.repeat(65), { ...INSTANT, maximumCharacters: 100 }).status,
    ).toBe('invalid');
  });

  it('reads text exactly as long as the declared limit', () => {
    expect(
      read('2024-01-02T03:04:05Z', { ...INSTANT, maximumCharacters: 20 })
        .status,
    ).toBe('valid');
  });
});

describe('an instant written as RFC 3339 text in UTC', () => {
  const WRITTEN: readonly (readonly [string, string])[] = [
    [nanoseconds(SECONDS), '2024-01-02T03:04:05Z'],
    [nanoseconds(SECONDS, 500_000_000n), '2024-01-02T03:04:05.5Z'],
    [nanoseconds(SECONDS, 120_000_000n), '2024-01-02T03:04:05.12Z'],
    [nanoseconds(SECONDS, 123_456_789n), '2024-01-02T03:04:05.123456789Z'],
    [nanoseconds(SECONDS, 1n), '2024-01-02T03:04:05.000000001Z'],
    [nanoseconds(SECONDS, 100n), '2024-01-02T03:04:05.0000001Z'],
    ['0', '1970-01-01T00:00:00Z'],
    ['-1', '1969-12-31T23:59:59.999999999Z'],
    ['-500000000', '1969-12-31T23:59:59.5Z'],
    [nanoseconds(-1n), '1969-12-31T23:59:59Z'],
    [nanoseconds(1_709_251_199n), '2024-02-29T23:59:59Z'],
    [nanoseconds(-62_167_219_200n), '0000-01-01T00:00:00Z'],
    [nanoseconds(-30_610_224_000n), '1000-01-01T00:00:00Z'],
    [
      nanoseconds(253_402_300_799n, 999_999_999n),
      '9999-12-31T23:59:59.999999999Z',
    ],
  ];

  for (const [epochNanoseconds, text] of WRITTEN) {
    it(`writes ${text}`, () => {
      const value = instant(epochNanoseconds);
      expect(write(value)).toMatchObject({ ok: true, value: { text } });
      // What was written is read back to the value it came from.
      expect(read(text)).toMatchObject({ status: 'valid', value });
    });
  }

  it('describes what it wrote as text in no language', () => {
    const value = instant(nanoseconds(SECONDS));
    expect(write(value, INSTANT, { locale: 'ar-EG' })).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'instant',
        text: '2024-01-02T03:04:05Z',
        parts: [{ kind: 'literal', value: '2024-01-02T03:04:05Z' }],
        locale: 'ar-EG',
        language: 'und',
        direction: 'ltr',
        source: value,
      },
    });
  });

  const UNWRITABLE: readonly (readonly [string, string])[] = [
    ['the first nanosecond of year 10000', nanoseconds(253_402_300_800n)],
    [
      'the last nanosecond before year zero',
      nanoseconds(-62_167_219_200n, -1n),
    ],
    [
      'a moment past the range of the platform date',
      nanoseconds(8_640_000_000_001n),
    ],
    [
      'a moment before the range of the platform date',
      nanoseconds(-8_640_000_000_001n),
    ],
    [
      'a count of milliseconds no number holds exactly',
      nanoseconds(9_007_199_254_740_993n),
    ],
    ['a count of milliseconds past every number', `1${'0'.repeat(400)}`],
  ];

  for (const [title, epochNanoseconds] of UNWRITABLE) {
    it(`does not write ${title}`, () => {
      expect(write(instant(epochNanoseconds))).toMatchObject(REFUSED_WRITE);
    });
  }

  it('does not write a count that is not in canonical form', () => {
    // The text would read back as the canonical count, which is not the value given.
    expect(
      write({ kind: 'instant', epochNanoseconds: `0${nanoseconds(SECONDS)}` }),
    ).toMatchObject(REFUSED_WRITE);
  });

  it('does not write text longer than the declared limit', () => {
    const value = instant(nanoseconds(SECONDS));
    expect(write(value, { ...INSTANT, maximumCharacters: 19 })).toMatchObject(
      REFUSED_WRITE,
    );
    expect(write(value, { ...INSTANT, maximumCharacters: 20 })).toMatchObject({
      ok: true,
    });
  });

  it('does not write a value of another kind as an instant', () => {
    expect(write({ kind: 'decimal', value: '5' })).toMatchObject(REFUSED_WRITE);
  });
});
