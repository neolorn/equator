/**
 * The locale tables Equator carries, derived from the pinned CLDR release rather than transcribed.
 *
 * `specs/01-standards-profile.spec.md` section 2 requires every such table to come from a source
 * the lock records, and to agree with that source. `--check` is what makes the second half true: it
 * regenerates and compares, so a data release cannot be raised while the tables derived from it
 * stay where they were, and a table cannot be edited by hand into disagreeing with the release its
 * own header names.
 */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { inputsRoot, repositoryRoot } from './stage-self-test.mjs';

const workspaceRoot = inputsRoot();
const cldrRoot = resolve(repositoryRoot, 'node_modules/cldr-core');
const manifest = JSON.parse(
  await readFile(resolve(cldrRoot, 'package.json'), 'utf8'),
);
assert.equal(manifest.name, 'cldr-core');
assert.equal(manifest.version, '48.2.0');
const cldrProfile = `cldr-${manifest.version.split('.').slice(0, 2).join('.')}`;

const likelyDocument = JSON.parse(
  await readFile(resolve(cldrRoot, 'supplemental/likelySubtags.json'), 'utf8'),
);
const scriptDocument = JSON.parse(
  await readFile(resolve(cldrRoot, 'scriptMetadata.json'), 'utf8'),
);
assert.equal(likelyDocument.supplemental.version._cldrVersion, '48');

const compareCodeUnit = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;
const rtlScripts = Object.entries(scriptDocument.scriptMetadata)
  .filter(([, metadata]) => metadata.rtl === 'YES')
  .map(([script]) => script)
  .sort(compareCodeUnit);

// The strong right-to-left character class.
//
// The property this answers is "can this text reposition the text around it". `Bidi_Class` answers
// that directly; script membership only stands in for it, and the substitution shows in both
// directions. Two script-based derivations, measured over every code point on Unicode 17.0:
//
// - `Script=` over the table above loses exactly one letter, U+0640 ARABIC TATWEEL, which is
//   `Script=Common` with Arabic among its script extensions.
// - `Script_Extensions=` keeps U+0640 and gains 106 code points that reorder nothing: U+00B7 MIDDLE
//   DOT, used with Avestan; 24 combining marks including U+0303 and U+0308, used with Syriac;
//   U+204F REVERSED SEMICOLON, used with Adlam; the Aegean and Coptic Epact number signs. What
//   separates U+0640 from U+00B7 is not their script data, which has the same shape, but that one
//   is a letter, so the union of `Script=` with the letters of `Script_Extensions=` is correct, and
//   correct by a rule that has nothing to do with direction.
//
// Both miss the 126 Siyaq numerals (U+1EC71..U+1ECB4, U+1ED01..U+1ED3D). They are `Script=Common`
// and `Script_Extensions=Common`, so no script derivation can reach them, and the UCD gives them
// `Bidi_Class=AL`. Reading the property directly finds them and needs no rule about letters.
//
// The script derivation is kept below as a cross-check rather than as the source, because the two
// files are independent: CLDR says which scripts run right to left, the UCD says which characters
// do. They agree on every letter in Unicode, and an assertion that they still do is worth more than
// either one alone.
//
// Generated rather than read at runtime: the runtime would have to ship and parse a 173 KB text
// file to answer a question a character class answers, and the vendored file is a build input.
const bidiClassPath = resolve(
  workspaceRoot,
  'standards/data/DerivedBidiClass-17.0.0.txt',
);
const bidiClassSource = await readFile(bidiClassPath, 'utf8');
assert.ok(
  bidiClassSource.startsWith('# DerivedBidiClass-17.0.0.txt'),
  `${bidiClassPath} is not the pinned Unicode 17.0.0 file; standards/sources.lock.json names what belongs there.`,
);

const BIDI_RANGE =
  /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*([A-Za-z_]+)/u;
const BIDI_MISSING =
  /^#\s*@missing:\s*([0-9A-F]{4,6})\.\.([0-9A-F]{4,6})\s*;\s*([A-Za-z_]+)/u;
const BIDI_LONG_NAMES = new Map([
  ['Right_To_Left', 'R'],
  ['Arabic_Letter', 'AL'],
  ['Left_To_Right', 'L'],
]);

// ---------------------------------------------------------------------------------------------
// READ THIS BEFORE CHANGING THE PARSE BELOW.
//
// The UCD does not put all of this file's answers on its data lines. Unassigned code points in
// blocks reserved for right-to-left scripts take `R` or `AL`, and the file says so on `@missing:`
// lines, which are comments, rather than by listing the code points. `0860..086A` is listed;
// `086B..086E`, unassigned, is not, and those four are `AL` all the same. 2,314 code points in
// this file are reachable only that way.
//
// A parser that reads only the data lines therefore produces a class that is correct for every
// character that exists today and wrong for the next one added to the Arabic block. That is the
// worst shape a generated table can have. It passes every test, ships, and stays right until some
// Unicode release years from now assigns a character in one of those blocks: at which point a
// value containing it silently stops being isolated, in a released version of Equator, with nothing
// in the repository having changed. Nothing would connect the two events.
//
// So the defaults go down first and every explicit line overrides them, and the class includes
// unassigned code points on purpose. `no-missing-defaults` is a mutation in the verification set
// and `bidi-isolation.test.ts` asserts U+05FF (unassigned, `Right_To_Left` by default) for
// exactly this reason. The same trap is waiting in every other UCD file: `@missing:` is a
// normative part of the format (UAX #44 §4.2.10), not a comment about it.
// ---------------------------------------------------------------------------------------------
const bidiClasses = new Array(0x110000).fill('L');
const applyBidiLines = (pattern, onlyComments) => {
  let applied = 0;
  for (const line of bidiClassSource.split('\n')) {
    if (line.startsWith('#') !== onlyComments) continue;
    const match = pattern.exec(line);
    if (match === null) continue;
    applied += 1;
    const value = BIDI_LONG_NAMES.get(match[3]) ?? match[3];
    const first = Number.parseInt(match[1], 16);
    const last = match[2] === undefined ? first : Number.parseInt(match[2], 16);
    for (let code = first; code <= last; code += 1) bidiClasses[code] = value;
  }
  return applied;
};
const missingRanges = applyBidiLines(BIDI_MISSING, true);
const explicitRanges = applyBidiLines(BIDI_RANGE, false);
assert.ok(
  missingRanges > 1 && explicitRanges > 1000,
  `Parsed ${missingRanges} default ranges and ${explicitRanges} explicit ranges from ${bidiClassPath}; the file did not read as the UCD format.`,
);

const isStrongRtl = (code) =>
  bidiClasses[code] === 'R' || bidiClasses[code] === 'AL';

// The cross-check: what the script data says, an independent derivation of the same answer.
const scriptClass = (property) =>
  new RegExp(
    `[${rtlScripts.map((script) => String.raw`\p{${property}=${script}}`).join('')}]`,
    'u',
  );
assert.equal(
  process.versions.unicode,
  '17.0',
  'The cross-check below compares the vendored Unicode 17.0.0 file against the running ICU. Under a different Unicode version the two disagree for reasons that have nothing to do with Equator, so this runs on the pinned toolchain or not at all.',
);
const inRtlScript = scriptClass('Script');
const usedWithRtlScript = scriptClass('Script_Extensions');
const isLetter = /\p{L}/u;

const rtlRanges = [];
const droppedByBidiClass = [];
let letterDisagreements = 0;
for (let code = 0; code <= 0x10ffff; code += 1) {
  // Surrogate code points are not characters and belong to no script; skipping them also keeps
  // `String.fromCodePoint` from producing a lone surrogate.
  if (code >= 0xd800 && code <= 0xdfff) continue;
  const character = String.fromCodePoint(code);
  const strong = isStrongRtl(code);
  if (
    isLetter.test(character) &&
    usedWithRtlScript.test(character) !== strong
  ) {
    letterDisagreements += 1;
  }
  if (
    !strong &&
    (inRtlScript.test(character) ||
      (usedWithRtlScript.test(character) && isLetter.test(character)))
  ) {
    droppedByBidiClass.push(code);
  }
  if (!strong) continue;
  const last = rtlRanges.at(-1);
  if (last !== undefined && code === last[1] + 1) {
    last[1] = code;
    continue;
  }
  rtlRanges.push([code, code]);
}

assert.ok(
  rtlRanges.length > 0,
  'No code point resolved to Bidi_Class R or AL; the derivation produced an empty class.',
);

// CLDR and the UCD are separate files maintained by separate processes. That they agree on every
// letter in Unicode is the strongest single statement available about either, and it is the reason
// the script derivation stays here after ceasing to be the source.
assert.equal(
  letterDisagreements,
  0,
  `${letterDisagreements} letters are in a CLDR right-to-left script but are not Bidi_Class R or AL, or the reverse. The two sources have diverged and the divergence has to be understood before either is trusted.`,
);

// The guard against a silent narrowing. `Bidi_Class` drops code points a script derivation covers,
// and every one of them must be a character the bidi algorithm resolves from its context rather
// than from itself: a mark, a neutral, or a number. A strong character appearing here means this
// source covers less than the script derivation does, which is the one outcome it must not have.
const CONTEXTUAL_CLASSES = new Set([
  'NSM',
  'ON',
  'AN',
  'EN',
  'ET',
  'ES',
  'CS',
  'BN',
  'WS',
  'B',
  'S',
  'L',
]);
const strongDropped = droppedByBidiClass.filter(
  (code) => !CONTEXTUAL_CLASSES.has(bidiClasses[code]),
);
assert.deepEqual(
  strongDropped.map((code) => `U+${code.toString(16).toUpperCase()}`),
  [],
  'Moving the strong right-to-left class to Bidi_Class dropped a character that is not resolved from its context. That is a narrowing, not a correction.',
);

const escapeCodePoint = (value) => `\\u{${value.toString(16).toUpperCase()}}`;
const rtlPattern = `[${rtlRanges
  .map(([start, end]) =>
    start === end
      ? escapeCodePoint(start)
      : `${escapeCodePoint(start)}-${escapeCodePoint(end)}`,
  )
  .join('')}]`;

const output = [
  '/** Generated from cldr-core 48.2.0 and Unicode 17.0.0 by tools/generate-locale-profile.mjs. */',
  "export const LOCALE_DATA_PROFILE =\n  'cldr-48.2+unicode-17.0/equator-rtl-bidi-1' as const;",
  '',
  '/**',
  ' * Every script code written right to left, from the CLDR release named above.',
  ' *',
  " * What a locale's direction is decided by: the script, rather than the language, because a language",
  ' * written in two scripts reads in two directions.',
  ' */',
  '// prettier-ignore',
  `export const RTL_SCRIPTS = Object.freeze(${JSON.stringify(rtlScripts)} as const);`,
  '',
  '/**',
  ' * Every code point whose Unicode `Bidi_Class` is `R` or `AL`.',
  ' *',
  ' * The source of a character class rather than a compiled expression, so the runtime picks its',
  ' * own flags. Derived from the vendored UCD file that `standards/sources.lock.json` names. `Bidi_Class`',
  ' * is the property that says whether a character reorders the text around it; script membership only',
  ' * stood in for it, and missed the Siyaq numerals in both of the forms that were tried.',
  ' *',
  ' * Unassigned code points in blocks reserved for right-to-left scripts are included, because that is',
  ' * what the standard says they are: the next character added to the Arabic block is `AL` before',
  ' * anyone regenerates this file.',
  ' */',
  '// prettier-ignore',
  `export const RTL_STRONG_CHARACTERS = ${JSON.stringify(rtlPattern)} as const;`,
  '',
].join('\n');

// Plural categories, from the same pinned CLDR release as the script data. The toolkit needs these
// to tell a translator that a target locale is missing a category its grammar requires; deriving
// them from the host Intl instead would make the check vary by Node version, which is exactly what
// pinning a CLDR release is for.
//
// Both sets are emitted because MessageFormat 2's `:number`/`:integer` `select` option chooses
// between them, and they are not variations of one another: Arabic requires all six cardinal
// categories and exactly one ordinal category, while English requires two cardinal and four
// ordinal. Checking an ordinal message against the cardinal table is wrong in both directions.
const CATEGORY_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];

function categoriesFrom(document, file, key) {
  const rules = document.supplemental[key];
  assert.ok(
    rules !== undefined && typeof rules === 'object',
    `cldr-core is missing supplemental/${file} ${key} rules.`,
  );
  return Object.fromEntries(
    Object.entries(rules)
      .map(([language, entries]) => {
        const categories = Object.keys(entries)
          .map((entry) => entry.replace('pluralRule-count-', ''))
          .filter((category) => CATEGORY_ORDER.includes(category))
          .sort(
            (left, right) =>
              CATEGORY_ORDER.indexOf(left) - CATEGORY_ORDER.indexOf(right),
          );
        return [language, categories];
      })
      .filter(([, categories]) => categories.length > 0)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

const pluralCategories = categoriesFrom(
  JSON.parse(
    await readFile(resolve(cldrRoot, 'supplemental/plurals.json'), 'utf8'),
  ),
  'plurals.json',
  'plurals-type-cardinal',
);
const ordinalCategories = categoriesFrom(
  JSON.parse(
    await readFile(resolve(cldrRoot, 'supplemental/ordinals.json'), 'utf8'),
  ),
  'ordinals.json',
  'plurals-type-ordinal',
);

const pluralOutput = [
  '/** Generated from cldr-core 48.2.0 by tools/generate-locale-profile.mjs. */',
  "export const PLURAL_DATA_PROFILE = 'cldr-48.2/equator-plurals-1' as const;",
  '',
  '/**',
  ' * Cardinal plural categories each language requires, keyed by CLDR language subtag.',
  ' *',
  ' * A language absent from this table has only `other`, which is how CLDR expresses it.',
  ' */',
  '// prettier-ignore',
  `export const CARDINAL_PLURAL_CATEGORIES: Readonly<Record<string, readonly string[]>> = Object.freeze(${JSON.stringify(pluralCategories)});`,
  '',
  '/**',
  ' * Ordinal plural categories each language requires, keyed by CLDR language subtag.',
  ' *',
  ' * A language absent from this table has only `other`, which is how CLDR expresses it. This is a',
  ' * different table, not a variant of the cardinal one: Arabic requires all six cardinal categories',
  ' * and exactly one ordinal category, while English requires two cardinal and four ordinal.',
  ' */',
  '// prettier-ignore',
  `export const ORDINAL_PLURAL_CATEGORIES: Readonly<Record<string, readonly string[]>> = Object.freeze(${JSON.stringify(ordinalCategories)});`,
  '',
].join('\n');

// Encompassed languages, from the same pinned CLDR release and the vendored IANA registry.
//
// A browser that sends `no` to a site shipping `nb-NO` is answered with nothing today: step 3 of
// `negotiateLocale` compares language subtags, `no` and `nb` are different subtags, and the only
// repair available to a consumer is writing `"no": "nb-NO"` into `aliases` by hand. That is a
// standards question with a standards answer, and a consumer should not be the one answering it.
//
// Two sources, because neither answers alone. **Membership** is BCP 47 3.1.10, the `Macrolanguage`
// field, "a language that encompasses this subtag's language according to assignments made by
// ISO 639-3", whose own worked example is this case: `nb` and `nn` both declare `Macrolanguage:
// no`. It gives the set and stops there, so on its own a request for `no` picks between Bokmal and
// Nynorsk by whichever the consumer happened to declare first. **Ordering** is CLDR's language
// matching data, which is the standard's own answer to how close one locale is to another:
// `nb`/`no` is distance 1 and `nn`/`no` is distance 20, so a site shipping both answers `no` with
// Bokmal, and does so for a published reason rather than a declaration accident.
//
// **The use is deliberately narrow, and it is not an oversight.** Only the language dimension of
// that data is read, and within it only pairs that share an encompassing macrolanguage. Two things
// are being refused. The script and region dimensions: for `zh-Hant` against a supported
// `zh-Hans-CN` the script dimension alone contributes 50, which is exactly the specification's
// default threshold, so under the whole distance model the refusal would rest on how the dimensions
// combine and on where the threshold sits. Equator decides that pair categorically today, by
// comparing maximized scripts, and with a test. And the rest of the language dimension: it holds
// 114 pairs that share no macrolanguage (`af`/`en` at 20, `be`/`ru` at 30, `da`/`no` at 8) which
// are judgments about what a reader will accept instead, not about what their language is. Serving
// Russian to a request for Belarusian is a policy, and a localization framework should not adopt
// one silently on a consumer's behalf. Widening this later is a deliberate decision with its own
// argument, not a correction of something left half-done.
const sourcesLock = JSON.parse(
  await readFile(resolve(workspaceRoot, 'standards/sources.lock.json'), 'utf8'),
);
const registrySource = sourcesLock.dataSources?.ianaLanguageSubtagRegistry;
assert.ok(
  typeof registrySource?.projectSnapshot === 'string' &&
    typeof registrySource?.fileDate === 'string',
  'standards/sources.lock.json does not pin the IANA Language Subtag Registry.',
);
const registry = await readFile(
  resolve(workspaceRoot, 'standards', registrySource.projectSnapshot),
  'utf8',
);
// The registry states its own date in its first record, so the lock's claim about which snapshot
// this is gets checked against the snapshot rather than trusted.
assert.equal(
  /^File-Date: (.+)$/mu.exec(registry)?.[1],
  registrySource.fileDate,
  'The vendored IANA registry states a different File-Date than standards/sources.lock.json pins.',
);

const matchingDocument = JSON.parse(
  await readFile(
    resolve(cldrRoot, 'supplemental/languageMatching.json'),
    'utf8',
  ),
);
assert.equal(matchingDocument.supplemental.version._cldrVersion, '48');
const languageMatch =
  matchingDocument.supplemental.languageMatching['written-new']?.languageMatch;
assert.ok(
  Array.isArray(languageMatch) && languageMatch.length > 0,
  'cldr-core is missing supplemental/languageMatching.json written-new rules.',
);

// A language subtag, and nothing wider. A rule whose either side carries a script, a region, a
// wildcard or a `$variable` belongs to a dimension this table does not read.
const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/u;
const languageRules = languageMatch.filter(
  (rule) =>
    LANGUAGE_SUBTAG.test(rule._desired) &&
    LANGUAGE_SUBTAG.test(rule._supported),
);
const languageDistance = new Map();
for (const rule of languageRules) {
  const distance = Number(rule._distance);
  languageDistance.set(`${rule._desired}|${rule._supported}`, distance);
  // A rule is bidirectional unless it says otherwise, and none of the language-dimension rules in
  // this release do. Reading `_oneway` anyway means a release that adds one is honoured rather than
  // silently reversed.
  if (rule._oneway !== 'true') {
    languageDistance.set(`${rule._supported}|${rule._desired}`, distance);
  }
}

const macrolanguageOf = new Map();
for (const record of registry.split(/\r?\n%%\r?\n/u)) {
  if (/^Type: language$/mu.test(record) === false) continue;
  // A deprecated subtag carries a `Preferred-Value` that canonicalization already applies, so
  // matching it here would answer a tag nobody should still be sending, in a second way.
  if (/^Deprecated:/mu.test(record)) continue;
  const subtag = /^Subtag: (.+)$/mu.exec(record)?.[1];
  const macrolanguage = /^Macrolanguage: (.+)$/mu.exec(record)?.[1];
  if (subtag === undefined || macrolanguage === undefined) continue;
  macrolanguageOf.set(subtag, macrolanguage);
}
assert.ok(
  macrolanguageOf.size > 0,
  'No Macrolanguage relations were read from the vendored IANA registry; the record format changed.',
);

// Two subtags belong together when one encompasses the other, or when both are encompassed by the
// same macrolanguage. `nn`/`nb` is the second shape and CLDR ranks it; `arz`/`ary` is the second
// shape and CLDR does not, so it is not in the table.
const sameGroup = (left, right) =>
  macrolanguageOf.get(left) === right ||
  macrolanguageOf.get(right) === left ||
  (macrolanguageOf.has(left) &&
    macrolanguageOf.get(left) === macrolanguageOf.get(right));

// UTS #35 Part 1, Language Matching: "the default threshold distance is 50", read from the tr35-73
// snapshot because the current tr35.html truncates before that section. Nothing here rests on the
// exact number: the assertions below establish that every encompassed pair CLDR ranks is far under
// it and every pair it does not rank is far over, so any threshold between them yields this table.
const DEFAULT_THRESHOLD = 50;
const unrelatedDistance = languageMatch.find(
  (rule) => rule._desired === '*' && rule._supported === '*',
);
assert.ok(
  unrelatedDistance !== undefined &&
    Number(unrelatedDistance._distance) > DEFAULT_THRESHOLD,
  'CLDR no longer places two unrelated languages beyond the default matching threshold.',
);

const encompassed = {};
let encompassedPairs = 0;
let widestKept = 0;
for (const [key, distance] of [...languageDistance].sort(([left], [right]) =>
  left < right ? -1 : left > right ? 1 : 0,
)) {
  const [desired, supported] = key.split('|');
  if (!sameGroup(desired, supported)) continue;
  assert.ok(
    distance < DEFAULT_THRESHOLD,
    `CLDR now rates ${desired} and ${supported} at ${distance}, at or beyond the default matching threshold, though one encompasses the other. Whether Equator should still treat them as the same language is a decision, not a regeneration.`,
  );
  widestKept = Math.max(widestKept, distance);
  encompassed[desired] ??= {};
  encompassed[desired][supported] = distance;
  encompassedPairs += 1;
}
assert.ok(
  encompassedPairs > 0,
  'The encompassed-language table came out empty; one of its two sources changed shape.',
);

const encompassedOutput = [
  `/** Generated from cldr-core ${manifest.version} and the IANA registry of ${registrySource.fileDate} by tools/generate-locale-profile.mjs. */`,
  // Built rather than written out: this string exists to change when the data under it changes,
  // and a literal is a thing somebody has to remember to edit.
  `export const ENCOMPASSED_LANGUAGE_PROFILE =\n  '${cldrProfile}+iana-${registrySource.fileDate}/equator-encompassed-1' as const;`,
  '',
  '/**',
  ' * How far apart two language subtags are, for subtags that are the same language written twice.',
  ' *',
  ' * Keyed by the requested language subtag, then by the supported one, in CLDR distances where a',
  ' * smaller number is a closer match. A pair is present only when the IANA registry says one subtag',
  ' * encompasses the other or that both are encompassed by one macrolanguage, BCP 47 3.1.10, and CLDR',
  ' * ranks the pair at the language dimension. Absent means Equator has nothing to say about the pair,',
  ' * not that the two are unrelated.',
  ' *',
  ' * This is not the whole of CLDR language matching and is not meant to become it. The dimensions it',
  ' * leaves out are the ones Equator already decides categorically, and the language-dimension pairs',
  " * it leaves out are CLDR's judgments about what a reader will accept instead of their own language,",
  ' * which is a policy rather than an identity.',
  ' */',
  '// prettier-ignore',
  `export const ENCOMPASSED_LANGUAGE_DISTANCES: Readonly<Record<string, Readonly<Record<string, number>>>> = Object.freeze(${JSON.stringify(encompassed)});`,
  '',
].join('\n');

// ---------------------------------------------------------------------------------------------
// Endonyms: the name each locale has for itself, decided here rather than by the visitor's engine.
//
// `selfName` on a locale choice is decided here rather than by
// `new Intl.DisplayNames([locale], { type: 'language' })` read in the browser, which is the
// engine's own CLDR snapshot. Over sixteen locales on the four engines Equator gates on, three of
// sixteen disagree in two distinct ways: WebKit 26.5
// title-cases the language name (`Portugues (Brasil)`, `Espanol latinoamericano`) where CLDR's own
// casing is lowercase, and Chromium 149 does not translate the `valencia` variant subtag and prints
// `catala (Espanya, VALENCIA)`. A name no reader of any language has seen. The sharper half is
// not the browsers disagreeing with each other: Equator server-renders the switcher on Node, so a
// WebKit visitor would be sent one label and recompute a different one on hydration.
//
// So the name is derived here from a pinned release and shipped, and the engine has no vote.
//
// THE ALGORITHM IS TR35'S, AND THE RULE THAT MATTERS IS THE SECOND LINE OF IT: look the whole
// locale id up in `languages`, and if it is not there, take the name of the *bare language subtag*
// and put every remaining subtag in the qualifier list. Not the longest matching prefix. Writing
// the ladder the other way (lang-script-region, then lang-region, then lang-script, then lang)
// is the obvious reading and it is wrong, and the measurement says so rather than the spec: over
// the 910 locales ICU has real data for, the ladder disagreed with ICU on 14 and this rule
// disagrees on 3. `zh-Hans-CN` is the clearest case. The ladder finds `zh-Hans` and produces
// "简体中文（中国）"; every engine in the world renders "中文（简体，中国）", which is what the
// bare-language rule produces.
//
// The three that remain are all one thing, CLDR ships a display-names bundle that ICU does not,
// and in each the pinned answer is CLDR's own:
//
//   - `el-polyton`: the `el-polyton` bundle spells Greek polytonically, "Ἑλληνικά". ICU has no such
//     bundle and answers "Ελληνικά" out of `el`.
//   - `zh-Latn` and `zh-Latn-CN`: the `zh-Latn` bundle's `localeDisplayPattern` uses ASCII
//     parentheses, which is right for a Latin-script rendering. ICU falls back to `zh`'s fullwidth
//     ones.
//
// The cross-check compares only where ICU has data for the locale: `Intl.DisplayNames` answers
// every request, so an unfiltered comparison reports 144 differences of which 141 are ICU replying
// in English about a locale it never shipped. `resolvedOptions().locale` says which locale ICU
// actually answered from, and a locale outside the requested one's inheritance chain is not a
// disagreement about a name: it is ICU not having one.
const localeNamesRoot = resolve(
  repositoryRoot,
  'node_modules/cldr-localenames-full',
);
const localeNamesManifest = JSON.parse(
  await readFile(resolve(localeNamesRoot, 'package.json'), 'utf8'),
);
assert.equal(localeNamesManifest.name, 'cldr-localenames-full');
assert.equal(localeNamesManifest.version, manifest.version);

const displayNamesBundles = new Set(
  (await readdir(resolve(localeNamesRoot, 'main'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
const availableLocales = JSON.parse(
  await readFile(resolve(cldrRoot, 'availableLocales.json'), 'utf8'),
).availableLocales.full;
const defaultContentLocales = JSON.parse(
  await readFile(resolve(cldrRoot, 'defaultContent.json'), 'utf8'),
).defaultContent;
const parentLocaleDocument = JSON.parse(
  await readFile(resolve(cldrRoot, 'supplemental/parentLocales.json'), 'utf8'),
).supplemental.parentLocales;
const parentLocales = parentLocaleDocument.parentLocale;
// UTS #35 Part 1, Parent Locales (LDML 48.2): a component's parents stand alone rather than
// merging with the main ones, and `localeRules` applies to the main component only. A key this
// list does not name would be a component or a rule nothing here reads, so a release that adds one
// stops the generator rather than being read as main data.
assert.deepEqual(
  Object.keys(parentLocaleDocument).sort(compareCodeUnit),
  [
    '_localeRules',
    'collations',
    'grammaticalFeatures',
    'parentLocale',
    'plurals',
    'segmentations',
  ],
  'parentLocales.json has a component or a rule this generator does not read.',
);
assert.deepEqual(
  parentLocaleDocument._localeRules,
  { parentLocale: { nonlikelyScript: 'root' } },
  'parentLocales.json changed its locale rules, which both packages apply to the main chain.',
);
const orderedComponentParents = (component) =>
  Object.fromEntries(
    Object.entries(parentLocaleDocument[component]).sort(([left], [right]) =>
      compareCodeUnit(left, right),
    ),
  );
const collationParentLocales = orderedComponentParents('collations');
const pluralParentLocales = orderedComponentParents('plurals');
const segmentationParentLocales = orderedComponentParents('segmentations');

const orderedParentLocales = Object.fromEntries(
  Object.entries(parentLocales).sort(([left], [right]) =>
    compareCodeUnit(left, right),
  ),
);
const undParents = Object.values(parentLocales).filter(
  (parent) => parent === 'und',
).length;

// Equator's two pseudo-locales are named here for the same reason every other locale is: they
// appear in a switcher during development, and CLDR does have names for XA and XB.
const PSEUDO_LOCALES = ['en-Latn-XA', 'en-Arab-XB'];

const endonymUniverse = [
  ...new Set([
    ...availableLocales,
    ...defaultContentLocales,
    ...PSEUDO_LOCALES,
  ]),
].sort(compareCodeUnit);

// CLDR inheritance, which is not truncation: `en-CC`'s parent is `en-001`, not `en`.
const inheritanceChain = (locale) => {
  const chain = [];
  let current = locale;
  while (current !== undefined && current !== 'root') {
    chain.push(current);
    const declared = parentLocales[current];
    if (declared !== undefined) {
      current = declared;
      continue;
    }
    const parts = current.split('-');
    parts.pop();
    current = parts.length > 0 ? parts.join('-') : undefined;
  }
  return chain;
};

const displayNamesCache = new Map();
const readDisplayNames = async (bundle) => {
  const cached = displayNamesCache.get(bundle);
  if (cached !== undefined) return cached;
  const read = async (file, key) => {
    try {
      const document = JSON.parse(
        await readFile(resolve(localeNamesRoot, 'main', bundle, file), 'utf8'),
      );
      return document.main[bundle].localeDisplayNames[key];
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const data = {
    languages: await read('languages.json', 'languages'),
    scripts: await read('scripts.json', 'scripts'),
    territories: await read('territories.json', 'territories'),
    variants: await read('variants.json', 'variants'),
    patterns: await read('localeDisplayNames.json', 'localeDisplayPattern'),
  };
  displayNamesCache.set(bundle, data);
  return data;
};

const resolveDisplayNames = async (locale) => {
  const merged = {
    languages: {},
    scripts: {},
    territories: {},
    variants: {},
    patterns: undefined,
  };
  for (const bundle of inheritanceChain(locale).reverse()) {
    if (!displayNamesBundles.has(bundle)) continue;
    const data = await readDisplayNames(bundle);
    Object.assign(merged.languages, data.languages ?? {});
    Object.assign(merged.scripts, data.scripts ?? {});
    Object.assign(merged.territories, data.territories ?? {});
    Object.assign(merged.variants, data.variants ?? {});
    if (data.patterns !== undefined) merged.patterns = data.patterns;
  }
  return merged;
};

const SUBTAG_SCRIPT = /^[A-Z][a-z]{3}$/u;
const SUBTAG_REGION = /^(?:[A-Z]{2}|\d{3})$/u;

const splitLocale = (locale) => {
  const parts = locale.split('-');
  const language = parts.shift();
  const script =
    parts[0] !== undefined && SUBTAG_SCRIPT.test(parts[0])
      ? parts.shift()
      : undefined;
  const region =
    parts[0] !== undefined && SUBTAG_REGION.test(parts[0])
      ? parts.shift()
      : undefined;
  return { language, script, region, variants: parts };
};

// TR35: a name going into a pattern that already carries parentheses takes brackets instead, so
// "English (Cocos (Keeling) Islands)" is written "English (Cocos [Keeling] Islands)".
const bracketed = (value) => value.replaceAll('(', '[').replaceAll(')', ']');

const deriveEndonym = (locale, data) => {
  const whole = data.languages[locale];
  if (whole !== undefined) return whole;

  const { language, script, region, variants } = splitLocale(locale);
  const base = data.languages[language];
  if (base === undefined) return undefined;

  const qualifiers = [];
  if (script !== undefined) qualifiers.push(data.scripts[script] ?? script);
  if (region !== undefined) qualifiers.push(data.territories[region] ?? region);
  for (const variant of variants) {
    const key = variant.toUpperCase();
    qualifiers.push(data.variants[key] ?? key);
  }
  if (qualifiers.length === 0) return base;

  const separator = data.patterns?.localeSeparator ?? '{0}, {1}';
  let joined = bracketed(qualifiers[0]);
  for (const qualifier of qualifiers.slice(1)) {
    joined = separator
      .replace('{0}', joined)
      .replace('{1}', bracketed(qualifier));
  }
  return (data.patterns?.localePattern ?? '{0} ({1})')
    .replace('{0}', base)
    .replace('{1}', joined);
};

const endonyms = {};
const endonymsWithoutName = [];
const endonymsComparedToIcu = [];
const endonymsDisagreeingWithIcu = [];

for (const locale of endonymUniverse) {
  const derived = deriveEndonym(locale, await resolveDisplayNames(locale));
  if (derived === undefined) {
    endonymsWithoutName.push(locale);
    continue;
  }
  endonyms[locale] = derived;

  let icu;
  let answeredFrom;
  try {
    const display = new Intl.DisplayNames([locale], {
      type: 'language',
      localeMatcher: 'lookup',
    });
    answeredFrom = display.resolvedOptions().locale;
    icu = display.of(locale);
  } catch {
    continue;
  }
  if (!inheritanceChain(locale).includes(answeredFrom)) continue;
  endonymsComparedToIcu.push(locale);
  if (icu !== derived)
    endonymsDisagreeingWithIcu.push(`${locale} (${derived} / ${icu})`);
}

// The cross-check has to be shown to work before its agreement means anything: a filter that
// excluded every locale would report perfect agreement over nothing.
assert.ok(
  endonymsComparedToIcu.length > 800,
  `The ICU cross-check compared only ${endonymsComparedToIcu.length} locales; it is meant to compare every locale ICU has display names for.`,
);
assert.deepEqual(
  endonymsDisagreeingWithIcu,
  [
    'el-polyton (Ἑλληνικά (Πολυτονικό) / Ελληνικά (Πολυτονικό))',
    'zh-Latn (中文 (拉丁文) / 中文（拉丁文）)',
    'zh-Latn-CN (中文 (拉丁文, 中国) / 中文（拉丁文，中国）)',
  ],
  'The derivation disagrees with ICU somewhere new. The three known differences are all CLDR shipping a display-names bundle ICU does not; a fourth is a defect in the derivation until it is shown to be one of those.',
);
assert.equal(endonyms['pt-BR'], 'português (Brasil)');
assert.equal(endonyms['es-419'], 'español latinoamericano');
assert.equal(endonyms['ca-ES-valencia'], 'català (Espanya, valencià)');

const endonymOutput = [
  `/** Generated from cldr-localenames-full ${localeNamesManifest.version} by tools/generate-locale-profile.mjs. */`,
  `export const ENDONYM_PROFILE = 'cldr-${cldrProfile.slice('cldr-'.length)}/equator-endonyms-1' as const;`,
  '',
  '/**',
  ' * The name each locale has for itself, in itself, keyed by CLDR locale identifier.',
  ' *',
  ' * Derived by TR35 locale display name from the same CLDR release the rest of the profile comes',
  ' * from, so a switcher renders one label for a locale on every engine and on both sides of',
  " * hydration. The engine's own answer is not wrong, it is merely the engine's: measured over the",
  ' * four engines Equator gates on, three of sixteen locales disagreed, and a server-rendered label',
  ' * that changes on hydration is a defect no consumer can fix.',
  ' *',
  ' * A locale absent from this table is one CLDR has no name for. There are',
  ` * ${endonymsWithoutName.length} of them and \`aa\` is one; the caller falls back rather than inventing a name.`,
  ' *',
  ' * This lives in the toolkit and not in the runtime on purpose. It is a build input: the generated',
  ' * configuration carries one string per configured locale, so an application shipping three',
  ' * locales sends three names to the browser rather than a table of every locale CLDR names.',
  ' */',
  '// prettier-ignore',
  `export const LOCALE_ENDONYMS: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(endonyms)});`,
  '',
].join('\n');

// The alias rules of UTS #35 Part 1 Annex C, preprocessed as its "Preprocessing" section states, so
// the canonicalizer applies them in order and never re-derives the order at run time. The annex
// reads the four alias tables as rules over a language identifier; a rule whose type is not a valid
// `unicode_language_id` is discarded there, which removes the legacy `i-` tags, the extended
// language tags and the three-letter territory codes, all of which the identifier grammar refuses
// before any rule is consulted.
const aliasDocument = JSON.parse(
  await readFile(resolve(cldrRoot, 'supplemental/aliases.json'), 'utf8'),
).supplemental.metadata.alias;

const aliasLanguage = /^(?:[a-z]{2,3}|[a-z]{5,8})$/u;
const aliasScript = /^[a-z]{4}$/u;
const aliasRegion = /^(?:[a-z]{2}|[0-9]{3})$/u;
const aliasVariant = /^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/u;

/** A language identifier as the annex's multimap, with `und` read as no language. */
function aliasLanguageId(text) {
  const subtags = text.replaceAll('_', '-').toLowerCase().split('-');
  let index = 0;
  if (!aliasLanguage.test(subtags[index] ?? '')) return undefined;
  const language = subtags[index++];
  const id = {
    language: language === 'und' ? '' : language,
    script: '',
    region: '',
    variants: [],
  };
  if (aliasScript.test(subtags[index] ?? '')) {
    const script = subtags[index++];
    id.script = script[0].toUpperCase() + script.slice(1);
  }
  if (aliasRegion.test(subtags[index] ?? '')) {
    id.region = subtags[index++].toUpperCase();
  }
  while (aliasVariant.test(subtags[index] ?? ''))
    id.variants.push(subtags[index++]);
  if (index !== subtags.length) return undefined;
  if (new Set(id.variants).size !== id.variants.length) return undefined;
  id.variants.sort(compareCodeUnit);
  return id;
}

const aliasSubtags = (id) =>
  [id.language || 'und', id.script, id.region, ...id.variants].filter(Boolean);
const aliasText = (id) => aliasSubtags(id).join('-');

const aliasEntries = [
  ...Object.entries(aliasDocument.languageAlias).map(
    ([type, { _replacement }]) => [type, _replacement],
  ),
  ...['scriptAlias', 'territoryAlias', 'variantAlias'].flatMap((table) =>
    Object.entries(aliasDocument[table]).map(([type, { _replacement }]) => [
      `und-${type}`,
      _replacement
        .split(' ')
        .map((replacement) => `und-${replacement}`)
        .join(' '),
    ]),
  ),
];
const aliasRules = [];
let discardedAliasRules = 0;
for (const [typeText, replacementText] of aliasEntries) {
  const type = aliasLanguageId(typeText);
  if (type === undefined) {
    discardedAliasRules += 1;
    continue;
  }
  const replacements = replacementText.split(' ').map(aliasLanguageId);
  assert.ok(
    replacements.every((replacement) => replacement !== undefined),
    `The CLDR alias ${typeText} has a valid type and a replacement ${replacementText} that is not a language identifier.`,
  );
  // Only a territory rule may name more than one replacement, and the annex resolves that list
  // over the region alone; a list that changed anything else would need a rule the annex lacks.
  assert.ok(
    replacements.length === 1 ||
      replacements.every(
        (replacement) =>
          replacement.region !== '' && aliasSubtags(replacement).length === 2,
      ),
    `The CLDR alias ${typeText} lists replacements that are not regions alone.`,
  );
  aliasRules.push({ type, replacements });
}

const aliasFields = (id) => [
  id.language === '' ? [] : [id.language],
  id.script === '' ? [] : [id.script],
  id.region === '' ? [] : [id.region],
  id.variants,
];
function compareAliasRules(left, right) {
  const leftFields = aliasFields(left.type);
  const rightFields = aliasFields(right.type);
  const size = (fields) => fields.reduce((sum, field) => sum + field.length, 0);
  if (size(leftFields) !== size(rightFields)) {
    return size(rightFields) - size(leftFields);
  }
  for (let field = 0; field < 4; field += 1) {
    const leftEmpty = leftFields[field].length === 0;
    const rightEmpty = rightFields[field].length === 0;
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
  }
  for (let field = 0; field < 4; field += 1) {
    const length = Math.max(
      leftFields[field].length,
      rightFields[field].length,
    );
    for (let position = 0; position < length; position += 1) {
      const order = compareCodeUnit(
        leftFields[field][position] ?? '',
        rightFields[field][position] ?? '',
      );
      if (order !== 0) return order;
    }
  }
  return 0;
}
aliasRules.sort(compareAliasRules);

// Two rules the order cannot separate would make the result depend on the table's own order, which
// the annex does not define.
for (let index = 1; index < aliasRules.length; index += 1) {
  assert.notEqual(
    compareAliasRules(aliasRules[index - 1], aliasRules[index]),
    0,
    `Two CLDR alias rules share the type ${aliasText(aliasRules[index].type)}.`,
  );
}

// The annex's territory exception picks, from a rule's list, the region likely subtags give the
// language and script. Its lookup tries the language with its script and then the language alone,
// so only the keys whose region is a later entry of some list change the answer, and a key with
// its script is kept as well when it answers differently from the language it would fall back to.
const laterRegions = new Set(
  aliasRules.flatMap(({ replacements }) =>
    replacements.slice(1).map(({ region }) => region),
  ),
);
const likelySubtags = likelyDocument.supplemental.likelySubtags;
const likelyRegion = (key) => likelySubtags[key]?.split('-').at(-1);
const likelyKeys = Object.keys(likelySubtags).filter((key) =>
  /^[a-z]{2,8}(?:-[A-Z][a-z]{3})?$/u.test(key),
);
const likelyRegions = Object.fromEntries(
  likelyKeys
    .filter((key) => {
      const region = likelyRegion(key);
      if (laterRegions.has(region)) return true;
      const [language, script] = key.split('-');
      return script !== undefined && laterRegions.has(likelyRegion(language));
    })
    .sort(compareCodeUnit)
    .map((key) => [key, likelyRegion(key)]),
);

const aliasRuleText = aliasRules
  .map(
    ({ type, replacements }) =>
      `${aliasText(type)}>${replacements.map(aliasText).join(' ')}`,
  )
  .join(',');
const likelyRegionText = Object.entries(likelyRegions)
  .map(([key, region]) => `${key}>${region}`)
  .join(',');

const localeAliasOutput = [
  `/** Generated from cldr-core ${manifest.version} by tools/generate-locale-profile.mjs. */`,
  '',
  '/**',
  ' * The alias rules of UTS #35 Part 1 Annex C, from `supplemental/aliases.json`, in the order the',
  ' * annex applies them: `type>replacement`, comma separated, with a territory rule listing its',
  ' * replacements space separated. Kept as text because the canonicalizer reads it once, and a',
  ' * string is the smallest form a bundler can carry.',
  ' */',
  '// prettier-ignore',
  `export const LOCALE_ALIAS_RULES = ${JSON.stringify(aliasRuleText)};`,
  '',
  '/**',
  ' * The likely region of a language, or of a language with its script, from',
  ' * `supplemental/likelySubtags.json`, for the keys that decide which region of a territory rule',
  ' * with several replacements applies. A key absent here takes the first replacement.',
  ' */',
  '// prettier-ignore',
  `export const LIKELY_REPLACEMENT_REGIONS = ${JSON.stringify(likelyRegionText)};`,
  '',
].join('\n');

// A tag is canonical when it is spelled in canonical case and no alias rule matches it, which is
// the annex's own stopping condition.
function isPinnedCanonical(tag) {
  const id = aliasLanguageId(tag);
  if (id === undefined || aliasText(id) !== tag) return false;
  const fields = aliasFields(id);
  return !aliasRules.some(({ type }) =>
    aliasFields(type).every((field, index) =>
      field.every((value) => fields[index].includes(value)),
    ),
  );
}

// Every tag in the table canonicalizes to itself, so a key here matches what
// `canonicalizeLocale` produces from a project's own configuration. A release that changed
// that would silently stop matching, and the chain would quietly become truncation again.
const nonCanonicalParentTags = [
  ...new Set(
    [
      parentLocales,
      collationParentLocales,
      pluralParentLocales,
      segmentationParentLocales,
    ].flatMap((table) => Object.entries(table).flat()),
  ),
].filter((tag) => !isPinnedCanonical(tag));
assert.deepEqual(
  nonCanonicalParentTags,
  [],
  'A CLDR parent-locale tag is not its own canonical form, so the toolkit would look it up under a name this table does not carry.',
);

const parentLocaleOutput = [
  `/** Generated from cldr-core ${manifest.version} by tools/generate-locale-profile.mjs. */`,
  // Wrapped as prettier wraps it: the name and the value together pass the print width, and a
  // generated file that the formatter would rewrite fails the gate on a difference nobody made.
  'export const PARENT_LOCALE_PROFILE =',
  `  '${cldrProfile}/equator-parent-locales-1' as const;`,
  '',
  '/**',
  ' * The parent CLDR declares for a locale, where that parent is not the tag with its last subtag',
  ' * removed.',
  ' *',
  ' * Inheritance in UTS #35 Part 1, Parent Locales, is not truncation. A locale takes the parent',
  ' * this table names; a locale absent from it takes the tag with its last subtag removed; a locale',
  ' * with one subtag left has no parent. So `en-AU` inherits from `en-001` rather than from `en`',
  ' * directly, and `de-CH` inherits from `de` because nothing here says otherwise.',
  ' *',
  ' * `und` is a value here rather than an absence, and it means the locale has no parent below',
  ' * root. `parentLocales.json` carries `_localeRules`',
  ' * `{"parentLocale":{"nonlikelyScript":"root"}}`: a locale written in a script its language does',
  ` * not usually take inherits from root, and ${undParents} entries say \`und\` for that reason. Dropping`,
  ' * them would put truncation back in force and send `az-Arab` to `az`, which is the Latin-script',
  ' * locale it was separated from, so they are kept and a reader stops when it reaches one.',
  ' * UTS #35 Part 1, Parent Locales, calls them a short list kept for migration: the rule covers',
  " * every language and script that is not the language's likely one, and both packages apply it",
  ' * from the likely scripts to the locales this table does not name, `ru-Latn` among them.',
  ' *',
  ' * Four parents change the language: `hi-Latn` takes `en-IN`, `ht` takes `fr-HT`, and `nb` and',
  ' * `nn` take `no`. That is CLDR data rather than a choice Equator made, and a project that',
  ' * disagrees says so under `parentLocales` in its own configuration.',
  ' *',
  ' * Both packages carry the same table. The toolkit resolves from it the chain each configured',
  ' * locale takes through the catalogs an owner ships, and writes that chain into the generated',
  ' * configuration. The runtime walks it where a formatting context names a locale the host has no',
  ' * data for, which can be any locale and not only a configured one, so it cannot be resolved',
  ' * ahead of time. Only the formatting operations read it.',
  ' */',
  '// prettier-ignore',
  `export const PARENT_LOCALES: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(orderedParentLocales)});`,
  '',
  '/**',
  ' * The parents CLDR declares for the collations, plurals and segmentations components, which the',
  ' * runtime walks for an ordering, a plural category and a segmentation.',
  ' *',
  ' * UTS #35 Part 1, Parent Locales (LDML 48.2): a component lists its own parents, which stand',
  ' * alone rather than merging with the table above, and the main rule that sends a locale in a',
  ' * script its language does not usually take to root is not applied to them, because their data',
  ' * is never mixed with text. So `sr-Latn` takes the plural rules of `sr`, and a locale absent from',
  ' * its component takes the tag with its last subtag removed.',
  ' */',
  '// prettier-ignore',
  `export const COLLATION_PARENT_LOCALES: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(collationParentLocales)});`,
  '// prettier-ignore',
  `export const PLURAL_PARENT_LOCALES: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(pluralParentLocales)});`,
  '// prettier-ignore',
  `export const SEGMENTATION_PARENT_LOCALES: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(segmentationParentLocales)});`,
  '',
].join('\n');

// The script a language is written in where a tag names none, by the lookup of UTS #35 Part 1
// section 4.3, Add Likely Subtags: language_region first, then language. The runtime compares the
// script of a formatting locale with the script of the locale its parent chain formatted in, and
// the two share a language only where the host has data in that language, which is data CLDR
// carries: a locale `availableLocales.json` lists, or the plural rules of a language that has no
// locale, as `guw` and `ars` have. So the table holds those languages, and each language_region
// whose script differs from its language's, and nothing for the thousands of languages CLDR has
// likely subtags for but no data. A language of the plural rules that is an alias is left out,
// because the runtime canonicalizes a tag before it walks the chain.
const REGION_SUBTAG = /^(?:[A-Z]{2}|\d{3})$/u;
const likelyScriptOf = (key) => likelySubtags[key]?.split('-')[1];
const availableLanguages = [
  ...new Set(availableLocales.map((tag) => tag.split('-')[0])),
].filter((language) => language !== 'root' && language !== 'und');
assert.deepEqual(
  availableLanguages.filter(
    (language) => likelyScriptOf(language) === undefined,
  ),
  [],
  'A language CLDR has locale data for has no likely subtags, so its script would be unknown.',
);
const pluralLanguages = [
  ...new Set(
    [...Object.keys(pluralCategories), ...Object.keys(ordinalCategories)].map(
      (tag) => tag.split('-')[0],
    ),
  ),
].filter(
  (language) =>
    language !== 'root' &&
    language !== 'und' &&
    !availableLanguages.includes(language) &&
    isPinnedCanonical(language) &&
    likelyScriptOf(language) !== undefined,
);
const localeLanguages = [...availableLanguages, ...pluralLanguages];
const likelyScripts = new Map(
  localeLanguages.map((language) => [language, likelyScriptOf(language)]),
);
for (const key of Object.keys(likelySubtags)) {
  const [language, region, ...rest] = key.split('-');
  if (rest.length > 0 || region === undefined || !REGION_SUBTAG.test(region)) {
    continue;
  }
  if (!likelyScripts.has(language)) continue;
  if (likelyScriptOf(key) !== likelyScriptOf(language)) {
    likelyScripts.set(key, likelyScriptOf(key));
  }
}
const languagesByScript = {};
for (const [key, script] of [...likelyScripts].sort(([left], [right]) =>
  compareCodeUnit(left, right),
)) {
  (languagesByScript[script] ??= []).push(key);
}
const likelyScriptTable = Object.fromEntries(
  Object.keys(languagesByScript)
    .sort(compareCodeUnit)
    .map((script) => [script, languagesByScript[script].join(' ')]),
);
const likelyScriptLanguages = localeLanguages.length;
const likelyScriptRegions = likelyScripts.size - likelyScriptLanguages;

const likelyScriptOutput = [
  `/** Generated from cldr-core ${manifest.version} by tools/generate-locale-profile.mjs. */`,
  '',
  '/**',
  ' * The script each language is written in where a tag names none, grouped by script: the',
  ' * languages and the language_region tags of `supplemental/likelySubtags.json` whose likely',
  ' * subtags give that script.',
  ' *',
  ` * ${likelyScriptLanguages} languages, the language of every locale CLDR carries and of every set of plural rules it`,
  ` * has for a language without a locale, and the ${likelyScriptRegions} language_region tags whose script is not`,
  " * their language's. UTS #35 Part 1 section 4.3 looks up language_region before language, so",
  ' * `zh-TW` is `Hant` where `zh` is `Hans`.',
  ' *',
  ' * The runtime reads it to tell whether the locale a formatter used is written in the script of',
  ' * the locale asked for, to give root as the main parent of a language and a script that',
  ' * language does not usually take, and to read a language_region whose script differs as the',
  ' * language_script_region UTS #35 Part 1, Lookup, aliases it to. The host is not asked, because',
  ' * its likely subtags are its own data and change with it. A language this table does not hold',
  ' * has no data the host could have used in its place, and its script is unknown.',
  ' */',
  '// prettier-ignore',
  `export const LIKELY_SCRIPTS: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(likelyScriptTable)});`,
  '',
].join('\n');

// The toolkit applies the main component's `nonlikelyScript` rule to the catalog chain of every
// configured locale, and a project configures locales in any language, not only one CLDR has locale
// data for. So its table holds the likely script of every language `likelySubtags.json` lists.
const languageScripts = {};
for (const key of Object.keys(likelySubtags).sort(compareCodeUnit)) {
  if (key.includes('-') || key === 'und') continue;
  (languageScripts[likelyScriptOf(key)] ??= []).push(key);
}
const languageScriptCount = Object.values(languageScripts).flat().length;
// UTS #35 Part 1, Lookup: a language_region aliases to language_script_region by likely subtags,
// which changes where its chain goes only where that script is not the language's.
let regionalScriptCount = 0;
for (const key of Object.keys(likelySubtags).sort(compareCodeUnit)) {
  const [language, region, ...rest] = key.split('-');
  if (rest.length > 0 || region === undefined || !REGION_SUBTAG.test(region)) {
    continue;
  }
  if (language === 'und' || likelyScriptOf(language) === undefined) continue;
  if (likelyScriptOf(key) === likelyScriptOf(language)) continue;
  (languageScripts[likelyScriptOf(key)] ??= []).push(key);
  regionalScriptCount += 1;
}
for (const script of Object.keys(languageScripts)) {
  languageScripts[script].sort(compareCodeUnit);
}
// A pinned parent keyed by a language_region that aliases to language_script_region is read before
// the alias, so it must name the parent its alias has, or the two spellings of one locale would
// inherit differently; `yue-CN` and `yue-Hans-CN` both take `zh-Hans` for collation.
assert.deepEqual(
  [
    parentLocales,
    collationParentLocales,
    pluralParentLocales,
    segmentationParentLocales,
  ].flatMap((table) =>
    Object.entries(table).filter(([key, parent]) => {
      const [language, region, ...rest] = key.split('-');
      if (
        rest.length > 0 ||
        region === undefined ||
        !REGION_SUBTAG.test(region) ||
        likelyScriptOf(language) === undefined ||
        likelyScriptOf(key) === undefined ||
        likelyScriptOf(key) === likelyScriptOf(language)
      ) {
        return false;
      }
      return table[`${language}-${likelyScriptOf(key)}-${region}`] !== parent;
    }),
  ),
  [],
  'A pinned parent of a language_region differs from the parent of the language_script_region it aliases to.',
);
const languageScriptTable = Object.fromEntries(
  Object.keys(languageScripts)
    .sort(compareCodeUnit)
    .map((script) => [script, languageScripts[script].join(' ')]),
);
assert.deepEqual(
  [...likelyScripts].filter(
    ([key, script]) => !languageScripts[script]?.includes(key),
  ),
  [],
  'The runtime and toolkit likely-script tables disagree on a tag both hold.',
);

const languageScriptOutput = [
  `/** Generated from cldr-core ${manifest.version} by tools/generate-locale-profile.mjs. */`,
  '',
  '/**',
  ' * The likely script of each language, grouped by script: every language',
  ` * \`supplemental/likelySubtags.json\` gives likely subtags for, ${languageScriptCount} of them, and the`,
  ` * ${regionalScriptCount} language_region tags whose likely script is not their language's.`,
  ' *',
  " * UTS #35 Part 1, Parent Locales: the main component's `nonlikelyScript` rule gives root as the",
  ' * parent of every locale of the form lang-Script whose script is not the likely script of lang,',
  ' * and `parentLocales.json` lists only some of them. The toolkit applies the rule to the catalog',
  ' * chain of a configured locale, which can be in any language, so this table holds every language',
  ' * the pinned data has a likely script for. A language it does not hold keeps truncation.',
  ' *',
  ' * UTS #35 Part 1, Lookup: a language_region aliases to language_script_region by likely subtags,',
  ' * so the chain of `zh-TW` runs through `zh-Hant-TW` and `zh-Hant`, and never reaches `zh`.',
  ' */',
  '// prettier-ignore',
  `export const LANGUAGE_SCRIPTS: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(languageScriptTable)});`,
  '',
].join('\n');

const toolkitRtlOutput = [
  '/** Generated from cldr-core 48.2.0 by tools/generate-locale-profile.mjs. */',
  '',
  '/**',
  " * Every script code written right to left: the list the runtime's `RTL_SCRIPTS` holds, generated",
  ' * from the same CLDR release rather than imported, because the toolkit cannot import the runtime.',
  ' *',
  " * The toolkit reads it to check that a pseudo-locale's script agrees with what its region says",
  ' * about direction.',
  ' */',
  '// prettier-ignore',
  `export const RTL_SCRIPTS: readonly string[] = Object.freeze(${JSON.stringify(rtlScripts)});`,
  '',
].join('\n');

// The primary identifier of every time zone name the pinned release carries, by the steps of
// AvailableNamedTimeZoneIdentifiers in ECMA-402 section 6.5.1: a Zone is primary, a Link resolves
// to its Zone, and three exceptions hold. UTC, Etc/UTC, Etc/GMT and GMT with their links are UTC.
// A Link that zone.tab's TZ column lists is primary. Any other Link resolves inside its own
// country.
//
// The zone.tab exception is what keeps a country's zone its own. The release links Europe/Oslo to
// Europe/Berlin because the two have agreed since 1970, and following that link would store
// Norway's zone as Germany's; zone.tab still lists Europe/Oslo for Norway, so it stays.
//
// The country exception does the same for a former name. The release links Africa/Timbuktu to
// Africa/Abidjan, which is another country's zone, so the name resolves to the one zone.tab line
// its own country has, Africa/Bamako. Where a country has several lines the standard reads the
// answer from backzone, which records the name each former name stood for.
//
// No file of the release states the country of a name zone.tab does not list. It is read from the
// name backzone maps it to, and is the Zone's own country where backzone has no line for it. The
// standard names one place where that mapping itself crosses a border, Atlantic/Jan_Mayen, and
// gives its country as SJ; that one fact is written here because the release cannot supply it.
//
// A "#= TARGET1" comment on a Link line of backward is the release's own statement of the name the
// link stands for. The standard's steps do not read it, so it is held against their answer
// instead: a release in which the two disagree stops the generator.
//
// The last step is the rename waiting period. Where the database adds a Zone to replace an existing
// one, the new name resolves to the former one until two years have passed, so that an identifier
// stored here is one a system on older data still reads. No file of a release dates a Link, so the
// renames and their days are the lock's, and a rename the lock does not record is found by holding
// the release against the table the previous pin produced: a name that was primary there, and is
// now a Link to a name that table did not carry, was renamed. A Zone and a Link that changed
// places were both carried, which is the case the standard gives no waiting period.
const COUNTRY_THE_RELEASE_DOES_NOT_STATE = new Map([
  ['Atlantic/Jan_Mayen', 'SJ'],
]);
const timeZoneSource = sourcesLock.dataSources?.ianaTimeZoneDatabase;
assert.ok(
  typeof timeZoneSource?.projectSnapshot === 'string' &&
    typeof timeZoneSource?.version === 'string',
  'standards/sources.lock.json does not pin the IANA Time Zone Database.',
);
const timeZoneRelease = timeZoneSource.version;
const timeZoneRoot = resolve(
  workspaceRoot,
  'standards',
  timeZoneSource.projectSnapshot,
);
const zoneTabCountry = new Map();
const zoneTabLinesOfCountry = new Map();
for (const line of (
  await readFile(resolve(timeZoneRoot, 'zone.tab'), 'utf8')
).split('\n')) {
  if (line === '' || line.startsWith('#')) continue;
  const [country, , name] = line.split('\t');
  zoneTabCountry.set(name, country);
  zoneTabLinesOfCountry.set(country, [
    ...(zoneTabLinesOfCountry.get(country) ?? []),
    name,
  ]);
}
const zoneTabNames = new Set(zoneTabCountry.keys());
const timeZoneLinks = new Map();
const timeZoneLinkStandsFor = new Map();
const backwardZones = new Set();
for (const line of (
  await readFile(resolve(timeZoneRoot, 'backward'), 'utf8')
).split('\n')) {
  const link = /^Link\s+(\S+)\s+(\S+)(?:\s+#=\s+(\S+))?/u.exec(line);
  if (link !== null) {
    timeZoneLinks.set(link[2], link[1]);
    if (link[3] !== undefined) timeZoneLinkStandsFor.set(link[2], link[3]);
  }
  const zone = /^Zone\s+(\S+)/u.exec(line);
  if (zone !== null) backwardZones.add(zone[1]);
}
// The release's etcetera file holds the zones that belong to no country: UTC, GMT, and a fixed
// offset from them for every whole hour a clock is kept at. Each is a Zone, so each is its own
// primary identifier, and a name the table lacked would be one the runtime refuses.
const etceteraZones = new Set();
for (const line of (
  await readFile(resolve(timeZoneRoot, 'etcetera'), 'utf8')
).split('\n')) {
  const zone = /^Zone\s+(\S+)/u.exec(line);
  if (zone !== null) etceteraZones.add(zone[1]);
  const link = /^Link\s+(\S+)\s+(\S+)/u.exec(line);
  assert.ok(
    link === null || (link[1] === 'Etc/GMT' && link[2] === 'GMT'),
    'The pinned etcetera file links ' +
      link?.[2] +
      ' to ' +
      link?.[1] +
      ', which the table has no rule for; the one link it is known to carry is GMT.',
  );
}
assert.ok(
  etceteraZones.size >= 20 &&
    etceteraZones.has('Etc/UTC') &&
    etceteraZones.has('Etc/GMT') &&
    [...etceteraZones].every((name) => name.startsWith('Etc/')),
  'The pinned etcetera file yielded ' +
    etceteraZones.size +
    ' zones, or one outside Etc/; the release carries UTC, GMT and a zone for each whole hour from them.',
);
// The two line openings and the single space are the standard's own reading of backzone. A line
// written any other way is one the standard does not read, and a name that needed it stops the
// generator below.
const BACKZONE_LINK_OPENINGS = ['Link ', '#PACKRATLIST zone.tab Link '];
const backzoneNames = new Map();
for (const line of (
  await readFile(resolve(timeZoneRoot, 'backzone'), 'utf8')
).split('\n')) {
  if (!BACKZONE_LINK_OPENINGS.some((opening) => line.startsWith(opening))) {
    continue;
  }
  const [target, name] = line.slice(line.indexOf('Link ') + 5).split(' ');
  assert.ok(
    target !== undefined && name !== undefined && !backzoneNames.has(name),
    'The pinned backzone file maps ' + name + ' twice, or not at all.',
  );
  backzoneNames.set(name, target);
}
assert.ok(
  zoneTabNames.size >= 400 &&
    !zoneTabNames.has(undefined) &&
    [...zoneTabLinesOfCountry.keys()].every((country) =>
      /^[A-Z]{2}$/u.test(country),
    ),
  'The pinned zone.tab did not yield the country and TZ columns; a reader that found no names would call every link non-primary.',
);
assert.ok(
  timeZoneLinks.size >= 200,
  'The pinned backward file yielded ' +
    timeZoneLinks.size +
    ' links; the release carries more than two hundred.',
);
assert.ok(
  backzoneNames.size >= 10,
  'The pinned backzone file yielded ' +
    backzoneNames.size +
    ' link lines; a reader that found none would leave every former name in the country of the zone it is linked to.',
);
for (const [name, country] of COUNTRY_THE_RELEASE_DOES_NOT_STATE) {
  assert.ok(
    timeZoneLinks.has(name) &&
      !zoneTabNames.has(name) &&
      zoneTabLinesOfCountry.has(country),
    name +
      ' is no longer a link outside zone.tab, or zone.tab has no line for ' +
      country +
      '; the country written for it has nothing to govern.',
  );
}
const UTC_NAMES = new Set(['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT']);
const zoneOfLink = (name, hops = 0) => {
  assert.ok(hops < 4, 'The links from ' + name + ' do not end.');
  return timeZoneLinks.has(name)
    ? zoneOfLink(timeZoneLinks.get(name), hops + 1)
    : name;
};
// backzone maps some former names to a name that is itself a former one, Asia/Chungking to
// Asia/Chongqing, so the country is followed through it.
const countryOfTimeZone = (name, hops = 0) => {
  assert.ok(hops < 4, 'The backzone lines from ' + name + ' do not end.');
  return (
    COUNTRY_THE_RELEASE_DOES_NOT_STATE.get(name) ??
    zoneTabCountry.get(name) ??
    (backzoneNames.has(name)
      ? countryOfTimeZone(backzoneNames.get(name), hops + 1)
      : zoneTabCountry.get(zoneOfLink(name)))
  );
};
const primaryWithinCountry = (name, zone) => {
  const zoneCountry = zoneTabCountry.get(zone);
  const nameCountry = countryOfTimeZone(name);
  assert.ok(
    nameCountry !== undefined || !backzoneNames.has(name),
    'The pinned backzone file maps ' +
      name +
      ' to ' +
      backzoneNames.get(name) +
      ', and zone.tab gives no country for either.',
  );
  if (nameCountry === zoneCountry) return zone;
  const countryLines = zoneTabLinesOfCountry.get(nameCountry);
  if (countryLines.length === 1) return countryLines[0];
  assert.ok(
    backzoneNames.has(name),
    name +
      ' is in ' +
      nameCountry +
      ', which has several zone.tab lines, and the pinned backzone file has no line for it.',
  );
  return backzoneNames.get(name);
};
const primaryBeforeWaiting = (name) => {
  let primary = name;
  if (timeZoneLinks.has(name) && !zoneTabNames.has(name)) {
    const zone = zoneOfLink(name);
    primary = zone.startsWith('Etc/') ? zone : primaryWithinCountry(name, zone);
  }
  return UTC_NAMES.has(primary) ? 'UTC' : primary;
};
const RENAME_WAITING_YEARS = 2;
const ISO_DAY = /^\d{4}-\d\d-\d\d$/u;
assert.ok(
  ISO_DAY.test(timeZoneSource.released ?? '') &&
    Array.isArray(timeZoneSource.renames),
  'standards/sources.lock.json does not give the pinned time zone release its day, or its list of renames.',
);
// Both are days written year first, so the later one is the greater string.
const waitingConcluded = (released) =>
  String(Number(released.slice(0, 4)) + RENAME_WAITING_YEARS) +
    released.slice(4) <=
  timeZoneSource.released;
const recordedRenames = new Set();
const renamedWhileWaiting = new Map();
for (const {
  renamed,
  replacement,
  release,
  released,
} of timeZoneSource.renames) {
  assert.ok(
    typeof release === 'string' &&
      ISO_DAY.test(released ?? '') &&
      released <= timeZoneSource.released,
    'The rename of ' +
      renamed +
      ' in standards/sources.lock.json names no release, or a day that is not one on or before the pinned release.',
  );
  assert.ok(
    timeZoneLinks.has(renamed) &&
      !zoneTabNames.has(renamed) &&
      zoneTabNames.has(replacement) &&
      primaryBeforeWaiting(renamed) === replacement,
    'standards/sources.lock.json records ' +
      renamed +
      ' as renamed to ' +
      replacement +
      ', and the pinned release does not link the first to the second as a name zone.tab lists.',
  );
  recordedRenames.add(renamed + '>' + replacement);
  if (!waitingConcluded(released))
    renamedWhileWaiting.set(replacement, renamed);
}
const primaryTimeZone = (name) => {
  const primary = primaryBeforeWaiting(name);
  return renamedWhileWaiting.get(primary) ?? primary;
};
let previousTimeZoneTable;
try {
  previousTimeZoneTable = await readFile(
    resolve(
      workspaceRoot,
      'packages/runtime/src/time-zone-identities.generated.ts',
    ),
    'utf8',
  );
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const previousTimeZoneRelease = /'tzdata-([^/']+)\/equator-time-zone-/u.exec(
  previousTimeZoneTable ?? '',
)?.[1];
if (
  previousTimeZoneRelease !== undefined &&
  previousTimeZoneRelease !== timeZoneRelease
) {
  const written = /TIME_ZONE_IDENTITIES =\s+("[^"]*");/u.exec(
    previousTimeZoneTable,
  );
  assert.ok(
    written !== null,
    'The time zone identity table of ' +
      previousTimeZoneRelease +
      ' could not be read, so a rename since it would go unseen.',
  );
  const previousPrimary = new Map(
    JSON.parse(written[1])
      .split(' ')
      .map((entry) => {
        const [name, primary = name] = entry.split('>');
        return [name, primary];
      }),
  );
  for (const name of timeZoneLinks.keys()) {
    if (zoneTabNames.has(name) || previousPrimary.get(name) !== name) continue;
    const replacement = primaryBeforeWaiting(name);
    assert.ok(
      previousPrimary.has(replacement) ||
        recordedRenames.has(name + '>' + replacement),
      'standards/sources.lock.json does not record the rename of ' +
        name +
        ' to ' +
        replacement +
        ', which release ' +
        timeZoneRelease +
        ' carries and ' +
        previousTimeZoneRelease +
        " did not. Add it to the renames of ianaTimeZoneDatabase with the release that made it and the day in that release's NEWS heading, so that " +
        replacement +
        ' resolves to ' +
        name +
        ' for the waiting period.',
    );
  }
}
for (const [name, standsFor] of timeZoneLinkStandsFor) {
  assert.equal(
    primaryTimeZone(name),
    primaryTimeZone(standsFor),
    'The pinned backward file says ' +
      name +
      ' stands for ' +
      standsFor +
      ', and the two do not resolve to one identifier.',
  );
}
const timeZoneEntries = [
  ...[...UTC_NAMES]
    .filter((name) => name !== 'UTC')
    .map((name) => [name, 'UTC']),
  ...[...zoneTabNames].map((name) => [
    name,
    renamedWhileWaiting.get(name) ?? name,
  ]),
  ...[...backwardZones].map((name) => [name, name]),
  ...[...etceteraZones]
    .filter((name) => !UTC_NAMES.has(name))
    .map((name) => [name, name]),
  ...[...timeZoneLinks.keys()]
    .filter((name) => !zoneTabNames.has(name))
    .map((name) => [name, primaryTimeZone(name)]),
].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
assert.equal(
  new Set(timeZoneEntries.map(([name]) => name.toLowerCase())).size,
  timeZoneEntries.length,
  'Two time zone names differ only by case, and the table is read without it.',
);
for (const [name, primary] of timeZoneEntries) {
  assert.ok(
    /^[\w+\-/]+$/u.test(name) && /^[\w+\-/]+$/u.test(primary),
    'The time zone name ' +
      name +
      ' or ' +
      primary +
      ' holds a character the table uses as a separator.',
  );
}
const timeZoneLinkCount = timeZoneEntries.filter(
  ([name, primary]) => name !== primary,
).length;
const timeZoneOutput = [
  '/** Generated from the IANA Time Zone Database ' +
    timeZoneRelease +
    ' by tools/generate-locale-profile.mjs. */',
  'export const TIME_ZONE_IDENTITIES_VERSION =',
  "  'tzdata-" + timeZoneRelease + "/equator-time-zone-1' as const;",
  '',
  '/**',
  ' * Every name the release gives a time zone, separated by spaces. A name that is not its own',
  ' * primary identifier is followed by a greater-than sign and the primary it stands for.',
  ' */',
  '// prettier-ignore',
  'export const TIME_ZONE_IDENTITIES =',
  '  ' +
    JSON.stringify(
      timeZoneEntries
        .map(([name, primary]) =>
          name === primary ? name : name + '>' + primary,
        )
        .join(' '),
    ) +
    ';',
  '',
].join('\n');
// The runtime gives a time zone value its identity and the toolkit judges the zone a message
// names, and neither package can import the other, so both carry the same table.
const timeZoneOutputPaths = [
  'packages/runtime/src/time-zone-identities.generated.ts',
  'packages/toolkit/src/time-zone-identities.generated.ts',
].map((path) => resolve(workspaceRoot, path));

// The single unit identifiers ECMA-402 sanctions, from Table 2 of section 6.6.2 in the pinned
// edition's own text. The toolkit judges a message's `unit` option by IsWellFormedUnitIdentifier
// over this table rather than by asking the build host, so a message has one answer on every
// machine that compiles it.
const unitSource = sourcesLock.dataSources?.ecma402MeasurementUnitIdentifiers;
assert.ok(
  typeof unitSource?.projectSnapshot === 'string' &&
    typeof unitSource?.version === 'string',
  'standards/sources.lock.json does not pin the ECMA-402 measurement unit clause.',
);
const unitClause = await readFile(
  resolve(workspaceRoot, 'standards', unitSource.projectSnapshot),
  'utf8',
);
const clauseText = (id) => {
  const start = unitClause.indexOf(`<emu-clause id="${id}"`);
  assert.ok(start >= 0, `The pinned ECMA-402 extract has no clause ${id}.`);
  const algorithm = /<emu-alg>([\s\S]*?)<\/emu-alg>/u.exec(
    unitClause.slice(start),
  );
  assert.ok(algorithm !== null, `Clause ${id} has no algorithm steps.`);
  return algorithm[1]
    .replace(/<\/li>/gu, ' ')
    .replace(/<[^>]+>/gu, '')
    .replace(/&quot;/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim();
};
// packages/toolkit/src/number-format-rules.ts transcribes these steps. An edition that changes
// them stops here, so the transcription is read again rather than left to disagree with its pin.
assert.equal(
  clauseText('sec-iswellformedunitidentifier'),
  [
    '1. If IsSanctionedSingleUnitIdentifier(unitIdentifier) is true, then a. Return true.',
    '2. Let i be StringIndexOf(unitIdentifier, "-per-", 0).',
    '3. If i is not-found or StringIndexOf(unitIdentifier, "-per-", i + 1) is not not-found, then a. Return false.',
    '4. Assert: The five-character substring "-per-" occurs exactly once in unitIdentifier, at index i.',
    '5. Let numerator be the substring of unitIdentifier from 0 to i.',
    '6. Let denominator be the substring of unitIdentifier from i + 5.',
    '7. If IsSanctionedSingleUnitIdentifier(numerator) and IsSanctionedSingleUnitIdentifier(denominator) are both true, then a. Return true.',
    '8. Return false.',
  ].join(' '),
  'IsWellFormedUnitIdentifier in the pinned ECMA-402 edition is not the algorithm packages/toolkit/src/number-format-rules.ts transcribes.',
);
assert.equal(
  clauseText('sec-issanctionedsingleunitidentifier'),
  '1. If unitIdentifier is listed in Table 2 below, return true. 2. Else, return false.',
  'IsSanctionedSingleUnitIdentifier in the pinned ECMA-402 edition no longer reads Table 2.',
);
const unitTable =
  /<emu-table id="table-sanctioned-single-unit-identifiers"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/u.exec(
    unitClause,
  );
assert.ok(
  unitTable !== null,
  'The pinned ECMA-402 extract has no Table 2 of sanctioned single units.',
);
const sanctionedUnits = [...unitTable[1].matchAll(/<td>([^<]*)<\/td>/gu)].map(
  ([, unit]) => unit,
);
assert.equal(
  sanctionedUnits.length,
  [...unitTable[1].matchAll(/<tr>/gu)].length,
  'A row of Table 2 in the pinned ECMA-402 extract is not one identifier in one cell.',
);
for (const unit of sanctionedUnits) {
  // Section 6.6: the canonical form is lower-case Basic Latin letters with medial hyphens.
  assert.match(
    unit,
    /^[a-z]+(?:-[a-z]+)*$/u,
    `${unit} in Table 2 is not a core unit identifier in canonical form.`,
  );
}
assert.deepEqual(
  sanctionedUnits,
  [...new Set(sanctionedUnits)].sort(compareCodeUnit),
  'Table 2 of the pinned ECMA-402 extract is not a sorted list of distinct identifiers.',
);
const unitEdition = /^ECMA-402 (\d+(?:st|nd|rd|th)) edition, \w+ \d{4}$/u.exec(
  unitSource.version,
);
assert.ok(
  unitEdition !== null,
  'standards/sources.lock.json names the ECMA-402 edition in a form this generator does not read.',
);
const sanctionedUnitOutput = [
  `/** Generated from ECMA-402 ${unitEdition[1]} edition, section 6.6.2, by tools/generate-locale-profile.mjs. */`,
  '',
  '/** The single unit identifiers Table 2 of the pinned edition sanctions, in code unit order. */',
  '// prettier-ignore',
  `export const SANCTIONED_SINGLE_UNITS: readonly string[] = Object.freeze(${JSON.stringify(sanctionedUnits)});`,
  '',
].join('\n');
const sanctionedUnitOutputPath = resolve(
  workspaceRoot,
  'packages/toolkit/src/sanctioned-units.generated.ts',
);

// CurrencyDigits, which ECMA-402 section 16.5.1 leaves to the implementation: the number of
// fraction digits a currency is written with, or 2 where nothing is known. The constructor reads it
// for a currency's default fraction digits, and whether `roundingIncrement` beside one inherited
// fraction-digit bound is accepted depends on it. The pinned CLDR release is the data the profile
// pins for every such fact, so the toolkit reads it from there rather than from the build host.
const currencyDocument = JSON.parse(
  await readFile(resolve(cldrRoot, 'supplemental/currencyData.json'), 'utf8'),
);
const currencyFractions = currencyDocument.supplemental.currencyData.fractions;
assert.equal(
  currencyFractions.DEFAULT?._digits,
  '2',
  'cldr-core no longer gives a currency it says nothing about 2 fraction digits, which is what ECMA-402 CurrencyDigits returns for one.',
);
const currencyDigits = Object.entries(currencyFractions)
  .filter(([code]) => code !== 'DEFAULT')
  .map(([code, { _digits: digits }]) => {
    assert.match(code, /^[A-Z]{3}$/u, `${code} is not a currency code.`);
    assert.match(digits, /^\d$/u, `${code} gives no fraction digits.`);
    return [code, Number(digits)];
  })
  .filter(([, digits]) => digits !== 2)
  .sort(([left], [right]) => compareCodeUnit(left, right));
const currencyDigitsOutput = [
  `/** Generated from cldr-core ${manifest.version} by tools/generate-locale-profile.mjs. */`,
  '',
  '/**',
  ' * The fraction digits of every currency the release writes with other than 2, which is what',
  ' * ECMA-402 CurrencyDigits answers for a currency nothing is known about.',
  ' */',
  '// prettier-ignore',
  `export const CURRENCY_DIGITS: Readonly<Record<string, number>> = Object.freeze(${JSON.stringify(Object.fromEntries(currencyDigits))});`,
  '',
].join('\n');
const currencyDigitsOutputPath = resolve(
  workspaceRoot,
  'packages/toolkit/src/currency-digits.generated.ts',
);

const toolkitRtlOutputPath = resolve(
  workspaceRoot,
  'packages/toolkit/src/rtl-scripts.generated.ts',
);

const encompassedOutputPath = resolve(
  workspaceRoot,
  'packages/runtime/core/src/encompassed-languages.generated.ts',
);

const pluralOutputPath = resolve(
  workspaceRoot,
  'packages/toolkit/src/plural-categories.generated.ts',
);

const endonymOutputPath = resolve(
  workspaceRoot,
  'packages/toolkit/src/endonyms.generated.ts',
);

// The toolkit resolves a configuration's catalog chains from the table and the runtime walks it
// where the host has no data for a formatting locale, and neither package can import the other, so
// both carry the same table.
const parentLocaleOutputPaths = [
  'packages/runtime/src/parent-locales.generated.ts',
  'packages/toolkit/src/parent-locales.generated.ts',
].map((path) => resolve(workspaceRoot, path));

const likelyScriptOutputPath = resolve(
  workspaceRoot,
  'packages/runtime/src/likely-scripts.generated.ts',
);

const languageScriptOutputPath = resolve(
  workspaceRoot,
  'packages/toolkit/src/language-scripts.generated.ts',
);

const outputPath = resolve(
  workspaceRoot,
  'packages/runtime/core/src/locale-profile.generated.ts',
);
// The toolkit canonicalizes a declaration and the runtime a request, and neither package can import
// the other, so both carry the same table.
const localeAliasOutputPaths = [
  'packages/runtime/core/src/locale-aliases.generated.ts',
  'packages/toolkit/src/locale-aliases.generated.ts',
].map((path) => resolve(workspaceRoot, path));
if (process.argv.includes('--check')) {
  assert.equal(
    await readFile(outputPath, 'utf8'),
    output,
    'The checked-in Equator locale profile is stale; run pnpm run generate:locale-profile.',
  );
  assert.equal(
    await readFile(pluralOutputPath, 'utf8'),
    pluralOutput,
    'The checked-in Equator plural-category table is stale; run pnpm run generate:locale-profile.',
  );
  assert.equal(
    await readFile(encompassedOutputPath, 'utf8'),
    encompassedOutput,
    'The checked-in Equator encompassed-language table is stale; run pnpm run generate:locale-profile.',
  );
  assert.equal(
    await readFile(endonymOutputPath, 'utf8'),
    endonymOutput,
    'The checked-in Equator endonym table is stale; run pnpm run generate:locale-profile.',
  );
  for (const path of parentLocaleOutputPaths) {
    assert.equal(
      await readFile(path, 'utf8'),
      parentLocaleOutput,
      'The checked-in Equator parent-locale table is stale; run pnpm run generate:locale-profile.',
    );
  }
  assert.equal(
    await readFile(likelyScriptOutputPath, 'utf8'),
    likelyScriptOutput,
    'The checked-in Equator likely-script table is stale; run pnpm run generate:locale-profile.',
  );
  assert.equal(
    await readFile(languageScriptOutputPath, 'utf8'),
    languageScriptOutput,
    'The checked-in Equator language-script table is stale; run pnpm run generate:locale-profile.',
  );
  assert.equal(
    await readFile(toolkitRtlOutputPath, 'utf8'),
    toolkitRtlOutput,
    'The checked-in toolkit copy of the right-to-left scripts is stale; run pnpm run generate:locale-profile.',
  );
  for (const path of localeAliasOutputPaths) {
    assert.equal(
      await readFile(path, 'utf8'),
      localeAliasOutput,
      'The checked-in Equator locale alias table is stale; run pnpm run generate:locale-profile.',
    );
  }
  assert.equal(
    await readFile(sanctionedUnitOutputPath, 'utf8'),
    sanctionedUnitOutput,
    'The checked-in table of the units ECMA-402 sanctions is stale; run pnpm run generate:locale-profile.',
  );
  assert.equal(
    await readFile(currencyDigitsOutputPath, 'utf8'),
    currencyDigitsOutput,
    'The checked-in table of currency fraction digits is stale; run pnpm run generate:locale-profile.',
  );
  for (const path of timeZoneOutputPaths) {
    assert.equal(
      await readFile(path, 'utf8'),
      timeZoneOutput,
      'The checked-in Equator time zone identity table is stale; run pnpm run generate:locale-profile.',
    );
  }
  console.log(
    `Verified ${rtlScripts.length} RTL scripts, ${rtlRanges.length} strong right-to-left code point ranges derived from Unicode 17.0.0 Bidi_Class, agreeing with the CLDR script data on every letter in Unicode and dropping ${droppedByBidiClass.length} context-resolved code points and no strong one, and cardinal plural categories for ${Object.keys(pluralCategories).length} languages and ordinal plural categories for ${Object.keys(ordinalCategories).length} languages from cldr-core 48.2.0, and ${encompassedPairs} encompassed-language pairs over ${Object.keys(encompassed).length} language subtags, every one ranked by CLDR at ${widestKept} or closer where two languages it does not relate stand at ${unrelatedDistance._distance} and its default matching threshold is ${DEFAULT_THRESHOLD}; likely-script resolution remains native Intl under the tested platform matrix; and ${Object.keys(endonyms).length} endonyms from cldr-localenames-full ${localeNamesManifest.version}, agreeing with this platform's ICU on ${endonymsComparedToIcu.length - endonymsDisagreeingWithIcu.length} of the ${endonymsComparedToIcu.length} locales it has display names for; and ${Object.keys(orderedParentLocales).length} declared parent locales from cldr-core ${manifest.version}, ${undParents} of which name root, and the likely script of ${likelyScriptLanguages} languages and ${likelyScriptRegions} language_region tags for the runtime and of ${languageScriptCount} languages for the toolkit; and ${aliasRules.length} locale alias rules, ${discardedAliasRules} discarded as UTS #35 Annex C discards them, with ${Object.keys(likelyRegions).length} likely regions for the territory exception; and ${timeZoneEntries.length} time zone names from tzdata ${timeZoneRelease}, ${timeZoneLinkCount} of them resolved to another primary identifier; and ${sanctionedUnits.length} single units ECMA-402 ${unitEdition[1]} edition sanctions, and ${currencyDigits.length} currencies cldr-core ${manifest.version} writes with other than 2 fraction digits.`,
  );
} else {
  let current;
  try {
    current = await readFile(outputPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (current !== output) await writeFile(outputPath, output, 'utf8');

  let currentPlural;
  try {
    currentPlural = await readFile(pluralOutputPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (currentPlural !== pluralOutput) {
    await writeFile(pluralOutputPath, pluralOutput, 'utf8');
  }

  let currentEncompassed;
  try {
    currentEncompassed = await readFile(encompassedOutputPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (currentEncompassed !== encompassedOutput) {
    await writeFile(encompassedOutputPath, encompassedOutput, 'utf8');
  }

  let currentEndonyms;
  try {
    currentEndonyms = await readFile(endonymOutputPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (currentEndonyms !== endonymOutput) {
    await writeFile(endonymOutputPath, endonymOutput, 'utf8');
  }

  for (const path of parentLocaleOutputPaths) {
    let currentParentLocales;
    try {
      currentParentLocales = await readFile(path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (currentParentLocales !== parentLocaleOutput) {
      await writeFile(path, parentLocaleOutput, 'utf8');
    }
  }

  let currentLikelyScripts;
  try {
    currentLikelyScripts = await readFile(likelyScriptOutputPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (currentLikelyScripts !== likelyScriptOutput) {
    await writeFile(likelyScriptOutputPath, likelyScriptOutput, 'utf8');
  }

  let currentLanguageScripts;
  try {
    currentLanguageScripts = await readFile(languageScriptOutputPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (currentLanguageScripts !== languageScriptOutput) {
    await writeFile(languageScriptOutputPath, languageScriptOutput, 'utf8');
  }

  let currentToolkitRtl;
  try {
    currentToolkitRtl = await readFile(toolkitRtlOutputPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (currentToolkitRtl !== toolkitRtlOutput) {
    await writeFile(toolkitRtlOutputPath, toolkitRtlOutput, 'utf8');
  }

  for (const path of localeAliasOutputPaths) {
    let currentAliases;
    try {
      currentAliases = await readFile(path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (currentAliases !== localeAliasOutput) {
      await writeFile(path, localeAliasOutput, 'utf8');
    }
  }

  for (const [path, generated] of [
    [sanctionedUnitOutputPath, sanctionedUnitOutput],
    [currencyDigitsOutputPath, currencyDigitsOutput],
  ]) {
    let current;
    try {
      current = await readFile(path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (current !== generated) await writeFile(path, generated, 'utf8');
  }

  for (const path of timeZoneOutputPaths) {
    let currentTimeZones;
    try {
      currentTimeZones = await readFile(path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (currentTimeZones !== timeZoneOutput) {
      await writeFile(path, timeZoneOutput, 'utf8');
    }
  }
}
