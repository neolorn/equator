import { describe, expect, it } from 'vitest';

import { plainDate, plainDateTime, plainTime } from '../src/formatting.js';
import { formatLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * Writing a date and time under a context the platform cannot spell digits for.
 *
 * `formatLocalizedInput` returns the text or a reported failure. A locale that is not a language
 * tag and a numbering system that is not well-formed are both refused outright by the platform, and
 * a form writing its value back has a result to branch on there and nothing to catch.
 */

const PROFILE: LocalizedInputProfile = {
  kind: 'plain-date-time',
  date: { order: 'year-month-day', separator: '-' },
  time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
  separator: ' ',
};

describe('a date and time written under a locale that is not a language tag', () => {
  it('is reported as a failure and not thrown', () => {
    const written = formatLocalizedInput(
      plainDateTime(plainDate(2024, 1, 2), plainTime(13, 45)),
      PROFILE,
      { locale: 'not a locale' },
    );

    expect(written).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'unsupported-formatting-capability',
        outcome: 'operational-failure',
        targetLocale: 'not a locale',
        reason: 'native-capability-rejected',
      },
    });
  });
});

describe('a date and time written under a malformed numbering system', () => {
  it('is reported as a failure and not thrown', () => {
    // Two letters is shorter than any numbering system identifier may be.
    const context: FormattingContext = {
      locale: 'en-US',
      numberingSystem: 'no',
    };
    const written = formatLocalizedInput(
      plainDateTime(plainDate(2024, 1, 2), plainTime(13, 45)),
      PROFILE,
      context,
    );

    expect(written).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        targetLocale: 'en-US',
      },
    });
  });
});
