import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LocalizationError,
  type FormattingContext,
  type FormattingResult,
} from '@neolorn/equator/core';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import {
  formatInstant,
  formatInstantRange,
  formatPlainDate,
  formatPlainDateTime,
  formatPlainTime,
  formatZonedDateTime,
  instant,
  plainDate,
  plainDateTime,
  plainTime,
  zonedDateTime,
} from '../src/formatting.js';
import { render } from './message-harness.js';

/**
 * What every date formatter reports for a calendar it was asked for and cannot write in.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4 has a calendar reach a formatter from
 * the call, from the value, or from the formatting context, and section 3 has an absent capability
 * reported and never approximated. A host asked for a calendar it does not have raises nothing and
 * writes in the calendar of the locale, which is the approximation, so each formatter compares the
 * calendar it was answered with to the one it asked for. A name that is not written as a
 * calendar's is refused before the host is asked.
 */

// 2024-03-14T12:00:00Z
const NOON = instant('1710417600000000000');
const LATER = instant('1710504000000000000');
const DATE = { dateStyle: 'long' } as const;
const MARCH_14 = plainDate(2024, 3, 14);

const under = (calendar: unknown): FormattingContext =>
  ({
    locale: 'en-US',
    timeZone: 'UTC',
    calendar,
  }) as FormattingContext;

/** Every formatter that writes a date, under one context and one set of options. */
const FORMATTERS: readonly (readonly [
  string,
  (
    context: FormattingContext,
    options: Intl.DateTimeFormatOptions,
  ) => FormattingResult,
])[] = [
  ['an instant', (context, options) => formatInstant(NOON, context, options)],
  [
    'a range of instants',
    (context, options) => formatInstantRange(NOON, LATER, context, options),
  ],
  [
    'a plain date',
    (context, options) => formatPlainDate(MARCH_14, context, options),
  ],
  [
    'a plain date-time',
    (context, options) =>
      formatPlainDateTime(
        plainDateTime(MARCH_14, plainTime(12, 0)),
        context,
        options,
      ),
  ],
  [
    'a zoned date-time',
    (context, options) =>
      formatZonedDateTime(zonedDateTime(NOON, 'UTC'), context, options),
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

const hostCalendar = (calendar: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    calendar,
  }).resolvedOptions().calendar;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the host this suite runs on', () => {
  it('answers a calendar it does not have with another and raises nothing', () => {
    expect(hostCalendar('zzzzzz')).toBe('gregory');
    expect(hostCalendar('islamicc')).toBe('islamic-civil');
    expect(hostCalendar('HEBREW')).toBe('hebrew');
  });
});

describe.each(FORMATTERS)('formatting %s', (_title, format) => {
  it('writes in a calendar of the context the host has', () => {
    const written = format(under('buddhist'), DATE);

    expect(written).toMatchObject({ ok: true });
    expect(written).not.toStrictEqual(format(under(undefined), DATE));
  });

  it.each(['zzzzzz', 'islamicc', 'ethiopic-amete-alem'])(
    'reports the calendar %s of the context, which the host answers with another',
    (calendar) => {
      expect(format(under(calendar), DATE)).toMatchObject(
        reported('native-capability-rejected'),
      );
    },
  );

  it.each([
    ['one character', 'x'],
    ['an upper-case spelling', 'HEBREW'],
    ['a subtag of nine characters', 'gregorian'],
    ['the empty name', ''],
    ['a space after the name', 'hebrew '],
    ['a number', 5],
    ['a list', ['hebrew']],
  ])(
    'refuses a calendar of the context written with %s, and builds no formatter',
    (_name, calendar) => {
      const built = vi.spyOn(Intl, 'DateTimeFormat');

      expect(format(under(calendar), DATE)).toMatchObject(
        reported('malformed-input'),
      );
      expect(built).not.toHaveBeenCalled();
    },
  );

  it('reports a calendar the call names, which the host answers with another', () => {
    expect(
      format(under(undefined), { ...DATE, calendar: 'zzzzzz' }),
    ).toMatchObject(reported('native-capability-rejected'));
    expect(
      format(under('buddhist'), { ...DATE, calendar: 'islamicc' }),
    ).toMatchObject(reported('native-capability-rejected'));
  });

  it('refuses a calendar the call names that is not written as one', () => {
    expect(
      format(under(undefined), { ...DATE, calendar: 'HEBREW' }),
    ).toMatchObject(reported('malformed-input'));
  });

  it('writes in the calendar the call names over one of the context the host lacks', () => {
    expect(
      format(under('zzzzzz'), { ...DATE, calendar: 'hebrew' }),
    ).toStrictEqual(format(under(undefined), { ...DATE, calendar: 'hebrew' }));
    expect(
      format(under('zzzzzz'), { ...DATE, calendar: 'hebrew' }),
    ).toMatchObject({ ok: true });
  });

  it('writes in the calendar of the locale where the context names iso8601', () => {
    expect(format(under('iso8601'), DATE)).toStrictEqual(
      format(under(undefined), DATE),
    );
    expect(format(under('iso8601'), DATE)).toMatchObject({ ok: true });
  });
});

describe('a table of dates under one calendar', () => {
  it('asks the host what the formatter counts in once, and not once for each date', () => {
    const asked = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');
    // A shape of options no other test builds, so the formatter is new to the cache.
    const options = {
      year: '2-digit',
      month: 'narrow',
      day: '2-digit',
    } as const;
    const context = under('buddhist');
    const written = new Set<string>();

    for (let day = 0; day < 10_000; day += 1) {
      const result = formatPlainDate(
        plainDate(2000 + (day % 400), 1 + (day % 12), 1 + (day % 28)),
        context,
        options,
      );
      if (result.ok) written.add(result.value.text);
    }

    expect(written.size).toBeGreaterThan(1_000);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('asks again for another formatter', () => {
    const asked = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');
    const options = {
      year: 'numeric',
      month: 'narrow',
      day: '2-digit',
    } as const;

    formatPlainDate(MARCH_14, under('buddhist'), options);
    formatPlainDate(MARCH_14, under('hebrew'), options);
    formatPlainDate(MARCH_14, under('hebrew'), options);

    expect(asked).toHaveBeenCalledTimes(2);
  });
});

describe('formatting a plain time', () => {
  const TIME = { hour: 'numeric', minute: 'numeric' } as const;

  it('is not held to a calendar of the context, which no time is counted in', () => {
    expect(
      formatPlainTime(plainTime(13, 5), under('zzzzzz'), TIME),
    ).toStrictEqual(formatPlainTime(plainTime(13, 5), under(undefined), TIME));
  });

  it('reports a calendar the call names, which the host answers with another', () => {
    expect(
      formatPlainTime(plainTime(13, 5), under(undefined), {
        ...TIME,
        calendar: 'zzzzzz',
      }),
    ).toMatchObject(reported('native-capability-rejected'));
  });

  it('refuses a calendar the call names that is not written as one', () => {
    expect(
      formatPlainTime(plainTime(13, 5), under(undefined), {
        ...TIME,
        calendar: 'HEBREW',
      }),
    ).toMatchObject(reported('malformed-input'));
  });
});

describe('a date written by a message', () => {
  const WHEN: readonly CompiledInputContract[] = Object.freeze([
    { name: 'd', type: 'date-time', optional: false, nullable: false },
  ]);
  const date = new Date(Date.UTC(2024, 2, 14, 12));
  const failure = (context: FormattingContext): LocalizationError => {
    let thrown: unknown;
    try {
      render('{$d :date}', WHEN, { d: date }, context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LocalizationError);
    return thrown as LocalizationError;
  };

  it('is written in a calendar of the context the host has', () => {
    expect(render('{$d :date}', WHEN, { d: date }, under('buddhist'))).not.toBe(
      render('{$d :date}', WHEN, { d: date }, under(undefined)),
    );
  });

  it('is written in the calendar of the locale where the context names iso8601, as a formatter writes it', () => {
    const named = render('{$d :date}', WHEN, { d: date }, under('iso8601'));

    expect(named).toBe(
      render('{$d :date}', WHEN, { d: date }, under(undefined)),
    );
    // The host has a calendar under the name, and writes a date in it another way.
    expect(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        calendar: 'iso8601',
        dateStyle: 'long',
      }).format(date),
    ).not.toBe(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        dateStyle: 'long',
      }).format(date),
    );
  });

  it('is written in iso8601 where the message names it', () => {
    expect(
      render(
        '{$d :date calendar=iso8601}',
        WHEN,
        { d: date },
        under('buddhist'),
      ),
    ).not.toBe(render('{$d :date}', WHEN, { d: date }, under('buddhist')));
    expect(
      render(
        '{$d :date calendar=iso8601}',
        WHEN,
        { d: date },
        under(undefined),
      ),
    ).toBe(
      render(
        '{$d :date calendar=iso8601}',
        WHEN,
        { d: date },
        under('buddhist'),
      ),
    );
  });

  it.each(['zzzzzz', 'islamicc'])(
    'reports the calendar %s of the context, which the host answers with another',
    (calendar) => {
      expect(failure(under(calendar)).diagnostic).toMatchObject({
        code: 'unsupported-formatting-capability',
        reason: 'native-capability-rejected',
      });
    },
  );

  it.each(['zzzzzz', 'islamicc'])(
    'reports the calendar %s the message names, which the host answers with another',
    (calendar) => {
      let thrown: unknown;
      try {
        render(
          `{$d :date calendar=${calendar}}`,
          WHEN,
          { d: date },
          under(undefined),
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(LocalizationError);
      expect((thrown as LocalizationError).diagnostic).toMatchObject({
        code: 'unsupported-formatting-capability',
        reason: 'native-capability-rejected',
      });
    },
  );

  it.each(['x', 'HEBREW', ''])(
    'refuses the calendar %j of the context, which is not written as one',
    (calendar) => {
      expect(failure(under(calendar)).diagnostic).toMatchObject({
        code: 'unsupported-formatting-capability',
        reason: 'malformed-input',
      });
    },
  );
});
