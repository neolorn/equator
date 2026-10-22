import { describe, expect, it } from 'vitest';

import { decimal, money, plainDate, plainTime } from '../src/formatting.js';
import { formatLocalizedInput } from '../src/localized-input.js';

/**
 * Whether a value belongs to a field is asked of its kind before anything else about it, and
 * before the context is looked at. A value of another kind is the caller's mistake even when it
 * carries the member the field goes on to compare, a currency or a unit or a scale, and even when
 * the numbering system of the context is at fault too: reporting the numbering system would send
 * the caller to a setting that is not what they got wrong.
 */

const MALFORMED = { locale: 'en-US', numberingSystem: 'not valid' };
const UNKNOWN = { locale: 'en-US', numberingSystem: 'zzzz' };

const FIVE = { kind: 'decimal', value: '5' };

const CASES: readonly (readonly [string, unknown, unknown])[] = [
  [
    'money against a decimal field',
    money(decimal('5'), 'USD'),
    { kind: 'decimal' },
  ],
  [
    'a decimal carrying a currency against a money field',
    { ...FIVE, currency: 'USD' },
    { kind: 'money', currency: 'USD' },
  ],
  [
    'a decimal carrying a unit against a measurement field',
    { ...FIVE, unit: 'day' },
    { kind: 'measurement', unit: 'day' },
  ],
  [
    'a decimal carrying a scale against a percent field',
    { ...FIVE, scale: 'percent-unit' },
    { kind: 'percent', scale: 'percent-unit' },
  ],
  [
    'a decimal against a field of percentage points',
    decimal('5'),
    { kind: 'percentage-points' },
  ],
  [
    'a decimal carrying a date and a time against a date and time field',
    { ...FIVE, date: plainDate(2024, 1, 2), time: plainTime(9, 30) },
    {
      kind: 'plain-date-time',
      date: { order: 'year-month-day', separator: '-' },
      time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
      separator: ' ',
    },
  ],
  [
    'a decimal carrying a count of nanoseconds against an instant field',
    { ...FIVE, epochNanoseconds: '0' },
    { kind: 'instant', syntax: 'rfc3339' },
  ],
];

function code(value: unknown, profile: unknown, context: unknown): unknown {
  const result = formatLocalizedInput(
    value as never,
    profile as never,
    context as never,
  );
  return result.ok ? 'ok' : result.diagnostic.code;
}

describe('a value of another kind is reported before the numbering system is', () => {
  it.each(CASES)(
    '%s, under a malformed identifier',
    (_name, value, profile) => {
      expect(code(value, profile, MALFORMED)).toBe('invalid-localized-input');
    },
  );

  it.each(CASES)('%s, under an unknown identifier', (_name, value, profile) => {
    expect(code(value, profile, UNKNOWN)).toBe('invalid-localized-input');
  });

  it('reports the numbering system for a value the field takes', () => {
    expect(code(decimal('5'), { kind: 'decimal' }, MALFORMED)).toBe(
      'invalid-configuration',
    );
    expect(code(decimal('5'), { kind: 'decimal' }, UNKNOWN)).toBe(
      'unsupported-formatting-capability',
    );
  });
});
