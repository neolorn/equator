import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FormattingContext } from '@neolorn/equator/core';

import { compareLocalized } from '../src/formatting.js';

/**
 * What ordering two strings reports for a collation it was asked for and cannot order by.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 3 has an absent capability reported and
 * never approximated. A host asked for a collation it does not have, or one the locale does not
 * have, raises nothing and orders by the default of the locale, so the collation the collator
 * answers with is compared with the one asked for. A name that is not written as a collation's is
 * refused before the host is asked.
 */

const GERMAN: FormattingContext = { locale: 'de-DE' };
const SWEDISH: FormattingContext = { locale: 'sv-SE' };

const reported = (reason: string, locale: string) => ({
  ok: false,
  diagnostic: {
    code: 'unsupported-formatting-capability',
    outcome: 'operational-failure',
    targetLocale: locale,
    reason,
  },
});

const hostCollation = (locale: string, collation: string): string =>
  new Intl.Collator(locale, { collation } as never).resolvedOptions().collation;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the host this suite runs on', () => {
  it('answers a collation it cannot order by with the default and raises nothing', () => {
    expect(hostCollation('de-DE', 'phonebk')).toBe('phonebk');
    expect(hostCollation('de-DE', 'zzzzzz')).toBe('default');
    expect(hostCollation('de-DE', 'PHONEBK')).toBe('phonebk');
    // Swedish has no phonebook order.
    expect(hostCollation('sv-SE', 'phonebk')).toBe('default');
  });
});

describe('ordering two strings by a collation the call names', () => {
  it('orders by a collation the host has for the locale', () => {
    // The phonebook order reads the umlaut as the vowel followed by e, so it sorts after "ad".
    // The host orders German of Germany by the data of German, and the answer says so.
    expect(
      compareLocalized('ä', 'ad', GERMAN, { collation: 'phonebk' }),
    ).toStrictEqual({ ok: true, value: 1, language: 'de' });
    expect(compareLocalized('ä', 'ad', GERMAN)).toStrictEqual({
      ok: true,
      value: -1,
      language: 'de',
    });
  });

  it.each([
    ['a collation no host has', 'zzzzzz', GERMAN],
    ['a collation the locale does not have', 'phonebk', SWEDISH],
    [
      'the name of the default, which is not a collation to ask for',
      'standard',
      GERMAN,
    ],
  ])(
    'reports %s, which the host answers with another',
    (_title, collation, context) => {
      expect(
        compareLocalized('ä', 'ad', context, { collation } as never),
      ).toMatchObject(reported('native-capability-rejected', context.locale));
    },
  );

  it.each([
    ['an upper-case spelling', 'PHONEBK'],
    ['one character', 'x'],
    ['a subtag of nine characters', 'phonebook'],
    ['the empty name', ''],
    ['a number', 5],
  ])(
    'refuses a collation written with %s, and builds no collator',
    (_title, collation) => {
      const built = vi.spyOn(Intl, 'Collator');

      expect(
        compareLocalized('ä', 'ad', GERMAN, { collation } as never),
      ).toMatchObject(reported('malformed-input', 'de-DE'));
      expect(built).not.toHaveBeenCalled();
    },
  );

  it('asks the host what a collator orders by once, and not once for each comparison', () => {
    const asked = vi.spyOn(Intl.Collator.prototype, 'resolvedOptions');
    // A shape of options no other test builds, so the collator is new to the cache.
    const options = { collation: 'phonebk', sensitivity: 'base' } as const;

    const names = ['Müller', 'Mueller', 'Muller', 'Möller', 'Moeller'];
    const sorted = [...names].sort((left, right) => {
      const order = compareLocalized(left, right, GERMAN, options);
      return order.ok ? order.value : 0;
    });

    expect(sorted).toHaveLength(5);
    expect(asked).toHaveBeenCalledTimes(1);
  });
});
