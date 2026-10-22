/**
 * A locale nobody translated, so a developer can see what translation is going to do.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 16 configures the direction, the length factor
 * and the boundary markers independently rather than as a set of modes, and keeps the transform
 * at build time: a production build does not generate the catalog, so there is no transform in
 * the bundle for anything to enable by accident.
 */

import { parseMessage, stringifyMessage, type Model } from 'messageformat';

import { requireArgument } from './call-arguments.js';
import {
  admitCatalog,
  builtCatalog,
  type Catalog,
  type CatalogMessage,
  type TextCatalogMessage,
} from './catalog.js';
import {
  toolkitDiagnostic,
  toolkitFailure,
  toolkitSuccess,
  type ToolkitResult,
} from './diagnostics.js';
import { canonicalizeLocale } from './locales.js';
import {
  parseMessageSemanticModel,
  type MessageCustomFunction,
} from './message-format.js';
import {
  PSEUDO_LOCALE_BIDI,
  PSEUDO_LOCALE_ACCENTED,
  pseudoLocaleRegionProblem,
} from './pseudo-locale-tags.js';
import { RTL_SCRIPTS } from './rtl-scripts.generated.js';

/**
 * The language, script and region subtags of a tag already in canonical form.
 *
 * Read by position rather than through `Intl.Locale`, which canonicalizes the tag again with the
 * host's own alias data. The tag is canonical by the pinned CLDR release already, and a second
 * canonicalization by the host would let the machine that reads the configuration decide which
 * language a pseudo-locale is in.
 */
function canonicalSubtags(tag: string): {
  readonly language: string;
  readonly script: string | undefined;
  readonly region: string | undefined;
} {
  const [language = '', ...rest] = tag.split('-');
  const script = /^[A-Za-z]{4}$/u.test(rest[0] ?? '')
    ? rest.shift()
    : undefined;
  const region = /^(?:[A-Za-z]{2}|[0-9]{3})$/u.test(rest[0] ?? '')
    ? rest[0]
    : undefined;
  return { language, script, region };
}

/**
 * What stops a well-formed tag from identifying a pseudo-locale, or nothing when it does.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 16: the script subtag carries the direction, so
 * it is written out; the language is the source catalog's, so a developer reads their own screens
 * transformed; and the region claims nothing the locale is not, which needs the declared length
 * because `XA` means lengthened.
 */
export function pseudoLocaleTagProblem(
  tag: string,
  sourceLocale: string,
  transform: PseudoLocaleTransform,
): string | undefined {
  const locale = canonicalSubtags(tag);
  if (locale.script === undefined) {
    return `Pseudo-locale ${JSON.stringify(tag)} names no script. A pseudo-locale carries its text direction in its own script subtag, as ${PSEUDO_LOCALE_ACCENTED} and ${PSEUDO_LOCALE_BIDI} do.`;
  }
  const source = canonicalSubtags(sourceLocale).language;
  if (locale.language !== source) {
    return `Pseudo-locale ${JSON.stringify(tag)} is in the language ${locale.language}, and the source locale is in ${source}. A pseudo-locale keeps the source language, so a developer reads their own screens transformed.`;
  }
  const problem = pseudoLocaleRegionProblem({
    language: locale.language,
    region: locale.region,
    direction: RTL_SCRIPTS.includes(locale.script) ? 'rtl' : 'ltr',
    lengthened: (transform.lengthFactor ?? 0) > 0,
  });
  return problem === undefined
    ? undefined
    : `Pseudo-locale ${JSON.stringify(tag)} ${problem}`;
}

/**
 * How a pseudo-locale differs from its source, as settings that combine freely.
 *
 * Nothing about the behaviours requires them to be bundled, so they are not: a reader can ask for
 * expansion *and* boundary markers, or contraction *without* them, which a set of fixed
 * combinations could not express.
 *
 * **Direction is deliberately absent from this interface.** It is carried by the locale tag, not by
 * the transform: direction is derived from the script subtag through the generated `RTL_SCRIPTS`
 * table, so `PSEUDO_LOCALE_BIDI` resolves RTL because `Arab` is an RTL script, through
 * machinery that already exists and needs no pseudo-locale special case. A direction flag here
 * would mean a runtime branch that reads it, which is a shipped code path the build-time design
 * exists to avoid.
 *
 * **Accenting is not a setting either, because it is what makes the locale a pseudo-locale.** The
 * substituted alphabet is how a reader tells transformed text from text that never reached Equator,
 * and a pseudo-locale with it switched off is just the source language under a different tag.
 */
export interface PseudoLocaleTransform {
  /**
   * Signed. Positive expands, negative contracts, absent leaves length alone.
   *
   * **No default, deliberately.** A default such as `0.35`, a German expansion figure, would be
   * inherited silently by every caller whether or not anyone had measured their content. Omitting
   * the key means the length behaviour is off rather than that an unmeasured number is applied. A
   * ratio worth using is derived from real translations of the strings that have no room to
   * shorten.
   *
   * Contraction is not padding with a negative count. It elides vowels in proportion to the factor,
   * because that is what makes one language shorter than another rather than what truncation looks
   * like, and truncation is the symptom the expanded locale exists to *find*, so producing it
   * here would make the two pseudo-locales indistinguishable in the one place they must differ.
   */
  readonly lengthFactor?: number;
  /**
   * Wrap each message in visible delimiters. Off unless asked for.
   *
   * One pair around the whole message rather than around each literal run, so a message containing
   * a placeholder reads as one bounded string instead of several. That is what makes a hardcoded
   * string visible: everything Equator rendered has boundaries and it does not.
   */
  readonly markers?: boolean;
}

/**
 * How to derive one pseudo-locale from a source catalog.
 *
 * A pseudo-locale is a translation nobody wrote: the source text put through a transform that makes
 * untranslated strings, cramped layouts and direction mistakes visible before a translator is
 * involved. The transform's own options are inherited; what this adds is the tag it publishes under
 * and the extension functions the derived catalog has to parse with.
 */
export interface PseudoLocaleOptions extends PseudoLocaleTransform {
  /**
   * Message-function names the application has registered, so a derived catalog parses like an
   * authored one.
   *
   * The transform re-parses each message to find its literal runs, and a parse that does not know
   * an application's registered functions rejects the message its own source catalog accepted. So
   * this is not a refinement: without it, deriving a pseudo-locale fails outright for any
   * application that registers a message extension.
   */
  readonly customFunctions?: readonly MessageCustomFunction[];
  /**
   * The tag the pseudo-locale is published under. Required.
   *
   * It cannot be optional with a per-mode default, because the tag is what decides direction, so a
   * default picks one silently, which is the single most consequential thing about a pseudo-locale
   * and the least visible if it is chosen by omission.
   */
  readonly locale: string;
}

const accentCharacters: Readonly<Record<string, string>> = Object.freeze({
  A: 'Å',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Đ',
  E: 'Ë',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Ï',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ø',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ř',
  S: 'Š',
  T: 'Ţ',
  U: 'Ü',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẍ',
  Y: 'Ÿ',
  Z: 'Ž',
  a: 'å',
  b: 'ƀ',
  c: 'ç',
  d: 'đ',
  e: 'ë',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'ï',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ṁ',
  n: 'ñ',
  o: 'ø',
  p: 'þ',
  q: 'ǫ',
  r: 'ř',
  s: 'š',
  t: 'ţ',
  u: 'ü',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẍ',
  y: 'ÿ',
  z: 'ž',
});

const protectedText = /(?:https?:\/\/|mailto:)[^\s]+/giu;

function transformUnprotected(
  value: string,
  transform: (part: string) => string,
): string {
  let result = '';
  let start = 0;
  for (const match of value.matchAll(protectedText)) {
    const index = match.index;
    result += transform(value.slice(start, index));
    result += match[0];
    start = index + match[0].length;
  }
  return result + transform(value.slice(start));
}

const vowels = /[AEIOUaeiouÅËÏØÜåëïøü]/u;

/**
 * Remove vowels in proportion to `factor`, spread across the run rather than taken from one end.
 *
 * Spread, because removing a tail is truncation and truncation is precisely the defect the expanded
 * pseudo-locale is built to surface. Two pseudo-locales that produce the same symptom cannot tell a
 * reader which one they are looking at.
 *
 * A run with no vowels does not contract, and that is honest rather than a gap: shortening it would
 * mean cutting consonants, which stops reading as the same word.
 */
function elide(value: string, factor: number): string {
  const characters = [...value];
  const positions = characters.flatMap((character, index) =>
    vowels.test(character) ? [index] : [],
  );
  const removeCount = Math.min(
    positions.length,
    Math.round(positions.length * factor),
  );
  if (removeCount === 0) return value;
  // Evenly spaced picks, so a long word loses vowels along its length instead of losing its middle.
  const step = positions.length / removeCount;
  const removed = new Set(
    Array.from(
      { length: removeCount },
      (_unused, index) => positions[Math.floor(index * step)],
    ),
  );
  return characters.filter((_unused, index) => !removed.has(index)).join('');
}

/**
 * Substitute the accented alphabet, then apply the length factor if there is one.
 *
 * A single `expansionRatio` doing both at once, and only in one direction, is what stops expansion
 * and accenting being asked for separately. The substitution never changes length; the factor never
 * changes which letters are used.
 */
function accent(value: string, lengthFactor: number | undefined): string {
  const substituted = [...value]
    .map((character) => accentCharacters[character] ?? character)
    .join('');
  if (lengthFactor === undefined || lengthFactor === 0) return substituted;
  if (lengthFactor < 0) return elide(substituted, -lengthFactor);
  const expansionRatio = lengthFactor;
  const letters = [...substituted].filter((character) =>
    /\p{L}/u.test(character),
  );
  const expansion = Math.ceil(letters.length * expansionRatio);
  if (expansion === 0) return substituted;
  const paddingSource = letters.filter((character) =>
    /[AEIOUaeiouÅËÏØÜåëïøü]/u.test(character),
  );
  const padding = (paddingSource.length === 0 ? letters : paddingSource)
    .slice(0, Math.max(1, expansion))
    .join('');
  return `${substituted}${padding.repeat(Math.ceil(expansion / Math.max(1, padding.length))).slice(0, expansion)}`;
}

function transformLiteral(
  value: string,
  lengthFactor: number | undefined,
): string {
  if (value.length === 0) return value;
  return transformUnprotected(value, (part) => {
    if (part.length === 0 || !/\S/u.test(part)) return part;
    return accent(part, lengthFactor);
  });
}

/**
 * Transform the literal runs, and optionally bound the whole pattern.
 *
 * Only `typeof part === 'string'` is touched, which is the property the whole design rests on: a
 * placeholder is a structured node, so it is never accented, padded or elided. A blind string
 * transform turns `Welcome, {$name}!` into a message whose placeholder no longer resolves, which is
 * the defect that removed the previous runtime helper.
 *
 * Markers go on the pattern rather than on each run, so a message reads as one bounded string
 * however many placeholders it contains.
 */
function transformPattern(
  pattern: Model.Pattern,
  transform: PseudoLocaleTransform,
): void {
  for (let index = 0; index < pattern.length; index += 1) {
    const part = pattern[index];
    if (typeof part === 'string') {
      pattern[index] = transformLiteral(part, transform.lengthFactor);
    }
  }
  if (transform.markers === true) {
    pattern.unshift('⟦');
    pattern.push('⟧');
  }
}

export function pseudoLocalizeMessage(
  source: string,
  transform: PseudoLocaleTransform = {},
  customFunctions: readonly MessageCustomFunction[] = [],
): ToolkitResult<string> {
  const { lengthFactor } = transform;
  if (
    lengthFactor !== undefined &&
    (!Number.isFinite(lengthFactor) || lengthFactor < -1 || lengthFactor > 2)
  ) {
    // The lower bound is -1 because that already elides every vowel; there is nothing further to
    // remove without cutting consonants, which stops reading as the same word.
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1804',
        'Pseudo-localization length factor must be between minus one and two. Positive expands, negative contracts, and omitting it leaves length unchanged.',
      ),
    ]);
  }
  let message: Model.Message;
  try {
    message = JSON.parse(JSON.stringify(parseMessage(source))) as Model.Message;
  } catch {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1804',
        'Pseudo-localization requires a valid MessageFormat message.',
      ),
    ]);
  }
  if (message.type === 'message') {
    transformPattern(message.pattern, transform);
  } else {
    for (const variant of message.variants) {
      transformPattern(variant.value, transform);
    }
  }
  const transformed = stringifyMessage(message);
  const validated = parseMessageSemanticModel(transformed, { customFunctions });
  return validated.ok
    ? toolkitSuccess(transformed, validated.diagnostics)
    : toolkitFailure(validated.diagnostics);
}

function pseudoMessage(
  message: CatalogMessage,
  transform: PseudoLocaleTransform,
  customFunctions: readonly MessageCustomFunction[],
): ToolkitResult<CatalogMessage> {
  if (message.kind === 'empty') {
    return toolkitSuccess(
      Object.freeze({
        kind: 'empty',
        inputs: Object.freeze({}),
        slots: Object.freeze({}),
      }),
    );
  }
  const transformed = pseudoLocalizeMessage(
    message.message,
    transform,
    customFunctions,
  );
  if (!transformed.ok) return transformed;
  const semantics = parseMessageSemanticModel(transformed.value, {
    customFunctions,
  });
  if (!semantics.ok) return semantics;
  return toolkitSuccess(
    Object.freeze({
      kind: 'message',
      message: transformed.value,
      semantics: semantics.value,
      inputs: Object.freeze({}),
      slots: Object.freeze({}),
    }) satisfies TextCatalogMessage,
  );
}

/**
 * An ordinary target catalog, derived from a source catalog with no authored translation.
 *
 * Ordinary is the point. What comes back is an `Catalog` like any other, so it compiles,
 * loads and renders through the same path a real translation does, and the catalog itself carries
 * nothing that tells it apart. That is what keeps the transform at
 * build time, and what makes a production build's exclusion an absence rather than a guard: this
 * function lives in the toolkit, which is a development dependency and reaches no bundle.
 */
export function createPseudoCatalog(
  source: Catalog,
  options: PseudoLocaleOptions,
): ToolkitResult<Catalog> {
  requireArgument('createPseudoCatalog', 'source', source, 'record');
  requireArgument('createPseudoCatalog', 'options', options, {
    optional: { customFunctions: ['record'] },
  });
  const admitted = admitCatalog(source, {
    customFunctions: options.customFunctions ?? [],
  });
  if (!admitted.ok) return admitted;
  return createAdmittedPseudoCatalog(admitted.value, options);
}

function createAdmittedPseudoCatalog(
  source: Catalog,
  options: PseudoLocaleOptions,
): ToolkitResult<Catalog> {
  if (source.role !== 'source') {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1804',
        'Pseudo-locales can be generated only from a source catalog.',
      ),
    ]);
  }
  const locale = canonicalizeLocale(options.locale);
  if (!locale.ok) return locale;
  const messages: Record<string, CatalogMessage> = Object.create(
    null,
  ) as Record<string, CatalogMessage>;
  const diagnostics = [];
  for (const [messageId, message] of Object.entries(source.messages)) {
    const transformed = pseudoMessage(
      message,
      options,
      options.customFunctions ?? [],
    );
    diagnostics.push(...transformed.diagnostics);
    if (!transformed.ok) return toolkitFailure(diagnostics);
    messages[messageId] = transformed.value;
  }
  return toolkitSuccess(
    builtCatalog(
      Object.freeze({
        role: 'target',
        providerId: source.providerId,
        scopeId: source.scopeId,
        locale: locale.value,
        messages: Object.freeze(messages),
        families: Object.freeze({}),
      }),
    ),
    diagnostics,
  );
}
