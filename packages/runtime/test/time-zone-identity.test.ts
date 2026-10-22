import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import { timeZone } from '../src/formatting.js';

/**
 * A stored zone identity is compared, persisted and exchanged, so the spelling that comes back has
 * to be the pinned time-zone database's own and not whatever the host's presentation data prefers.
 * The pairs are names of the pinned release: zones, former names that survive only as links in its
 * `backward` file, links its `zone.tab` still lists for a country, former names the release
 * links across a border, and the zones of its `etcetera` file, which belong to no country.
 */

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

const ZONES = ['Asia/Kolkata', 'Europe/Kyiv', 'Asia/Ho_Chi_Minh'] as const;
const LINKS = [
  ['Asia/Calcutta', 'Asia/Kolkata'],
  ['Europe/Kiev', 'Europe/Kyiv'],
  ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
  ['US/Pacific', 'America/Los_Angeles'],
] as const;

describe('a time-zone identity', () => {
  it.each(ZONES)('keeps the database zone %s as it is', (id) => {
    expect(timeZone(id).id).toBe(id);
  });

  it.each(LINKS)('resolves the link %s to the zone %s', (link, zone) => {
    expect(timeZone(link).id).toBe(zone);
  });

  // The release links both to a neighbor that has kept the same clock since 1970, and zone.tab
  // still lists each for its own country. Following the link would store Norway's zone as
  // Germany's.
  it.each(['Europe/Oslo', 'Africa/Accra', 'America/Atikokan'])(
    'keeps %s, which its country still calls its own',
    (id) => {
      expect(timeZone(id).id).toBe(id);
    },
  );

  // Each line carries the name the link stands for in a "#=" comment, because the data refrains
  // from linking to a link.
  it.each([
    ['Africa/Asmera', 'Africa/Asmara'],
    ['Iceland', 'Atlantic/Reykjavik'],
    ['Pacific/Truk', 'Pacific/Chuuk'],
  ])(
    'resolves %s to %s, the name its line says it stands for',
    (link, zone) => {
      expect(timeZone(link).id).toBe(zone);
    },
  );

  // The release links each to a zone of another country. Mali, and Svalbard and Jan Mayen, have
  // one zone.tab line each; Canada, Antarctica and Micronesia have several, so the answer is the
  // name the release's `backzone` file says the former name stood for.
  it.each([
    ['Africa/Timbuktu', 'Africa/Bamako'],
    ['Atlantic/Jan_Mayen', 'Arctic/Longyearbyen'],
    ['America/Coral_Harbour', 'America/Atikokan'],
    ['Antarctica/South_Pole', 'Antarctica/McMurdo'],
    ['Pacific/Yap', 'Pacific/Chuuk'],
  ])(
    'resolves the former name %s inside its own country, to %s',
    (link, zone) => {
      expect(timeZone(link).id).toBe(zone);
    },
  );

  it.each(['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT', 'Greenwich'])(
    'reads %s as UTC',
    (id) => {
      expect(timeZone(id).id).toBe('UTC');
    },
  );

  it('matches a name without regard to case and answers in the database spelling', () => {
    expect(timeZone('asia/calcutta').id).toBe('Asia/Kolkata');
    expect(timeZone('EUROPE/OSLO').id).toBe('Europe/Oslo');
  });

  // The release's fixed offsets run from fourteen hours ahead of UTC to twelve behind, and the
  // sign in the name is the reverse of the offset's.
  it.each(['Etc/GMT+5', 'Etc/GMT-14', 'Etc/GMT+12', 'Etc/GMT-1'])(
    'keeps the fixed offset %s, a zone of the release',
    (id) => {
      expect(timeZone(id).id).toBe(id);
      expect(timeZone(id.toLowerCase()).id).toBe(id);
    },
  );

  it.each(['Etc/GMT+0', 'Etc/GMT-0', 'GMT0'])('reads %s as UTC', (id) => {
    expect(timeZone(id).id).toBe('UTC');
  });

  // Each is a name some host formats in or lists, and none is a name of the release: a clock
  // offset is not a zone name, the release has no zone thirteen hours behind UTC, and Factory
  // stands for a clock nobody has set.
  it.each([
    ['a name of no place', 'Mars/Olympus_Mons'],
    ['a clock offset', '+05:00'],
    ['a fixed offset the release has no zone for', 'Etc/GMT+13'],
    ['the zone of an unset clock', 'Factory'],
    ['the empty name', ''],
    ['a name with a space after it', 'Europe/Paris '],
  ])('refuses %s', (_title, id) => {
    const failure = refusal(() => timeZone(id));

    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
    expect(failure.diagnostic.reason).toBe('malformed-input');
    expect(Object.hasOwn(failure, 'cause')).toBe(false);
  });

  // The Kelvin sign lower-cases to the letter k, and it is not a letter of any zone's name.
  it('matches case over the ASCII letters only', () => {
    const kelvin = `Asia/${String.fromCodePoint(0x212a)}olkata`;

    expect(kelvin.toLowerCase()).toBe('asia/kolkata');
    expect(refusal(() => timeZone(kelvin)).diagnostic.reason).toBe(
      'malformed-input',
    );
  });

  it('refuses what is not a string as it refuses a name', () => {
    for (const id of [undefined, null, 5, ['UTC'], { id: 'UTC' }]) {
      expect(refusal(() => timeZone(id as never)).diagnostic.reason).toBe(
        'malformed-input',
      );
    }
  });

  // The identity is the pinned release's on every host, so the host is not asked: a host with
  // older or newer zone data than the release would answer differently from its neighbor.
  it('builds no host formatter, for a name it keeps or a name it refuses', () => {
    const built = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new RangeError('The host was asked.');
    });

    expect(timeZone('Asia/Calcutta').id).toBe('Asia/Kolkata');
    expect(timeZone('Etc/GMT+5').id).toBe('Etc/GMT+5');
    refusal(() => timeZone('Mars/Olympus_Mons'));
    expect(built).not.toHaveBeenCalled();
  });
});
