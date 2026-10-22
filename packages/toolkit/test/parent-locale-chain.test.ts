import { describe, expect, it } from 'vitest';

import {
  parseCatalog,
  parseConfiguration,
  type SemanticGraph,
} from '../src/index.js';
import { configurationWithPseudoLocales } from '../src/configuration.js';
import { generateContracts } from '../src/generated-contracts.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { localeFallbackChain, shippedFallbackChain } from '../src/locales.js';
import { LANGUAGE_SCRIPTS } from '../src/language-scripts.generated.js';
import { PARENT_LOCALES } from '../src/parent-locales.generated.js';
import { testProjectConfiguration } from './fixtures.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';

/**
 * A locale falls back to its parent before it falls back to the source.
 *
 * Without it, a target catalog that omits a message is answered by the source locale and by nothing
 * in between, so an application shipping `en`, `en-AU` and `en-GB` either writes every string three
 * times or serves the source language for the ones it does not. CLDR states which locale each
 * locale inherits from.
 *
 * ## What the chain is
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 4 takes each parent from the pinned
 * release rather than from a consumer's statement, and walks the chain to its end.
 *
 * Inheritance as UTS #35 Part 1, Parent Locales, describes it, which is not truncation, walked to
 * its end rather than stopped at one hop. `en-AU` gives `en-001` and then `en`; stopping after
 * `en-001` would serve the source language for a string `en` has, which is the outcome the feature
 * exists to remove and which is invisible in any project whose source locale is English.
 *
 * `und` in the pinned table is a value rather than an absence. `parentLocales.json` carries
 * `_localeRules` `{"parentLocale":{"nonlikelyScript":"root"}}`, and that rule is what produced its
 * 49 `und` entries: a locale written in a script its language does not usually take inherits from
 * root. Those 49 have no parent, and fall back from their own catalog straight to the source
 * locale. UTS #35 Part 1, Parent Locales, says the entries are a short list kept for migration and
 * the rule applies to every language and script that is not the language's likely one, so
 * `ru-Latn`, which no entry names, has no parent either.
 */

const chainOf = (locale: string, overrides?: Record<string, string>) =>
  localeFallbackChain(locale, overrides);

describe('the chain CLDR declares', () => {
  it('walks to its end rather than stopping at one hop', () => {
    // The case the feature is named for, and the one a single hop gets wrong: a reader of "falls
    // back to its parent" expects `en` to be consulted, and `en-001` is not where the strings are.
    expect(chainOf('en-AU')).toEqual(['en-001', 'en']);
    expect(chainOf('en-DE')).toEqual(['en-150', 'en-001', 'en']);
  });

  it('truncates only where the table says nothing', () => {
    // The default rule, and the reason the table has to be read: `de-CH` is the shape everyone
    // assumes, and `en-AU` is the shape CLDR actually declares.
    expect(chainOf('de-CH')).toEqual(['de']);
    expect(chainOf('pt-BR')).toEqual(['pt']);
    expect(chainOf('es-MX')).toEqual(['es-419', 'es']);
  });

  it('stops at a locale whose script is not the one its language takes', () => {
    // `az-Arab` truncated is `az`, the Latin-script locale it was separated from. Serving Latin
    // Azerbaijani to a reader who asked for Arabic Azerbaijani is worse than serving the source
    // language, because it looks like a translation.
    expect(chainOf('az-Arab')).toEqual([]);
    expect(chainOf('sr-Latn')).toEqual([]);
    // The same rule two hops in: `zh-Hant-MO` reaches `zh-Hant` and stops, rather than reaching
    // `zh`, which is written in the other script.
    expect(chainOf('zh-Hant-MO')).toEqual(['zh-Hant-HK', 'zh-Hant']);
  });

  it('gives root to a language in a script it does not usually take, where no entry names it', () => {
    expect(PARENT_LOCALES).not.toHaveProperty('ru-Latn');
    expect(chainOf('ru-Latn')).toEqual([]);
    // The rule is for a language and a script alone: a region below it truncates to it first.
    expect(chainOf('ru-Latn-RU')).toEqual(['ru-Latn']);
    // The likely script of Serbian is Cyrillic, so `sr-Cyrl` truncates to `sr`.
    expect(chainOf('sr-Cyrl')).toEqual(['sr']);
  });

  it('applies that rule to the shipped chain of a locale not marked as a pseudo-locale', () => {
    // A locale is a pseudo-locale only where the caller says so; a pseudo-locale's chain is
    // truncation, so `ru-Latn` would reach `ru`.
    expect(shippedFallbackChain('ru-Latn', ['ru'])).toEqual([]);
    expect(shippedFallbackChain('ru-Latn', ['ru'], undefined, true)).toEqual([
      'ru',
    ]);
  });

  it('takes a language_region of another script through the language_script_region it aliases to', () => {
    // UTS #35 Part 1, Lookup: `zh-TW` is `zh-Hant-TW`, so its catalogs never fall to `zh`, which
    // is Simplified, and `sr-ME` is `sr-Latn-ME`, never Cyrillic `sr`.
    expect(chainOf('zh-TW')).toEqual(['zh-Hant-TW', 'zh-Hant']);
    expect(chainOf('zh-MO')).toEqual(['zh-Hant-MO', 'zh-Hant-HK', 'zh-Hant']);
    expect(chainOf('sr-ME')).toEqual(['sr-Latn-ME', 'sr-Latn']);
    expect(chainOf('pa-PK')).toEqual(['pa-Arab-PK', 'pa-Arab']);
    // A language_region whose likely script is its language's truncates as before.
    expect(chainOf('sr-RS')).toEqual(['sr']);
    expect(chainOf('zh-CN')).toEqual(['zh']);
  });

  it('keeps truncation for a language the pinned data gives no likely script', () => {
    expect(
      Object.values(LANGUAGE_SCRIPTS).some((languages) =>
        languages.split(' ').includes('qaa'),
      ),
    ).toBe(false);
    expect(chainOf('qaa-Latn')).toEqual(['qaa']);
  });

  it('leaves every locale that inherits from root behaving as it always did', () => {
    const rootParented = Object.entries(PARENT_LOCALES)
      .filter(([, parent]) => parent === 'und')
      .map(([locale]) => locale);
    // The count is asserted so a CLDR release that stopped applying the rule is read here rather
    // than silently turning 49 empty chains into 49 truncations.
    expect(rootParented).toHaveLength(49);
    for (const locale of rootParented) expect(chainOf(locale)).toEqual([]);
  });

  it('follows the four parents that change the language', () => {
    // Leaving these out would be Equator overriding pinned data on taste. They are named in the
    // README's fallback section so nobody meets them by surprise, and the per-locale declaration
    // is where a project that disagrees says so.
    expect(chainOf('hi-Latn')).toEqual(['en-IN', 'en-001', 'en']);
    expect(chainOf('ht')).toEqual(['fr-HT', 'fr']);
    expect(chainOf('nb')).toEqual(['no']);
    expect(chainOf('nn')).toEqual(['no']);
    const crossLanguage = Object.entries(PARENT_LOCALES)
      .filter(
        ([locale, parent]) =>
          parent !== 'und' && locale.split('-')[0] !== parent.split('-')[0],
      )
      .map(([locale]) => locale)
      .sort();
    expect(crossLanguage).toEqual(['hi-Latn', 'ht', 'nb', 'nn']);
  });
});

describe('a project that declares a parent of its own', () => {
  it('replaces one hop and lets CLDR carry the rest', () => {
    // The declaration is a correction rather than a chain: `hi-Latn` now inherits from `hi`, and
    // what `hi` inherits from is still CLDR's answer.
    expect(chainOf('hi-Latn', { 'hi-Latn': 'hi' })).toEqual(['hi']);
    expect(chainOf('en-AU', { 'en-AU': 'en-GB' })).toEqual([
      'en-GB',
      'en-001',
      'en',
    ]);
  });

  it('is read at every hop, so one line moves a family', () => {
    // `en-001` is not a locale anyone ships, and every regional English inherits through it.
    expect(chainOf('en-AU', { 'en-001': 'und' })).toEqual(['en-001']);
    expect(chainOf('en-DE', { 'en-150': 'en' })).toEqual(['en-150', 'en']);
  });

  it('outranks the rule that sends a language in an unusual script to root', () => {
    expect(chainOf('ru-Latn', { 'ru-Latn': 'ru' })).toEqual(['ru']);
  });

  it('says a locale has no parent with the identity the standard uses', () => {
    expect(chainOf('en-AU', { 'en-AU': 'und' })).toEqual([]);
  });
});

const configuration = (extra: Readonly<Record<string, unknown>>) =>
  parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US', 'en-AU'],
      ...extra,
    }),
  );

const codesOf = (result: ReturnType<typeof configuration>) =>
  result.diagnostics.map(({ code }) => code);

describe('the declarations a configuration is refused for', () => {
  it('accepts a declaration a configured locale inherits through', () => {
    // The key is not a locale this project ships, and that is deliberate: a chain runs through
    // locales nobody serves, and redirecting one of those is what the key is for.
    const parsed = configuration({ parentLocales: { 'en-001': 'und' } });
    if (!parsed.ok) throw new Error('the configuration was refused');
    expect(parsed.value.parentLocales).toEqual({ 'en-001': 'und' });
    claimCapability('capability:fallback-chain');
  });

  it('refuses a locale that declares itself', () => {
    // A cycle of length one. The message says what to write instead, because somebody who types
    // this means "no parent" and there is a spelling for that.
    expect(
      codesOf(configuration({ parentLocales: { 'en-AU': 'en-AU' } })),
    ).toContain('EQ1007');
    claimCapability('capability:fallback-chain');
  });

  it('refuses a chain that comes back on itself', () => {
    // Only a declaration can make one: the pinned table has no cycle and truncation always
    // shortens. Undetected it is not a hang, because the walk stops at the first repeat; it is a
    // chain that quietly ends somewhere nobody chose.
    const parsed = configuration({
      parentLocales: { 'en-US': 'en-AU', 'en-AU': 'en-US' },
    });
    // One finding per locale caught in it, and each one prints the walk that came back, because a
    // reader looking at two entries in a file cannot see the loop and a reader given the path can.
    const cycles = parsed.diagnostics.filter(({ code }) => code === 'EQ1007');
    expect(cycles.map(({ summary }) => summary).join('\n')).toContain(
      'en-AU to en-US to en-AU',
    );
    expect(cycles.map(({ summary }) => summary).join('\n')).toContain(
      'en-US to en-AU to en-US',
    );
    claimCapability('capability:fallback-chain');
  });

  it('refuses a declaration nothing inherits through', () => {
    // `fr-CA` is not shipped and no shipped locale reaches it, so the entry states a decision that
    // has no effect, which is a typo far more often than it is a plan.
    expect(
      codesOf(configuration({ parentLocales: { 'fr-CA': 'fr' } })),
    ).toContain('EQ1004');
    claimCapability('capability:fallback-chain');
  });

  it('refuses a malformed locale on either side', () => {
    expect(
      codesOf(configuration({ parentLocales: { 'not a locale': 'en' } })),
    ).toContain('EQ1003');
    expect(
      codesOf(configuration({ parentLocales: { 'en-AU': 'not a locale' } })),
    ).toContain('EQ1003');
    claimCapability('capability:fallback-chain');
  });
});

function catalog(role: 'source' | 'target', locale: string, body: string) {
  const parsed = parseCatalog(body, {
    role,
    providerId: 'home',
    scopeId: 'shell',
    locale,
    sourcePath: `i18n/shell/${locale}.yaml`,
  });
  if (!parsed.ok) throw new Error(`fixture ${locale} failed to parse`);
  return parsed.value;
}

// French is the source, so English is a target like any other and `en-AU` inheriting from `en` is
// a claim about the chain rather than about source fallback. With English as the source every case
// below would pass whether or not any of this existed.
const french = catalog(
  'source',
  'fr-FR',
  'messages:\n  nav.home: Accueil\n  nav.help: Aide\n',
);
const english = catalog(
  'target',
  'en',
  'messages:\n  nav.home: Home\n  nav.help: Help\n',
);
const australian = catalog('target', 'en-AU', 'messages:\n  nav.home: Home\n');

const analyze = (
  locales: readonly string[],
  catalogs: readonly ReturnType<typeof catalog>[],
  extra: Readonly<Record<string, unknown>> = {},
) =>
  analyzeCatalogSet({
    configuration: testProjectConfiguration(locales, extra),
    catalogs,
    requireCompleteTargets: true,
  });

function graphOf(result: ReturnType<typeof analyze>): SemanticGraph {
  if (!result.ok) {
    throw new Error(
      `the fixture did not compile: ${result.diagnostics
        .map(({ code, summary }) => `${code} ${summary}`)
        .join('; ')}`,
    );
  }
  return result.value;
}

function indexModuleOf(graph: SemanticGraph): string {
  const generated = generateContracts(graph);
  if (!generated.ok) throw new Error('the fixture generated nothing');
  const index = generated.value.find(({ path }) => path === 'index.ts');
  if (index === undefined) throw new Error('no index module was generated');
  return index.contents;
}

describe('what the build hands the runtime', () => {
  it('carries each chain, filtered to the locales this project ships', () => {
    // `en-001` is a real link in `en-AU`'s chain and no application ships a catalog for it, so it
    // is dropped here: a member with no catalog costs a lookup and answers nothing.
    expect(
      indexModuleOf(
        graphOf(
          analyze(['fr-FR', 'en', 'en-AU'], [french, english, australian]),
        ),
      ),
    ).toContain('localeFallbacks: Object.freeze({"en-AU":["en"]} as const)');
    claimCapability('capability:fallback-chain');
  });

  it('carries nothing when no locale inherits from another it ships', () => {
    expect(
      indexModuleOf(graphOf(analyze(['fr-FR', 'en'], [french, english]))),
    ).not.toContain('localeFallbacks');
    claimCapability('capability:fallback-chain');
  });

  it('sends a redirected locale where the declaration points', () => {
    // `hi-Latn` inherits from `en-IN` in CLDR. A project that would rather it inherited from `hi`
    // says so, and what reaches the runtime changes with it.
    const hindi = catalog('target', 'hi', 'messages:\n  nav.home: होम\n');
    const latin = catalog('target', 'hi-Latn', 'messages:\n  nav.home: Home\n');
    const indian = catalog(
      'target',
      'en-IN',
      'messages:\n  nav.home: Home\n  nav.help: Help\n',
    );
    const locales = ['fr-FR', 'hi', 'hi-Latn', 'en-IN'];
    const catalogs = [french, hindi, latin, indian];
    expect(indexModuleOf(graphOf(analyze(locales, catalogs)))).toContain(
      'localeFallbacks: Object.freeze({"hi-Latn":["en-IN"]}',
    );
    expect(
      indexModuleOf(
        graphOf(
          analyze(locales, catalogs, { parentLocales: { 'hi-Latn': 'hi' } }),
        ),
      ),
    ).toContain('localeFallbacks: Object.freeze({"hi-Latn":["hi"]}');
    claimCapability('capability:fallback-chain');
  });

  it('sends nothing for a locale whose script parts it from its language', () => {
    // `az-Arab` next to `az`: the chain is empty, so the runtime falls to the source and never to
    // `az`. A truncating implementation would send `["az"]` here.
    const arabic = catalog(
      'target',
      'az-Arab',
      'messages:\n  nav.home: Ev\n  nav.help: Kömək\n',
    );
    const latin = catalog(
      'target',
      'az',
      'messages:\n  nav.home: Ev\n  nav.help: Komek\n',
    );
    expect(
      indexModuleOf(
        graphOf(analyze(['fr-FR', 'az', 'az-Arab'], [french, latin, arabic])),
      ),
    ).not.toContain('localeFallbacks');
    claimCapability('capability:fallback-chain');
  });
});

describe('a pseudo-locale, whose script says only which way its text runs', () => {
  // `en-Arab-XB` is English forced right to left. The rule that sends a language in a script it
  // does not usually take to root keeps text in one script from inheriting another's, and a
  // pseudo-locale's text is its language's, so its chain is truncation.
  it('inherits through its language', () => {
    expect(localeFallbackChain('en-Arab-XB', undefined, true)).toEqual([
      'en-Arab',
      'en',
    ]);
    expect(chainOf('en-Arab-XB')).toEqual(['en-Arab']);
  });

  it('hands the runtime the chain to its language when the build generated it', () => {
    const configuration = configurationWithPseudoLocales(
      testProjectConfiguration(['en'], {
        pseudoLocales: { 'en-Arab-XB': { markers: true } },
      }),
    );
    const source = catalog(
      'source',
      'en',
      'messages:\n  nav.home: Home\n  nav.help: Help\n',
    );
    const pseudo = catalog(
      'target',
      'en-Arab-XB',
      'messages:\n  nav.home: Home\n  nav.help: Help\n',
    );
    const graph = graphOf(
      analyzeCatalogSet({
        configuration,
        catalogs: [source, pseudo],
        requireCompleteTargets: true,
      }),
    );
    expect(indexModuleOf(graph)).toContain(
      'localeFallbacks: Object.freeze({"en-Arab-XB":["en"]}',
    );
    claimCapability('capability:fallback-chain');
  });
});

describe('a zh-TW catalog beside zh and zh-Hant', () => {
  it('falls back to zh-Hant and never to zh', () => {
    const simplified = catalog('target', 'zh', 'messages:\n  nav.home: 首页\n');
    const traditional = catalog(
      'target',
      'zh-Hant',
      'messages:\n  nav.home: 首頁\n  nav.help: 說明\n',
    );
    const taiwan = catalog('target', 'zh-TW', 'messages:\n  nav.home: 首頁\n');
    expect(
      indexModuleOf(
        graphOf(
          analyze(
            ['fr-FR', 'zh', 'zh-Hant', 'zh-TW'],
            [french, simplified, traditional, taiwan],
          ),
        ),
      ),
    ).toContain(
      'localeFallbacks: Object.freeze({"zh-TW":["zh-Hant"]} as const)',
    );
    claimCapability('capability:fallback-chain');
  });
});

describe('the release completeness gate', () => {
  const codes = (result: ReturnType<typeof analyze>) =>
    result.diagnostics.map(({ code }) => code);

  it('counts a locale complete once its whole chain is counted', () => {
    // `en-AU` omits `nav.help` and `en` has it. That is a regional locale saying it has nothing to
    // add, which is what a parent is for, so there is nothing to report.
    const graph = analyze(
      ['fr-FR', 'en', 'en-AU'],
      [french, english, australian],
    );
    expect(graph.ok).toBe(true);
    expect(codes(graph)).not.toContain('EQ1307');
  });

  it('still reports a message no locale in the chain has', () => {
    // The same omission with the chain unable to answer it. The gate has not been softened; it has
    // been given the second place to look that the runtime already looks in.
    const thin = catalog('target', 'en', 'messages:\n  nav.home: Home\n');
    const graph = analyze(['fr-FR', 'en', 'en-AU'], [french, thin, australian]);
    const reported = graph.diagnostics.filter(({ code }) => code === 'EQ1307');
    // Both locales are short of it and both are told so: `en-AU` inherits from an `en` that does
    // not have it either.
    expect(reported).toHaveLength(2);
    expect(reported.map(({ summary }) => summary).join(' ')).toContain(
      'nav.help',
    );
  });

  it('counts a locale with no catalog complete when it inherits one', () => {
    // The most complete form of incompleteness is a locale with no catalog at all, and it is a
    // legitimate way to ship a regional locale: `en-AU` exists as an address and a way of writing
    // numbers, and every string it shows is `en`.
    const graph = analyze(['fr-FR', 'en', 'en-AU'], [french, english]);
    expect(graph.ok).toBe(true);
    expect(codes(graph)).not.toContain('EQ1306');
  });

  it('still reports a locale with no catalog and nothing to inherit from', () => {
    expect(
      codes(analyze(['fr-FR', 'en', 'de-DE'], [french, english])),
    ).toContain('EQ1306');
  });
});
