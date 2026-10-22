import { describe, expect, it } from 'vitest';

import { parseLocalizedInput } from '../src/localized-input.js';
import { type LocalizedInputProfile } from '@neolorn/equator/core';

/**
 * A duration field read under a locale the host refuses.
 *
 * A duration is read digit by digit in the locale's own digits and decimal separator, which the
 * host's number formatter is asked for. A locale tag the host throws on has neither, so there is
 * nothing to read the text against. That is a capability the host lacks and not a fault in what
 * was typed, so the field reports it as one, names the host's refusal as the reason, and gives
 * back the text untouched.
 */

const HOURS: LocalizedInputProfile = {
  kind: 'duration',
  pattern: [{ field: 'hours', maximumIntegerDigits: 2 }],
};

/** An underscore where a hyphen belongs, which the host refuses as a locale. */
const REFUSED = 'en_US';

describe('a duration field under a locale the host refuses', () => {
  it('is under a tag the host’s number formatter throws on', () => {
    expect(() => new Intl.NumberFormat(REFUSED)).toThrow(RangeError);
  });

  it('is read under a locale the host accepts', () => {
    expect(parseLocalizedInput('5', HOURS, { locale: 'en-US' })).toMatchObject({
      status: 'valid',
      value: { kind: 'duration', hours: 5 },
    });
  });

  it('is reported as a capability the host lacks, with the text as it was typed', () => {
    expect(parseLocalizedInput('5', HOURS, { locale: REFUSED })).toStrictEqual({
      status: 'unsupported-capability',
      text: '5',
      diagnostic: {
        code: 'unsupported-input-capability',
        outcome: 'operational-failure',
        message: expect.stringMatching(/\S/u) as unknown as string,
        targetLocale: REFUSED,
        reason: 'native-capability-rejected',
      },
    });
  });
});
