import { describe, expect, it } from 'vitest';

import {
  decimal,
  formatInstant,
  formatNumber,
  instant,
} from '../src/formatting.js';
import { type FormattingContext } from '@neolorn/equator/core';

/**
 * The standalone functions share one formatter store across every call in the process, so an
 * override one call makes is only narrow if the next call on the same context, without it, gets the
 * context's own answer back. Each case makes the override first, so the store holds the overridden
 * formatter when the plain call arrives.
 */

const EN_UTC: FormattingContext = Object.freeze({
  locale: 'en-US',
  timeZone: 'UTC',
  hourCycle: 'h23',
});

describe('a per-operation override', () => {
  it('does not change how the next number on the context is written', () => {
    const value = decimal('1234.5');
    const overridden = formatNumber(value, EN_UTC, {
      maximumFractionDigits: 0,
    });
    const after = formatNumber(value, EN_UTC);

    expect(overridden.ok && overridden.value.text).toBe('1,235');
    expect(after.ok && after.value.text).toBe('1,234.5');
  });

  it('does not change the hour cycle of the next instant on the context', () => {
    // Twenty-three hundred UTC, which reads 23 on the context's clock and 11 on a twelve-hour one.
    const late = instant('82800000000000');
    const hour = { hour: 'numeric' } as const;
    const overridden = formatInstant(late, EN_UTC, { ...hour, hour12: true });
    const after = formatInstant(late, EN_UTC, hour);

    expect(overridden.ok && overridden.value.text).toContain('11');
    expect(after.ok && after.value.text).toBe('23');
  });
});
