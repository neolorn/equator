/**
 * A percentage-points value handed to `:percent`.
 *
 * `specs/01-standards-profile.spec.md` section 8: percentage points are a separate contract and
 * never enter `:percent` implicitly. Two points and two percent are the same digits and different
 * sentences, so the message refuses the value rather than rendering it as a proportion.
 */
import { describe, expect, it } from 'vitest';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import { decimal, percentagePoints } from '../src/formatting.js';
import { render } from './message-harness.js';

const RATE: readonly CompiledInputContract[] = Object.freeze([
  { name: 'rate', type: 'number', optional: false, nullable: false },
]);

describe('percentage points under :percent', () => {
  it('formats a number as a proportion', () => {
    expect(render('{$rate :percent}', RATE, { rate: 0.02 })).toBe('2%');
  });

  it('refuses a percentage-points value', () => {
    expect(() =>
      render('{$rate :percent}', RATE, {
        rate: percentagePoints(decimal('2')),
      }),
    ).toThrow(/number operand|invalid|input/iu);
  });
});
