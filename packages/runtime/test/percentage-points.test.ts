import { describe, expect, it } from 'vitest';

import {
  decimal,
  formatPercent,
  formatPercentagePoints,
  percent,
  percentagePoints,
} from '../src/formatting.js';
import { type FormattingContext } from '@neolorn/equator/core';

/**
 * A rate that moved from four percent to six rose by two percentage points, and writing that as
 * two percent says something else. The percent case is the control: the same amount does carry a
 * percent sign when it is a percent.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

describe('percentage points', () => {
  it('are written without a percent sign or a percent scale', () => {
    const result = formatPercentagePoints(percentagePoints(decimal('5')), EN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe('5');
    expect(result.value.parts.map(({ kind }) => kind)).not.toContain(
      'percentSign',
    );
    expect(result.value.parts).toContainEqual({
      kind: 'semantic-unit',
      value: 'percentage-points',
    });
  });

  it('are distinct from a percent of the same amount', () => {
    const result = formatPercent(percent(decimal('5'), 'percent-unit'), EN);
    expect(result.ok && result.value.text).toBe('5%');
  });
});
