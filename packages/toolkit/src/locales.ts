import {
  toolkitDiagnostic,
  toolkitFailure,
  toolkitSuccess,
  type ToolkitResult,
} from './diagnostics.js';
import { LOCALE_ENDONYMS } from './endonyms.generated.js';
import { LANGUAGE_SCRIPTS } from './language-scripts.generated.js';
import { canonicalizeLanguageTag } from './language-tag.js';
import { PARENT_LOCALES } from './parent-locales.generated.js';
import { untrustedText } from './untrusted-text.js';

declare const localeBrand: unique symbol;
declare const localeAliasBrand: unique symbol;

/**
 * A locale tag in its canonical spelling.
 *
 * Branded, so a bare string cannot stand in for one and a tag that was never canonicalized cannot
 * reach a place expecting one. `canonicalizeLocale` is what produces one; two spellings of the
 * same locale become the same value, which is what lets them be compared and used as keys.
 */
export type CanonicalLocale = string & {
  readonly [localeBrand]: 'CanonicalLocale';
};

export type LocaleAlias = string & {
  readonly [localeAliasBrand]: 'LocaleAlias';
};

/**
 * The alias grammar, which is narrower than a locale identity on purpose.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 5 says what an alias is for: a
 * consumer's own spelling of a locale, such as one its storage held before Equator. It is not a
 * place to restate a relation the pinned data already gives, so nothing here consults that data,
 * and section 3 of `specs/03-locale-identity-and-resolution.spec.md` is what the canonical side is
 * held to instead.
 */
const aliasPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

export function canonicalizeLocale(
  value: unknown,
): ToolkitResult<CanonicalLocale> {
  const text = untrustedText(value, 'EQ1003', 'Locale identity');
  if (!text.ok) return text;
  const locale = text.value;
  if (
    locale.length === 0 ||
    locale.length > 255 ||
    locale.includes('_') ||
    locale.trim() !== locale
  ) {
    return toolkitFailure([
      toolkitDiagnostic('EQ1003', 'Locale identity is malformed.'),
    ]);
  }

  const canonical = canonicalizeLanguageTag(locale);
  if (canonical === undefined) {
    return toolkitFailure([
      toolkitDiagnostic('EQ1003', 'Locale identity is malformed.'),
    ]);
  }

  const parts = canonical.split('-');
  if (parts.slice(1).some((part) => part.length === 1)) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1003',
        'Catalog locale identities cannot contain extensions or private-use subtags.',
      ),
    ]);
  }

  return toolkitSuccess(canonical as CanonicalLocale);
}

export function parseLocaleAlias(value: unknown): ToolkitResult<LocaleAlias> {
  const text = untrustedText(value, 'EQ1005', 'Locale alias');
  if (!text.ok) return text;
  if (!aliasPattern.test(text.value)) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1005',
        'Locale alias must be a lowercase ASCII identifier containing only letters, digits, and hyphens.',
      ),
    ]);
  }

  return toolkitSuccess(text.value as LocaleAlias);
}

/**
 * The name a locale has for itself, from Equator's pinned CLDR release.
 *
 * `undefined` means Equator has no name for this locale and the caller should say so rather than
 * invent one: either CLDR names none of it, there are locales in the standard with no display
 * names at all, or the tag is outside CLDR's coverage entirely, as a private-use tag is.
 *
 * A tag CLDR does not list is answered by its parent, by truncation: `de-CH-1901` is `de-CH`, which
 * is "Deutsch (Schweiz)". That is a real name for a broader locale rather than a guess at a
 * narrower one, and it is the same fallback CLDR itself performs to find data. What is not done is
 * composing a new name out of subtags Equator has no words for: that is how `catala (Espanya,
 * VALENCIA)` happens, and it is the defect this table exists to remove.
 */
export function localeEndonym(locale: string): string | undefined {
  let candidate = locale;
  for (;;) {
    const endonym = Object.hasOwn(LOCALE_ENDONYMS, candidate)
      ? LOCALE_ENDONYMS[candidate]
      : undefined;
    if (endonym !== undefined) return endonym;
    const cut = candidate.lastIndexOf('-');
    if (cut <= 0) return undefined;
    candidate = candidate.slice(0, cut);
  }
}

/**
 * The identity CLDR gives the locale every chain ends at.
 *
 * It is written in the pinned parent table as the parent of a locale that inherits from root, so
 * it is a value Equator reads rather than one it chose, and a project writing it in its own
 * `parentLocales` is saying the same thing CLDR says: this locale has no parent.
 */
export const ROOT_LOCALE = 'und';

const NO_PARENT_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * The parent of one locale, from Equator's pinned CLDR release and the project's own declarations.
 *
 * `undefined` means the locale inherits from root, which is where a chain ends.
 *
 * Five rules, from UTS #35 Part 1, Lookup and Parent Locales. A parent the project declared wins,
 * because its configuration is where a consumer says CLDR's answer is wrong for this product.
 * Otherwise the pinned table answers, `und` included: `und` there means root, so it ends the chain
 * rather than naming a locale. Otherwise a language_region whose likely script is not its
 * language's takes the language_script_region it aliases to, so `zh-TW` reaches `zh-Hant` and not
 * `zh`. Otherwise a language and a script its language does not usually
 * take inherit from root, the `nonlikelyScript` rule of UTS #35 Part 1, Parent Locales, which the
 * table lists only some locales of: `ru-Latn` has no entry and is not served Cyrillic Russian.
 * Otherwise the parent is the tag with its last subtag removed, and a tag with one subtag left has
 * none.
 *
 * Declarations are consulted at every hop rather than only at the first, which is what makes one
 * entry enough to move a family: a project that gives `en-001` a different parent has moved every
 * locale that inherits through it.
 *
 * A pseudo-locale's script subtag carries its direction and nothing else, and its text is its
 * language's, so the `nonlikelyScript` rule is not applied along its chain: `en-Arab-XB` inherits
 * through `en-Arab` to `en`. `pseudoLocale` says the chain being walked is one.
 */
export function localeParent(
  locale: string,
  overrides: Readonly<Record<string, string>> = NO_PARENT_OVERRIDES,
  pseudoLocale = false,
): string | undefined {
  const declared = Object.hasOwn(overrides, locale)
    ? overrides[locale]
    : Object.hasOwn(PARENT_LOCALES, locale)
      ? PARENT_LOCALES[locale]
      : undefined;
  if (declared !== undefined) {
    return declared === ROOT_LOCALE ? undefined : declared;
  }
  const aliased = scriptedRegion(locale);
  if (aliased !== undefined) return aliased;
  if (!pseudoLocale && hasNonlikelyScript(locale)) return undefined;
  const cut = locale.lastIndexOf('-');
  return cut <= 0 ? undefined : locale.slice(0, cut);
}

let scriptsByLanguage: ReadonlyMap<string, string> | undefined;

const SCRIPT_SUBTAG = /^[A-Z][a-z]{3}$/u;

/** The pinned likely script of a language or a language_region, or `undefined` for one it lacks. */
function likelyScript(tag: string): string | undefined {
  scriptsByLanguage ??= new Map(
    Object.entries(LANGUAGE_SCRIPTS).flatMap(([likely, tags]) =>
      tags.split(' ').map((key) => [key, likely] as const),
    ),
  );
  return scriptsByLanguage.get(tag);
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

/**
 * Whether a locale is a language and a script other than the likely script of that language.
 * A language the pinned table does not hold has no likely script to compare with, and keeps
 * truncation.
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
 * Every locale a locale inherits from, nearest first, ending before root.
 *
 * The chain is walked to its end rather than stopped at one hop, because one hop is not what a
 * reader of "falls back to its parent" expects and not what CLDR means. `en-AU` gives `en-001`
 * and then `en`; stopping at `en-001` would serve the source locale for a string `en` has.
 *
 * The locale itself is not in the result. It is the caller's first choice by definition, and
 * putting it here would make every caller drop it again.
 *
 * A cycle can only come from a project's own declarations, since the pinned table has none and
 * truncation always shortens. The walk stops at the first locale it has already seen so that a
 * mistake costs a short chain rather than a hang, and `EQ1007` reports the mistake itself when
 * the configuration is read.
 */
export function localeFallbackChain(
  locale: string,
  overrides: Readonly<Record<string, string>> = NO_PARENT_OVERRIDES,
  pseudoLocale = false,
): readonly string[] {
  const chain: string[] = [];
  const seen = new Set<string>([locale]);
  for (
    let parent = localeParent(locale, overrides, pseudoLocale);
    parent !== undefined && !seen.has(parent);
    parent = localeParent(parent, overrides, pseudoLocale)
  ) {
    seen.add(parent);
    chain.push(parent);
  }
  return Object.freeze(chain);
}

/**
 * The same chain, restricted to the locales a project actually ships.
 *
 * This is what reaches the runtime. A chain runs through locales nobody serves, `en-001` among
 * them, and a member with no catalog costs a lookup and answers nothing; the links still matter
 * while the chain is being walked, which is why they are dropped here and not while walking.
 *
 * `shipped` is the project's own locale set, so the answer changes when the set does. That is why
 * the resolved chain is a build output rather than something the runtime derives: only the build
 * knows which locales this application ships.
 */
export function shippedFallbackChain(
  locale: string,
  shipped: readonly string[],
  overrides: Readonly<Record<string, string>> = NO_PARENT_OVERRIDES,
  pseudoLocale = false,
): readonly string[] {
  const available = new Set(shipped);
  return Object.freeze(
    localeFallbackChain(locale, overrides, pseudoLocale).filter((parent) =>
      available.has(parent),
    ),
  );
}
