import { describe, expect, it } from 'vitest';

import {
  decimal,
  duration,
  formatDuration,
  formatInstant,
  formatInstantRange,
  formatNumberRange,
  formatPlainDate,
  formatPlainDateTime,
  formatPlainTime,
  instant,
  plainDate,
  plainDateTime,
  plainTime,
} from '../src/formatting.js';
import {
  type FormattingContext,
  type FormattingResult,
} from '@neolorn/equator/core';

/**
 * What a formatting call hands back when the platform refuses the options it was given.
 *
 * The options of a date, a range or a duration are the platform's own, so the platform is what
 * decides whether a set of them is one profile. A set it throws on is reported as a refusal the
 * platform made, on the result, for the locale that was asked for. Each set here is first shown to
 * make the platform's own constructor throw, so the refusal is the platform's and not a check of
 * Equator's that happens to precede it.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const EN_UTC: FormattingContext = Object.freeze({
  locale: 'en-US',
  timeZone: 'UTC',
});

/** A style and a field together, which the platform refuses as one date-time profile. */
const STYLE_AND_FIELD: Intl.DateTimeFormatOptions = Object.freeze({
  dateStyle: 'full',
  year: 'numeric',
});

const PLATFORM_REFUSAL = {
  ok: false,
  diagnostic: {
    code: 'unsupported-formatting-capability',
    outcome: 'operational-failure',
    message: expect.stringMatching(/\S/u) as unknown as string,
    targetLocale: 'en-US',
    reason: 'native-capability-rejected',
  },
};

const refused = (result: FormattingResult): void => {
  expect(result).toStrictEqual(PLATFORM_REFUSAL);
};

describe('a date-time profile the platform refuses', () => {
  it('is one the platform throws on', () => {
    expect(() => new Intl.DateTimeFormat('en-US', STYLE_AND_FIELD)).toThrow(
      TypeError,
    );
    expect(
      () => new Intl.DateTimeFormat('en-US', { timeZone: 'Not/A_Zone' }),
    ).toThrow(RangeError);
  });

  it('is reported for an instant', () => {
    refused(formatInstant(instant('0'), EN_UTC, STYLE_AND_FIELD));
  });

  it('is reported for an instant in a zone the platform does not know', () => {
    refused(
      formatInstant(instant('0'), EN, {
        year: 'numeric',
        timeZone: 'Not/A_Zone',
      }),
    );
  });

  it('is reported for a plain date', () => {
    refused(formatPlainDate(plainDate(2024, 3, 14), EN, STYLE_AND_FIELD));
  });

  it('is reported for a plain time', () => {
    refused(
      formatPlainTime(plainTime(13, 5, 9, 0), EN, {
        timeStyle: 'full',
        hour: 'numeric',
      }),
    );
  });

  it('is reported for a plain date-time', () => {
    refused(
      formatPlainDateTime(
        plainDateTime(plainDate(2024, 3, 14), plainTime(13, 5, 9, 0)),
        EN,
        STYLE_AND_FIELD,
      ),
    );
  });

  it('is reported for a range of instants', () => {
    refused(
      formatInstantRange(
        instant('0'),
        instant('3600000000000'),
        EN_UTC,
        STYLE_AND_FIELD,
      ),
    );
  });
});

describe('a number-range profile the platform refuses', () => {
  // A currency style that names no currency.
  const options: Intl.NumberFormatOptions = { style: 'currency' };

  it('is one the platform throws on', () => {
    expect(() => new Intl.NumberFormat('en-US', options)).toThrow(TypeError);
  });

  it('is reported', () => {
    refused(formatNumberRange(decimal('1'), decimal('2'), EN, options));
  });
});

describe('a duration profile the platform refuses', () => {
  const options = { style: 'no-such-style' };

  it('is one the platform throws on', () => {
    const DurationFormat = (
      Intl as unknown as {
        DurationFormat: new (locale: string, options: object) => unknown;
      }
    ).DurationFormat;
    expect(() => new DurationFormat('en-US', options)).toThrow(RangeError);
  });

  it('is reported', () => {
    refused(formatDuration(duration({ hours: 1 }), EN, options));
  });
});
