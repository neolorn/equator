import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  type FormattingContext,
  type FormattingResult,
} from '@neolorn/equator/core';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import {
  formatInstant,
  formatInstantRange,
  instant,
} from '../src/formatting.js';
import { render } from './message-harness.js';

/**
 * A time zone an operation, the context or a message variable names is judged by the host where a
 * date is formatted, by the three routes alike.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4: a name the host does not read as a
 * zone is the typed unsupported result, and a name the host reads, an alias, a link, another
 * spelling or a clock offset, is written in the zone the host reads it as, never in another. The
 * message path carries no time-zone table, so nothing on it judges a name except the host.
 *
 * No CLDR string is pinned: a name and the name it is an alias of must write the same text, and a
 * zone with another offset must not.
 */

const NOON = instant('1710417600000000000');
const LATER = instant('1710504000000000000');
const OPTIONS = { dateStyle: 'medium', timeStyle: 'long' } as const;
const UNREAD = 'Nowhere/Nowhere';

const WHEN: readonly CompiledInputContract[] = Object.freeze([
  { name: 'd', type: 'date-time', optional: false, nullable: false },
]);
const WHEN_IN: readonly CompiledInputContract[] = Object.freeze([
  ...WHEN,
  { name: 'tz', type: 'string', optional: false, nullable: false },
]);
const D = new Date(Date.UTC(2024, 2, 14, 12));

const under = (timeZone: string): FormattingContext =>
  Object.freeze({ locale: 'en-US', timeZone });
const PLAIN = under('UTC');

/** The three routes, each writing the same moment in the zone it is given. */
const ROUTES: readonly (readonly [string, (zone: string) => string])[] = [
  [
    'a call option',
    (zone) =>
      textOf(formatInstant(NOON, PLAIN, { ...OPTIONS, timeZone: zone })),
  ],
  ['the context', (zone) => textOf(formatInstant(NOON, under(zone), OPTIONS))],
  [
    'a call option on a range',
    (zone) =>
      textOf(
        formatInstantRange(NOON, LATER, PLAIN, { ...OPTIONS, timeZone: zone }),
      ),
  ],
  [
    'the context of a range',
    (zone) => textOf(formatInstantRange(NOON, LATER, under(zone), OPTIONS)),
  ],
  [
    'the context of a message',
    (zone) =>
      render(
        '{$d :datetime timePrecision=minute}',
        WHEN,
        { d: D },
        under(zone),
      ),
  ],
  [
    'a message variable',
    (zone) =>
      render(
        '{$d :datetime timeZone=$tz timePrecision=minute}',
        WHEN_IN,
        { d: D, tz: zone },
        PLAIN,
      ),
  ],
];

function textOf(result: FormattingResult): string {
  if (!result.ok) {
    throw new LocalizationError(result.diagnostic);
  }
  return result.value.text;
}

function refusal(write: () => string): unknown {
  try {
    write();
  } catch (error) {
    return error instanceof LocalizationError
      ? {
          code: error.diagnostic.code,
          reason: error.diagnostic.reason,
        }
      : error;
  }
  return 'written';
}

describe('a time zone the host judges', () => {
  for (const [route, write] of ROUTES) {
    describe(`named by ${route}`, () => {
      it('is the typed unsupported result where the host does not read the name', () => {
        expect(refusal(() => write(UNREAD))).toEqual({
          code: 'unsupported-formatting-capability',
          reason: 'native-capability-rejected',
        });
      });

      it.each([
        ['Asia/Calcutta', 'Asia/Kolkata'],
        ['Europe/Kiev', 'Europe/Kyiv'],
        ['Etc/UTC', 'UTC'],
        ['europe/paris', 'Europe/Paris'],
        ['+05:00', 'Etc/GMT-5'],
      ])(
        'writes %s in the zone the host reads it as, the zone of %s',
        (name, zone) => {
          expect(write(name)).toBe(write(zone));
        },
      );

      it('writes a zone of another offset differently, so the comparison can fail', () => {
        expect(write('+05:00')).not.toBe(write('UTC'));
      });
    });
  }
});
