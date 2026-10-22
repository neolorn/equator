import { afterEach, describe, expect, it, vi } from 'vitest';

import { type FormattingContext } from '@neolorn/equator/core';

import {
  formatZonedDateTime,
  instant,
  zonedDateTime,
} from '../src/formatting.js';

/**
 * What formatting a zoned date-time reports where the host cannot do what the value asks.
 *
 * A zoned date-time is made without the host: its zone is a name of the pinned time-zone database
 * and its calendar is a well-formed name. Whether this host has rules for that zone and counts in
 * that calendar is found where the value is formatted, and
 * `specs/08-formatting-parsing-and-domain.spec.md` section 3 has an absent capability reported as
 * a typed unsupported result and never approximated. A host asked for a calendar it does not have
 * formats in the locale's own without an error, which is the approximation.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

// 2024-03-14T12:00:00Z
const NOON_MILLISECONDS = 1_710_417_600_000;
const NOON = instant('1710417600000000000');
const DATE = { dateStyle: 'long' } as const;

const UNSUPPORTED = {
  ok: false,
  diagnostic: {
    code: 'unsupported-formatting-capability',
    outcome: 'operational-failure',
    targetLocale: 'en-US',
    reason: 'native-capability-rejected',
  },
};

const hostText = (options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat('en-US', options).format(NOON_MILLISECONDS);

const hostCalendar = (calendar: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    calendar,
  }).resolvedOptions().calendar;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatting a zoned date-time in the calendar it names', () => {
  it('counts in a calendar the host has', () => {
    const result = formatZonedDateTime(
      zonedDateTime(NOON, 'Asia/Tokyo', 'hebrew'),
      EN,
      DATE,
    );
    const expected = hostText({
      ...DATE,
      timeZone: 'Asia/Tokyo',
      calendar: 'hebrew',
    });

    expect(expected).not.toBe(hostText({ ...DATE, timeZone: 'Asia/Tokyo' }));
    expect(result).toMatchObject({ ok: true, value: { text: expected } });
  });

  it('reports a calendar the host does not have and formats nothing in another', () => {
    // The host takes the name without an error and answers with the calendar of the locale.
    expect(hostCalendar('zzzzzz')).toBe('gregory');

    expect(
      formatZonedDateTime(
        zonedDateTime(NOON, 'Asia/Tokyo', 'zzzzzz'),
        EN,
        DATE,
      ),
    ).toMatchObject(UNSUPPORTED);
  });

  it('reports a calendar the host knows by another name', () => {
    // The value says which calendar it is counted in by one name, and the host answers to this
    // spelling with another, so the two could not be compared.
    expect(hostCalendar('islamicc')).toBe('islamic-civil');

    expect(
      formatZonedDateTime(
        zonedDateTime(NOON, 'Asia/Tokyo', 'islamicc'),
        EN,
        DATE,
      ),
    ).toMatchObject(UNSUPPORTED);
  });

  it('reports the calendar under the locale the caller asked for', () => {
    expect(
      formatZonedDateTime(
        zonedDateTime(NOON, 'Asia/Tokyo', 'zzzzzz'),
        { locale: 'ar-EG' },
        DATE,
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { ...UNSUPPORTED.diagnostic, targetLocale: 'ar-EG' },
    });
  });

  it('formats an ISO value in the calendar of the locale', () => {
    const result = formatZonedDateTime(
      zonedDateTime(NOON, 'Asia/Tokyo'),
      { locale: 'th-TH' },
      DATE,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        text: new Intl.DateTimeFormat('th-TH', {
          ...DATE,
          timeZone: 'Asia/Tokyo',
        }).format(NOON_MILLISECONDS),
      },
    });
  });

  it('formats an ISO value in the calendar of the context', () => {
    const result = formatZonedDateTime(
      zonedDateTime(NOON, 'Asia/Tokyo'),
      { locale: 'en-US', calendar: 'hebrew' },
      DATE,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        text: hostText({ ...DATE, timeZone: 'Asia/Tokyo', calendar: 'hebrew' }),
      },
    });
  });

  // The call's options are the narrowest layer, so a calendar written there is the one asked for
  // and the value's is not what the host is held to.
  it('formats in the calendar the call names over the value', () => {
    const result = formatZonedDateTime(
      zonedDateTime(NOON, 'Asia/Tokyo', 'zzzzzz'),
      EN,
      { ...DATE, calendar: 'hebrew' },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        text: hostText({ ...DATE, timeZone: 'Asia/Tokyo', calendar: 'hebrew' }),
      },
    });
  });
});

describe('formatting a zoned date-time in a zone the host has no rules for', () => {
  it('reports the zone and does not throw', () => {
    const Native = Intl.DateTimeFormat;
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      if (options?.timeZone === 'Etc/GMT+7') {
        throw new RangeError('Invalid time zone specified: Etc/GMT+7');
      }
      return new Native(locales, options);
    } as never);

    expect(
      formatZonedDateTime(zonedDateTime(NOON, 'Etc/GMT+7'), EN, {
        dateStyle: 'full',
        timeStyle: 'full',
      }),
    ).toMatchObject(UNSUPPORTED);
  });
});
