/**
 * The locale kinds `specs/12-verification.spec.md` section 5 requires the gate to cover, and which
 * fixture locales cover each.
 *
 * A kind is decided from the pinned CLDR data wherever the data states it, so a locale counts for a
 * kind because the release it is pinned to says so rather than because someone listed it: direction
 * from `scriptMetadata.rtl`, a script written without spaces from `scriptMetadata.lbLetters`, complex
 * shaping from `scriptMetadata.shapingReq`, plural categories from the cardinal rules, digits from
 * the numbering system a locale declares. The script is the tag's own, or the one likely subtags
 * give it. Three kinds are not properties of a locale's data: a pseudo-locale is one the
 * configuration declares as one, a supplying language differs from the target where a configured
 * locale's language is not its source locale's, and content of unknown or fixed language is what a
 * fixture presents under `und` and `zxx`.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  INIT_REQUEST,
  LOCALE_FORMATTING,
  PSEUDO_LOCALES,
} from './package-consumer-locales.ts';

/** The kinds, in the order section 5 names them. */
export const LOCALE_KINDS = Object.freeze([
  Object.freeze({ id: 'right-to-left', name: 'a right to left language' }),
  Object.freeze({
    id: 'plural-categories',
    name: 'plural categories beyond one and other',
  }),
  Object.freeze({ id: 'non-latin-digits', name: 'non-Latin digits' }),
  Object.freeze({
    id: 'without-spaces',
    name: 'a script written without spaces',
  }),
  Object.freeze({ id: 'complex-shaping', name: 'complex shaping' }),
  Object.freeze({
    id: 'supplying-language',
    name: 'a supplying language different from the target',
  }),
  Object.freeze({
    id: 'unknown-or-fixed-content',
    name: 'content whose language is unknown or deliberately fixed',
  }),
  Object.freeze({ id: 'pseudo-locale', name: 'a pseudo-locale' }),
]);

export type LocaleKindId = (typeof LOCALE_KINDS)[number]['id'];

interface ScriptMetadata {
  readonly rtl?: string;
  readonly lbLetters?: string;
  readonly shapingReq?: string;
}

interface NumberingSystem {
  readonly _digits?: string;
}

export interface LocaleData {
  readonly likely: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, ScriptMetadata>>;
  readonly plurals: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly numberingSystems: {
    readonly latn: NumberingSystem;
    readonly [name: string]: NumberingSystem | undefined;
  };
}

export interface LocaleEntry {
  readonly fixture: string;
  readonly locale: string;
  readonly sourceLocale: string;
  readonly pseudo: boolean;
  readonly numberingSystem?: string;
}

interface LocaleConfiguration {
  readonly sourceLocale: string;
  readonly locales: readonly string[];
  readonly pseudoLocales?: Readonly<Record<string, unknown>>;
  readonly formatting?: Readonly<
    Record<string, { readonly numberingSystem?: string } | undefined>
  >;
}

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, 'utf8')) as T;

/** The pinned CLDR data the kinds are read from, with the version the lock records. */
export function pinnedLocaleData(repositoryRoot: string): LocaleData {
  const cldr = resolve(repositoryRoot, 'node_modules/cldr-core');
  assert.equal(
    readJson<{ readonly version?: unknown }>(resolve(cldr, 'package.json'))
      .version,
    '48.2.0',
  );
  const supplemental = (name: string) =>
    readJson<{
      readonly supplemental: {
        readonly likelySubtags: LocaleData['likely'];
        readonly 'plurals-type-cardinal': LocaleData['plurals'];
        readonly numberingSystems: LocaleData['numberingSystems'];
      };
    }>(resolve(cldr, 'supplemental', `${name}.json`)).supplemental;
  return {
    likely: supplemental('likelySubtags').likelySubtags,
    scripts: readJson<{ readonly scriptMetadata: LocaleData['scripts'] }>(
      resolve(cldr, 'scriptMetadata.json'),
    ).scriptMetadata,
    plurals: supplemental('plurals')['plurals-type-cardinal'],
    numberingSystems: supplemental('numberingSystems').numberingSystems,
  };
}

function scriptOf(tag: string, data: LocaleData): string | undefined {
  const [language, ...rest] = tag.split('-') as [string, ...string[]];
  const explicit = rest.find((subtag) => /^[A-Z][a-z]{3}$/u.test(subtag));
  if (explicit !== undefined) return explicit;
  const region = rest.find((subtag) => /^(?:[A-Z]{2}|\d{3})$/u.test(subtag));
  const likely =
    (region === undefined ? undefined : data.likely[`${language}-${region}`]) ??
    data.likely[language];
  return likely?.split('-')[1];
}

function pluralCategoriesOf(tag: string, data: LocaleData): string[] {
  const language = tag.split('-')[0] as string;
  const rules = data.plurals[tag] ?? data.plurals[language] ?? {};
  return Object.keys(rules).map((key) => key.replace('pluralRule-count-', ''));
}

/** The kinds one configured locale covers, read from the pinned data. */
export function kindsOf(
  entry: LocaleEntry,
  data: LocaleData,
): Set<LocaleKindId> {
  const kinds = new Set<LocaleKindId>();
  const script = scriptOf(entry.locale, data);
  const metadata = script === undefined ? undefined : data.scripts[script];
  if (metadata?.rtl === 'YES') kinds.add('right-to-left');
  if (metadata?.lbLetters === 'YES') kinds.add('without-spaces');
  if (metadata?.shapingReq === 'YES') kinds.add('complex-shaping');
  if (
    pluralCategoriesOf(entry.locale, data).some(
      (category) => category !== 'one' && category !== 'other',
    )
  ) {
    kinds.add('plural-categories');
  }
  const numbering =
    entry.numberingSystem ??
    /-u-(?:.*-)?nu-([a-z0-9]+)/u.exec(entry.locale)?.[1];
  const digits = data.numberingSystems[numbering ?? 'latn']?._digits;
  if (digits !== undefined && digits !== data.numberingSystems.latn._digits) {
    kinds.add('non-latin-digits');
  }
  if (entry.pseudo) kinds.add('pseudo-locale');
  if (entry.locale.split('-')[0] !== entry.sourceLocale.split('-')[0]) {
    kinds.add('supplying-language');
  }
  return kinds;
}

function configurationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : configurationFiles(path);
    }
    return entry.name === 'equator.config.json' ? [path] : [];
  });
}

function entriesOf(
  fixture: string,
  configuration: LocaleConfiguration,
): LocaleEntry[] {
  const pseudo = Object.keys(configuration.pseudoLocales ?? {});
  return [...configuration.locales, ...pseudo].map((locale) => ({
    fixture,
    locale,
    sourceLocale: configuration.sourceLocale,
    pseudo: pseudo.includes(locale),
    ...(configuration.formatting?.[locale]?.numberingSystem === undefined
      ? {}
      : { numberingSystem: configuration.formatting[locale].numberingSystem }),
  }));
}

/**
 * Every locale a fixture configures: the checked-in configuration files, and the main consumer's,
 * which its gate writes from `package-consumer-locales.ts` rather than checking one in.
 */
export function fixtureLocales(repositoryRoot: string): LocaleEntry[] {
  const fixtures = resolve(repositoryRoot, 'fixtures');
  return [
    ...configurationFiles(fixtures).flatMap((path) =>
      entriesOf(
        relative(repositoryRoot, path).replaceAll('\\', '/'),
        readJson<LocaleConfiguration>(path),
      ),
    ),
    ...entriesOf('the main package consumer', {
      ...INIT_REQUEST,
      pseudoLocales: PSEUDO_LOCALES,
      formatting: LOCALE_FORMATTING,
    }),
  ];
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : sourceFiles(path);
    }
    return entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * The languages fixture specs present content under: `contentPresentation` called with a literal
 * tag, which is how content carries a language of its own.
 */
export function fixtureContentLanguages(repositoryRoot: string): Set<string> {
  const languages = new Set<string>();
  for (const path of sourceFiles(resolve(repositoryRoot, 'fixtures'))) {
    for (const [, tag] of readFileSync(path, 'utf8').matchAll(
      /\bcontentPresentation\(\s*'([^']+)'/gu,
    )) {
      languages.add(tag as string);
    }
  }
  return languages;
}

/** Each kind, with the fixture locales or content languages that cover it. */
export function localeKindCoverage({
  locales,
  contentLanguages,
  data,
}: {
  readonly locales: readonly LocaleEntry[];
  readonly contentLanguages: ReadonlySet<string>;
  readonly data: LocaleData;
}): { id: LocaleKindId; name: string; covering: string[] }[] {
  const covering = new Map(
    LOCALE_KINDS.map(({ id }) => [id, new Set<string>()]),
  );
  for (const entry of locales) {
    for (const kind of kindsOf(entry, data)) {
      (covering.get(kind) as Set<string>).add(entry.locale);
    }
  }
  const unknown = [...contentLanguages].filter(
    (tag) => tag === 'und' || tag.startsWith('und-'),
  );
  // Unknown and fixed are two cases of one kind, and a fixture presenting only one of them has not
  // shown the other.
  if (unknown.length > 0 && contentLanguages.has('zxx')) {
    for (const tag of [...unknown, 'zxx']) {
      (covering.get('unknown-or-fixed-content') as Set<string>).add(tag);
    }
  }
  return LOCALE_KINDS.map(({ id, name }) => ({
    id,
    name,
    covering: [...(covering.get(id) as Set<string>)].sort(),
  }));
}
