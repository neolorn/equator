import {
  findNodeAtLocation,
  parseTree,
  printParseErrorCode,
  type Node as JsonNode,
  type ParseError,
} from 'jsonc-parser';

import { inspectTree } from './bounded-data.js';
import { requireArgument } from './call-arguments.js';
import { untrustedSource } from './untrusted-text.js';
import {
  toolkitDiagnostic,
  toolkitFailure,
  spanAt,
  toolkitSuccess,
  type ToolkitDiagnostic,
  type ToolkitDiagnosticCode,
  type ToolkitDiagnosticSeverity,
  type ToolkitResult,
} from './diagnostics.js';
import {
  ROOT_LOCALE,
  localeFallbackChain,
  localeParent,
  canonicalizeLocale,
  parseLocaleAlias,
  type CanonicalLocale,
} from './locales.js';
import {
  schemaErrorPath,
  schemaErrorSummary,
  compileSchema,
  sortedSchemaErrors,
} from './schema-validation.js';
import { CONFIGURATION_SCHEMA } from './schemas.js';
import {
  pseudoLocaleTagProblem,
  type PseudoLocaleTransform,
} from './pseudo-localization.js';
import { RESOURCE_LIMITS } from './resource-limits.js';
import {
  constructJsonValue,
  duplicateJsonKeys,
  jsonNestingExceeds,
  jsonNodeSpan,
} from './json-tree.js';

/** What reading a configuration file needs beyond its text. */
export interface ConfigurationParseOptions {
  /** Where it came from, carried into every diagnostic about it. */
  readonly sourcePath?: string;
}

/**
 * How one locale is written, where the application disagrees with CLDR about it.
 *
 * The three fields of a runtime `FormattingContext` that are facts about the locale rather than
 * about the reader. `timeZone` is the fourth field and is deliberately not here: it belongs to the
 * reader or to the business, not to the language, so it stays application-wide.
 *
 * Every field is optional, and an absent field is not a blank one: it means CLDR's answer for
 * that locale stands, which is the standard's choice rather than a gap. The schema refuses an entry
 * that sets nothing at all, because an empty entry reads as a decision somebody made.
 */
export interface LocaleFormatting {
  readonly numberingSystem?: string;
  readonly calendar?: string;
  readonly hourCycle?: 'h11' | 'h12' | 'h23' | 'h24';
}

/**
 * A locale that is still being translated, and why.
 *
 * The release completeness gate requires every locale to carry every source message; this is how a
 * project says that one of them is not there yet. The findings are still reported: what changes
 * is whether they stop the release.
 *
 * `note` is required because an exemption with no reason is the kind nobody removes. It is quoted
 * back in every finding it downgrades, so the reason travels with the effect instead of sitting in
 * a file nobody rereads.
 */
export interface LocaleInProgress {
  readonly note: string;
}

/**
 * The locale set, and nothing else.
 *
 * Decision section 2 closes this file at the locale-set identity: what the compiler must know
 * before it can analyse any code. `profile` was a second version marker beside `schemaVersion`,
 * carrying no information the file did not already have: one file, one version marker.
 */
export interface ProjectConfiguration {
  /** Which version of the configuration format this is. */
  readonly schemaVersion: 1;
  /** The locale messages are authored in, which is the one every translation is measured against. */
  readonly sourceLocale: CanonicalLocale;
  /** The locale used when nothing else selects one. Must be among the locales built. */
  readonly defaultLocale: CanonicalLocale;
  /** Every locale the project builds, canonically spelled, including the source. */
  readonly locales: readonly CanonicalLocale[];
  /**
   * Locales whose person names this application formats, beyond the ones it is translated into.
   *
   * Person-name patterns are generated for `locales` already. This adds the locales a name may be
   * *written in* while the interface stays in one of those: a fact about the product that Equator
   * cannot derive, which is why it is declared rather than inferred. An application rendering
   * names people typed in needs a wider set than one with a fixed roster.
   *
   * Empty when the key is absent, which is the ordinary case.
   *
   * **What goes wrong without it, and why it is quiet.** A name written in a script none of the
   * configured locales use is formatted with the interface's own patterns. The *order* is still
   * right, that comes from the interface locale's own list of which languages put the surname
   * first, so the result looks correct. What is wrong is everything else the name's locale
   * would have said: spacing, punctuation, which fields appear. An `en-US` application renders a
   * Japanese name `鈴木 一郎`, surname first with an English space, where `ja`
   * writes `鈴木一郎` with none. Nothing fails, nothing is reported, and the
   * output is wrong in a way only a reader of that language sees. Listing `ja` here is the fix.
   */
  readonly personNameLocales: readonly CanonicalLocale[];
  /**
   * Locales generated from the source catalog rather than authored, and how each one differs.
   *
   * A pseudo-locale is a member of the locale set like any other, which is why it is declared here
   * and not in a file of its own. What makes it different is only that nobody writes its catalog:
   * Equator derives one from the source catalog at generate time, and everything downstream
   * receives an ordinary target catalog it cannot distinguish from a translation.
   *
   * **Declaring one does not generate it.** Generation is off unless `equator generate --pseudo`
   * asks for it, so the same configuration file serves the development build that wants
   * pseudo-locales and the production build that must not contain them. That split is what makes
   * the production guarantee an absence rather than a flag: the catalog is not emitted, it is not
   * in the generated locale table, and the transform that would have produced it lives in a
   * development dependency that never reaches a bundle.
   *
   * **It reaches everything a locale reaches, including the application's own content.** A
   * pseudo-locale is negotiated, addressed, prerendered and asked for like any other locale, so an
   * application that localizes anything outside a catalog (articles, product data, anything
   * behind a `LocalizationParticipant`) is asked for a locale it can have no content in, and
   * nothing can produce that content because Equator never sees it. A participant that answers
   * `unavailable` there fails the render rather than the region: required participants fail the
   * transition, and under prerendering that is a build error with no page written. The answer is a
   * `ready` report whose `supplyingLocale` names the locale the content really came from, which is
   * documented on `LocalizationParticipant` and is worth reading before the first `--pseudo` build.
   *
   * Empty when the key is absent, which is the ordinary case.
   */
  readonly pseudoLocales: Readonly<Record<string, PseudoLocaleTransform>>;
  /**
   * Spellings that resolve to a locale the project builds, keyed by the spelling.
   *
   * What keeps an address or a stored preference working after a locale is renamed, and what lets
   * `en-GB` be answered by `en` where the project ships only one of them.
   *
   * Empty when the key is absent.
   */
  readonly aliases: Readonly<Record<string, CanonicalLocale>>;
  /**
   * How each locale is written, keyed by the locale it speaks about.
   *
   * Empty when the key is absent, which is the ordinary case: an application that agrees with CLDR
   * about every locale it ships declares nothing here and gets CLDR's answer for each one.
   */
  readonly formatting: Readonly<Record<string, LocaleFormatting>>;
  /**
   * The locales this project has said are still being translated, keyed by locale.
   *
   * Empty when the key is absent, and that is the strict state rather than the lax one: every
   * locale is required to be complete unless it is named here.
   */
  readonly inProgress: Readonly<Record<string, LocaleInProgress>>;
  /**
   * Which locale each locale inherits from, where this project disagrees with CLDR.
   *
   * Empty when the key is absent, which is the ordinary case: a project that agrees with CLDR
   * about inheritance declares nothing and gets the pinned chain for every locale it ships.
   *
   * `und` as a value means the locale inherits from root, so it has no parent and falls straight
   * to the source locale.
   */
  readonly parentLocales: Readonly<Record<string, CanonicalLocale>>;
}

/**
 * The fields an invocation may set, which is the parser's own shape minus the version marker.
 *
 * Derived rather than written out, so a key added to `RawConfiguration` is settable through
 * `equator init` on the day it lands and a key removed stops type-checking at every caller. A
 * second list of field names here is precisely the failure 10.5 reports: `personNameLocales`
 * reached the parser and never reached `init`, and nothing was in a position to notice.
 *
 * `schemaVersion` is fixed by the schema, so an invocation choosing it could only be wrong.
 */
export type InitConfiguration = Partial<
  Omit<RawConfiguration, 'schemaVersion'>
>;

interface RawConfiguration {
  readonly schemaVersion: 1;
  readonly sourceLocale: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly personNameLocales?: readonly string[];
  readonly pseudoLocales?: Readonly<Record<string, PseudoLocaleTransform>>;
  readonly aliases?: Readonly<Record<string, string>>;
  readonly formatting?: Readonly<Record<string, LocaleFormatting>>;
  readonly inProgress?: Readonly<Record<string, LocaleInProgress>>;
  readonly parentLocales?: Readonly<Record<string, string>>;
}

const validateConfiguration = compileSchema(CONFIGURATION_SCHEMA);

function syntaxDiagnostic(
  source: string,
  error: ParseError,
  sourcePath: string | undefined,
): ToolkitDiagnostic {
  return toolkitDiagnostic(
    'EQ1001',
    `Equator configuration contains invalid JSON: ${printParseErrorCode(error.error)}.`,
    {
      span: spanAt(source, error.offset, Math.max(1, error.length), sourcePath),
    },
  );
}

function configurationDiagnostic(
  source: string,
  root: JsonNode,
  sourcePath: string | undefined,
  code: ToolkitDiagnosticCode,
  summary: string,
  path: readonly (string | number)[],
): ToolkitDiagnostic {
  const span = jsonNodeSpan(
    source,
    findNodeAtLocation(root, [...path]),
    sourcePath,
  );
  return toolkitDiagnostic(code, summary, {
    path,
    ...(span === undefined ? {} : { span }),
  });
}

function freezeLocaleRecord(
  entries: readonly (readonly [string, CanonicalLocale])[],
): Readonly<Record<string, CanonicalLocale>> {
  const record = Object.create(null) as Record<string, CanonicalLocale>;
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  }
  return Object.freeze(record);
}

/**
 * Reads an `equator.config.json` and returns it parsed, or the reasons it could not be.
 *
 * Takes the file's text. Validates against the published schema, canonicalizes every locale, and
 * checks the things a schema cannot: that the default locale is one of the locales built, that an
 * alias points at one, that a pseudo-locale does not collide with a real one.
 *
 * Diagnostics carry the line and column in the original text, so a problem points at the place in
 * the file. Returns a failure rather than throwing, including for input that is not text at all.
 */
export function parseConfiguration(
  sourceValue: unknown,
  options: ConfigurationParseOptions = {},
): ToolkitResult<ProjectConfiguration> {
  requireArgument('parseConfiguration', 'options', options, {
    optional: { sourcePath: 'text' },
  });
  // A non-string reached Buffer.byteLength and threw a raw TypeError out of a function whose
  // contract is to return a diagnostic instead of throwing.
  const sourceText = untrustedSource(
    sourceValue,
    'EQ1001',
    'Equator configuration source',
  );
  if (!sourceText.ok) return sourceText;
  const source = sourceText.value;
  if (Buffer.byteLength(source, 'utf8') > RESOURCE_LIMITS.configurationBytes) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1001',
        `Equator configuration exceeds the ${RESOURCE_LIMITS.configurationBytes}-byte implementation ceiling.`,
        {
          span: spanAt(source, 0, source.length, options.sourcePath),
        },
      ),
    ]);
  }
  if (jsonNestingExceeds(source, RESOURCE_LIMITS.jsonDepth)) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1001',
        `Equator configuration exceeds the JSON depth ceiling of ${RESOURCE_LIMITS.jsonDepth}.`,
      ),
    ]);
  }
  const parseErrors: ParseError[] = [];
  const root = parseTree(source, parseErrors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  });

  if (parseErrors.length > 0 || root === undefined) {
    const diagnostics = parseErrors
      .slice(0, RESOURCE_LIMITS.diagnostics)
      .map((error) => syntaxDiagnostic(source, error, options.sourcePath));
    if (diagnostics.length === 0) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1001',
          'Equator configuration must contain one JSON value.',
        ),
      );
    }
    return toolkitFailure(diagnostics);
  }

  const tree = inspectTree(root, (node) => node.children ?? [], {
    maximumDepth: RESOURCE_LIMITS.jsonDepth,
    maximumNodes: RESOURCE_LIMITS.jsonNodes,
  });
  if (tree.failure !== undefined) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1001',
        tree.failure === 'depth'
          ? `Equator configuration exceeds the JSON depth ceiling of ${RESOURCE_LIMITS.jsonDepth}.`
          : `Equator configuration exceeds the JSON node ceiling of ${RESOURCE_LIMITS.jsonNodes}.`,
      ),
    ]);
  }

  const duplicateDiagnostics = duplicateJsonKeys(
    source,
    root,
    options.sourcePath,
    {
      code: 'EQ1001',
      summary: (key) =>
        `Equator configuration contains the duplicate key ${JSON.stringify(key)}.`,
    },
  );
  if (duplicateDiagnostics.length > 0) {
    return toolkitFailure(duplicateDiagnostics);
  }

  const value = constructJsonValue(root);
  if (!validateConfiguration(value)) {
    return toolkitFailure(
      sortedSchemaErrors(validateConfiguration.errors)
        .slice(0, RESOURCE_LIMITS.diagnostics)
        .map((error) => {
          const path = schemaErrorPath(error);
          return configurationDiagnostic(
            source,
            root,
            options.sourcePath,
            'EQ1002',
            schemaErrorSummary('Equator configuration', error),
            path,
          );
        }),
    );
  }

  const raw = value as RawConfiguration;
  const diagnostics: ToolkitDiagnostic[] = [];
  const locales: CanonicalLocale[] = [];
  const localeSet = new Set<string>();

  for (const [index, locale] of raw.locales.entries()) {
    const canonical = canonicalizeLocale(locale);
    if (!canonical.ok) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1003',
          `Supported locale ${JSON.stringify(locale)} is malformed.`,
          ['locales', index],
        ),
      );
      continue;
    }

    if (localeSet.has(canonical.value)) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1004',
          `Supported locale ${JSON.stringify(locale)} duplicates ${JSON.stringify(canonical.value)} after canonicalization.`,
          ['locales', index],
        ),
      );
      continue;
    }

    localeSet.add(canonical.value);
    locales.push(canonical.value);
  }

  const sourceLocale = canonicalizeLocale(raw.sourceLocale);
  const defaultLocale = canonicalizeLocale(raw.defaultLocale);

  for (const [name, authored, parsed] of [
    ['source', raw.sourceLocale, sourceLocale],
    ['default', raw.defaultLocale, defaultLocale],
  ] as const) {
    const path = name === 'source' ? ['sourceLocale'] : ['defaultLocale'];
    if (!parsed.ok) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1003',
          `The ${name} locale ${JSON.stringify(authored)} is malformed.`,
          path,
        ),
      );
    } else if (!localeSet.has(parsed.value)) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1004',
          `The ${name} locale ${JSON.stringify(parsed.value)} is not declared in locales.`,
          path,
        ),
      );
    }
  }

  // Not required to appear in `locales`: a name locale an application never renders its
  // interface in is the entire reason this key exists.
  const personNameLocales: CanonicalLocale[] = [];
  const personNameLocaleSet = new Set<CanonicalLocale>();
  for (const [index, locale] of (raw.personNameLocales ?? []).entries()) {
    const canonical = canonicalizeLocale(locale);
    if (!canonical.ok) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1003',
          `Person-name locale ${JSON.stringify(locale)} is malformed.`,
          ['personNameLocales', index],
        ),
      );
      continue;
    }
    if (personNameLocaleSet.has(canonical.value)) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1004',
          `Person-name locale ${JSON.stringify(locale)} duplicates ${JSON.stringify(canonical.value)} after canonicalization.`,
          ['personNameLocales', index],
        ),
      );
      continue;
    }
    personNameLocaleSet.add(canonical.value);
    personNameLocales.push(canonical.value);
  }

  // Canonicalized, refused if it collides with an authored locale, and sorted so the generated
  // locale set is deterministic regardless of key order in the file.
  const pseudoLocales: [string, PseudoLocaleTransform][] = [];
  const configuredLocales = new Set<string>(locales);
  for (const tag of Object.keys(raw.pseudoLocales ?? {}).sort()) {
    const transform = raw.pseudoLocales?.[tag];
    if (transform === undefined) continue;
    const canonical = canonicalizeLocale(tag);
    if (!canonical.ok) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1003',
          `Pseudo-locale ${JSON.stringify(tag)} is malformed. A pseudo-locale carries its text direction in its own script subtag, so the tag must be a well-formed catalog locale identity; private-use subtags are not.`,
          ['pseudoLocales', tag],
        ),
      );
      continue;
    }
    if (configuredLocales.has(canonical.value)) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1004',
          `Pseudo-locale ${JSON.stringify(canonical.value)} is also declared in "locales". A pseudo-locale is generated from the source catalog, so declaring it as an authored locale would ask for both a written catalog and a derived one under the same identity.`,
          ['pseudoLocales', tag],
        ),
      );
      continue;
    }
    const problem = sourceLocale.ok
      ? pseudoLocaleTagProblem(canonical.value, sourceLocale.value, transform)
      : undefined;
    if (problem !== undefined) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1008',
          problem,
          ['pseudoLocales', tag],
        ),
      );
      continue;
    }
    configuredLocales.add(canonical.value);
    pseudoLocales.push([canonical.value, Object.freeze({ ...transform })]);
  }

  // Sorted for the same reason the pseudo-locales are: the generated table must not depend on the
  // order somebody typed the keys in.
  const formatting: [string, LocaleFormatting][] = [];
  for (const tag of Object.keys(raw.formatting ?? {}).sort()) {
    const entry = raw.formatting?.[tag];
    if (entry === undefined) continue;
    const canonical = canonicalizeLocale(tag);
    if (!canonical.ok) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1003',
          `Formatting is declared for ${JSON.stringify(tag)}, which is not a well-formed locale identity.`,
          ['formatting', tag],
        ),
      );
      continue;
    }
    // A locale this project does not ship. Left as an error rather than ignored: the entry states
    // something about a locale, and a statement about a locale nobody is served is either a typo
    // or a locale somebody meant to declare, and both are worth stopping for.
    if (!configuredLocales.has(canonical.value)) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1004',
          `Formatting is declared for ${JSON.stringify(canonical.value)}, which is not in "locales" or "pseudoLocales". Formatting says how a locale this project serves is written, so a locale it does not serve has nothing to say.`,
          ['formatting', tag],
        ),
      );
      continue;
    }
    formatting.push([canonical.value, Object.freeze({ ...entry })]);
  }

  const inProgress: [string, LocaleInProgress][] = [];
  for (const tag of Object.keys(raw.inProgress ?? {}).sort()) {
    const entry = raw.inProgress?.[tag];
    if (entry === undefined) continue;
    const canonical = canonicalizeLocale(tag);
    if (!canonical.ok) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1003',
          `A translation-in-progress entry is declared for ${JSON.stringify(tag)}, which is not a well-formed locale identity.`,
          ['inProgress', tag],
        ),
      );
      continue;
    }
    // Only an authored target locale can be short of the source. The source locale defines what
    // complete means, and a pseudo-locale is derived from it rather than written, so neither can be
    // in progress: an entry for one states something that can never be true, which reads as a
    // decision somebody made and is really a typo.
    if (
      !locales.includes(canonical.value) ||
      (sourceLocale.ok && canonical.value === sourceLocale.value)
    ) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1004',
          `A translation-in-progress entry is declared for ${JSON.stringify(canonical.value)}, which is not an authored target locale. Only a locale in "locales" other than the source locale can be short of the source.`,
          ['inProgress', tag],
        ),
      );
      continue;
    }
    inProgress.push([canonical.value, Object.freeze({ ...entry })]);
  }

  // Which locale each locale inherits from, where this project disagrees with CLDR.
  //
  // Two checks and not three. A key must be a well-formed locale, and a value must be one or
  // `und`; neither has to be a locale this project ships, because a chain runs through locales
  // nobody serves and redirecting one of those is the point. What is checked instead is that the
  // declaration reaches something: an entry no configured locale inherits through changes nothing,
  // and an entry that changes nothing is a typo far more often than it is a plan.
  const declaredParents: Record<string, CanonicalLocale> = Object.create(
    null,
  ) as Record<string, CanonicalLocale>;
  const parentLocales: [string, CanonicalLocale][] = [];
  for (const tag of Object.keys(raw.parentLocales ?? {}).sort()) {
    const target = raw.parentLocales?.[tag];
    if (target === undefined) continue;
    const canonical = canonicalizeLocale(tag);
    if (!canonical.ok) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1003',
          `A parent locale is declared for ${JSON.stringify(tag)}, which is not a well-formed locale identity.`,
          ['parentLocales', tag],
        ),
      );
      continue;
    }
    const canonicalTarget = canonicalizeLocale(target);
    if (!canonicalTarget.ok) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1003',
          `Locale ${JSON.stringify(canonical.value)} declares parent ${JSON.stringify(target)}, which is not a well-formed locale identity. Use a locale, or ${JSON.stringify(ROOT_LOCALE)} for no parent.`,
          ['parentLocales', tag],
        ),
      );
      continue;
    }
    if (canonicalTarget.value === canonical.value) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1007',
          `Locale ${JSON.stringify(canonical.value)} declares itself as its own parent. Use ${JSON.stringify(ROOT_LOCALE)} to say it has no parent.`,
          ['parentLocales', tag],
        ),
      );
      continue;
    }
    declaredParents[canonical.value] = canonicalTarget.value;
    parentLocales.push([canonical.value, canonicalTarget.value]);
  }

  // Walked once, for both answers it has to give. `localeFallbackChain` stops at the first
  // locale it has already seen, so a chain whose last member still has a parent is a chain that
  // came back on itself, and everything the walk visited is a locale some configured locale
  // inherits through.
  const inheritedThrough = new Set<string>();
  for (const locale of [...configuredLocales].sort()) {
    const chain = localeFallbackChain(locale, declaredParents);
    inheritedThrough.add(locale);
    for (const parent of chain) inheritedThrough.add(parent);
    const last = chain[chain.length - 1] ?? locale;
    const beyond = localeParent(last, declaredParents);
    if (beyond !== undefined) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1007',
          `The parent chain for ${JSON.stringify(locale)} returns to ${JSON.stringify(beyond)}: ${[locale, ...chain, beyond].join(' to ')}. A chain must end, so one of the declarations in it has to name ${JSON.stringify(ROOT_LOCALE)} or a locale outside it.`,
          ['parentLocales', last],
        ),
      );
    }
  }
  for (const [tag] of parentLocales) {
    if (inheritedThrough.has(tag)) continue;
    diagnostics.push(
      configurationDiagnostic(
        source,
        root,
        options.sourcePath,
        'EQ1004',
        `A parent locale is declared for ${JSON.stringify(tag)}, which no locale this project serves inherits through. The declaration has no effect.`,
        ['parentLocales', tag],
      ),
    );
  }

  const aliases: [string, CanonicalLocale][] = [];
  for (const alias of Object.keys(raw.aliases ?? {}).sort()) {
    const target = raw.aliases?.[alias];
    if (target === undefined) {
      continue;
    }

    const parsedAlias = parseLocaleAlias(alias);
    if (!parsedAlias.ok) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1005',
          `Locale alias ${JSON.stringify(alias)} is malformed.`,
          ['aliases', alias],
        ),
      );
      continue;
    }

    const aliasAsLocale = canonicalizeLocale(alias);
    if (aliasAsLocale.ok && localeSet.has(aliasAsLocale.value)) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1006',
          `Locale alias ${JSON.stringify(alias)} shadows supported locale ${JSON.stringify(aliasAsLocale.value)}.`,
          ['aliases', alias],
        ),
      );
    }

    const canonicalTarget = canonicalizeLocale(target);
    if (!canonicalTarget.ok) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1003',
          `Locale alias ${JSON.stringify(alias)} has malformed target ${JSON.stringify(target)}.`,
          ['aliases', alias],
        ),
      );
    } else if (!localeSet.has(canonicalTarget.value)) {
      diagnostics.push(
        configurationDiagnostic(
          source,
          root,
          options.sourcePath,
          'EQ1006',
          `Locale alias ${JSON.stringify(alias)} targets unsupported locale ${JSON.stringify(canonicalTarget.value)}.`,
          ['aliases', alias],
        ),
      );
    } else {
      aliases.push([parsedAlias.value, canonicalTarget.value]);
    }
  }

  if (diagnostics.length > 0 || !sourceLocale.ok || !defaultLocale.ok) {
    return toolkitFailure(diagnostics);
  }

  const configuration: ProjectConfiguration = Object.freeze({
    schemaVersion: 1,
    sourceLocale: sourceLocale.value,
    defaultLocale: defaultLocale.value,
    locales: Object.freeze(locales),
    personNameLocales: Object.freeze(personNameLocales),
    pseudoLocales: Object.freeze(Object.fromEntries(pseudoLocales)),
    aliases: freezeLocaleRecord(aliases),
    formatting: Object.freeze(Object.fromEntries(formatting)),
    inProgress: Object.freeze(Object.fromEntries(inProgress)),
    parentLocales: freezeLocaleRecord(parentLocales),
  });
  parsedConfigurations.add(configuration);
  return toolkitSuccess(configuration);
}

/** What `parseConfiguration` returned, which `admitConfiguration` answers without reading again. */
const parsedConfigurations = new WeakSet<object>();

/**
 * A parsed configuration with its declared pseudo-locales among its locales.
 *
 * A build that asked for pseudo-locales compiles them as locales, and no configuration file can
 * say that: a tag in both lists is refused there. The host builds this from a configuration the
 * parser returned, so it is admitted as that one was.
 */
export function configurationWithPseudoLocales(
  configuration: ProjectConfiguration,
): ProjectConfiguration {
  const extended: ProjectConfiguration = Object.freeze({
    ...configuration,
    locales: Object.freeze([
      ...configuration.locales,
      ...pseudoLocaleTags(configuration),
    ]),
  });
  if (parsedConfigurations.has(configuration)) {
    parsedConfigurations.add(extended);
  }
  return extended;
}

/** The members a parsed configuration always carries and a configuration file may leave out. */
const OMITTED_WHEN_EMPTY: ReadonlySet<string> = new Set([
  'personNameLocales',
  'pseudoLocales',
  'aliases',
  'formatting',
  'inProgress',
  'parentLocales',
]);

/**
 * Judges a configuration a caller hands a programmatic entry point, before anything reads it.
 *
 * What `parseConfiguration` returned has been judged and is answered as it is. Any other object is
 * a configuration nobody has read: it is written as the file it would be and parsed, so it is
 * refused for what `parseConfiguration` refuses and with the same diagnostics. The diagnostics
 * carry no position, because the text they would point into is one no file holds.
 */
export function admitConfiguration(
  configuration: ProjectConfiguration,
): ToolkitResult<ProjectConfiguration> {
  if (parsedConfigurations.has(configuration)) {
    return toolkitSuccess(configuration);
  }
  let source: string | undefined;
  try {
    source = JSON.stringify(
      Object.fromEntries(
        Object.entries(configuration).filter(
          ([member, value]) =>
            !(
              OMITTED_WHEN_EMPTY.has(member) &&
              typeof value === 'object' &&
              value !== null &&
              Object.keys(value).length === 0
            ),
        ),
      ),
    );
  } catch {
    // An accessor that throws, a cycle, a value JSON has no form for.
    source = undefined;
  }
  if (source === undefined) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1001',
        'A configuration handed over as an object holds a value that cannot be written as JSON.',
      ),
    ]);
  }
  const parsed = parseConfiguration(source);
  if (parsed.ok) return parsed;
  return toolkitFailure(
    parsed.diagnostics.map(({ code, summary, severity, path }) =>
      toolkitDiagnostic(code, summary, { severity, path }),
    ),
  );
}

/**
 * The declared pseudo-locale tags, canonical, in the order the generated locale table carries them.
 *
 * `Object.keys` erases the key type and these keys are `CanonicalLocale` values: every one was put
 * through `canonicalizeLocale` by the parser above, sorted, and checked against the authored
 * locales before being inserted, and nothing else can add a key to a frozen record. The assertion
 * belongs here, beside the loop that establishes it, rather than at a call site that would have to
 * take it on trust.
 */
export function pseudoLocaleTags(
  configuration: ProjectConfiguration,
): readonly CanonicalLocale[] {
  return Object.freeze(
    Object.keys(configuration.pseudoLocales) as CanonicalLocale[],
  );
}

/**
 * Whether a completeness finding about one locale stops the release, and what to say if it does not.
 *
 * **One rule for the whole family.** A locale with no catalog at all (`EQ1306`), a catalog missing
 * a message (`EQ1307`), a message missing a plural category (`EQ1308`) and a translation written
 * against an older source (`EQ1309`) are one question asked at four granularities: is this locale
 * finished. They escalate together or not at all. A gate that blocked on a missing message and
 * passed a missing catalog would report a green meaning "every message is translated except in the
 * locales where none are".
 *
 * Two things have to be true for a finding to block. The **run** asked for it, which is the switch
 * on the command; and the **project** has not said this locale is still being translated, which is
 * the declaration in its configuration. Neither substitutes for the other: enforcement is a fact
 * about this run, and which locales are expected to be finished is a fact about the project.
 */
export interface CompletenessPolicy {
  readonly severity: ToolkitDiagnosticSeverity;
  /**
   * Appended to the finding's own sentence, and empty unless a declaration is what downgraded it.
   *
   * Nothing is added when the gate is off, because nothing was downgraded: the finding is a warning
   * for the ordinary reason. The clause exists for the one case that is otherwise invisible: a
   * release gate that is on, a locale that is incomplete, and a green result.
   */
  readonly suffix: string;
}

export function completenessPolicy(
  configuration: Pick<ProjectConfiguration, 'inProgress'>,
  requireComplete: boolean,
  locale: string,
): CompletenessPolicy {
  if (!requireComplete) return NON_BLOCKING;
  const declared = configuration.inProgress[locale];
  if (declared === undefined) return BLOCKING;
  return Object.freeze({
    severity: 'warning' as const,
    suffix: ` ${locale} is declared still in progress: ${declared.note}`,
  });
}

const NON_BLOCKING: CompletenessPolicy = Object.freeze({
  severity: 'warning' as const,
  suffix: '',
});
const BLOCKING: CompletenessPolicy = Object.freeze({
  severity: 'error' as const,
  suffix: '',
});

/**
 * The same family, as a set, for the one question that has to ask what raised a severity.
 *
 * Every occurrence of these codes takes its severity from `completenessPolicy` and from nowhere
 * else, so a member at `error` is a release policy speaking rather than a fault in the model. That
 * is what lets the catalog analysis keep the graph it finished building: a locale missing a message,
 * or missing every message, still compiles and still generates, it falls back to the source, and
 * an analysis that threw the graph away over it would leave everything downstream of the compile
 * unreported: a project both incomplete and stale would report `EQ1307` alone with the gate on,
 * and `EQ1307`, `EQ1309` and `EQ1704` with it off.
 *
 * `EQ1309` is a member and is never raised by the analysis: it is raised against the translation
 * record, which is read after the compile. It is listed anyway, because the family is one thing and
 * a reader who found three of four here would reasonably conclude the fourth was not a member.
 *
 * This is not the pass decision. Whether a run may pass is answered on severity alone, in
 * `diagnosticsBlock`, and keying that on codes is the trap that function exists to close. The
 * question here is a different one, whether a model was built, and its answer is a property of
 * these four findings rather than a list of what is allowed to fail.
 */
export const COMPLETENESS_CODES: ReadonlySet<ToolkitDiagnosticCode> =
  Object.freeze(
    new Set<ToolkitDiagnosticCode>(['EQ1306', 'EQ1307', 'EQ1308', 'EQ1309']),
  ) as ReadonlySet<ToolkitDiagnosticCode>;

export function formatConfiguration(
  configuration: ProjectConfiguration,
): string {
  const aliases = Object.fromEntries(
    Object.entries(configuration.aliases).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
  const output = {
    schemaVersion: configuration.schemaVersion,
    sourceLocale: configuration.sourceLocale,
    defaultLocale: configuration.defaultLocale,
    locales: configuration.locales,
    // Omitted when empty, like `aliases`: `init` writes neither, and a key present but empty
    // would say an application had considered this and chosen nothing.
    ...(configuration.personNameLocales.length === 0
      ? {}
      : { personNameLocales: configuration.personNameLocales }),
    ...(Object.keys(configuration.pseudoLocales).length === 0
      ? {}
      : { pseudoLocales: configuration.pseudoLocales }),
    ...(Object.keys(aliases).length === 0 ? {} : { aliases }),
    ...(Object.keys(configuration.formatting).length === 0
      ? {}
      : { formatting: configuration.formatting }),
    ...(Object.keys(configuration.inProgress).length === 0
      ? {}
      : { inProgress: configuration.inProgress }),
    ...(Object.keys(configuration.parentLocales).length === 0
      ? {}
      : { parentLocales: configuration.parentLocales }),
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}
