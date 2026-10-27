/**
 * Which locale the host formats a context's locale with, and the refusal where it has none.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4. A host asked for a locale it has no
 * data for raises nothing: ECMA-402 resolves it to the longest prefix it has, and to its own
 * default locale where it has none, so `tlh` is written in whatever language the machine runs in
 * and `az-Arab` in the Latin script. What the host has is read from the locale a constructor built
 * from the tag answers with, compared with the tag: equal means the host has it, and anything
 * else, its default included, means it does not, so no answer depends on the default.
 *
 * Where the host does not have the locale, the pinned parent chain of
 * `specs/03-locale-identity-and-resolution.spec.md` section 4 is walked to the first locale it
 * has, and that locale formats and is reported. The chain is that of the CLDR component the
 * constructor's data comes from. Root is the end: its data writes no language.
 *
 * The keywords of the tag the operation's constructor reads go with the locale that formats, and
 * one the host drops is refused, as an option the host drops is.
 *
 * The locale used is named wherever it is not the one asked for, and is a fallback only where it
 * differs in language or in script, each side's script taken from the pinned likely subtags: `en`
 * answering for `en-US` is the same writing, and `zh` answering for `zh-TW` is not.
 *
 * A pseudo-locale's script subtag carries its direction and nothing else. Its text is its
 * language's, so the likely-script rule, which keeps text in one script from inheriting another's,
 * is not applied along its chain, and its script is its language's when a fallback is judged.
 */
import {
  canonicalizeLanguageTag,
  ɵisGeneratedPseudoLocales,
} from '@neolorn/equator/core';

import { LIKELY_SCRIPTS } from './likely-scripts.generated';
import {
  COLLATION_PARENT_LOCALES,
  PARENT_LOCALES,
  PLURAL_PARENT_LOCALES,
  SEGMENTATION_PARENT_LOCALES,
} from './parent-locales.generated';
import { RUNTIME_LIMITS } from './runtime-safety';

/** The `Intl` constructor an operation formats with. */
export type LocaleService =
  | 'number'
  | 'date-time'
  | 'plural'
  | 'relative-time'
  | 'list'
  | 'display-names'
  | 'collator'
  | 'segmenter'
  | 'duration';

type Keyword =
  | 'calendar'
  | 'hourCycle'
  | 'numberingSystem'
  | 'collation'
  | 'caseFirst'
  | 'numeric';

/**
 * The keywords of a tag each constructor reads, its relevant extension keys in ECMA-402: `ca`,
 * `hc` and `nu` for dates, `nu` for numbers, relative time and durations, `co`, `kf` and `kn` for
 * collation, and none for the others. A keyword no constructor reads is never a refusal.
 */
const RELEVANT: Readonly<Record<LocaleService, readonly Keyword[]>> = {
  number: ['numberingSystem'],
  'date-time': ['calendar', 'hourCycle', 'numberingSystem'],
  plural: [],
  'relative-time': ['numberingSystem'],
  list: [],
  'display-names': [],
  collator: ['collation', 'caseFirst', 'numeric'],
  segmenter: [],
  duration: ['numberingSystem'],
};

/** The `u` extension key of each keyword. */
const KEY: Readonly<Record<Keyword, string>> = {
  calendar: 'ca',
  hourCycle: 'hc',
  numberingSystem: 'nu',
  collation: 'co',
  caseFirst: 'kf',
  numeric: 'kn',
};

/**
 * The keys a tag's `u` extension writes. `Intl.Locale` reads `numeric` as false where a tag has no
 * `kn` as well as for `kn-false`, so a keyword is the tag's only where its key is written.
 */
function unicodeKeys(locale: Intl.Locale): ReadonlySet<string> {
  const keys = new Set<string>();
  let inExtension = false;
  for (const subtag of locale.toString().split('-').slice(1)) {
    // Everything after `x` is private use, whose subtags are not keys.
    if (subtag === 'x') break;
    if (subtag.length === 1) inExtension = subtag === 'u';
    else if (inExtension && subtag.length === 2) keys.add(subtag);
  }
  return keys;
}

/**
 * The option that takes the place of a keyword. ECMA-402's ResolveLocale drops a keyword whose
 * option differs, and the option is judged by its own rule, so the keyword is not carried.
 */
const OVERRIDDEN_BY: Readonly<Record<Keyword, readonly string[]>> = {
  calendar: ['calendar'],
  hourCycle: ['hourCycle', 'hour12'],
  numberingSystem: ['numberingSystem'],
  collation: ['collation'],
  caseFirst: ['caseFirst'],
  numeric: ['numeric'],
};

export type HostLocale =
  | {
      readonly ok: true;
      /** The tag the formatter is built from. */
      readonly tag: string;
      /** The locale of the chain that formats, where it is not the one asked for. */
      readonly used?: string;
      /** Present where `used` differs from the locale asked for in language or script. */
      readonly fallback?: true;
    }
  | {
      readonly ok: false;
      /**
       * `malformed-input` where the context marks as a pseudo-locale a locale whose region is not
       * one a pseudo-locale takes, else `native-capability-rejected`.
       */
      readonly reason: 'native-capability-rejected' | 'malformed-input';
    };

const probe: Readonly<
  Record<
    LocaleService,
    (tag: string) => { resolvedOptions(): { locale: string } }
  >
> = {
  number: (tag) => new Intl.NumberFormat(tag, { localeMatcher: 'lookup' }),
  'date-time': (tag) =>
    new Intl.DateTimeFormat(tag, { localeMatcher: 'lookup' }),
  plural: (tag) => new Intl.PluralRules(tag, { localeMatcher: 'lookup' }),
  'relative-time': (tag) =>
    new Intl.RelativeTimeFormat(tag, { localeMatcher: 'lookup' }),
  list: (tag) => new Intl.ListFormat(tag, { localeMatcher: 'lookup' }),
  'display-names': (tag) =>
    new Intl.DisplayNames(tag, { type: 'language', localeMatcher: 'lookup' }),
  collator: (tag) => new Intl.Collator(tag, { localeMatcher: 'lookup' }),
  segmenter: (tag) => new Intl.Segmenter(tag, { localeMatcher: 'lookup' }),
  duration: (tag) =>
    new (
      Intl as unknown as {
        DurationFormat: new (
          tag: string,
          options: object,
        ) => { resolvedOptions(): { locale: string } };
      }
    ).DurationFormat(tag, { localeMatcher: 'lookup' }),
};

/**
 * A bounded store of answers, oldest dropped first.
 *
 * The locales asked about are the contexts' and a context can be made from anything, so a store
 * that kept every one would grow with what reached it.
 */
class Answers<Value> {
  private readonly values = new Map<string, Value>();

  get(key: string, compute: () => Value): Value {
    if (this.values.has(key)) return this.values.get(key) as Value;
    const value = compute();
    if (this.values.size >= RUNTIME_LIMITS.formatterCacheEntries) {
      const oldest = this.values.keys().next();
      if (!oldest.done) this.values.delete(oldest.value);
    }
    this.values.set(key, value);
    return value;
  }
}

const answered = new Answers<string | undefined>();
const resolved = new Answers<HostLocale>();

/** The locale the host answers a tag with, or `undefined` where it builds nothing for it. */
function hostAnswerFor(
  service: LocaleService,
  tag: string,
): string | undefined {
  return answered.get(`${service}\u0000${tag}`, () => {
    try {
      return probe[service](tag).resolvedOptions().locale;
    } catch {
      return undefined;
    }
  });
}

/**
 * The CLDR component whose parents a constructor's data inherits through. UTS #35 Part 1, Parent
 * Locales: plural rules, collation and segmentation have parent lists of their own, which stand
 * alone, and every other constructor reads main data.
 */
const PARENTS: Readonly<
  Record<LocaleService, Readonly<Record<string, string>>>
> = {
  number: PARENT_LOCALES,
  'date-time': PARENT_LOCALES,
  plural: PLURAL_PARENT_LOCALES,
  'relative-time': PARENT_LOCALES,
  list: PARENT_LOCALES,
  'display-names': PARENT_LOCALES,
  collator: COLLATION_PARENT_LOCALES,
  segmenter: SEGMENTATION_PARENT_LOCALES,
  duration: PARENT_LOCALES,
};

/**
 * The parent of spec 03 section 4 in the component the service reads: the pinned one, else the
 * language_script_region a language_region aliases to, else root for a main-component locale in a
 * script its language does not usually take, else the tag less its last subtag.
 */
function parentOf(
  service: LocaleService,
  locale: string,
  pseudoLocale: boolean,
): string | undefined {
  const parents = PARENTS[service];
  const declared = Object.hasOwn(parents, locale) ? parents[locale] : undefined;
  if (declared !== undefined) return declared === 'und' ? undefined : declared;
  const aliased = scriptedRegion(locale);
  if (aliased !== undefined) return aliased;
  if (parents === PARENT_LOCALES && !pseudoLocale && hasNonlikelyScript(locale))
    return undefined;
  const cut = locale.lastIndexOf('-');
  return cut <= 0 ? undefined : locale.slice(0, cut);
}

/**
 * The tag to build an operation's formatter from, and the locale of the chain that formats where
 * it is not the context's own.
 *
 * `tag` is the context's locale as `formattingLocale` gives it; `options` are the constructor
 * options the operation passes, read only for which keywords they take the place of;
 * `pseudoLocale` is the context's member of that name.
 */
export function hostLocale(
  service: LocaleService,
  tag: string,
  options: object = {},
  pseudoLocale = false,
): HostLocale {
  const overridden = RELEVANT[service].filter((keyword) =>
    OVERRIDDEN_BY[keyword].some((name) => Object.hasOwn(options, name)),
  );
  return resolved.get(
    `${service}\u0000${tag}\u0000${overridden.join(',')}\u0000${String(pseudoLocale)}`,
    () => walk(service, tag, overridden, pseudoLocale),
  );
}

function walk(
  service: LocaleService,
  tag: string,
  overridden: readonly Keyword[],
  pseudoLocale: boolean,
): HostLocale {
  let asked: Intl.Locale;
  try {
    asked = new Intl.Locale(tag);
  } catch {
    return REFUSED;
  }
  const keys = unicodeKeys(asked);
  const keywords: Record<string, string | boolean> = {};
  for (const keyword of RELEVANT[service]) {
    if (!keys.has(KEY[keyword]) || overridden.includes(keyword)) continue;
    // Intl.Locale reads every key the tag writes.
    keywords[keyword] = asked[keyword] as string | boolean;
  }
  const base = canonicalizeLanguageTag(asked.baseName) ?? asked.baseName;
  if (pseudoLocale && !ɵisGeneratedPseudoLocales([base], [base])) {
    return MISMARKED;
  }
  let member: string | undefined = base;
  while (member !== undefined && hostAnswerFor(service, member) !== member) {
    member = parentOf(service, member, pseudoLocale);
  }
  if (member === undefined) return REFUSED;
  let built: string;
  try {
    built = new Intl.Locale(member, keywords).toString();
  } catch {
    return REFUSED;
  }
  const carried = Object.keys(keywords) as Keyword[];
  if (carried.length > 0) {
    // A keyword the host has no data for is dropped from the locale it answers with, and the
    // locale's default is written in its place without an error, as for an option it drops.
    const answer = hostAnswerFor(service, built);
    if (answer === undefined) return REFUSED;
    const kept = new Intl.Locale(answer);
    if (carried.some((name) => kept[name] !== keywords[name])) return REFUSED;
  }
  return Object.freeze({
    ok: true as const,
    tag: built,
    ...(member === base
      ? {}
      : {
          used: member,
          ...(differsInWriting(base, member, pseudoLocale)
            ? { fallback: true as const }
            : {}),
        }),
  });
}

let scriptsByTag: ReadonlyMap<string, string> | undefined;

/** The pinned likely script of a language or a language_region, or `undefined` for one it lacks. */
function likelyScript(tag: string): string | undefined {
  scriptsByTag ??= new Map(
    Object.entries(LIKELY_SCRIPTS).flatMap(([script, tags]) =>
      tags.split(' ').map((tag) => [tag, script] as const),
    ),
  );
  return scriptsByTag.get(tag);
}

/**
 * The script a tag is written in: its own script subtag, else the likely script of its
 * language_region, else of its language, the order UTS #35 Part 1 section 4.3 looks them up in.
 * `undefined` for a language the pinned table does not hold.
 */
function scriptOf(locale: Intl.Locale): string | undefined {
  if (locale.script !== undefined) return locale.script;
  const regional =
    locale.region === undefined
      ? undefined
      : likelyScript(`${locale.language}-${locale.region}`);
  return regional ?? likelyScript(locale.language);
}

/**
 * The language_script_region a language_region aliases to, where its likely script is not its
 * language's, else `undefined`.
 *
 * UTS #35 Part 1, Lookup: where a language is written in more than one script, a language_region
 * aliases to language_script_region by likely subtags, so `zh-TW` is `zh-Hant-TW` and inherits
 * through `zh-Hant`, never through `zh`, which is written in the other script. The pinned table
 * holds a tag with more than one subtag only where it is such a language_region, so it alone decides.
 */
function scriptedRegion(locale: string): string | undefined {
  const cut = locale.indexOf('-');
  if (cut < 0) return undefined;
  const script = likelyScript(locale);
  return script === undefined
    ? undefined
    : `${locale.slice(0, cut)}-${script}${locale.slice(cut)}`;
}

const SCRIPT_SUBTAG = /^[A-Z][a-z]{3}$/u;

/**
 * Whether a locale is a language and a script its language does not usually take.
 *
 * UTS #35 Part 1, Parent Locales: the main component's `nonlikelyScript` rule gives root as the
 * parent of every such locale, and `parentLocales.json` lists only some of them, so `ru-Latn`
 * takes root although no entry names it. A language the pinned table does not hold has no likely
 * script to compare with and keeps truncation.
 */
function hasNonlikelyScript(locale: string): boolean {
  const subtags = locale.split('-');
  if (subtags.length !== 2) return false;
  const [language, script] = subtags as [string, string];
  if (!SCRIPT_SUBTAG.test(script)) return false;
  const likely = likelyScript(language);
  return likely !== undefined && likely !== script;
}

/**
 * Whether the locale used is written otherwise than the locale asked for: another language, or
 * the same language in another script. Where either script is unknown the language alone decides.
 * A pseudo-locale asked for is written in its language's script, whatever its tag names.
 */
function differsInWriting(
  asked: string,
  used: string,
  pseudoLocale: boolean,
): boolean {
  const askedLocale = new Intl.Locale(asked);
  const usedLocale = new Intl.Locale(used);
  if (askedLocale.language !== usedLocale.language) return true;
  const askedScript = pseudoLocale
    ? likelyScript(askedLocale.language)
    : scriptOf(askedLocale);
  const usedScript = scriptOf(usedLocale);
  return (
    askedScript !== undefined &&
    usedScript !== undefined &&
    askedScript !== usedScript
  );
}

const REFUSED: HostLocale = Object.freeze({
  ok: false as const,
  reason: 'native-capability-rejected' as const,
});

const MISMARKED: HostLocale = Object.freeze({
  ok: false as const,
  reason: 'malformed-input' as const,
});
