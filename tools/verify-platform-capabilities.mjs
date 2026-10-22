/**
 * The `Intl` capabilities Equator relies on, probed on every engine it claims to support.
 *
 * `specs/01-standards-profile.spec.md` section 5 makes the host's own implementation the engine and
 * requires a capability to be feature-detected before anything rests on it. The probe runs on the
 * pinned Node version and in the three browser engines, so each detection is exercised against
 * the engines a release claims rather than against a stub. The other Node rows the suites run on
 * take the same probe, because the toolkit canonicalizes a declaration on whichever of them a build
 * uses, and a host missing a capability is a host the documentation has to name.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 3 forbids a difference between runtimes
 * from changing an identity. The toolkit canonicalizes a declaration at build time and the runtime
 * canonicalizes a requested locale on the server and in the browser, both with the module built
 * from the pinned CLDR alias data rather than through the host's `Intl`. So every engine runs that
 * built module over spellings that are not canonical, and every answer has to be the pinned data's.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 3 lets a supported runtime lack a
 * capability only where the release names both in its documentation. The compatibility page is
 * where it does, and a host the probe finds lacking one is held against that page in both
 * directions.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, firefox, webkit } from 'playwright';

import { listenForBrowsers } from './browser-reachable-port.mjs';
import {
  reportedCapabilities,
  unreportedCapabilities,
} from './host-capability-gaps.mjs';
import { describeSpawnFailure, locateNode } from './node-runtimes.mjs';
import { inputsRoot } from './stage-self-test.mjs';
import {
  compareVersions,
  developmentNode,
  nodeFloors,
} from './supported-versions.mjs';

const inputs = inputsRoot();
const compatibilityPage = 'docs/reference/compatibility.md';

assert.equal(
  process.version,
  'v26.10.0',
  `The exact capability row requires Node v26.10.0; received ${process.version}`,
);

// Spellings a consumer can declare, request or store that are not canonical: casing, including
// the fixture consumers' own locales and route segments; the pinned data's deprecated language,
// territory, script and variant aliases; the legacy tags it maps; and tags one host could accept
// and another refuse. A refusal is an answer too, because a tag one engine refuses and another
// accepts is an identity only one of them has.
const identitySpellings = Object.freeze([
  'EN-us',
  'en-us',
  'ar-eg',
  'en-arab-xb',
  'EN',
  'AR',
  'zh-hant-tw',
  'ZH-HANS-cn',
  'sr-latn-rs',
  'iw',
  'iw-IL',
  'in',
  'ji',
  'jw',
  'mo',
  'mo-MD',
  'sh',
  'sh-BA',
  'tl',
  'tl-PH',
  'bh',
  'tw',
  'cmn',
  'cmn-Hans-CN',
  'no-bokmal',
  'art-lojban',
  'cel-gaulish',
  'zh-guoyu',
  'zh-hakka',
  'zh-xiang',
  'sgn-GR',
  'zh-min-nan',
  'zh-cmn-Hans',
  'i-klingon',
  'en-GB-oed',
  'de-DD',
  'en-UK',
  'my-BU',
  'ru-SU',
  'hy-SU',
  'sr-YU',
  'und-Qaai',
  'hy-arevela',
  'hy-arevmda',
  'ja-Latn-hepburn-heploc',
  'sv-aaland',
  'de-1996-1901',
]);

async function probePlatform() {
  const requiredIntl = {
    locale:
      typeof Intl.Locale === 'function' &&
      new Intl.Locale('ar-EG').baseName === 'ar-EG',
    numberParts:
      typeof Intl.NumberFormat === 'function' &&
      typeof Intl.NumberFormat.prototype.formatToParts === 'function',
    dateTimeParts:
      typeof Intl.DateTimeFormat === 'function' &&
      typeof Intl.DateTimeFormat.prototype.formatToParts === 'function',
    dateTimeRange:
      typeof Intl.DateTimeFormat.prototype.formatRange === 'function' &&
      typeof Intl.DateTimeFormat.prototype.formatRangeToParts === 'function',
    pluralRules:
      typeof Intl.PluralRules === 'function' &&
      typeof Intl.PluralRules.prototype.select === 'function',
    relativeTime: typeof Intl.RelativeTimeFormat === 'function',
    list: typeof Intl.ListFormat === 'function',
    displayNames: typeof Intl.DisplayNames === 'function',
    collator: typeof Intl.Collator === 'function',
    supportedValues:
      typeof Intl.supportedValuesOf === 'function' &&
      Intl.supportedValuesOf('timeZone').length > 0,
  };

  const optionalIntl = {
    durationFormat: typeof Intl.DurationFormat === 'function',
    numberRange:
      typeof Intl.NumberFormat.prototype.formatRange === 'function' &&
      typeof Intl.NumberFormat.prototype.formatRangeToParts === 'function',
    pluralRange: typeof Intl.PluralRules.prototype.selectRange === 'function',
    segmenter: typeof Intl.Segmenter === 'function',
    temporal: typeof globalThis.Temporal === 'object',
  };

  const localeProfiles = Object.fromEntries(
    [
      'ar-EG',
      'en-US',
      'az-Arab',
      'az-Latn',
      'ff-Adlm',
      'ff-Latn',
      'pa-Arab',
      'pa-Guru',
      'sd-Deva',
      'sd-PK',
      'und-Hebr',
      'und-Latn',
    ].map((input) => {
      const locale = new Intl.Locale(input);
      const maximized = locale.maximize();
      return [
        input,
        {
          canonical: locale.toString(),
          language: maximized.language,
          script: maximized.script ?? null,
          region: maximized.region ?? null,
        },
      ];
    }),
  );

  const encoder = new TextEncoder();
  const bytes = encoder.encode('platform-capability-probe');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  let ed25519 = false;

  try {
    const keys = await globalThis.crypto.subtle.generateKey(
      { name: 'Ed25519' },
      false,
      ['sign', 'verify'],
    );
    const signature = await globalThis.crypto.subtle.sign(
      'Ed25519',
      keys.privateKey,
      bytes,
    );
    ed25519 = await globalThis.crypto.subtle.verify(
      'Ed25519',
      keys.publicKey,
      signature,
      bytes,
    );
  } catch {
    ed25519 = false;
  }

  const instant = new Date('2026-01-02T15:04:05.000Z');
  const rangeEnd = new Date('2026-01-04T15:04:05.000Z');

  // Where each engine puts a direction control inside a number.
  //
  // Every such control is data rather than an algorithm. LDML part 3 says number patterns may carry
  // LRM, RLM and ALM, and the release ships them inside the symbols themselves: the Arabic minus
  // sign is U+061C followed by the hyphen, the Latin-digit one is U+200E followed by it, and the
  // Arabic currency pattern opens with U+200F. Equator builds no numeric text of its own and
  // inserts none of these, so a control reaches a page only because an engine emitted it out of
  // whatever release that engine carries.
  //
  // Which is why the row measures it. A server emitting one set and a browser emitting another
  // differ by characters nobody can see, inside a string this project server-renders and the
  // browser then renders again from the same values: the same shape as the locale self-name
  // difference, and invisible to any assertion about the text a reader sees. The positions are
  // recorded beside the strings so that a drift in the controls alone is named as one rather than
  // hidden inside a whole-string comparison.
  const controlsOf = (text) => {
    if (text === null) return null;
    const found = [];
    let index = 0;
    for (const character of text) {
      const point = character.codePointAt(0);
      if (
        point === 0x061c ||
        point === 0x200e ||
        point === 0x200f ||
        (point >= 0x202a && point <= 0x202e) ||
        (point >= 0x2066 && point <= 0x2069)
      ) {
        found.push(`${index}:${point.toString(16)}`);
      }
      index += 1;
    }
    return found.join(' ');
  };

  const formats = Object.fromEntries(
    ['en-US', 'ar-EG'].map((locale) => {
      const currency = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
      }).format(1234.5);
      const number = new Intl.NumberFormat(locale).format(1234.5);
      const numberSigned = new Intl.NumberFormat(locale).format(-1234.5);
      // Null where the engine has no number range at all, which is what the runtime reports rather
      // than composing one, so null here is the same answer read at the same place.
      const numberRange =
        typeof Intl.NumberFormat.prototype.formatRange === 'function'
          ? new Intl.NumberFormat(locale).formatRange(-5, 3)
          : null;
      return [
        locale,
        {
          currency,
          currencyControls: controlsOf(currency),
          date: new Intl.DateTimeFormat(locale, {
            dateStyle: 'full',
            timeZone: 'UTC',
          }).format(instant),
          dateRange: new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeZone: 'UTC',
          }).formatRange(instant, rangeEnd),
          displayLanguage: new Intl.DisplayNames([locale], {
            type: 'language',
          }).of('fr'),
          list: new Intl.ListFormat(locale, {
            style: 'long',
            type: 'conjunction',
          }).format(['alpha', 'bravo', 'charlie']),
          number,
          numberControls: controlsOf(number),
          numberRange,
          numberRangeControls: controlsOf(numberRange),
          numberSigned,
          numberSignedControls: controlsOf(numberSigned),
          plural: new Intl.PluralRules(locale).select(2),
          relativeDay: new Intl.RelativeTimeFormat(locale, {
            numeric: 'always',
          }).format(-1, 'day'),
        },
      ];
    }),
  );

  return {
    crypto: {
      ed25519,
      sha256: digest.byteLength === 32,
    },
    formats,
    localeProfiles,
    optionalIntl,
    requiredIntl,
  };
}

function assertRequiredCapabilities(evidence, runtime) {
  for (const [capability, supported] of Object.entries(evidence.requiredIntl)) {
    assert.equal(
      supported,
      true,
      `${runtime} lacks required Intl capability ${capability}`,
    );
  }

  assert.equal(
    evidence.crypto.sha256,
    true,
    `${runtime} lacks required Web Crypto SHA-256`,
  );
}

// Per input rather than one deep comparison, so the refusal names the spelling and both answers. An
// input the runtime reported nothing for differs from the reference rather than matching it.
function assertSameIdentities(actual, expected, runtime, reference) {
  const differences = Object.keys(expected)
    .filter((input) => actual?.[input] !== expected[input])
    .map(
      (input) =>
        `${input} to ${actual?.[input]}, and ${reference} to ${expected[input]}`,
    );
  assert.deepEqual(
    differences,
    [],
    `${runtime} canonicalizes ${differences.join('; ')}`,
  );
}

const nodeEvidence = await probePlatform();
assertRequiredCapabilities(nodeEvidence, `Node ${process.version}`);
assert.deepEqual(nodeEvidence.localeProfiles, {
  'ar-EG': {
    canonical: 'ar-EG',
    language: 'ar',
    script: 'Arab',
    region: 'EG',
  },
  'en-US': {
    canonical: 'en-US',
    language: 'en',
    script: 'Latn',
    region: 'US',
  },
  'az-Arab': {
    canonical: 'az-Arab',
    language: 'az',
    script: 'Arab',
    region: 'IR',
  },
  'az-Latn': {
    canonical: 'az-Latn',
    language: 'az',
    script: 'Latn',
    region: 'AZ',
  },
  'ff-Adlm': {
    canonical: 'ff-Adlm',
    language: 'ff',
    script: 'Adlm',
    region: 'GN',
  },
  'ff-Latn': {
    canonical: 'ff-Latn',
    language: 'ff',
    script: 'Latn',
    region: 'SN',
  },
  'pa-Arab': {
    canonical: 'pa-Arab',
    language: 'pa',
    script: 'Arab',
    region: 'PK',
  },
  'pa-Guru': {
    canonical: 'pa-Guru',
    language: 'pa',
    script: 'Guru',
    region: 'IN',
  },
  'sd-Deva': {
    canonical: 'sd-Deva',
    language: 'sd',
    script: 'Deva',
    region: 'IN',
  },
  'sd-PK': {
    canonical: 'sd-PK',
    language: 'sd',
    script: 'Arab',
    region: 'PK',
  },
  'und-Hebr': {
    canonical: 'und-Hebr',
    language: 'he',
    script: 'Hebr',
    region: 'IL',
  },
  'und-Latn': {
    canonical: 'und-Latn',
    language: 'en',
    script: 'Latn',
    region: 'US',
  },
});

const hostNode = `Node ${process.version}`;

// Each replacement is the pinned CLDR 48.2 alias data (`supplemental/aliases.json` in `cldr-core`)
// applied under UTS #35: `languageAlias` for iw, in, ji, jw, mo, sh, tl, bh, tw, cmn, no-bokmal, the
// legacy tags and the variant pairs; `territoryAlias` for DD, UK, BU, SU and YU, where a list
// resolves to the language's likely region; `scriptAlias` for Qaai; `variantAlias` for heploc; and
// variants sorted alphabetically, which is where 1996 and 1901 trade places. A refusal is a tag the
// Unicode locale identifier grammar ECMA-402 parses does not admit: an extended language subtag, an
// irregular legacy tag, or a three-letter variant.
const pinnedIdentities = Object.freeze({
  'EN-us': 'en-US',
  'en-us': 'en-US',
  'ar-eg': 'ar-EG',
  'en-arab-xb': 'en-Arab-XB',
  EN: 'en',
  AR: 'ar',
  'zh-hant-tw': 'zh-Hant-TW',
  'ZH-HANS-cn': 'zh-Hans-CN',
  'sr-latn-rs': 'sr-Latn-RS',
  iw: 'he',
  'iw-IL': 'he-IL',
  in: 'id',
  ji: 'yi',
  jw: 'jv',
  mo: 'ro',
  'mo-MD': 'ro-MD',
  sh: 'sr-Latn',
  'sh-BA': 'sr-Latn-BA',
  tl: 'fil',
  'tl-PH': 'fil-PH',
  bh: 'bho',
  tw: 'ak',
  cmn: 'zh',
  'cmn-Hans-CN': 'zh-Hans-CN',
  'no-bokmal': 'nb',
  'art-lojban': 'jbo',
  'cel-gaulish': 'xtg',
  'zh-guoyu': 'zh',
  'zh-hakka': 'hak',
  'zh-xiang': 'hsn',
  'sgn-GR': 'gss',
  'zh-min-nan': 'refused',
  'zh-cmn-Hans': 'refused',
  'i-klingon': 'refused',
  'en-GB-oed': 'refused',
  'de-DD': 'de-DE',
  'en-UK': 'en-GB',
  'my-BU': 'my-MM',
  'ru-SU': 'ru-RU',
  'hy-SU': 'hy-AM',
  'sr-YU': 'sr-RS',
  'und-Qaai': 'und-Zinh',
  'hy-arevela': 'hy',
  'hy-arevmda': 'hyw',
  'ja-Latn-hepburn-heploc': 'ja-Latn-alalc97',
  'sv-aaland': 'sv-AX',
  'de-1996-1901': 'de-1901-1996',
});

// The module the toolkit and the runtime canonicalize through, read from the built package because
// that is what a consumer's build and its browsers run.
const languageTagModule = resolve(inputs, 'dist/toolkit/language-tag.js');
const aliasTableModule = resolve(
  inputs,
  'dist/toolkit/locale-aliases.generated.js',
);
const { canonicalizeLanguageTag } = await import(
  pathToFileURL(languageTagModule).href
);
const canonicalIdentitiesOf = (canonicalize) =>
  Object.fromEntries(
    identitySpellings.map((input) => [input, canonicalize(input) ?? 'refused']),
  );
assertSameIdentities(
  canonicalIdentitiesOf(canonicalizeLanguageTag),
  pinnedIdentities,
  hostNode,
  'the pinned CLDR alias data',
);

// The function the compiler canonicalizes a declared locale through. It also refuses an extension,
// which none of the inputs carries, so a refusal compares as one.
const { canonicalizeLocale } = await import(
  pathToFileURL(resolve(inputs, 'dist/toolkit/locales.js')).href
);
assertSameIdentities(
  canonicalIdentitiesOf((input) => {
    const result = canonicalizeLocale(input);
    return result.ok ? result.value : undefined;
  }),
  pinnedIdentities,
  'The toolkit',
  'the pinned CLDR alias data',
);

// The other Node rows run the same probe and the built module as a child, the way the compatibility
// rows run the suites, so each answers from its own engine rather than from this process's.
const nodeRowVersions = [...new Set([...nodeFloors, developmentNode])]
  .filter((version) => version !== process.versions.node)
  .sort(compareVersions);
const located = [];
const missingRows = [];
for (const version of nodeRowVersions) {
  const { executable, failure } = await locateNode(version, `Node ${version}`);
  if (failure === undefined) located.push({ executable, version });
  else missingRows.push(failure);
}
if (missingRows.length > 0) {
  throw new Error(
    `The platform capability row needs every Node row the suites run on.\n\n${missingRows.join('\n\n')}`,
  );
}
const nodeRowResults = located.map(({ executable, version }) => {
  const label = `Node v${version}`;
  process.stdout.write(`Probing ${label}.\n`);
  const result = spawnSync(executable, ['--input-type=module', '-'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    input: [
      `const probePlatform = ${probePlatform.toString()};`,
      `const { canonicalizeLanguageTag } = await import(${JSON.stringify(pathToFileURL(languageTagModule).href)});`,
      `const spellings = ${JSON.stringify(identitySpellings)};`,
      'const canonicalIdentities = Object.fromEntries(spellings.map((input) => [input, canonicalizeLanguageTag(input) ?? "refused"]));',
      'process.stdout.write(JSON.stringify({ ...(await probePlatform()), canonicalIdentities }));',
      '',
    ].join('\n'),
    maxBuffer: 4_194_304,
    timeout: 120_000,
    windowsHide: true,
  });
  if (
    result.status !== 0 ||
    result.error !== undefined ||
    result.signal !== null
  ) {
    throw new Error(
      `${label} could not run the capability probe: ${describeSpawnFailure(result)}`,
    );
  }
  const evidence = JSON.parse(result.stdout);
  assertRequiredCapabilities(evidence, label);
  assertSameIdentities(
    evidence.canonicalIdentities,
    pinnedIdentities,
    label,
    'the pinned CLDR alias data',
  );
  return { evidence, host: 'Node', label, version };
});

// The page imports the built module from its own origin, so a browser runs the same file Node did.
const servedModules = new Map([
  ['/language-tag.js', languageTagModule],
  ['/locale-aliases.generated.js', aliasTableModule],
]);
const capabilityServer = createServer((request, response) => {
  const module = servedModules.get(request.url ?? '');
  if (module === undefined) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>Equator capability probe</title>');
    return;
  }
  readFile(module).then(
    (source) => {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(source);
    },
    (error) => {
      response.statusCode = 500;
      response.end(String(error));
    },
  );
});

await listenForBrowsers(capabilityServer, '127.0.0.1');

const browserRows = Object.freeze([
  Object.freeze({ id: 'chromium', label: 'Chromium', browserType: chromium }),
  Object.freeze({ id: 'firefox', label: 'Firefox', browserType: firefox }),
  Object.freeze({ id: 'webkit', label: 'WebKit', browserType: webkit }),
]);
const reviewedEnglishDateRangeSpacing = Object.freeze([
  Object.freeze({ format: 'dateRange', locale: 'en-US' }),
]);
const reviewedFormatDifferences = Object.freeze({
  chromium: reviewedEnglishDateRangeSpacing,
  firefox: reviewedEnglishDateRangeSpacing,
  webkit: reviewedEnglishDateRangeSpacing,
});
const browserResults = [];

try {
  const address = capabilityServer.address();
  assert.notEqual(address, null, 'Capability server has no address');
  assert.equal(typeof address, 'object', 'Capability server is not TCP');
  const capabilityOrigin = `http://127.0.0.1:${address.port}`;

  for (const row of browserRows) {
    let browser;

    try {
      browser = await row.browserType.launch({ headless: true });
    } catch (error) {
      throw new Error(
        `${row.label} could not start for the Equator platform capability row. ` +
          `Install the pinned browser engines with "pnpm exec playwright install chromium firefox webkit" and retry. ` +
          `Original error: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    try {
      const version = browser.version();
      const page = await browser.newPage();
      await page.goto(capabilityOrigin);
      const evidence = {
        ...(await page.evaluate(probePlatform)),
        canonicalIdentities: await page.evaluate(async (spellings) => {
          const { canonicalizeLanguageTag } = await import('/language-tag.js');
          return Object.fromEntries(
            spellings.map((input) => [
              input,
              canonicalizeLanguageTag(input) ?? 'refused',
            ]),
          );
        }, identitySpellings),
      };
      assertRequiredCapabilities(evidence, `${row.label} ${version}`);
      assert.deepEqual(
        evidence.localeProfiles,
        nodeEvidence.localeProfiles,
        `${row.label} ${version} likely-script results differ from the Node reference row`,
      );
      assertSameIdentities(
        evidence.canonicalIdentities,
        pinnedIdentities,
        `${row.label} ${version}`,
        'the pinned CLDR alias data',
      );

      const formatDifferences = [];
      const formatDifferenceDetails = [];
      for (const locale of Object.keys(nodeEvidence.formats)) {
        const nodeFormats = nodeEvidence.formats[locale];
        const browserFormats = evidence.formats[locale];

        for (const format of Object.keys(nodeFormats)) {
          if (nodeFormats[format] !== browserFormats[format]) {
            formatDifferences.push({ format, locale });
            formatDifferenceDetails.push({
              browser: browserFormats[format],
              format,
              locale,
              node: nodeFormats[format],
            });
          }
        }
      }

      const reviewedDifferences = reviewedFormatDifferences[row.id];
      if (reviewedDifferences !== undefined) {
        assert.deepEqual(
          formatDifferences,
          reviewedDifferences,
          `${row.label} ${version} native-formatting differences changed; review hydration safety`,
        );
      }

      browserResults.push({
        evidence,
        formatDifferenceDetails,
        formatDifferences,
        formatDifferencesReviewed: reviewedDifferences !== undefined,
        host: row.label,
        id: row.id,
        label: row.label,
        version,
      });
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolveClose, rejectClose) => {
    capabilityServer.close((error) => {
      if (error === undefined) {
        resolveClose();
      } else {
        rejectClose(error);
      }
    });
  });
}

// Every optional capability the probe reads is either one the runtime reports as unsupported, and so
// one the page has to name, or one Equator formats nothing with. A capability added to the probe
// without that decision would otherwise be measured and never held to anything.
assert.deepEqual(
  Object.keys(nodeEvidence.optionalIntl).sort(),
  [...Object.keys(reportedCapabilities), ...unreportedCapabilities].sort(),
  'The probe reads an optional Intl capability tools/host-capability-gaps.mjs neither reports nor sets aside',
);

const measuredGaps = [
  { evidence: nodeEvidence, host: 'Node', version: process.versions.node },
  ...nodeRowResults,
  ...browserResults,
].flatMap(({ evidence, host, version }) =>
  Object.entries(reportedCapabilities)
    .filter(([capability]) => evidence.optionalIntl[capability] !== true)
    .map(([, { native }]) => `${host} ${version} lacks ${native}`),
);

// Read from the page a reader sees rather than from the record it is generated from, so what is held
// to the measurement is what is published. `verify:docs-reference` holds the page to the record.
const pageText = (await readFile(resolve(inputs, compatibilityPage), 'utf8'))
  .replaceAll('\r\n', '\n')
  .split('\n');
const gapHeading = pageText.indexOf('## Formatting a host does not provide');
assert.notEqual(
  gapHeading,
  -1,
  `${compatibilityPage} has no "Formatting a host does not provide" section, so it names no host that lacks a capability`,
);
const gapSectionEnd = pageText.findIndex(
  (line, index) => index > gapHeading && line.startsWith('## '),
);
const documentedGaps = pageText
  .slice(gapHeading + 1, gapSectionEnd === -1 ? undefined : gapSectionEnd)
  .filter((line) => line.startsWith('|'))
  .slice(2)
  .map((line) => {
    const [host, native] = line
      .split('|')
      .slice(1, 3)
      .map((cell) => cell.replaceAll('`', '').trim());
    return `${host} lacks ${native}`;
  });

const undocumentedGaps = measuredGaps.filter(
  (gap) => !documentedGaps.includes(gap),
);
assert.deepEqual(
  undocumentedGaps,
  [],
  `${undocumentedGaps.join('; ')}, and ${compatibilityPage} does not say so`,
);
const contradictedGaps = documentedGaps.filter(
  (gap) => !measuredGaps.includes(gap),
);
assert.deepEqual(
  contradictedGaps,
  [],
  `${compatibilityPage} says ${contradictedGaps.join('; ')}, and the probe did not find that on any host it ran`,
);

// The row above proves agreement; this says what was agreed. A record that reports only "no
// differences" cannot be read later to find out what the engines actually emitted, and the
// positions are the whole content of the numeric direction-control measurement.
const numericControlEvidence = Object.entries(nodeEvidence.formats).map(
  ([locale, values]) =>
    `${locale}: number=[${values.numberControls}] signed=[${values.numberSignedControls}] ` +
    `range=[${values.numberRangeControls}] currency=[${values.currencyControls}]`,
);

process.stdout.write(
  [
    `Equator platform capability rows verified against Node ${process.version}.`,
    `Numeric direction controls, agreed by every row above, as code-point index and value: ${numericControlEvidence.join('; ')}.`,
    `Canonical identities of ${identitySpellings.length} spellings agreed by the toolkit, ${nodeRowResults.map(({ label }) => label).join(', ')} and every browser row with the pinned alias data.`,
    `Hosts lacking a reported capability, each named in ${compatibilityPage}: ${measuredGaps.length === 0 ? 'none' : measuredGaps.join('; ')}.`,
    ...nodeRowResults.map(
      ({ evidence, label }) =>
        `${label}: conditional Intl=${JSON.stringify(evidence.optionalIntl)}.`,
    ),
    ...browserResults.flatMap((result) => [
      `${result.label} ${result.version}: native formatting differences=${JSON.stringify(result.formatDifferences)}${result.formatDifferencesReviewed ? ' (reviewed)' : ' (uncharacterized; record after review)'}.`,
      `${result.label} ${result.version}: native formatting difference details=${JSON.stringify(result.formatDifferenceDetails)}.`,
      `${result.label} ${result.version}: conditional Intl=${JSON.stringify(result.evidence.optionalIntl)}.`,
      `${result.label} ${result.version}: conditional Ed25519 node=${nodeEvidence.crypto.ed25519}, browser=${result.evidence.crypto.ed25519}.`,
    ]),
  ].join('\n') + '\n',
);
