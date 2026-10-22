/**
 * The consumer's exercise sheet, read and held to its authority, and the claims that follow.
 *
 * The sheet is `src/app/exercise-route.ts` in the consumer: every pipe and every formatting
 * function, each on a line of its own, writing the inputs in `src/app/exercise-inputs.json`. The
 * consumer stage reads it as the server answered it and as the build prerendered it; the browser
 * stage reads it as each engine adopted it and as a client navigation drew it. Both hold every line
 * to `exerciseAuthority`, run on the host that wrote the line, and claim what they held here, so
 * one list says which capability each line is evidence for.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';

import { recordCapabilityClaim } from './capability-evidence.mjs';

export { exerciseAuthority } from './exercise-authority.mjs';

/**
 * The name the application gives each sheet page, which its address spells in the page's locale:
 * `live` is `مباشر` in Arabic, and `values` is `قيم`.
 */
export const exerciseSheetNames = Object.freeze({
  exercise: 'live',
  'exercise values': 'values',
});

/** The inputs the consumer's sheet writes. */
export async function readExerciseInputs(consumerRoot) {
  return JSON.parse(
    await readFile(
      resolve(consumerRoot, 'src/app/exercise-inputs.json'),
      'utf8',
    ),
  );
}

/**
 * A message the sheet localizes, as the translator wrote it in the consumer's catalog for the
 * locale. Read from the catalog line itself, which holds a plain or single-quoted scalar, either as
 * the entry's value or as the `message` of an entry that also declares its slots.
 */
export async function readCatalogMessage(consumerRoot, locale, key) {
  const catalog = await readFile(
    resolve(consumerRoot, 'i18n/shell', `${locale}.yaml`),
    'utf8',
  );
  const line = new RegExp(
    `^  ${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}:(?: (.+)|\n    message: (.+))$`,
    'mu',
  ).exec(catalog);
  assert.ok(line, `The ${locale} catalog has no line for ${key}`);
  const written = (line[1] ?? line[2]).trim();
  return written.startsWith("'")
    ? written.slice(1, -1).replaceAll("''", "'")
    : written;
}

/**
 * The direction CLDR gives a locale: that of its likely script, from the pinned CLDR release's
 * script metadata, rather than from anything Equator derives.
 */
async function directionOf(locale) {
  const { scriptMetadata } = JSON.parse(
    await readFile(
      new URL('../node_modules/cldr-core/scriptMetadata.json', import.meta.url),
      'utf8',
    ),
  );
  const { script } = new Intl.Locale(locale).maximize();
  assert.ok(script in scriptMetadata, `CLDR has no metadata for ${script}`);
  return scriptMetadata[script].rtl === 'YES' ? 'rtl' : 'ltr';
}

/**
 * What the authority needs beside the inputs for one locale: each message the sheet localizes, as
 * the catalog has it, and the locale's direction.
 */
export async function readExerciseSources(consumerRoot, locale, inputs) {
  const keys = [
    inputs.message,
    inputs.richMessage,
    'extension.uppercase',
    'extension.badge',
    `feature-state.${inputs.extensions.member}`,
  ];
  return {
    catalog: Object.fromEntries(
      await Promise.all(
        keys.map(async (key) => [
          key,
          await readCatalogMessage(consumerRoot, locale, key),
        ]),
      ),
    ),
    direction: await directionOf(locale),
  };
}

/**
 * What a page's sheet says: its locale, its policy, and each line by the capability it shows. Where
 * the whole document was read, also the language and direction of the root the application
 * attaches overlays to.
 */
export function sheetOf({ locale, sheet, policy, lines, overlay }) {
  return Object.freeze({
    locale,
    sheet,
    policy: JSON.parse(policy),
    overlay,
    // Angular keeps one space where the template breaks the line around an interpolation. A
    // direction mark the formatter writes is not white space, and survives.
    lines: new Map(lines.map(([id, text]) => [id, text.trim()])),
  });
}

/**
 * One line of a sheet, as `[id, text]`: its text, or the attribute it names where a directive
 * writes the line into an attribute.
 */
function lineOf(line) {
  const attribute = line.getAttribute('data-exercise-attribute');
  return [
    line.getAttribute('data-exercise'),
    attribute === null
      ? line.textContent
      : (line.getAttribute(attribute) ?? ''),
  ];
}

/** The sheet in a document a server answered or a build wrote. */
export function sheetInDocument(html) {
  const { document } = new JSDOM(html).window;
  const section = document.querySelector('[data-route-view="exercise"]');
  assert.notEqual(section, null, 'The document shows no exercise sheet');
  const overlay = document.querySelector('[data-overlay-root]');
  assert.notEqual(overlay, null, 'The document has no overlay root');
  return sheetOf({
    overlay: {
      lang: overlay.getAttribute('lang'),
      dir: overlay.getAttribute('dir'),
    },
    locale: section.getAttribute('data-exercise-locale'),
    sheet: section.getAttribute('data-exercise-sheet'),
    policy: section.getAttribute('data-url-policy'),
    lines: [...section.querySelectorAll('[data-exercise]')].map(lineOf),
  });
}

/**
 * One line of the sheet, held to what the host's own formatter wrote for it. Where it matters which
 * part of Equator wrote the line, the failure says so.
 */
function holds({ lines }, expected, id, writer) {
  assert.ok(lines.has(id), `The exercise sheet has no ${id} line`);
  assert.equal(
    lines.get(id),
    expected[id],
    `The exercise sheet's ${id} line${writer === undefined ? '' : `, written ${writer},`} is not what the host writes for its input`,
  );
}

/**
 * Every pipe, held and claimed. A duration is claimed only where the host has a duration
 * formatter; elsewhere the line holds the empty text a pipe renders for the typed result.
 */
export function claimExercisedPipes(check, sheet, expected, context) {
  const pipe = (id) =>
    holds(sheet, expected, id, 'by a pipe of @neolorn/equator');
  holds(
    sheet,
    expected,
    'localize',
    'from the catalog provideLocalizationSetup installed, by a pipe of @neolorn/equator',
  );
  recordCapabilityClaim(check, 'feature:provideLocalizationSetup', context);
  recordCapabilityClaim(check, 'pipe:localize', context);
  pipe('localizedDecimal');
  recordCapabilityClaim(check, 'pipe:localizedDecimal', context);
  pipe('localizedMoney');
  recordCapabilityClaim(check, 'pipe:localizedMoney', context);
  pipe('localizedMeasurement');
  recordCapabilityClaim(check, 'pipe:localizedMeasurement', context);
  pipe('localizedPercent');
  recordCapabilityClaim(check, 'pipe:localizedPercent', context);
  pipe('localizedPercentagePoints');
  recordCapabilityClaim(check, 'pipe:localizedPercentagePoints', context);
  pipe('localizedInstant');
  recordCapabilityClaim(check, 'pipe:localizedInstant', context);
  pipe('localizedPlainDate');
  recordCapabilityClaim(check, 'pipe:localizedPlainDate', context);
  pipe('localizedPlainTime');
  recordCapabilityClaim(check, 'pipe:localizedPlainTime', context);
  pipe('localizedPlainDateTime');
  recordCapabilityClaim(check, 'pipe:localizedPlainDateTime', context);
  pipe('localizedZonedDateTime');
  recordCapabilityClaim(check, 'pipe:localizedZonedDateTime', context);
  pipe('localizedDuration');
  if (expected.localizedDuration !== '') {
    recordCapabilityClaim(check, 'pipe:localizedDuration', context);
  }
  recordCapabilityClaim(check, 'entry:@neolorn/equator', context);
}

/**
 * A field kind's two lines: the text its value is written as, held to the host's, and what reading
 * that text back gives, which must be the value the field was given.
 */
function holdsField(sheet, expected, value, written, read) {
  holds(sheet, expected, written);
  assert.ok(sheet.lines.has(read), `The exercise sheet has no ${read} line`);
  assert.deepEqual(
    JSON.parse(sheet.lines.get(read)),
    value,
    `The exercise sheet's ${read} line is not the value its field was given`,
  );
}

/** Every field kind, held and claimed. */
export function claimExercisedControls(
  check,
  sheet,
  expected,
  controls,
  context,
) {
  const field = (kind) =>
    holdsField(
      sheet,
      expected,
      controls[kind].value,
      `formatLocalizedInput:${kind}`,
      `parseLocalizedInput:${kind}`,
    );
  field('decimal');
  recordCapabilityClaim(check, 'control:decimal', context);
  field('money');
  recordCapabilityClaim(check, 'control:money', context);
  field('measurement');
  recordCapabilityClaim(check, 'control:measurement', context);
  field('percent');
  recordCapabilityClaim(check, 'control:percent', context);
  field('percentage-points');
  recordCapabilityClaim(check, 'control:percentage-points', context);
  field('plain-date');
  recordCapabilityClaim(check, 'control:plain-date', context);
  field('plain-time');
  recordCapabilityClaim(check, 'control:plain-time', context);
  field('plain-date-time');
  recordCapabilityClaim(check, 'control:plain-date-time', context);
  field('time-zone');
  recordCapabilityClaim(check, 'control:time-zone', context);
  field('duration');
  recordCapabilityClaim(check, 'control:duration', context);
  field('instant');
  recordCapabilityClaim(check, 'control:instant', context);
}

/**
 * Every kind of extension the application registers through `withExtensions`, held and claimed. A
 * parse result is compared as the value it is, whatever order its fields were written in.
 */
export function claimExercisedExtensions(check, sheet, expected, context) {
  const extension = (kind) => holds(sheet, expected, `extension:${kind}`);
  extension('message-function');
  recordCapabilityClaim(check, 'extension:message-function', context);
  extension('identifier-segment');
  extension('identifier-segment:refused');
  recordCapabilityClaim(check, 'extension:identifier-segment', context);
  extension('rich-slot-kind');
  recordCapabilityClaim(check, 'extension:rich-slot-kind', context);
  extension('formatting-adapter');
  recordCapabilityClaim(check, 'extension:formatting-adapter', context);
  const read = (kind) => {
    const id = `extension:${kind}`;
    assert.ok(sheet.lines.has(id), `The exercise sheet has no ${id} line`);
    assert.deepEqual(
      JSON.parse(sheet.lines.get(id)),
      JSON.parse(expected[id]),
      `The exercise sheet's ${id} line is not what the binding installed with withExtensions reads`,
    );
  };
  read('parsing-adapter');
  recordCapabilityClaim(check, 'extension:parsing-adapter', context);
  recordCapabilityClaim(check, 'feature:withExtensions', context);
}

/**
 * The sheet a page shows, as the route's parameter codec reads it from the address. Every locale's
 * spelling must read back as the one name the application gives the sheet.
 */
export function claimSheetParameter(check, sheet, name, locale, context) {
  assert.equal(
    sheet.sheet,
    name,
    `${check}: the RouteParameterCodec the exercise route declares did not read the sheet's ${locale} spelling as ${name} through provideLocalizedRouter from @neolorn/equator/router`,
  );
  recordCapabilityClaim(check, 'declaration:route-parameter-codec', context);
  recordCapabilityClaim(check, 'feature:provideLocalizedRouter', context);
  recordCapabilityClaim(check, 'entry:@neolorn/equator/router', context);
}

/**
 * The root the application attaches overlays to, in the locale the page was written in and that
 * locale's direction, which only the adapter the application installed can have put there.
 */
export function claimOverlayLocale(check, sheet, locale, direction, context) {
  assert.deepEqual(
    sheet.overlay,
    { lang: locale, dir: direction },
    `${check}: the overlay root is not in the locale the LocalizationOverlayAdapter installed with withOverlayLocale was handed`,
  );
  recordCapabilityClaim(check, 'extension:overlay-adapter', context);
  recordCapabilityClaim(check, 'feature:withOverlayLocale', context);
}

/** The directive and the component that put a message where interpolation cannot, held and claimed. */
export function claimExercisedDirectives(check, sheet, expected, context) {
  holds(
    sheet,
    expected,
    'directive:LocalizedMessage',
    'by the localized-message component',
  );
  recordCapabilityClaim(check, 'directive:LocalizedMessage', context);
  holds(
    sheet,
    expected,
    'directive:LocalizedLabel',
    'into aria-label by the localizedLabel directive',
  );
  recordCapabilityClaim(check, 'directive:LocalizedLabel', context);
}

/**
 * What every line was written under: the formatting context the runtime carries, which is the one
 * the application declared, and what the core entry point says of the locale.
 */
export function claimExercisedContext(check, sheet, expected, context) {
  holds(
    sheet,
    expected,
    'formattingContext',
    'from what withFormattingContext declared',
  );
  recordCapabilityClaim(check, 'feature:withFormattingContext', context);
  const core = (id) => holds(sheet, expected, id, 'by @neolorn/equator/core');
  core('core:directionForLocale');
  core('core:openGraphLocale');
  recordCapabilityClaim(check, 'entry:@neolorn/equator/core', context);
}

/**
 * A moment the page asks the localization to word, held and claimed. The call names neither a clock
 * nor thresholds, so the words are the ones the application installed.
 */
export function claimInstalledRelativeTime(check, sheet, expected, context) {
  holds(
    sheet,
    expected,
    'relativeTime',
    'against the clock withLocalizationClock installed and the thresholds withRelativeTimePolicy declared',
  );
  recordCapabilityClaim(check, 'feature:withLocalizationClock', context);
  recordCapabilityClaim(check, 'feature:withRelativeTimePolicy', context);
}

/** Every formatting function, held and claimed, durations as above. */
export function claimExercisedFormats(check, sheet, expected, context) {
  holds(sheet, expected, 'formatNumber');
  recordCapabilityClaim(check, 'format:formatNumber', context);
  holds(sheet, expected, 'formatMoney');
  recordCapabilityClaim(check, 'format:formatMoney', context);
  holds(sheet, expected, 'formatMeasurement');
  recordCapabilityClaim(check, 'format:formatMeasurement', context);
  holds(sheet, expected, 'formatPercent');
  recordCapabilityClaim(check, 'format:formatPercent', context);
  holds(sheet, expected, 'formatPercentagePoints');
  recordCapabilityClaim(check, 'format:formatPercentagePoints', context);
  holds(sheet, expected, 'formatInstant');
  recordCapabilityClaim(check, 'format:formatInstant', context);
  holds(sheet, expected, 'formatPlainDate');
  recordCapabilityClaim(check, 'format:formatPlainDate', context);
  holds(sheet, expected, 'formatPlainTime');
  recordCapabilityClaim(check, 'format:formatPlainTime', context);
  holds(sheet, expected, 'formatPlainDateTime');
  recordCapabilityClaim(check, 'format:formatPlainDateTime', context);
  holds(sheet, expected, 'formatZonedDateTime');
  recordCapabilityClaim(check, 'format:formatZonedDateTime', context);
  holds(sheet, expected, 'formatNumberRange');
  recordCapabilityClaim(check, 'format:formatNumberRange', context);
  holds(sheet, expected, 'formatInstantRange');
  recordCapabilityClaim(check, 'format:formatInstantRange', context);
  holds(sheet, expected, 'formatList');
  recordCapabilityClaim(check, 'format:formatList', context);
  holds(sheet, expected, 'formatRelativeTime');
  recordCapabilityClaim(check, 'format:formatRelativeTime', context);
  holds(sheet, expected, 'resolveRelativeTime');
  recordCapabilityClaim(check, 'format:resolveRelativeTime', context);
  holds(sheet, expected, 'formatDisplayName');
  recordCapabilityClaim(check, 'format:formatDisplayName', context);
  holds(sheet, expected, 'selectPlural');
  recordCapabilityClaim(check, 'format:selectPlural', context);
  holds(sheet, expected, 'compareLocalized');
  recordCapabilityClaim(check, 'format:compareLocalized', context);
  holds(sheet, expected, 'segmentText');
  recordCapabilityClaim(check, 'format:segmentText', context);
  holds(sheet, expected, 'formatPersonName');
  recordCapabilityClaim(check, 'format:formatPersonName', context);
  holds(sheet, expected, 'formatLocalizedInput');
  recordCapabilityClaim(check, 'format:formatLocalizedInput', context);
  holds(sheet, expected, 'parseLocalizedInput');
  recordCapabilityClaim(check, 'format:parseLocalizedInput', context);
  holds(sheet, expected, 'formatDuration');
  if (expected.formatDuration !== 'unsupported-formatting-capability') {
    recordCapabilityClaim(check, 'format:formatDuration', context);
  }
}
