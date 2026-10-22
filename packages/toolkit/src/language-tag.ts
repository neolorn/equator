/**
 * The canonical form of a language tag, decided from the pinned CLDR release.
 *
 * `specs/01-standards-profile.spec.md` section 3 forbids a host's own registry from deciding an
 * identity that is stored, compared, or exchanged. `Intl.getCanonicalLocales` answers from the
 * host's ICU, and hosts ship different CLDR editions: one maps `tl` to `fil` and another keeps it,
 * so a request and the build it is matched against could disagree. This applies UTS #35 Part 1
 * Annex C with the alias rules generated from the pinned release instead.
 *
 * The toolkit canonicalizes a declaration and the runtime a request, and neither package can import
 * the other, so this file is duplicated in `packages/toolkit/src/language-tag.ts`, and
 * `tools/twin-sources.json` lists the pair for the test that compares twins.
 *
 * The grammar is the one ECMA-402 accepts, `unicode_bcp47_locale_id`, so a tag the host refuses is
 * refused here too: a legacy `i-` tag, an extended language subtag, a leading script, `root`, and a
 * repeated variant or singleton. Extension values are put in canonical order but not replaced: the
 * aliases for them are in the CLDR `bcp47` data, which is not a pinned source, and no identity
 * Equator stores carries an extension.
 */
import {
  LIKELY_REPLACEMENT_REGIONS,
  LOCALE_ALIAS_RULES,
} from './locale-aliases.generated.js';

interface LanguageId {
  language: string;
  script: string;
  region: string;
  variants: string[];
}

interface AliasRule {
  readonly order: number;
  readonly type: LanguageId;
  readonly replacements: readonly LanguageId[];
}

const LANGUAGE = /^(?:[a-z]{2,3}|[a-z]{5,8})$/u;
const SCRIPT = /^[a-z]{4}$/u;
const REGION = /^(?:[a-z]{2}|[0-9]{3})$/u;
const VARIANT = /^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/u;
const SUBTAG = /^[a-z0-9]{1,8}$/u;
const EXTENSION_VALUE = /^[a-z0-9]{3,8}$/u;
const UNICODE_KEY = /^[a-z0-9][a-z]$/u;
const TRANSFORM_KEY = /^[a-z][0-9]$/u;

/**
 * The annex applies rules until none matches. The pinned rules settle every tag in a few steps, so
 * a tag still changing after this many is refused rather than looped over.
 */
const MAXIMUM_ALIAS_STEPS = 16;

let aliasIndex: ReadonlyMap<string, readonly AliasRule[]> | undefined;
let likelyRegions: ReadonlyMap<string, string> | undefined;

/**
 * The canonical form of `tag`, or `undefined` when it is not a well-formed Unicode BCP 47 locale
 * identifier.
 *
 * Casing, variant order and extension order follow UTS #35 Part 1 Annex C, and deprecated
 * languages, scripts, regions and variants are replaced as the pinned CLDR alias data states, so
 * `iw-IL` is `he-IL`, `tl` is `fil` and `sh` is `sr-Latn` on every host.
 */
export function canonicalizeLanguageTag(tag: string): string | undefined {
  const subtags = tag.toLowerCase().split('-');
  if (!subtags.every((subtag) => SUBTAG.test(subtag))) return undefined;
  const parsed = languageIdAt(subtags, 0);
  if (parsed === undefined) return undefined;
  const language = canonicalLanguageId(parsed.id);
  if (language === undefined) return undefined;

  const extensions: string[] = [];
  const singletons = new Set<string>();
  let privateUse = '';
  let index = parsed.next;
  while (index < subtags.length) {
    const singleton = subtags[index] as string;
    if (singleton.length !== 1 || singletons.has(singleton)) return undefined;
    singletons.add(singleton);
    if (singleton === 'x') {
      if (index + 1 === subtags.length) return undefined;
      privateUse = subtags.slice(index).join('-');
      break;
    }
    const end = extensionEnd(subtags, index + 1);
    const body = subtags.slice(index + 1, end);
    const canonical =
      singleton === 'u'
        ? unicodeExtension(body)
        : singleton === 't'
          ? transformedExtension(body)
          : otherExtension(body);
    if (canonical === undefined) return undefined;
    extensions.push(`${singleton}-${canonical}`);
    index = end;
  }

  return [
    language,
    ...extensions.sort(),
    ...(privateUse ? [privateUse] : []),
  ].join('-');
}

function languageIdAt(
  subtags: readonly string[],
  start: number,
): { readonly id: LanguageId; readonly next: number } | undefined {
  let index = start;
  const language = subtags[index];
  if (language === undefined || !LANGUAGE.test(language)) return undefined;
  index += 1;
  const id: LanguageId = {
    language: language === 'und' ? '' : language,
    script: '',
    region: '',
    variants: [],
  };
  if (SCRIPT.test(subtags[index] ?? '')) {
    const script = subtags[index] as string;
    id.script = script.charAt(0).toUpperCase() + script.slice(1);
    index += 1;
  }
  if (REGION.test(subtags[index] ?? '')) {
    id.region = (subtags[index] as string).toUpperCase();
    index += 1;
  }
  while (VARIANT.test(subtags[index] ?? '')) {
    const variant = subtags[index] as string;
    if (id.variants.includes(variant)) return undefined;
    id.variants.push(variant);
    index += 1;
  }
  return { id, next: index };
}

/** The first subtag after `start` that begins another extension, or the end of the tag. */
function extensionEnd(subtags: readonly string[], start: number): number {
  let index = start;
  while (index < subtags.length && (subtags[index] as string).length > 1) {
    index += 1;
  }
  return index;
}

/**
 * Attributes sorted, keywords sorted by key, and a keyword's `true` value dropped, as the annex
 * says; ECMA-402 keeps the first of a repeated attribute or key, which is what hosts produce.
 */
function unicodeExtension(body: readonly string[]): string | undefined {
  const attributes: string[] = [];
  const keywords = new Map<string, string>();
  let index = 0;
  while (index < body.length && EXTENSION_VALUE.test(body[index] as string)) {
    const attribute = body[index] as string;
    if (!attributes.includes(attribute)) attributes.push(attribute);
    index += 1;
  }
  while (index < body.length) {
    const key = body[index] as string;
    if (!UNICODE_KEY.test(key)) return undefined;
    index += 1;
    const value: string[] = [];
    while (index < body.length && EXTENSION_VALUE.test(body[index] as string)) {
      value.push(body[index] as string);
      index += 1;
    }
    if (!keywords.has(key)) keywords.set(key, value.join('-'));
  }
  if (attributes.length === 0 && keywords.size === 0) return undefined;
  return [
    ...attributes.sort(),
    ...[...keywords]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) =>
        value === '' || value === 'true' ? key : `${key}-${value}`,
      ),
  ].join('-');
}

/** The source language canonicalized like any other, and fields sorted by key. */
function transformedExtension(body: readonly string[]): string | undefined {
  let index = 0;
  let source: string | undefined;
  if (LANGUAGE.test(body[0] ?? '')) {
    const parsed = languageIdAt(body, 0);
    if (parsed === undefined) return undefined;
    const canonical = canonicalLanguageId(parsed.id);
    if (canonical === undefined) return undefined;
    source = canonical.toLowerCase();
    index = parsed.next;
  }
  const fields: { readonly key: string; readonly text: string }[] = [];
  while (index < body.length) {
    const key = body[index] as string;
    if (!TRANSFORM_KEY.test(key)) return undefined;
    index += 1;
    const value: string[] = [];
    while (index < body.length && EXTENSION_VALUE.test(body[index] as string)) {
      value.push(body[index] as string);
      index += 1;
    }
    if (value.length === 0) return undefined;
    fields.push({ key, text: `${key}-${value.join('-')}` });
  }
  if (source === undefined && fields.length === 0) return undefined;
  fields.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  return [...(source ? [source] : []), ...fields.map(({ text }) => text)].join(
    '-',
  );
}

function otherExtension(body: readonly string[]): string | undefined {
  return body.length > 0 && body.every((subtag) => subtag.length >= 2)
    ? body.join('-')
    : undefined;
}

/** Apply the first matching alias rule until none matches, then spell the result. */
function canonicalLanguageId(id: LanguageId): string | undefined {
  const current: LanguageId = { ...id, variants: [...id.variants].sort() };
  for (let step = 0; step <= MAXIMUM_ALIAS_STEPS; step += 1) {
    const rule = firstMatchingRule(current);
    if (rule === undefined) {
      return [
        current.language || 'und',
        current.script,
        current.region,
        ...current.variants,
      ]
        .filter((subtag) => subtag !== '')
        .join('-');
    }
    applyRule(current, rule);
  }
  return undefined;
}

function firstMatchingRule(id: LanguageId): AliasRule | undefined {
  const index = (aliasIndex ??= readAliasRules());
  let first: AliasRule | undefined;
  for (const field of indexKeys(id)) {
    for (const rule of index.get(field) ?? []) {
      if (
        (first === undefined || rule.order < first.order) &&
        matches(id, rule.type)
      ) {
        first = rule;
      }
    }
  }
  return first;
}

function matches(id: LanguageId, type: LanguageId): boolean {
  return (
    (type.language === '' || type.language === id.language) &&
    (type.script === '' || type.script === id.script) &&
    (type.region === '' || type.region === id.region) &&
    type.variants.every((variant) => id.variants.includes(variant))
  );
}

/**
 * The annex's replacement: a field the rule names is replaced, and a field it does not name is
 * filled from the replacement only when the tag left it empty.
 */
function applyRule(id: LanguageId, rule: AliasRule): void {
  const replacement =
    rule.replacements.length === 1
      ? (rule.replacements[0] as LanguageId)
      : territoryException(id, rule.replacements);
  const { type } = rule;
  if (type.language !== '' || id.language === '') {
    id.language =
      replacement.language || (type.language === '' ? id.language : '');
  }
  if (type.script !== '' || id.script === '') {
    id.script = replacement.script || (type.script === '' ? id.script : '');
  }
  if (type.region !== '' || id.region === '') {
    id.region = replacement.region || (type.region === '' ? id.region : '');
  }
  if (type.variants.length > 0) {
    id.variants = [
      ...new Set([
        ...id.variants.filter((variant) => !type.variants.includes(variant)),
        ...replacement.variants,
      ]),
    ].sort();
  } else if (id.variants.length === 0) {
    id.variants = [...replacement.variants];
  }
}

/**
 * A region split into several, such as `SU`, becomes the one likely subtags give the language and
 * script, where that is in the list, and the first otherwise.
 */
function territoryException(
  id: LanguageId,
  replacements: readonly LanguageId[],
): LanguageId {
  const regions = (likelyRegions ??= readLikelyRegions());
  const language = id.language || 'und';
  const likely =
    (id.script === '' ? undefined : regions.get(`${language}-${id.script}`)) ??
    regions.get(language);
  return (
    replacements.find(({ region }) => region === likely) ??
    (replacements[0] as LanguageId)
  );
}

function indexKeys(id: LanguageId): string[] {
  return [
    ...(id.language === '' ? [] : [`l:${id.language}`]),
    ...(id.script === '' ? [] : [`s:${id.script}`]),
    ...(id.region === '' ? [] : [`r:${id.region}`]),
    ...id.variants.map((variant) => `v:${variant}`),
  ];
}

function readAliasRules(): ReadonlyMap<string, readonly AliasRule[]> {
  const index = new Map<string, AliasRule[]>();
  LOCALE_ALIAS_RULES.split(',').forEach((entry, order) => {
    const [typeText = '', replacementText = ''] = entry.split('>');
    const type = parseRuleId(typeText);
    const rule: AliasRule = {
      order,
      type,
      replacements: replacementText.split(' ').map(parseRuleId),
    };
    // A rule is filed under one field it names, since a tag it matches carries that field.
    const key = indexKeys(type)[0] as string;
    const rules = index.get(key);
    if (rules === undefined) index.set(key, [rule]);
    else rules.push(rule);
  });
  return index;
}

function parseRuleId(text: string): LanguageId {
  return (languageIdAt(text.toLowerCase().split('-'), 0) as { id: LanguageId })
    .id;
}

function readLikelyRegions(): ReadonlyMap<string, string> {
  return new Map(
    LIKELY_REPLACEMENT_REGIONS.split(',').map(
      (entry) => entry.split('>') as [string, string],
    ),
  );
}
