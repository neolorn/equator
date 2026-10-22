import { describe, expect, it } from 'vitest';

import { formatDisplayName } from '../src/formatting.js';
import { type FormattingContext } from '@neolorn/equator/core';

/**
 * What asking for the name of a code hands back when there is no name to give.
 *
 * Three different things can stand in the way, and the result tells them apart. A code too long to
 * be one, or not text at all, is turned away before the platform is asked. A code of the wrong
 * shape for its kind is the platform's refusal. A well-shaped code the platform has no name for,
 * asked with no fallback, is neither: the platform answered, and its answer was nothing.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

const refusal = (reason?: string) => ({
  ok: false,
  diagnostic: {
    code: 'unsupported-formatting-capability',
    outcome: 'operational-failure',
    message: expect.stringMatching(/\S/u) as unknown as string,
    targetLocale: 'en-US',
    ...(reason === undefined ? {} : { reason }),
  },
});

describe('a display name', () => {
  it('is refused with no reason for a code past the length bound, which the platform is not asked about', () => {
    const options = { type: 'language' } as const;

    // At the bound the platform is asked, and the refusal is its own.
    expect(formatDisplayName('a'.repeat(1_024), EN, options)).toStrictEqual(
      refusal('native-capability-rejected'),
    );
    expect(formatDisplayName('a'.repeat(1_025), EN, options)).toStrictEqual(
      refusal(),
    );
  });

  it('is refused with no reason for a code that is not text', () => {
    expect(
      formatDisplayName(840 as unknown as string, EN, { type: 'region' }),
    ).toStrictEqual(refusal());
  });

  it('is refused with no reason where the platform has no name and no fallback was asked for', () => {
    // A private-use region code, which no release of the locale data names.
    const options = { type: 'region', fallback: 'none' } as const;

    expect(new Intl.DisplayNames('en-US', options).of('QQ')).toBeUndefined();
    expect(formatDisplayName('QQ', EN, options)).toStrictEqual(refusal());
  });

  it('is refused, as the platform’s refusal, for a code of the wrong shape for its kind', () => {
    const options = { type: 'region' } as const;

    expect(() =>
      new Intl.DisplayNames('en-US', options).of('not a region'),
    ).toThrow(RangeError);
    expect(formatDisplayName('not a region', EN, options)).toStrictEqual(
      refusal('native-capability-rejected'),
    );
  });
});
