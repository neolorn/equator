import { describe, expect, it } from 'vitest';

import {
  decimal,
  duration,
  formatDuration,
  formatInstant,
  formatInstantRange,
  formatList,
  formatMeasurement,
  formatMoney,
  formatNumber,
  formatNumberRange,
  formatPercent,
  formatPercentagePoints,
  formatPlainDate,
  instant,
  measurement,
  money,
  percent,
  percentagePoints,
  plainDate,
} from '../src/formatting.js';
import {
  type FormattingContext,
  type FormattingResult,
  type LocalizationDiagnostic,
} from '@neolorn/equator/core';

/**
 * What a standalone formatting call hands back, on both sides of `ok`.
 *
 * A caller branches on three things it cannot read from the text: which kind of value was
 * formatted, which parts the text is made of, and, when the call is refused, whether the platform
 * rejected the request or the value never reached it. Every expected text and every expected part
 * is asked of the platform with the same arguments, so nothing here is a spelling that locale data
 * may revise.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const EN_UTC: FormattingContext = Object.freeze({
  locale: 'en-US',
  timeZone: 'UTC',
});

/** Past 2^53, so the platform's number type holds a neighbour rather than this. */
const INEXACT = '9007199254740993';

/** Nanoseconds whose millisecond is past what the platform's date holds as a whole number. */
const BEYOND_DATE = '9'.repeat(25);

interface DurationFields {
  readonly years: number;
  readonly months: number;
  readonly weeks: number;
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

interface DurationFormatter {
  format(fields: DurationFields): string;
  formatToParts(
    fields: DurationFields,
  ): readonly { readonly type: string; readonly value: string }[];
}

const durationFormatter = (
  locale: string,
  options: Readonly<Record<string, unknown>> = {},
): DurationFormatter =>
  new (
    Intl as unknown as {
      readonly DurationFormat: new (
        locale: string,
        options: Readonly<Record<string, unknown>>,
      ) => DurationFormatter;
    }
  ).DurationFormat(locale, options);

const NO_DURATION: DurationFields = Object.freeze({
  years: 0,
  months: 0,
  weeks: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
});

const refusal = (result: FormattingResult): LocalizationDiagnostic => {
  if (result.ok) throw new Error(`formatted as ${result.value.text}`);
  return result.diagnostic;
};

const formatted = (
  result: FormattingResult,
): Extract<FormattingResult, { readonly ok: true }>['value'] => {
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.value;
};

const asParts = (
  native: readonly { readonly type: string; readonly value: string }[],
): readonly { readonly kind: string; readonly value: string }[] =>
  native.map(({ type, value }) => ({ kind: type, value }));

/** Runs `run` on a host that lacks one member, and puts the member back whatever happens. */
const withoutMember = <Result>(
  owner: object,
  member: string,
  run: () => Result,
): Result => {
  const descriptor = Object.getOwnPropertyDescriptor(owner, member);
  if (descriptor === undefined) throw new Error(`${member} is not present`);
  Object.defineProperty(owner, member, {
    value: undefined,
    configurable: true,
    writable: true,
  });
  try {
    return run();
  } finally {
    Object.defineProperty(owner, member, descriptor);
  }
};

describe('a refusal that the platform did not make', () => {
  it('names the locale and the outcome, and carries no reason', () => {
    const diagnostic = refusal(
      formatNumber(decimal(`1${'0'.repeat(400)}`), EN),
    );
    expect(diagnostic.code).toBe('unsupported-formatting-capability');
    expect(diagnostic.outcome).toBe('operational-failure');
    expect(diagnostic.targetLocale).toBe('en-US');
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is what a decimal the number type would round comes back as', () => {
    const diagnostic = refusal(formatNumber(decimal(INEXACT), EN));
    expect(diagnostic.code).toBe('unsupported-formatting-capability');
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is what percentage points the number type would round come back as', () => {
    const result = formatPercentagePoints(
      percentagePoints(decimal(INEXACT)),
      EN,
    );
    expect(refusal(result).code).toBe('unsupported-formatting-capability');
  });

  it('is what a range with an inexact start comes back as', () => {
    const diagnostic = refusal(
      formatNumberRange(decimal(INEXACT), decimal('2'), EN),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is what a range with an inexact end comes back as', () => {
    const diagnostic = refusal(
      formatNumberRange(decimal('1'), decimal(INEXACT), EN),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is what a duration with inexact seconds comes back as', () => {
    const diagnostic = refusal(
      formatDuration(duration({ seconds: decimal(INEXACT) }), EN),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is what an instant outside the date range comes back as', () => {
    const diagnostic = refusal(
      formatInstant(instant(BEYOND_DATE), EN_UTC, { year: 'numeric' }),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is what a range starting outside the date range comes back as', () => {
    const diagnostic = refusal(
      formatInstantRange(instant(BEYOND_DATE), instant('0'), EN_UTC, {
        year: 'numeric',
      }),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is what a range ending outside the date range comes back as', () => {
    const diagnostic = refusal(
      formatInstantRange(instant('0'), instant(BEYOND_DATE), EN_UTC, {
        year: 'numeric',
      }),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is what an instant range with no zone anywhere comes back as', () => {
    const diagnostic = refusal(
      formatInstantRange(instant('0'), instant('3600000000000'), EN, {
        hour: 'numeric',
      }),
    );
    expect(diagnostic.code).toBe('unsupported-formatting-capability');
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });
});

describe('a refusal that the platform made', () => {
  const NO_SUCH_DIGITS: FormattingContext = Object.freeze({
    locale: 'en-US',
    timeZone: 'UTC',
    numberingSystem: 'zzzz',
  });

  it('says so for a numbering system with no data, on a number', () => {
    expect(refusal(formatNumber(decimal('1'), NO_SUCH_DIGITS)).reason).toBe(
      'native-capability-rejected',
    );
  });

  it('says so for a numbering system with no data, on an instant', () => {
    expect(
      refusal(formatInstant(instant('0'), NO_SUCH_DIGITS, { year: 'numeric' }))
        .reason,
    ).toBe('native-capability-rejected');
  });

  it('says so for a numbering system with no data, on an instant range', () => {
    expect(
      refusal(
        formatInstantRange(
          instant('0'),
          instant('3600000000000'),
          NO_SUCH_DIGITS,
          { hour: 'numeric' },
        ),
      ).reason,
    ).toBe('native-capability-rejected');
  });

  it('says so for a unit the platform does not know', () => {
    expect(
      refusal(
        formatMeasurement(measurement(decimal('1'), 'not-a-real-unit'), EN),
      ).reason,
    ).toBe('native-capability-rejected');
  });
});

describe('a host that lacks a capability', () => {
  it('reports number ranges unavailable without range text', () => {
    const diagnostic = withoutMember(
      Intl.NumberFormat.prototype,
      'formatRange',
      () => refusal(formatNumberRange(decimal('1'), decimal('2'), EN)),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('reports number ranges unavailable without range parts', () => {
    const diagnostic = withoutMember(
      Intl.NumberFormat.prototype,
      'formatRangeToParts',
      () => refusal(formatNumberRange(decimal('1'), decimal('2'), EN)),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('reports instant ranges unavailable without range text', () => {
    const diagnostic = withoutMember(
      Intl.DateTimeFormat.prototype,
      'formatRange',
      () =>
        refusal(
          formatInstantRange(instant('0'), instant('3600000000000'), EN_UTC, {
            hour: 'numeric',
          }),
        ),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('reports instant ranges unavailable without range parts', () => {
    const diagnostic = withoutMember(
      Intl.DateTimeFormat.prototype,
      'formatRangeToParts',
      () =>
        refusal(
          formatInstantRange(instant('0'), instant('3600000000000'), EN_UTC, {
            hour: 'numeric',
          }),
        ),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('reports durations unavailable without a duration formatter', () => {
    const diagnostic = withoutMember(Intl, 'DurationFormat', () =>
      refusal(formatDuration(duration({ hours: 1 }), EN)),
    );
    expect(diagnostic.code).toBe('unsupported-formatting-capability');
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });
});

describe('what a formatted number carries', () => {
  it('is a number, with the parts the platform divides it into', () => {
    const amount = decimal('1234.5');
    const result = formatNumber(amount, EN);
    expect(result.ok).toBe(true);
    const value = formatted(result);
    expect(value.semantic).toBe('number');
    expect(value.source).toBe(amount);
    expect(value.parts).toEqual(
      asParts(new Intl.NumberFormat('en-US').formatToParts(1234.5)),
    );
  });

  it('is money, written with its own currency', () => {
    const value = formatted(formatMoney(money(decimal('1234'), 'EGP'), EN));
    expect(value.semantic).toBe('money');
    expect(value.text).toBe(
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'EGP',
      }).format(1234),
    );
  });

  it('is a measurement', () => {
    const value = formatted(
      formatMeasurement(measurement(decimal('3'), 'kilometer'), EN),
    );
    expect(value.semantic).toBe('measurement');
  });

  it('is a percent', () => {
    const value = formatted(formatPercent(percent(decimal('0.05')), EN));
    expect(value.semantic).toBe('percent');
    expect(value.text).toBe(
      new Intl.NumberFormat('en-US', { style: 'percent' }).format(0.05),
    );
  });

  it('is percentage points', () => {
    const value = formatted(
      formatPercentagePoints(percentagePoints(decimal('2')), EN),
    );
    expect(value.semantic).toBe('percentage-points');
  });
});

describe('a percent held in percent units', () => {
  const percentText = (fraction: number, digits = 0): string =>
    new Intl.NumberFormat('en-US', {
      style: 'percent',
      maximumFractionDigits: digits,
    }).format(fraction);

  const inPercentUnits = (amount: string, digits = 0): string =>
    formatted(
      formatPercent(percent(decimal(amount), 'percent-unit'), EN, {
        maximumFractionDigits: digits,
      }),
    ).text;

  it('is a hundredth of its amount when the amount has one digit', () => {
    expect(inPercentUnits('5')).toBe(percentText(0.05));
  });

  it('is a hundredth of its amount when the amount has two digits', () => {
    expect(inPercentUnits('50')).toBe(percentText(0.5));
  });

  it('is a hundredth of its amount when the amount has more than two digits', () => {
    expect(inPercentUnits('1234')).toBe(percentText(12.34));
  });

  it('keeps the fraction the amount was given with', () => {
    expect(inPercentUnits('12.5', 1)).toBe(percentText(0.125, 1));
  });

  it('keeps the sign of a negative amount', () => {
    expect(inPercentUnits('-5')).toBe(percentText(-0.05));
    expect(inPercentUnits('-1234')).toBe(percentText(-12.34));
  });
});

describe('what a formatted number range carries', () => {
  it('is a number range, with its two ends and the platform parts', () => {
    const start = decimal('3');
    const end = decimal('5');
    const value = formatted(formatNumberRange(start, end, EN));
    expect(value.semantic).toBe('number-range');
    expect(value.source).toEqual({ start, end });
    // Cast because the compiled type definitions predate the range methods.
    const native = new Intl.NumberFormat('en-US') as unknown as {
      formatRangeToParts(
        from: number,
        to: number,
      ): readonly { readonly type: string; readonly value: string }[];
    };
    expect(value.parts).toEqual(asParts(native.formatRangeToParts(3, 5)));
  });
});

describe('what a formatted duration carries', () => {
  const NINETY_MINUTES: DurationFields = Object.freeze({
    ...NO_DURATION,
    hours: 1,
    minutes: 30,
  });

  it('is a duration, with the parts the platform divides it into', () => {
    const value = formatted(
      formatDuration(duration({ hours: 1, minutes: 30 }), EN),
    );
    expect(value.semantic).toBe('duration');
    expect(value.parts).toEqual(
      asParts(durationFormatter('en-US').formatToParts(NINETY_MINUTES)),
    );
  });

  it('is written in the style the call asks for', () => {
    const long = durationFormatter('en-US', { style: 'long' }).format(
      NINETY_MINUTES,
    );
    // The control: a host whose long and default styles read alike could not show the option.
    expect(long).not.toBe(durationFormatter('en-US').format(NINETY_MINUTES));
    expect(
      formatted(
        formatDuration(duration({ hours: 1, minutes: 30 }), EN, {
          style: 'long',
        }),
      ).text,
    ).toBe(long);
  });

  it('runs backward when its sign is negative', () => {
    expect(
      formatted(formatDuration(duration({ hours: 1, minutes: 30 }, -1), EN))
        .text,
    ).toBe(
      durationFormatter('en-US').format({
        ...NO_DURATION,
        hours: -1,
        minutes: -30,
      }),
    );
  });

  it('is formatted when it is no time at all', () => {
    const result = formatDuration(duration({}, 0), EN);
    expect(result.ok).toBe(true);
    expect(formatted(result).text).toBe(
      durationFormatter('en-US').format(NO_DURATION),
    );
  });
});

describe('the millisecond an instant falls in', () => {
  const MILLISECONDS = Object.freeze({
    second: 'numeric',
    fractionalSecondDigits: 3,
    timeZone: 'UTC',
  } as const);
  const at = (milliseconds: number): string =>
    new Intl.DateTimeFormat('en-US', MILLISECONDS).format(milliseconds);

  it('is the one before it when the instant is past a whole millisecond', () => {
    expect(
      formatted(formatInstant(instant('1500000'), EN, MILLISECONDS)).text,
    ).toBe(at(1));
  });

  it('is the earlier one for an instant before the epoch', () => {
    expect(
      formatted(formatInstant(instant('-1500000'), EN, MILLISECONDS)).text,
    ).toBe(at(-2));
  });

  it('is the instant itself on a whole millisecond before the epoch', () => {
    expect(
      formatted(formatInstant(instant('-2000000'), EN, MILLISECONDS)).text,
    ).toBe(at(-2));
  });
});

describe('what a formatted instant carries', () => {
  const HOUR_AND_MINUTE = Object.freeze({
    hour: 'numeric',
    minute: 'numeric',
  } as const);

  it('is an instant, with the parts the platform divides it into', () => {
    const value = formatted(
      formatInstant(instant('0'), EN_UTC, HOUR_AND_MINUTE),
    );
    expect(value.semantic).toBe('instant');
    expect(value.parts).toEqual(
      asParts(
        new Intl.DateTimeFormat('en-US', {
          ...HOUR_AND_MINUTE,
          timeZone: 'UTC',
        }).formatToParts(0),
      ),
    );
  });

  it('is a date range, with its two ends and the platform parts', () => {
    const start = instant('0');
    const end = instant('3600000000000');
    const value = formatted(
      formatInstantRange(start, end, EN_UTC, HOUR_AND_MINUTE),
    );
    expect(value.semantic).toBe('date-range');
    expect(value.source).toEqual({ start, end });
    expect(value.parts).toEqual(
      asParts(
        new Intl.DateTimeFormat('en-US', {
          ...HOUR_AND_MINUTE,
          timeZone: 'UTC',
        }).formatRangeToParts(0, 3_600_000),
      ),
    );
  });

  it('is a range in the context zone when the call names none', () => {
    const tokyo: FormattingContext = Object.freeze({
      locale: 'en-US',
      timeZone: 'Asia/Tokyo',
    });
    expect(
      formatted(
        formatInstantRange(
          instant('0'),
          instant('3600000000000'),
          tokyo,
          HOUR_AND_MINUTE,
        ),
      ).text,
    ).toBe(
      new Intl.DateTimeFormat('en-US', {
        ...HOUR_AND_MINUTE,
        timeZone: 'Asia/Tokyo',
      }).formatRange(0, 3_600_000),
    );
  });

  it('is a range in the zone the call names when the context names none', () => {
    expect(
      formatted(
        formatInstantRange(instant('0'), instant('3600000000000'), EN, {
          ...HOUR_AND_MINUTE,
          timeZone: 'Asia/Tokyo',
        }),
      ).text,
    ).toBe(
      new Intl.DateTimeFormat('en-US', {
        ...HOUR_AND_MINUTE,
        timeZone: 'Asia/Tokyo',
      }).formatRange(0, 3_600_000),
    );
  });
});

describe('the calendar a date is displayed in', () => {
  const YEAR = Object.freeze({ year: 'numeric', timeZone: 'UTC' } as const);
  const MONTH_AND_YEAR = Object.freeze({
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  } as const);

  it('is the one the context names', () => {
    const buddhist = new Intl.DateTimeFormat('en-US', {
      ...YEAR,
      calendar: 'buddhist',
    }).format(0);
    // The control: the two calendars count this year differently, so the option is visible.
    expect(buddhist).not.toBe(new Intl.DateTimeFormat('en-US', YEAR).format(0));
    expect(
      formatted(
        formatInstant(
          instant('0'),
          { locale: 'en-US', calendar: 'buddhist' },
          YEAR,
        ),
      ).text,
    ).toBe(buddhist);
  });

  it('is the locale default for an instant whose context says iso8601', () => {
    expect(
      formatted(
        formatInstant(
          instant('0'),
          { locale: 'en-US', calendar: 'iso8601' },
          MONTH_AND_YEAR,
        ),
      ).text,
    ).toBe(new Intl.DateTimeFormat('en-US', MONTH_AND_YEAR).format(0));
  });

  it('is the locale default for a plain date, which is always iso8601', () => {
    expect(
      formatted(
        formatPlainDate(plainDate(2026, 3, 14), EN, { dateStyle: 'medium' }),
      ).text,
    ).toBe(
      new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(Date.UTC(2026, 2, 14, 12)),
    );
  });
});

describe('the ceiling on formatted output', () => {
  // Sixteen items of 4,096 characters are exactly the text ceiling before anything joins them.
  const items = (count: number): readonly string[] =>
    Array.from({ length: count }, () => 'a'.repeat(4_096));

  it('admits a list whose joined text is under the ceiling', () => {
    expect(formatList(items(15), EN).ok).toBe(true);
  });

  it('refuses a list whose joined text is over the ceiling', () => {
    const diagnostic = refusal(formatList(items(16), EN));
    expect(diagnostic.code).toBe('unsupported-formatting-capability');
  });
});

describe('what a formatted plain date carries', () => {
  const NOON = Date.UTC(2026, 2, 14, 12);

  it('is a plain date, with the parts the platform divides it into', () => {
    const value = formatted(formatPlainDate(plainDate(2026, 3, 14), EN));
    expect(value.semantic).toBe('plain-date');
    expect(value.parts).toEqual(
      asParts(
        new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          timeZone: 'UTC',
        }).formatToParts(NOON),
      ),
    );
  });

  it('reads as midday when the call asks for an hour', () => {
    const hour = Object.freeze({ hour: 'numeric', hourCycle: 'h23' } as const);
    expect(
      formatted(formatPlainDate(plainDate(2026, 3, 14), EN, hour)).text,
    ).toBe(
      new Intl.DateTimeFormat('en-US', { ...hour, timeZone: 'UTC' }).format(
        NOON,
      ),
    );
  });

  it('is refused in a calendar other than iso8601, and not by the platform', () => {
    const diagnostic = refusal(
      formatPlainDate(plainDate(2569, 3, 14, 'buddhist'), EN),
    );
    expect(diagnostic.code).toBe('unsupported-formatting-capability');
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is refused, and not thrown, for a year the platform has no date for', () => {
    // `plainDate` refuses this year, so the value is one written as an object.
    const diagnostic = refusal(
      formatPlainDate(
        {
          kind: 'plain-date',
          year: 300_000,
          month: 3,
          day: 14,
          calendar: 'iso8601',
        },
        EN,
      ),
    );
    expect(diagnostic.code).toBe('unsupported-formatting-capability');
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is refused in a numbering system with no data', () => {
    expect(
      refusal(
        formatPlainDate(plainDate(2026, 3, 14), {
          locale: 'en-US',
          numberingSystem: 'zzzz',
        }),
      ).reason,
    ).toBe('native-capability-rejected');
  });
});

describe('a list', () => {
  const letters = (count: number): readonly string[] =>
    Array.from({ length: count }, () => 'a');

  it('is a list, with a copy of its items and the platform parts', () => {
    const values = ['tea', 'coffee', 'water'];
    const value = formatted(formatList(values, EN));
    expect(value.semantic).toBe('list');
    expect(value.source).toEqual(values);
    expect(value.source).not.toBe(values);
    expect(value.parts).toEqual(
      asParts(new Intl.ListFormat('en-US').formatToParts(values)),
    );
  });

  it('is formatted at a hundred items', () => {
    expect(formatList(letters(100), EN).ok).toBe(true);
  });

  it('is refused past a hundred items', () => {
    const diagnostic = refusal(formatList(letters(101), EN));
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is formatted with an item of 4,096 characters', () => {
    expect(formatList(['a'.repeat(4_096)], EN).ok).toBe(true);
  });

  it('is refused with an item one character longer', () => {
    const diagnostic = refusal(formatList(['a'.repeat(4_097), 'b'], EN));
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is refused when one item among strings is not a string', () => {
    const diagnostic = refusal(
      formatList(['a', 5] as unknown as readonly string[], EN),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is refused when its only item is not a string', () => {
    const diagnostic = refusal(
      formatList([5] as unknown as readonly string[], EN),
    );
    expect(Object.keys(diagnostic)).not.toContain('reason');
  });

  it('is refused when it is not an array', () => {
    const diagnostic = refusal(
      formatList({ length: 1, 0: 'a' } as unknown as readonly string[], EN),
    );
    expect(diagnostic.code).toBe('unsupported-formatting-capability');
  });
});
