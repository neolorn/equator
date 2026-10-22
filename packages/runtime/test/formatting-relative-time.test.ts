import { describe, expect, it } from 'vitest';

import { decimal, formatRelativeTime } from '../src/formatting.js';
import { type FormattingContext } from '@neolorn/equator/core';

/**
 * What formatting an offset in a unit hands back, and what it refuses.
 *
 * `formatRelativeTime` writes the amount and the unit it is handed. Every expected text and part
 * is asked of the platform with the same arguments, so nothing here is a spelling that locale data
 * may revise.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

/** A numbering system no platform carries, so the context asks for digits that do not exist. */
const NO_SUCH_DIGITS: FormattingContext = Object.freeze({
  locale: 'en-US',
  numberingSystem: 'zzzz',
});

describe('a relative time', () => {
  it('is reported with its parts, and with the amount and the unit as its source', () => {
    const value = decimal('-3');
    const formatter = new Intl.RelativeTimeFormat('en-US');
    const parts = formatter
      .formatToParts(-3, 'day')
      .map(({ type, value: part }) => ({ kind: type, value: part }));

    expect(parts.map(({ kind }) => kind)).toStrictEqual(['integer', 'literal']);
    expect(formatRelativeTime(value, 'day', EN)).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'relative-time',
        text: formatter.format(-3, 'day'),
        parts,
        locale: 'en-US',
        language: 'en-US',
        direction: 'ltr',
        source: { value, unit: 'day' },
      },
    });
  });

  it('is written with the options it is handed', () => {
    const named = new Intl.RelativeTimeFormat('en-US', {
      numeric: 'auto',
    }).format(-1, 'day');

    expect(named).not.toBe(
      new Intl.RelativeTimeFormat('en-US').format(-1, 'day'),
    );
    expect(
      formatRelativeTime(decimal('-1'), 'day', EN, { numeric: 'auto' }),
    ).toMatchObject({ ok: true, value: { text: named } });
  });

  // The platform was never asked, so the refusal carries no reason naming it.
  it('is refused, with no reason given, where the amount is finer than a native number holds', () => {
    expect(
      formatRelativeTime(decimal('0.1234567890123456789'), 'day', EN),
    ).toStrictEqual({
      ok: false,
      diagnostic: {
        code: 'unsupported-formatting-capability',
        outcome: 'operational-failure',
        message: expect.any(String) as string,
        targetLocale: 'en-US',
      },
    });
  });

  it('is refused under a numbering system the platform has no data for', () => {
    expect(
      formatRelativeTime(decimal('-3'), 'day', NO_SUCH_DIGITS),
    ).toStrictEqual({
      ok: false,
      diagnostic: {
        code: 'unsupported-formatting-capability',
        outcome: 'operational-failure',
        message: expect.any(String) as string,
        targetLocale: 'en-US',
        reason: 'native-capability-rejected',
      },
    });
  });
});
