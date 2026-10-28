import { describe, expect, it } from 'vitest';

import {
  formatInstant,
  formatInstantRange,
  instant,
} from '../src/formatting.js';
import { type FormattingContext } from '@neolorn/equator/core';

import { claimCapability } from '../../../tools/capability-claims-in-tests.ts';

/**
 * An application whose catalogs never format in the context's zone can start without naming one,
 * so the refusal of an instant with no zone at all is only observable here, below any application.
 */

const NO_ZONE: FormattingContext = Object.freeze({ locale: 'en-US' });

describe('an instant with no time zone', () => {
  it('is refused when neither the context nor the call names a zone', () => {
    expect(
      formatInstant(instant('0'), NO_ZONE, { year: 'numeric' }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: 'unsupported-formatting-capability' },
    });
    claimCapability('format:formatInstant');
  });

  it('is formatted in the zone the call names', () => {
    const result = formatInstant(instant('0'), NO_ZONE, {
      year: 'numeric',
      timeZone: 'UTC',
    });

    expect(result.ok && result.value.text).toBe('1970');
  });
});

describe('an instant formatted with a zone of its own', () => {
  const UTC_H12: FormattingContext = Object.freeze({
    locale: 'en-US',
    timeZone: 'UTC',
    hourCycle: 'h12',
  });
  // Midnight UTC is nine in the morning in Tokyo, so the zone that won is readable in the hour.
  const HOUR = { hour: 'numeric', hourCycle: 'h23' } as const;

  it('is formatted in the zone the call names, not the context zone', () => {
    const result = formatInstant(instant('0'), UTC_H12, {
      ...HOUR,
      timeZone: 'Asia/Tokyo',
    });
    expect(result.ok && result.value.text).toBe('09');
    // The control: without a zone of its own, the context's.
    const control = formatInstant(instant('0'), UTC_H12, HOUR);
    expect(control.ok && control.value.text).toBe('00');
  });

  it('is formatted as a range in the zone the call names', () => {
    const result = formatInstantRange(
      instant('0'),
      instant('3600000000000'),
      UTC_H12,
      { ...HOUR, timeZone: 'Asia/Tokyo' },
    );
    expect(result.ok && result.value.text).toMatch(/^09/u);
  });
});
