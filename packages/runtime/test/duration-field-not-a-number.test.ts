/**
 * A duration written by hand whose field is text where a number belongs.
 *
 * The text a field is written as reads back as the same characters, so the round trip alone would
 * let `'5'` through as 5. The field is held to a number before anything is written.
 */
import { describe, expect, it } from 'vitest';

import { decimal } from '../src/formatting.js';
import { formatLocalizedInput } from '../src/localized-input.js';

describe('a duration whose field is not a number', () => {
  it.each(['years', 'months', 'weeks', 'days', 'hours', 'minutes'] as const)(
    'is not written where %s is text',
    (field) => {
      const value = {
        kind: 'duration',
        sign: 1,
        years: 0,
        months: 0,
        weeks: 0,
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: decimal('0'),
        [field]: '5',
      };
      const result = formatLocalizedInput(
        value as never,
        { kind: 'duration', pattern: [{ field }, 'x'] },
        { locale: 'en-US' },
      );
      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: 'invalid-localized-input' },
      });
    },
  );
});
