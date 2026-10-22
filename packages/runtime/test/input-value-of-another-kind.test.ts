import { describe, expect, it } from 'vitest';

import {
  decimal,
  measurement,
  money,
  plainDate,
  plainDateTime,
  plainTime,
} from '../src/formatting.js';
import {
  formatLocalizedInput,
  parseLocalizedInput,
} from '../src/localized-input.js';

const malformed = { locale: 'en-US', numberingSystem: 'not valid' };
const unknown = { locale: 'en-US', numberingSystem: 'zzzz' };
const date = { kind: 'plain-date', order: 'year-month-day', separator: '-' };
const time = {
  kind: 'plain-time',
  hourCycle: 'h23',
  precision: 'minute',
  separator: ':',
};
const dateTime = {
  kind: 'plain-date-time',
  date: { order: 'year-month-day', separator: '-' },
  time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
  separator: ' ',
};
const span = { kind: 'duration', pattern: [{ field: 'minutes' }] };

function code(value: unknown, profile: unknown, context: unknown): unknown {
  const result = formatLocalizedInput(
    value as never,
    profile as never,
    context as never,
  );
  return result.ok ? 'ok' : result.diagnostic.code;
}

// The value is the caller's mistake and the numbering system is the application's, and a writer
// that reported the second first would send the caller to a setting that is not at fault.
describe('a value its field does not take is reported before the numbering system is', () => {
  it('a decimal against a date field', () => {
    expect(code(decimal('5'), date, malformed)).toBe('invalid-localized-input');
    expect(code(decimal('5'), date, unknown)).toBe('invalid-localized-input');
  });

  it('a Gregorian date against an ISO date field', () => {
    expect(code(plainDate(2024, 1, 2, 'gregory'), date, malformed)).toBe(
      'invalid-localized-input',
    );
  });

  it('a decimal carrying a calendar member against a date field', () => {
    expect(
      code(
        { kind: 'decimal', value: '5', calendar: 'iso8601' },
        date,
        malformed,
      ),
    ).toBe('invalid-localized-input');
  });

  it('a decimal against a time field', () => {
    expect(code(decimal('5'), time, malformed)).toBe('invalid-localized-input');
  });

  it('a Gregorian date-time against an ISO date-time field', () => {
    expect(
      code(
        plainDateTime(plainDate(2024, 1, 2, 'gregory'), plainTime(9, 30)),
        dateTime,
        malformed,
      ),
    ).toBe('invalid-localized-input');
  });

  it('a decimal against a duration field', () => {
    expect(code(decimal('5'), span, malformed)).toBe('invalid-localized-input');
  });
});

describe('a value is compared with its re-read form by the members of its own kind', () => {
  it('writes a money value that also carries a unit member', () => {
    const value = { ...money(decimal('5'), 'USD'), unit: 'day' };
    const result = formatLocalizedInput(
      value as never,
      { kind: 'money', currency: 'USD' },
      { locale: 'en-US' },
    );
    expect(result.ok).toBe(true);
  });

  it('writes a measurement that also carries a scale member', () => {
    const value = { ...measurement(decimal('5'), 'day'), scale: 'fractional' };
    const result = formatLocalizedInput(
      value as never,
      { kind: 'measurement', unit: 'day' },
      { locale: 'en-US' },
    );
    expect(result.ok).toBe(true);
  });
});

describe('a text past the limit of its field', () => {
  it('is reported with the text that was given', () => {
    const result = parseLocalizedInput(
      '123456',
      { kind: 'decimal', maximumCharacters: 3 },
      { locale: 'en-US' },
    );
    expect(result.status).toBe('out-of-range');
    expect(result.text).toBe('123456');
  });
});
