import { describe, expect, it } from 'vitest';

import { decimal } from '../src/formatting.js';
import { parseLocalizedInput } from '../src/localized-input.js';

const context = { locale: 'en-US' };

function status(profile: unknown, text = '3'): unknown {
  const result = parseLocalizedInput(text, profile as never, context);
  return result.status;
}

// A bound reaches the comparison as written, and the comparison converts its digits without
// looking at them. A bound that is not a decimal in its canonical spelling either threw out of
// the read or was compared as some other number.
describe('a numeric field whose bound is not a decimal', () => {
  it.each([
    ['letters', 'abc'],
    ['two signs', '--5'],
    ['an exponent', '1e3'],
    ['the empty text', ''],
    ['a point with no fraction', '5.'],
    ['a point with no integer', '.5'],
    ['two points', '1.2.3'],
    ['a leading space', ' 5'],
    ['a number', 5],
    ['null', null],
    ['nothing', undefined],
  ])('is policy-rejected for %s', (_label, value) => {
    for (const bound of ['minimum', 'maximum']) {
      expect(
        status({ kind: 'decimal', [bound]: { kind: 'decimal', value } }),
      ).toBe('policy-rejected');
    }
  });

  it('is policy-rejected for a bound that is not a value at all', () => {
    expect(status({ kind: 'decimal', minimum: 5 })).toBe('policy-rejected');
    expect(status({ kind: 'decimal', maximum: null })).toBe('policy-rejected');
  });

  it('is policy-rejected for every kind of numeric field and for the empty text', () => {
    const bad = { kind: 'decimal', value: '--5' };
    expect(status({ kind: 'money', currency: 'USD', minimum: bad })).toBe(
      'policy-rejected',
    );
    expect(status({ kind: 'measurement', unit: 'day', maximum: bad })).toBe(
      'policy-rejected',
    );
    expect(status({ kind: 'percent', scale: 'fractional', minimum: bad })).toBe(
      'policy-rejected',
    );
    expect(status({ kind: 'decimal', minimum: bad }, '')).toBe(
      'policy-rejected',
    );
  });

  it('still reads against bounds that are decimals', () => {
    const profile = {
      kind: 'decimal',
      minimum: decimal('-5'),
      maximum: decimal('5.50'),
    };
    expect(status(profile, '3')).toBe('valid');
    expect(status(profile, '6')).toBe('out-of-range');
    expect(status(profile, '-6')).toBe('out-of-range');
  });
});
