import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  canonicalizeLanguageTag,
  type FormattingContext,
} from '@neolorn/equator/core';

import {
  compareLocalized,
  decimal,
  duration,
  formatDisplayName,
  formatDuration,
  formatInstant,
  formatList,
  formatNumber,
  formatRelativeTime,
  instant,
  segmentText,
  selectPlural,
} from '../src/formatting.js';
import { LIKELY_SCRIPTS } from '../src/likely-scripts.generated.js';

/**
 * The runtime's likely-script table against the pinned likely subtags it is drawn from.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 4. The runtime holds the likely script
 * of the languages CLDR has locale data or plural rules for and not of every language the pinned
 * likely subtags list, because a host's data is drawn from CLDR's: a formatting locale in another
 * language reaches no locale the host has, whichever parent it takes, so its script is never
 * compared and the rule that sends a language in an unusual script to root changes nothing for
 * it. The sweep asks the host itself, so a host that gained a language the table lacks fails here
 * and the table grows to hold it. A code CLDR keeps likely subtags for although it is an alias,
 * `iw` for `he`, is canonicalized before the chain is walked, so it is held where its canonical
 * language is.
 */

const require = createRequire(import.meta.url);
const likelySubtags = (
  JSON.parse(
    readFileSync(
      require.resolve('cldr-core/supplemental/likelySubtags.json'),
      'utf8',
    ),
  ) as { supplemental: { likelySubtags: Record<string, string> } }
).supplemental.likelySubtags;

const held = new Map(
  Object.entries(LIKELY_SCRIPTS).flatMap(([script, tags]) =>
    tags.split(' ').map((tag) => [tag, script] as const),
  ),
);

const pinnedLanguages = Object.keys(likelySubtags).filter(
  (key) => !key.includes('-') && key !== 'und',
);
const absent = pinnedLanguages.filter(
  (language) =>
    !held.has(
      new Intl.Locale(canonicalizeLanguageTag(language) ?? language).language,
    ),
);

const lookup = { localeMatcher: 'lookup' } as const;
const CONSTRUCTORS: readonly (readonly [
  string,
  (tag: string) => { resolvedOptions(): { locale: string } },
])[] = [
  ['NumberFormat', (tag) => new Intl.NumberFormat(tag, lookup)],
  ['DateTimeFormat', (tag) => new Intl.DateTimeFormat(tag, lookup)],
  ['PluralRules', (tag) => new Intl.PluralRules(tag, lookup)],
  ['RelativeTimeFormat', (tag) => new Intl.RelativeTimeFormat(tag, lookup)],
  ['ListFormat', (tag) => new Intl.ListFormat(tag, lookup)],
  [
    'DisplayNames',
    (tag) => new Intl.DisplayNames(tag, { type: 'region', ...lookup }),
  ],
  ['Collator', (tag) => new Intl.Collator(tag, lookup)],
  ['Segmenter', (tag) => new Intl.Segmenter(tag, lookup)],
  [
    'DurationFormat',
    (tag) =>
      new (
        Intl as unknown as {
          DurationFormat: new (
            tag: string,
            options: object,
          ) => { resolvedOptions(): { locale: string } };
        }
      ).DurationFormat(tag, lookup),
  ],
];

const at = (locale: string): FormattingContext =>
  Object.freeze({ locale, timeZone: 'UTC' });

const OPERATIONS: readonly (readonly [
  string,
  (context: FormattingContext) => { ok: boolean },
])[] = [
  ['formatNumber', (c) => formatNumber(decimal('1234.5'), c)],
  [
    'formatInstant',
    (c) =>
      formatInstant(instant('1710417600000000000'), c, { dateStyle: 'full' }),
  ],
  ['formatRelativeTime', (c) => formatRelativeTime(decimal('-2'), 'day', c)],
  ['formatList', (c) => formatList(['a', 'b'], c)],
  ['formatDisplayName', (c) => formatDisplayName('DE', c, { type: 'region' })],
  ['formatDuration', (c) => formatDuration(duration({ hours: 2 }), c)],
  ['selectPlural', (c) => selectPlural(decimal('2'), c)],
  ['compareLocalized', (c) => compareLocalized('a', 'b', c)],
  ['segmentText', (c) => segmentText('a b', c)],
];

describe('the likely-script table of the runtime', () => {
  it('agrees with the pinned likely subtags on every tag it holds', () => {
    expect(held.size).toBeGreaterThan(0);
    const disagreeing = [...held].filter(
      ([tag, script]) => likelySubtags[tag]?.split('-')[1] !== script,
    );
    expect(disagreeing).toEqual([]);
  });

  it('leaves out only languages the host has no locale for, under every constructor', () => {
    // The sweep is only evidence where it can find something: a language the table holds must be
    // one the host answers with, and `held` is drawn from the same list.
    expect(new Intl.NumberFormat('de', lookup).resolvedOptions().locale).toBe(
      'de',
    );
    expect(absent.length).toBeGreaterThan(6_000);
    const hostHas = absent.flatMap((language) =>
      CONSTRUCTORS.filter(
        ([, build]) => build(language).resolvedOptions().locale === language,
      ).map(([name]) => `${language} ${name}`),
    );
    expect(hostHas).toEqual([]);
  });

  it('returns the typed unsupported result for every language it leaves out', () => {
    const answered = absent.flatMap((language) =>
      OPERATIONS.filter(([, operate]) => operate(at(language)).ok).map(
        ([name]) => `${language} ${name}`,
      ),
    );
    expect(answered).toEqual([]);
  });
});
