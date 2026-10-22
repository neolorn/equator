import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  type FormattingContext,
  type FormattingResult,
  type LocaleCapabilityResult,
  type LocalizedParts,
} from '@neolorn/equator/core';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import {
  compareLocalized,
  decimal,
  duration,
  formatDisplayName,
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
  segmentText,
  selectPlural,
  zonedDateTime,
} from '../src/formatting.js';
import { evaluateArtifact, refusalOf } from './compiled-artifact-harness.js';
import { parse, render } from './message-harness.js';

/**
 * A formatting locale the host has no data for, and a keyword of its tag the host drops.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4. A host asked for a locale it does
 * not have raises nothing and writes in a prefix it has, or in its own default locale, so the
 * same tag would be written in another language on another machine. The pinned parent chain is
 * walked instead, to the first locale the host has, and that locale is reported; where none is,
 * the result is the typed unsupported one.
 *
 * The locales are chosen from what every supported Node line's ICU carries and lacks: `tlh` and
 * `la` are in no ICU locale list, `de-AQ` names a region no German locale has, `ht` is absent
 * while its pinned parent `fr-HT` is present, and `az-Arab` takes root as its pinned parent,
 * which the host would answer with the Latin-script `az`. Plural rules, collation and
 * segmentation inherit through components of their own, where `az-Arab` takes `az`, so for them
 * it is answered and reported as a fallback. Texts are compared with the text the locale that
 * answers writes, so no CLDR string is pinned.
 */

const NOON = instant('1710417600000000000');
const LATER = instant('1710504000000000000');
const N = decimal('1234.5');
const DATE = { dateStyle: 'full' } as const;

const at = (locale: string): FormattingContext =>
  Object.freeze({ locale, timeZone: 'UTC' });

type Operation = (context: FormattingContext) => FormattingResult;

/** Every formatter that takes a context, each writing one fixed value. */
const FORMATTERS: readonly (readonly [string, Operation])[] = [
  ['formatNumber', (c) => formatNumber(N, c)],
  ['formatMoney', (c) => formatMoney(money(N, 'EUR'), c)],
  [
    'formatMeasurement',
    (c) => formatMeasurement(measurement(N, 'kilometer'), c),
  ],
  ['formatPercent', (c) => formatPercent(percent(decimal('0.25')), c)],
  [
    'formatPercentagePoints',
    (c) => formatPercentagePoints(percentagePoints(decimal('2.5')), c),
  ],
  [
    'formatNumberRange',
    (c) => formatNumberRange(decimal('3'), decimal('5'), c),
  ],
  ['formatInstant', (c) => formatInstant(NOON, c, DATE)],
  ['formatInstantRange', (c) => formatInstantRange(NOON, LATER, c, DATE)],
  ['formatPlainDate', (c) => formatPlainDate(plainDate(2024, 3, 14), c, DATE)],
  ['formatPlainTime', (c) => formatPlainTime(plainTime(13, 5), c)],
  [
    'formatPlainDateTime',
    (c) =>
      formatPlainDateTime(
        plainDateTime(plainDate(2024, 3, 14), plainTime(13, 5)),
        c,
      ),
  ],
  [
    'formatZonedDateTime',
    (c) => formatZonedDateTime(zonedDateTime(NOON, 'Europe/Paris'), c, DATE),
  ],
  [
    'formatDuration',
    (c) => formatDuration(duration({ hours: 2, minutes: 5 }), c),
  ],
  ['formatRelativeTime', (c) => formatRelativeTime(decimal('-2'), 'day', c)],
  ['formatList', (c) => formatList(['a', 'b', 'c'], c)],
  ['formatDisplayName', (c) => formatDisplayName('DE', c, { type: 'region' })],
];

const CAPABILITIES: readonly (readonly [
  string,
  (context: FormattingContext) => LocaleCapabilityResult<unknown>,
])[] = [
  ['selectPlural', (c) => selectPlural(decimal('2'), c)],
  [
    'selectPlural ordinal',
    (c) => selectPlural(decimal('2'), c, { type: 'ordinal' }),
  ],
  ['compareLocalized', (c) => compareLocalized('a', 'b', c)],
  ['segmentText', (c) => segmentText('a b', c, { granularity: 'word' })],
];

const refused = {
  code: 'unsupported-formatting-capability',
  reason: 'native-capability-rejected',
};

function written(result: FormattingResult): { text: string; language: string } {
  if (!result.ok) throw new LocalizationError(result.diagnostic);
  return { text: result.value.text, language: result.value.language };
}

describe('a formatting locale the host has no data for', () => {
  for (const [name, format] of FORMATTERS) {
    describe(name, () => {
      it.each(['tlh', 'la', 'az-Arab'])(
        'is the typed unsupported result for %s, where no locale of the chain is one the host has',
        (locale) => {
          const result = format(at(locale));
          expect(result.ok ? 'written' : result.diagnostic).toMatchObject(
            refused,
          );
        },
      );

      it('writes de-AQ as de writes it and reports de', () => {
        const fallback = format(at('de-AQ'));
        expect(fallback.ok && fallback.value.locale).toBe('de-AQ');
        expect(written(fallback)).toEqual({
          text: written(format(at('de'))).text,
          language: 'de',
        });
      });

      it('writes ht as its pinned parent fr-HT writes it and reports fr-HT', () => {
        expect(written(format(at('ht')))).toEqual({
          text: written(format(at('fr-HT'))).text,
          language: 'fr-HT',
        });
      });

      it('reports the locale itself where the host has it', () => {
        expect(written(format(at('en-AU'))).language).toBe('en-AU');
      });
    });
  }

  for (const [name, ask] of CAPABILITIES) {
    describe(name, () => {
      it.each(['tlh', 'la'])(
        'is the typed unsupported result for %s',
        (locale) => {
          const result = ask(at(locale));
          expect(result.ok ? 'answered' : result.diagnostic).toMatchObject(
            refused,
          );
        },
      );

      it('answers az-Arab as az answers, through its own component, and reports a fallback', () => {
        const result = ask(at('az-Arab'));
        const own = ask(at('az'));
        expect(result.ok && own.ok && result.value).toEqual(
          own.ok && own.value,
        );
        expect(result).toMatchObject({
          ok: true,
          language: 'az',
          fallback: true,
        });
      });

      it('answers de-AQ as de answers and reports de', () => {
        const result = ask(at('de-AQ'));
        const own = ask(at('de'));
        expect(result.ok && own.ok && result.value).toEqual(
          own.ok && own.value,
        );
        expect(result.ok && result.language).toBe('de');
        expect(own.ok && 'language' in own).toBe(false);
      });
    });
  }

  it('reports en for the plural rules and the collation of en-AU, the locale the host used', () => {
    for (const ask of [
      (c: FormattingContext) => selectPlural(decimal('2'), c),
      (c: FormattingContext) => compareLocalized('a', 'b', c),
    ]) {
      const result = ask(at('en-AU'));
      expect(result.ok && result.language).toBe('en');
    }
  });

  it('does not report a locale the host has, for the plural rules', () => {
    const result = selectPlural(decimal('2'), at('en'));
    expect(result.ok && 'language' in result).toBe(false);
  });
});

/**
 * UTS #35 Part 1, Parent Locales: plural rules, collation and segmentation inherit through parent
 * lists of their own, which stand alone and to which the main rule sending a locale in another
 * script to root does not apply. Each case is one the main chain answers otherwise, and asserts
 * what the host has before what the result reports.
 */
describe('the parent chain of a component', () => {
  const lookup = { localeMatcher: 'lookup' } as const;

  it('answers the plural rules of sr-Latn with sr, which the main chain sends to root', () => {
    expect(
      new Intl.PluralRules('sr-Latn', lookup).resolvedOptions().locale,
    ).toBe('sr');
    expect(selectPlural(decimal('2'), at('sr-Latn'))).toMatchObject({
      ok: true,
      language: 'sr',
      fallback: true,
    });
  });

  it('refuses the plural rules of ht, whose main parent fr-HT the plurals component does not name', () => {
    expect(
      new Intl.PluralRules('ht', lookup).resolvedOptions().locale,
    ).not.toBe('ht');
    const result = selectPlural(decimal('2'), at('ht'));
    expect(result.ok ? 'answered' : result.diagnostic).toMatchObject(refused);
  });

  it('orders yue as zh-Hant orders, the parent the collations component names', () => {
    expect(new Intl.Collator('yue', lookup).resolvedOptions().locale).not.toBe(
      'yue',
    );
    expect(compareLocalized('a', 'b', at('yue'))).toMatchObject({
      ok: true,
      language: 'zh-Hant',
      fallback: true,
    });
  });
});

describe('a keyword of the context tag the host drops', () => {
  it.each([
    [
      'formatNumber',
      (c: FormattingContext) => formatNumber(N, c),
      'en-u-nu-zzzz',
    ],
    [
      'formatInstant',
      (c: FormattingContext) => formatInstant(NOON, c, DATE),
      'en-u-nu-zzzz',
    ],
    [
      'formatInstant',
      (c: FormattingContext) => formatInstant(NOON, c, DATE),
      'en-u-ca-zzzzzz',
    ],
    [
      'formatPlainDate',
      (c: FormattingContext) =>
        formatPlainDate(plainDate(2024, 3, 14), c, DATE),
      'en-u-ca-zzzzzz',
    ],
    [
      'formatRelativeTime',
      (c: FormattingContext) => formatRelativeTime(decimal('-2'), 'day', c),
      'en-u-nu-zzzz',
    ],
    [
      'formatDuration',
      (c: FormattingContext) => formatDuration(duration({ hours: 2 }), c),
      'en-u-nu-zzzz',
    ],
  ])(
    'is the typed unsupported result from %s under %s',
    (_, format, locale) => {
      const result = format(at(locale));
      expect(result.ok ? 'written' : result.diagnostic).toMatchObject(refused);
    },
  );

  it('is the typed unsupported result from compareLocalized under de-u-co-zzzzzz', () => {
    const result = compareLocalized('a', 'b', at('de-u-co-zzzzzz'));
    expect(result.ok ? 'answered' : result.diagnostic).toMatchObject(refused);
  });

  it('is honoured where the host keeps it', () => {
    expect(compareLocalized('a', 'b', at('de-u-co-phonebk')).ok).toBe(true);
    expect(written(formatNumber(N, at('ar-EG-u-nu-latn'))).text).toBe(
      written(formatNumber(N, at('ar-EG'), { numberingSystem: 'latn' })).text,
    );
  });

  it('is not judged where the operation names the option itself', () => {
    expect(
      formatInstant(NOON, at('en-u-ca-zzzzzz'), {
        ...DATE,
        calendar: 'gregory',
      }).ok,
    ).toBe(true);
  });

  it('is never a refusal for a keyword no constructor reads, or one the operation does not read', () => {
    expect(formatNumber(N, at('en-u-fw-mon')).ok).toBe(true);
    expect(formatNumber(N, at('en-u-ca-zzzzzz')).ok).toBe(true);
    expect(formatList(['a', 'b'], at('en-u-nu-zzzz')).ok).toBe(true);
  });
});

describe('a message under a formatting locale the host has no data for', () => {
  const N_INPUT: readonly CompiledInputContract[] = [
    { name: 'n', type: 'number', optional: false, nullable: false },
  ];
  const D_INPUT: readonly CompiledInputContract[] = [
    { name: 'd', type: 'date-time', optional: false, nullable: false },
  ];
  const D = new Date(Date.UTC(2024, 2, 14, 12));

  it.each([
    ['{$n :number}', N_INPUT, { n: 1234.5 }],
    ['{$n :integer}', N_INPUT, { n: 1234.5 }],
    ['{$n :currency currency=EUR}', N_INPUT, { n: 1234.5 }],
    ['{$n :percent}', N_INPUT, { n: 0.25 }],
    ['{$n :unit unit=kilometer}', N_INPUT, { n: 12 }],
    ['{$d :date}', D_INPUT, { d: D }],
    ['{$d :time}', D_INPUT, { d: D }],
    ['{$d :datetime}', D_INPUT, { d: D }],
  ] as const)('refuses %s under tlh', (source, inputs, values) => {
    const failure = refusalOf(() => render(source, inputs, values, at('tlh')));
    expect(failure.diagnostic).toMatchObject(refused);
  });

  it('refuses a keyword of the context tag a number function drops', () => {
    const failure = refusalOf(() =>
      render('{$n :number}', N_INPUT, { n: 1 }, at('en-u-nu-zzzz')),
    );
    expect(failure.diagnostic).toMatchObject(refused);
  });

  it('writes de-AQ as de and reports de on the value part', () => {
    const structured = (locale: string): LocalizedParts => {
      const semantics = parse('{$n :number}');
      const result = evaluateArtifact(
        {
          body: {
            kind: 'pattern',
            declarations: semantics.declarations,
            pattern: (semantics as { pattern: unknown }).pattern,
          },
          inputs: N_INPUT,
          resultKind: 'structured',
        },
        { n: 1234.5 },
        undefined,
        at(locale),
      );
      if (result.kind !== 'parts') throw new Error('Expected parts.');
      return result;
    };
    const fallback = structured('de-AQ');
    const own = structured('de');
    const value = fallback.value.find((part) => part.kind === 'value');
    const ownValue = own.value.find((part) => part.kind === 'value');
    expect(value?.value).toBe(ownValue?.value);
    expect(value && 'valueLanguage' in value && value.valueLanguage).toBe('de');
    expect(ownValue && 'valueLanguage' in ownValue).toBe(false);
  });

  it('selects a plural category under a catalog locale the host has no data for as refused', () => {
    const semantics = parse(
      '.input {$n :number}\n.match $n\none {{one}}\n* {{other}}',
    );
    const failure = refusalOf(() =>
      evaluateArtifact(
        {
          body: {
            kind: 'select',
            declarations: semantics.declarations,
            selectors: (semantics as { selectors: unknown }).selectors,
            variants: (semantics as { variants: unknown }).variants,
          },
          inputs: N_INPUT,
          locale: 'tlh',
        },
        { n: 1 },
        undefined,
        at('en-US'),
      ),
    );
    expect(failure.diagnostic).toMatchObject(refused);
  });
});

/**
 * UTS #35 Part 1, Parent Locales: the main component's `nonlikelyScript` rule gives root as the
 * parent of every locale that is a language and a script its language does not usually take,
 * and `parentLocales.json` lists only some of them. `ru-Latn` is not listed, and truncation would
 * write it in Cyrillic Russian.
 */
describe('the main chain of a language in a script it does not usually take', () => {
  const lookup = { localeMatcher: 'lookup' } as const;

  it('gives root as the parent of ru-Latn, which no pinned entry names', () => {
    expect(
      new Intl.NumberFormat('ru-Latn', lookup).resolvedOptions().locale,
    ).toBe('ru');
    const result = formatNumber(N, at('ru-Latn'));
    expect(result.ok ? 'written' : result.diagnostic).toMatchObject(refused);
  });

  it('leaves the plural rules of ru-Latn to the plurals component, which answers with ru', () => {
    expect(selectPlural(decimal('2'), at('ru-Latn'))).toMatchObject({
      ok: true,
      language: 'ru',
      fallback: true,
    });
  });

  it('applies to the language and script alone, so sr-Latn-AQ is written as sr-Latn', () => {
    expect(
      new Intl.NumberFormat('sr-Latn-AQ', lookup).resolvedOptions().locale,
    ).toBe('sr-Latn');
    const result = formatNumber(N, at('sr-Latn-AQ'));
    expect(result).toMatchObject({ ok: true, value: { language: 'sr-Latn' } });
    expect(result.ok && 'fallback' in result.value).toBe(false);
  });
});

/**
 * UTS #35 Part 1, Lookup: where a language is written in more than one script, a language_region
 * aliases to language_script_region by likely subtags. `zh-AU` is `zh-Hant-AU`, and a host
 * without it writes `zh-Hant`, not `zh`, which is Simplified. Each case asserts what the host
 * has before what the result reports.
 */
describe("a language_region whose likely script is not its language's", () => {
  const lookup = { localeMatcher: 'lookup' } as const;

  it('writes zh-AU as zh-Hant writes it, and is not a fallback', () => {
    expect(
      new Intl.NumberFormat('zh-AU', lookup).resolvedOptions().locale,
    ).toBe('zh');
    const result = formatInstant(NOON, at('zh-AU'), DATE);
    expect(written(result)).toEqual({
      text: written(formatInstant(NOON, at('zh-Hant'), DATE)).text,
      language: 'zh-Hant',
    });
    expect(result.ok && 'fallback' in result.value).toBe(false);
  });

  it('writes sr-RO in the Latin script, as sr-Latn writes it', () => {
    expect(
      new Intl.NumberFormat('sr-RO', lookup).resolvedOptions().locale,
    ).toBe('sr');
    expect(written(formatInstant(NOON, at('sr-RO'), DATE))).toEqual({
      text: written(formatInstant(NOON, at('sr-Latn'), DATE)).text,
      language: 'sr-Latn',
    });
  });

  it('refuses az-IQ, whose chain runs through az-Arab to root', () => {
    expect(
      new Intl.NumberFormat('az-IQ', lookup).resolvedOptions().locale,
    ).toBe('az');
    const result = formatNumber(N, at('az-IQ'));
    expect(result.ok ? 'written' : result.diagnostic).toMatchObject(refused);
  });

  it("takes the plural rules of zh-AU through zh-Hant to zh, the plurals component's truncation", () => {
    expect(selectPlural(decimal('2'), at('zh-AU'))).toMatchObject({
      ok: true,
      language: 'zh',
      fallback: true,
    });
  });
});
