import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import { instant, zonedDateTime } from '../src/formatting.js';

/**
 * What `zonedDateTime` stores, and what it refuses.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 2 has every domain value normalized
 * where it is created. A zoned date-time is an instant, the zone it is read in and the calendar it
 * is counted in. The zone is a name of the pinned time-zone database and the calendar is a name
 * written as the standards write a calendar's, and neither is asked of the host: the same
 * arguments make the same value, or the same refusal, in every engine.
 */

// 2024-03-14T12:00:00Z
const NOON = instant('1710417600000000000');

function refusal(create: () => unknown): LocalizationError {
  let thrown: unknown;
  try {
    create();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LocalizationError);
  return thrown as LocalizationError;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a zoned date-time', () => {
  it('is counted in the ISO calendar where none is named', () => {
    expect(zonedDateTime(NOON, 'Asia/Tokyo')).toStrictEqual({
      kind: 'zoned-date-time',
      instant: NOON,
      timeZone: 'Asia/Tokyo',
      calendar: 'iso8601',
    });
  });

  it.each(['hebrew', 'islamic-civil', 'ethioaa', 'roc', 'gregory'])(
    'keeps the calendar %s it names',
    (calendar) => {
      expect(zonedDateTime(NOON, 'Asia/Tokyo', calendar)).toStrictEqual({
        kind: 'zoned-date-time',
        instant: NOON,
        timeZone: 'Asia/Tokyo',
        calendar,
      });
    },
  );

  it('is frozen', () => {
    expect(Object.isFrozen(zonedDateTime(NOON, 'Asia/Tokyo', 'hebrew'))).toBe(
      true,
    );
  });

  it('holds its zone under the primary identifier of the pinned database', () => {
    expect(zonedDateTime(NOON, 'asia/calcutta').timeZone).toBe('Asia/Kolkata');
    expect(zonedDateTime(NOON, 'Etc/GMT+5').timeZone).toBe('Etc/GMT+5');
  });

  // Whether a host counts in a calendar differs from host to host, and a value is stored and
  // exchanged between them. The name is kept, and a host that has no such calendar says so where
  // the value is formatted.
  it('keeps a well-formed calendar name whether or not the host has that calendar', () => {
    expect(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        calendar: 'zzzzzz',
      }).resolvedOptions().calendar,
    ).not.toBe('zzzzzz');

    expect(zonedDateTime(NOON, 'Asia/Tokyo', 'zzzzzz').calendar).toBe('zzzzzz');
    expect(zonedDateTime(NOON, 'Asia/Tokyo', 'abc-12345678').calendar).toBe(
      'abc-12345678',
    );
  });

  // A calendar's name is one or more subtags of three to eight lower-case ASCII letters and
  // digits, joined by hyphens.
  it.each([
    ['a subtag of one character', 'x'],
    ['a subtag of two characters', 'ab'],
    ['a subtag of nine characters', 'gregorian'],
    ['a second subtag of two characters', 'islamic-ci'],
    ['a second subtag of nine characters', 'islamic-civilcivi'],
    ['an upper-case spelling', 'HEBREW'],
    ['one upper-case letter', 'hebreW'],
    ['the empty name', ''],
    ['a hyphen with nothing after it', 'islamic-'],
    ['a hyphen with nothing before it', '-civil'],
    ['two hyphens together', 'islamic--civil'],
    ['an underscore for the hyphen', 'islamic_civil'],
    ['a space after the name', 'hebrew '],
    ['a space before the name', ' hebrew'],
    ['a line break after the name', 'hebrew\n'],
    ['a letter outside ASCII', `h${String.fromCodePoint(0xe9)}breu`],
    ['a locale extension', 'u-ca-hebrew'],
  ])('is refused where its calendar is written with %s', (_title, calendar) => {
    const failure = refusal(() => zonedDateTime(NOON, 'Asia/Tokyo', calendar));

    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
    expect(failure.diagnostic.reason).toBe('malformed-input');
    expect(Object.hasOwn(failure, 'cause')).toBe(false);
  });

  it('is refused where its calendar is not a string', () => {
    for (const calendar of [null, 5, ['hebrew'], { calendar: 'hebrew' }]) {
      expect(
        refusal(() => zonedDateTime(NOON, 'Asia/Tokyo', calendar as never))
          .diagnostic.reason,
      ).toBe('malformed-input');
    }
  });

  it.each([
    ['a name of no place', 'Mars/Olympus_Mons'],
    ['a clock offset', '+05:00'],
    ['the empty name', ''],
  ])('is refused where its zone is %s', (_title, zone) => {
    const failure = refusal(() => zonedDateTime(NOON, zone, 'hebrew'));

    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.reason).toBe('malformed-input');
    expect(Object.hasOwn(failure, 'cause')).toBe(false);
  });

  it('builds no host formatter, for a value it makes or a value it refuses', () => {
    const built = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new RangeError('The host was asked.');
    });

    expect(zonedDateTime(NOON, 'Europe/Kiev', 'hebrew')).toStrictEqual({
      kind: 'zoned-date-time',
      instant: NOON,
      timeZone: 'Europe/Kyiv',
      calendar: 'hebrew',
    });
    refusal(() => zonedDateTime(NOON, 'Europe/Kyiv', 'HEBREW'));
    refusal(() => zonedDateTime(NOON, 'Mars/Olympus_Mons', 'hebrew'));
    expect(built).not.toHaveBeenCalled();
  });
});
