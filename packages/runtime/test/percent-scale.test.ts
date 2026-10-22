/**
 * A percentage's scale comes from the value, never from how large the number is.
 *
 * `specs/01-standards-profile.spec.md` section 8: `0.25` on the fractional scale is twenty-five
 * percent, a domain that stores `25` says so through the profile, and a release MUST NOT infer the
 * scale from the magnitude. The amounts below are the ones a guess gets wrong: a fractional value
 * above one, and a percent-unit value below one.
 */
import { describe, expect, it } from 'vitest';

import { decimal, formatPercent, percent } from '../src/formatting.js';
import { type FormattingContext } from '@neolorn/equator/core';

const CONTEXT: FormattingContext = Object.freeze({ locale: 'en-US' });
const OPTIONS = Object.freeze({ maximumFractionDigits: 3 });

function platform(fraction: number): string {
  return new Intl.NumberFormat('en-US', {
    ...OPTIONS,
    style: 'percent',
  }).format(fraction);
}

function text(result: ReturnType<typeof formatPercent>): string | undefined {
  return result.ok ? result.value.text : undefined;
}

describe('the scale of a percentage', () => {
  it.each([
    ['fractional 2 is two hundred percent', decimal('2'), 'fractional', 2],
    [
      'fractional 0.25 is twenty-five percent',
      decimal('0.25'),
      'fractional',
      0.25,
    ],
    [
      'percent-unit 25 is twenty-five percent',
      decimal('25'),
      'percent-unit',
      0.25,
    ],
    [
      'percent-unit 0.5 is half a percent',
      decimal('0.5'),
      'percent-unit',
      0.005,
    ],
  ] as const)('%s', (_label, amount, scale, fraction) => {
    expect(text(formatPercent(percent(amount, scale), CONTEXT, OPTIONS))).toBe(
      platform(fraction),
    );
  });
});
