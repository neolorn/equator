import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import { FormatterCache } from '../src/evaluator.js';
import { RUNTIME_LIMITS } from '../src/runtime-safety.js';

/**
 * One bounded store for every kind of `Intl` formatter the evaluator builds.
 *
 * `specs/12-verification.spec.md` section 11 asks for a cost to be verified by a count the machine
 * cannot change. For this store the count is which object comes back: the same formatter for the
 * same request, a different one for a different request, and the least recently used one gone
 * when the store is over its capacity. Output alone cannot show any of the three, because a store
 * that misses every time formats exactly as well as one that hits.
 */

interface Formatter {
  resolvedOptions(): object;
}

interface FormatterKind {
  readonly name: string;
  readonly type: abstract new (...parameters: never[]) => object;
  /** Three requests to one kind that no two of which may share an entry. */
  readonly request: (
    cache: FormatterCache,
    locale: string,
    shape: 0 | 1 | 2,
  ) => Formatter;
  readonly direct: (locale: string, shape: 0 | 1 | 2) => Formatter;
}

const kindOf = <Options extends object>(
  name: string,
  type: new (locale: string, options: Options) => Formatter,
  shapes: readonly [Options, Options, Options],
  request: (
    cache: FormatterCache,
    locale: string,
    options: Options,
  ) => Formatter,
): FormatterKind => ({
  name,
  type,
  request: (cache, locale, shape) => request(cache, locale, shapes[shape]),
  direct: (locale, shape) => new type(locale, shapes[shape]),
});

const KINDS: readonly FormatterKind[] = [
  kindOf<Intl.NumberFormatOptions>(
    'number',
    Intl.NumberFormat,
    [{}, { minimumFractionDigits: 2 }, { style: 'percent' }],
    (cache, locale, options) => cache.number(locale, options),
  ),
  kindOf<Intl.DateTimeFormatOptions>(
    'dateTime',
    Intl.DateTimeFormat,
    [
      { timeZone: 'UTC' },
      { timeZone: 'Asia/Tokyo' },
      { timeZone: 'UTC', hour12: true, hour: 'numeric' },
    ],
    (cache, locale, options) => cache.dateTime(locale, options),
  ),
  kindOf<Intl.PluralRulesOptions>(
    'plural',
    Intl.PluralRules,
    [
      { type: 'cardinal' },
      { type: 'ordinal' },
      { type: 'cardinal', minimumFractionDigits: 2 },
    ],
    (cache, locale, options) => cache.plural(locale, options),
  ),
  kindOf<Intl.ListFormatOptions>(
    'list',
    Intl.ListFormat,
    [{ type: 'conjunction' }, { type: 'disjunction' }, { type: 'unit' }],
    (cache, locale, options) => cache.list(locale, options),
  ),
  kindOf<Intl.RelativeTimeFormatOptions>(
    'relativeTime',
    Intl.RelativeTimeFormat,
    [{ numeric: 'always' }, { numeric: 'auto' }, { style: 'short' }],
    (cache, locale, options) => cache.relativeTime(locale, options),
  ),
  kindOf<Intl.DisplayNamesOptions>(
    'displayNames',
    Intl.DisplayNames,
    [{ type: 'region' }, { type: 'language' }, { type: 'currency' }],
    (cache, locale, options) => cache.displayNames(locale, options),
  ),
  kindOf<Intl.CollatorOptions>(
    'collator',
    Intl.Collator,
    [{ sensitivity: 'base' }, { sensitivity: 'accent' }, { numeric: true }],
    (cache, locale, options) => cache.collator(locale, options),
  ),
  kindOf<Intl.SegmenterOptions>(
    'segmenter',
    Intl.Segmenter,
    [
      { granularity: 'grapheme' },
      { granularity: 'word' },
      { granularity: 'sentence' },
    ],
    (cache, locale, options) => cache.segmenter(locale, options),
  ),
];

const refusalOf = (run: () => unknown): LocalizationError => {
  try {
    run();
  } catch (error) {
    if (error instanceof LocalizationError) return error;
    throw error;
  }
  throw new Error('Expected a refusal and nothing was thrown.');
};

describe('the capacity a formatter store is built with', () => {
  it.each([1, 2, RUNTIME_LIMITS.formatterCacheEntries])(
    'accepts a capacity of %d',
    (capacity) => {
      expect(new FormatterCache(capacity)).toBeInstanceOf(FormatterCache);
    },
  );

  it.each([
    ['zero', 0],
    ['a negative count', -1],
    ['a fraction', 1.5],
    ['a fraction below one', 0.5],
    ['one past the runtime ceiling', RUNTIME_LIMITS.formatterCacheEntries + 1],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['an integer no double holds exactly', 2 ** 53],
  ])('refuses %s', (_label, capacity) => {
    const failure = refusalOf(() => new FormatterCache(capacity));
    expect(failure.diagnostic.code).toBe('invalid-configuration');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
  });
});

describe.each(KINDS)('the $name formatters a store holds', (kind) => {
  it('builds the formatter the locale and options ask for', () => {
    const cache = new FormatterCache(8);
    for (const shape of [0, 1, 2] as const) {
      const formatter = kind.request(cache, 'fr-FR', shape);
      expect(formatter).toBeInstanceOf(kind.type);
      expect(formatter.resolvedOptions()).toEqual(
        kind.direct('fr-FR', shape).resolvedOptions(),
      );
    }
  });

  it('returns the formatter it already built for the same request', () => {
    const cache = new FormatterCache(8);
    const first = kind.request(cache, 'en-US', 0);
    expect(kind.request(cache, 'en-US', 0)).toBe(first);
  });

  it('keeps requests that differ in locale or options apart', () => {
    const cache = new FormatterCache(8);
    const english = kind.request(cache, 'en-US', 0);
    const german = kind.request(cache, 'de-DE', 0);
    const other = kind.request(cache, 'en-US', 1);
    expect(german).not.toBe(english);
    expect(other).not.toBe(english);
    expect(german.resolvedOptions()).toEqual(
      kind.direct('de-DE', 0).resolvedOptions(),
    );
    expect(other.resolvedOptions()).toEqual(
      kind.direct('en-US', 1).resolvedOptions(),
    );
    // And asking again still finds each one, so the three are three entries and not one replaced.
    expect(kind.request(cache, 'en-US', 0)).toBe(english);
    expect(kind.request(cache, 'de-DE', 0)).toBe(german);
    expect(kind.request(cache, 'en-US', 1)).toBe(other);
  });

  it('drops the entry nothing asked for and keeps the one that was just read', () => {
    const cache = new FormatterCache(2);
    const kept = kind.request(cache, 'en-US', 0);
    const dropped = kind.request(cache, 'en-US', 1);
    // Reading the first again makes the second the least recently used of the two.
    expect(kind.request(cache, 'en-US', 0)).toBe(kept);
    kind.request(cache, 'en-US', 2);
    expect(kind.request(cache, 'en-US', 0)).toBe(kept);
    expect(kind.request(cache, 'en-US', 1)).not.toBe(dropped);
  });

  it('holds no more than its capacity', () => {
    const cache = new FormatterCache(1);
    const first = kind.request(cache, 'en-US', 0);
    kind.request(cache, 'en-US', 1);
    expect(kind.request(cache, 'en-US', 0)).not.toBe(first);
  });
});

describe('what makes two requests the same request', () => {
  it('ignores the order the options were written in', () => {
    const cache = new FormatterCache(8);
    const entries: readonly (readonly [string, unknown])[] = [
      ['minimumFractionDigits', 1],
      ['maximumFractionDigits', 3],
      ['useGrouping', false],
    ];
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const formatters = orders.map((order) =>
      cache.number(
        'en-US',
        Object.fromEntries(order.map((index) => entries[index]!)),
      ),
    );
    for (const formatter of formatters) {
      expect(formatter).toBe(formatters[0]);
    }
  });

  it('ignores the order of more options than any formatter reads', () => {
    const cache = new FormatterCache(8);
    // Names `Intl.NumberFormat` does not read, so only the store's own comparison is exercised.
    const names = Array.from(
      { length: 48 },
      (_, index) => `option${String(index).padStart(2, '0')}`,
    );
    const ascending = Object.fromEntries(names.map((name) => [name, name]));
    const descending = Object.fromEntries(
      [...names].reverse().map((name) => [name, name]),
    );
    const interleaved = Object.fromEntries(
      [
        ...names.filter((_, index) => index % 2 === 1),
        ...names.filter((_, index) => index % 2 === 0).reverse(),
      ].map((name) => [name, name]),
    );
    const first = cache.number('en-US', ascending);
    expect(cache.number('en-US', descending)).toBe(first);
    expect(cache.number('en-US', interleaved)).toBe(first);
  });

  it('tells two values of one option apart', () => {
    const cache = new FormatterCache(8);
    const two = cache.number('en-US', { minimumFractionDigits: 2 });
    const three = cache.number('en-US', { minimumFractionDigits: 3 });
    expect(two).not.toBe(three);
    expect(two.format(1)).toBe('1.00');
    expect(three.format(1)).toBe('1.000');
  });

  it('gives each kind its own formatter for one locale and one set of options', () => {
    const cache = new FormatterCache(8);
    expect(cache.number('en-US', {})).toBeInstanceOf(Intl.NumberFormat);
    expect(cache.plural('en-US', {})).toBeInstanceOf(Intl.PluralRules);
    expect(cache.collator('en-US', {})).toBeInstanceOf(Intl.Collator);
    expect(cache.segmenter('en-US', {})).toBeInstanceOf(Intl.Segmenter);
    expect(cache.list('en-US', {})).toBeInstanceOf(Intl.ListFormat);
    expect(cache.relativeTime('en-US', {})).toBeInstanceOf(
      Intl.RelativeTimeFormat,
    );
    expect(cache.dateTime('en-US', {})).toBeInstanceOf(Intl.DateTimeFormat);
    expect(cache.number('en-US', {}).format(1234.5)).toBe('1,234.5');
    expect(cache.plural('en-US', {}).select(1)).toBe('one');
  });
});
