import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LocalizationError,
  type FormattingContext,
  type FormattingResult,
} from '@neolorn/equator/core';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import {
  decimal,
  duration,
  formatDuration,
  formatInstant,
  formatInstantRange,
  formatMeasurement,
  formatMoney,
  formatNumber,
  formatNumberRange,
  formatPercent,
  formatPercentagePoints,
  formatPlainDate,
  formatPlainDateTime,
  formatPlainTime,
  formatRelativeTime,
  formatZonedDateTime,
  instant,
  measurement,
  money,
  percent,
  percentagePoints,
  plainDate,
  plainDateTime,
  plainTime,
  zonedDateTime,
} from '../src/formatting.js';
import { render } from './message-harness.js';

/**
 * What every formatter that writes digits reports for a numbering system it cannot write in.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4 holds a numbering system to one rule
 * whoever named it, the call or the formatting context. A host given a well-formed name it has no
 * digits for raises nothing and writes the digits of the locale, which is the approximation
 * section 3 forbids, so the name is judged before a formatter is built: by how a numbering
 * system's name is written, and then by whether the host has it.
 */

const NOON = instant('1710417600000000000');
const LATER = instant('1710504000000000000');
const MARCH_14 = plainDate(2024, 3, 14);
const AMOUNT = decimal('1234.5');
const DATE = { dateStyle: 'short' } as const;
const TIME = { timeStyle: 'short' } as const;

const under = (numberingSystem?: unknown): FormattingContext =>
  ({
    locale: 'en-US',
    timeZone: 'UTC',
    ...(numberingSystem === undefined ? {} : { numberingSystem }),
  }) as FormattingContext;

type Named = { readonly numberingSystem?: unknown };

/** Every formatter that writes digits, under one context and the numbering system a call names. */
const FORMATTERS: readonly (readonly [
  string,
  (context: FormattingContext, named: Named) => FormattingResult,
])[] = [
  [
    'a number',
    (context, named) => formatNumber(AMOUNT, context, named as never),
  ],
  [
    'money',
    (context, named) =>
      formatMoney(money(AMOUNT, 'EUR'), context, named as never),
  ],
  [
    'a measurement',
    (context, named) =>
      formatMeasurement(measurement(AMOUNT, 'meter'), context, named as never),
  ],
  [
    'a percent',
    (context, named) =>
      formatPercent(percent(decimal('0.25')), context, named as never),
  ],
  [
    'percentage points',
    (context, named) =>
      formatPercentagePoints(percentagePoints(AMOUNT), context, named as never),
  ],
  [
    'a range of numbers',
    (context, named) =>
      formatNumberRange(AMOUNT, decimal('2000'), context, named as never),
  ],
  [
    'an instant',
    (context, named) =>
      formatInstant(NOON, context, { ...DATE, ...named } as never),
  ],
  [
    'a range of instants',
    (context, named) =>
      formatInstantRange(NOON, LATER, context, { ...DATE, ...named } as never),
  ],
  [
    'a plain date',
    (context, named) =>
      formatPlainDate(MARCH_14, context, { ...DATE, ...named } as never),
  ],
  [
    'a plain time',
    (context, named) =>
      formatPlainTime(plainTime(13, 5), context, {
        ...TIME,
        ...named,
      } as never),
  ],
  [
    'a plain date-time',
    (context, named) =>
      formatPlainDateTime(plainDateTime(MARCH_14, plainTime(13, 5)), context, {
        ...DATE,
        ...TIME,
        ...named,
      } as never),
  ],
  [
    'a zoned date-time',
    (context, named) =>
      formatZonedDateTime(zonedDateTime(NOON, 'UTC'), context, {
        ...DATE,
        ...named,
      } as never),
  ],
  [
    'a duration',
    (context, named) =>
      formatDuration(
        duration({ hours: 3, minutes: 12 } as never),
        context,
        named as never,
      ),
  ],
  [
    'relative time',
    (context, named) =>
      formatRelativeTime(decimal('-3'), 'day', context, named as never),
  ],
];

const reported = (reason: string) => ({
  ok: false,
  diagnostic: {
    code: 'unsupported-formatting-capability',
    outcome: 'operational-failure',
    targetLocale: 'en-US',
    reason,
  },
});

const MALFORMED: readonly (readonly [string, unknown])[] = [
  ['one character', 'x'],
  ['an upper-case spelling', 'LATN'],
  ['a subtag of nine characters', 'arabicext'],
  ['the empty name', ''],
  ['a space after the name', 'arab '],
  ['a number', 5],
];

const builders = () => [
  vi.spyOn(Intl, 'NumberFormat'),
  vi.spyOn(Intl, 'DateTimeFormat'),
  vi.spyOn(Intl, 'RelativeTimeFormat'),
  vi.spyOn(
    Intl as unknown as { DurationFormat: () => unknown },
    'DurationFormat',
  ),
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the host this suite runs on', () => {
  it('answers a numbering system it does not have with another and raises nothing', () => {
    const answer = (numberingSystem: string): string =>
      new Intl.NumberFormat('en-US', { numberingSystem }).resolvedOptions()
        .numberingSystem;

    expect(answer('zzzz')).toBe('latn');
    expect(answer('LATN')).toBe('latn');
    expect(answer('traditio')).toBe('latn');
  });
});

describe('the name of a numbering system', () => {
  it('is judged before the host is asked which systems it has', async () => {
    vi.resetModules();
    const fresh = await import('../src/formatting.js');
    const listed = vi.spyOn(Intl, 'supportedValuesOf');

    expect(fresh.formatNumber(AMOUNT, under('LATN'))).toMatchObject(
      reported('malformed-input'),
    );
    expect(
      fresh.formatNumber(AMOUNT, under(), { numberingSystem: 'LATN' }),
    ).toMatchObject(reported('malformed-input'));
    expect(listed).not.toHaveBeenCalled();

    expect(fresh.formatNumber(AMOUNT, under('zzzz'))).toMatchObject(
      reported('native-capability-rejected'),
    );
    expect(listed).toHaveBeenCalledTimes(1);
  });
});

describe.each(FORMATTERS)('formatting %s', (_title, format) => {
  it('writes in the digits the call names, as it does in the digits the context names', () => {
    const named = format(under(), { numberingSystem: 'arab' });

    expect(named).toMatchObject({ ok: true });
    expect(named).not.toStrictEqual(format(under(), {}));
    expect((named as { value: { text: string } }).value.text).toBe(
      (format(under('arab'), {}) as { value: { text: string } }).value.text,
    );
  });

  it('writes in the digits the call names over the digits the context names', () => {
    expect(
      (
        format(under('arab'), { numberingSystem: 'latn' }) as {
          value: { text: string };
        }
      ).value.text,
    ).toBe((format(under(), {}) as { value: { text: string } }).value.text);
    expect(format(under('zzzz'), { numberingSystem: 'arab' })).toMatchObject({
      ok: true,
    });
  });

  it.each(['zzzz', 'traditio', 'roman'])(
    'reports the numbering system %s the call names, which the host has no digits for',
    (numberingSystem) => {
      expect(format(under(), { numberingSystem })).toMatchObject(
        reported('native-capability-rejected'),
      );
      expect(format(under('arab'), { numberingSystem })).toMatchObject(
        reported('native-capability-rejected'),
      );
    },
  );

  it.each(MALFORMED)(
    'refuses a numbering system the call names written with %s, and builds no formatter',
    (_name, numberingSystem) => {
      const built = builders();

      expect(format(under(), { numberingSystem })).toMatchObject(
        reported('malformed-input'),
      );
      for (const builder of built) expect(builder).not.toHaveBeenCalled();
    },
  );

  it.each(['zzzz', 'traditio'])(
    'reports the numbering system %s of the context, which the host has no digits for',
    (numberingSystem) => {
      expect(format(under(numberingSystem), {})).toMatchObject(
        reported('native-capability-rejected'),
      );
    },
  );

  it.each(MALFORMED)(
    'refuses a numbering system of the context written with %s, and builds no formatter',
    (_name, numberingSystem) => {
      const built = builders();

      expect(format(under(numberingSystem), {})).toMatchObject(
        reported('malformed-input'),
      );
      for (const builder of built) expect(builder).not.toHaveBeenCalled();
    },
  );
});

describe('a number or a date written by a message', () => {
  const INPUTS: readonly CompiledInputContract[] = Object.freeze([
    { name: 'n', type: 'number', optional: false, nullable: false },
    { name: 'd', type: 'date-time', optional: false, nullable: false },
  ]);
  const values = { n: 1234.5, d: new Date(Date.UTC(2024, 2, 14, 12)) };
  const failure = (source: string, context: FormattingContext) => {
    let thrown: unknown;
    try {
      render(source, INPUTS, values, context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LocalizationError);
    return (thrown as LocalizationError).diagnostic;
  };

  it.each(['{$n :number}', '{$d :date}'])(
    '%s reports a numbering system of the context the host has no digits for',
    (source) => {
      expect(failure(source, under('zzzz'))).toMatchObject({
        code: 'unsupported-formatting-capability',
        reason: 'native-capability-rejected',
      });
    },
  );

  it.each(['{$n :number}', '{$d :date}'])(
    '%s refuses a numbering system of the context that is not written as one',
    (source) => {
      for (const numberingSystem of ['LATN', 'x', '']) {
        expect(failure(source, under(numberingSystem))).toMatchObject({
          code: 'unsupported-formatting-capability',
          reason: 'malformed-input',
        });
      }
    },
  );
});
