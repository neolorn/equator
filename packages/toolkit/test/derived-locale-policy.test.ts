import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { diagnosticsBlock } from '../src/diagnostics.js';
import { generateProject } from '../src/index.js';

/**
 * What the build reads of a locale URL policy, by how the policy is written.
 *
 * EQ1408 compares the policy's locales with the configuration's, and EQ1409 compares the segments
 * the policy claims with each route's leading segment. Both read the argument of the policy factory
 * as source text: `specs/10-compiler-and-tooling.spec.md` section 5 forbids calling a function or
 * evaluating an expression, so a value the application computes is not available to them.
 *
 * One application, wrong in six ways at once, written every way a policy can be spelled. The literal
 * spelling is the control: it reports all six, so a form that reports fewer is a form the analysis
 * does not read, and not an application that happens to be right.
 *
 * The configuration has `en-US`, `ar-EG` and `fr-FR`, with `en-US` the default. The policy addresses
 * `en-US`, `ar-EG` and `de-DE`, makes `ar-EG` the default, and claims the prefix `ar-eg`, the alias
 * `ara` and the locale-neutral root `assets`, each of which a route also begins with.
 */

const temporaryRoots: string[] = [];

async function write(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}

const manifest = (name: string): string =>
  `${JSON.stringify({ name, version: '0.0.0', types: './index.d.ts' }, null, 2)}\n`;

const CONFIGURED = ['en-US', 'ar-EG', 'fr-FR'];

/** The route each claimed segment collides with, keyed by the address the diagnostic quotes. */
const COLLIDING_ROUTES = new Map([
  ['"/ar-eg/tools"', 'prefix'],
  ['"/ara/help"', 'alias'],
  ['"/assets/logo"', 'neutral root'],
]);

const TABLE = "{ 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'de-DE': 'de' }";
const ALIASES = "{ ara: 'ar-EG' }";
const ROOTS = "['assets']";
const LITERAL_OPTIONS = [
  '{',
  "  defaultLocale: 'ar-EG',",
  `  locales: ${TABLE},`,
  `  aliases: ${ALIASES},`,
  `  localeNeutralRoots: ${ROOTS},`,
  '}',
].join('\n');

async function project(policySource: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'derived-policy-'));
  temporaryRoots.push(root);

  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: 'derived-policy',
        private: true,
        type: 'module',
        imports: {
          '#i18n': './src/generated/i18n/index.ts',
          '#i18n/*': './src/generated/i18n/*.ts',
        },
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'equator.config.json',
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: CONFIGURED,
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'tsconfig.app.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'preserve',
          moduleResolution: 'bundler',
          resolvePackageJsonImports: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  for (const locale of CONFIGURED) {
    await write(
      root,
      `i18n/shell/${locale}.yaml`,
      ['messages:', '  app-title: Derived policy probe', ''].join('\n'),
    );
  }
  await write(
    root,
    'node_modules/@angular/router/index.d.ts',
    [
      'export declare interface Route {',
      '  path?: string;',
      '  component?: unknown;',
      '}',
      'export type Routes = readonly Route[];',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'node_modules/@angular/router/package.json',
    manifest('@angular/router'),
  );
  await write(
    root,
    'node_modules/@neolorn/equator/index.d.ts',
    [
      'export declare function createPathPrefixLocalePolicy(options: unknown): unknown;',
      'export declare function createLocaleNeutralPolicy(options: unknown): unknown;',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'node_modules/@neolorn/equator/package.json',
    manifest('@neolorn/equator'),
  );
  await write(
    root,
    'src/app.routes.ts',
    [
      "import type { Routes } from '@angular/router';",
      '',
      'export class Page {}',
      '',
      'export const routes: Routes = [',
      "  { path: 'dashboard', component: Page },",
      "  { path: 'ar-eg/tools', component: Page },",
      "  { path: 'ara/help', component: Page },",
      "  { path: 'assets/logo', component: Page },",
      '];',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'src/app.ts',
    [
      "import { messages } from '#i18n/shell';",
      "import { createLocaleNeutralPolicy, createPathPrefixLocalePolicy } from '@neolorn/equator';",
      '',
      'export const title = messages.appTitle.messageId;',
      '',
      policySource,
      '',
    ].join('\n'),
  );
  return root;
}

interface Reading {
  /** Configured locales reported as having no address. */
  readonly noAddress: readonly string[];
  /** Policy locales reported as having no catalogs. */
  readonly noCatalogs: readonly string[];
  /** Whether the two default locales were reported as different. */
  readonly defaultLocale: boolean;
  /** Which of the three claimed segments a route was reported as colliding with. */
  readonly claimed: readonly string[];
  /** The options the advisory names as not read, in the order it names them. */
  readonly unread: readonly string[];
}

const quoted = (text: string): string[] =>
  [...text.matchAll(/"([^"]+)"/gu)].map((match) => match[1] ?? '').sort();

async function reading(policySource: string): Promise<Reading> {
  const generated = await generateProject({
    project: await project(policySource),
  });
  const summaries = (wanted: string): string[] =>
    generated.diagnostics
      .filter(({ code }) => code === wanted)
      .map(({ summary }) => summary);
  const agreement = summaries('EQ1408');
  const listed = (marker: string): string[] =>
    agreement
      .filter((summary) => summary.includes(marker))
      .flatMap((summary) => quoted(summary.split(marker)[0] ?? ''));
  return {
    noAddress: [
      ...listed(' is a configured locale'),
      ...listed(' are configured locales'),
    ],
    noCatalogs: [...listed(' has an address'), ...listed(' have addresses')],
    // The whole clause, because the no-catalogs summary also says "the default locale".
    defaultLocale: agreement.some((summary) =>
      summary.includes(' the default locale and its locale URL policy makes '),
    ),
    claimed: summaries('EQ1409')
      .flatMap((summary) =>
        [...COLLIDING_ROUTES].filter(([address]) => summary.includes(address)),
      )
      .map(([, kind]) => kind)
      .sort(),
    unread: generated.diagnostics
      .filter(({ code }) => code === 'EQ1417')
      .flatMap(({ summary }) =>
        [
          ...(summary.split(' from something')[0] ?? '').matchAll(
            /`([^`]+)`/gu,
          ),
        ].map((match) => match[1] ?? ''),
      ),
  };
}

const EVERYTHING: Reading = {
  noAddress: ['fr-FR'],
  noCatalogs: ['de-DE'],
  defaultLocale: true,
  claimed: ['alias', 'neutral root', 'prefix'],
  unread: [],
};

const EVERY_OPTION = [
  'locales',
  'defaultLocale',
  'aliases',
  'localeNeutralRoots',
];

const NOTHING: Reading = {
  noAddress: [],
  noCatalogs: [],
  defaultLocale: false,
  claimed: [],
  unread: EVERY_OPTION,
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('a policy written as literals is read whole', () => {
  it('reports all six disagreements when the options are written at the call', async () => {
    expect(
      await reading(
        `export const routePolicy = createPathPrefixLocalePolicy(${LITERAL_OPTIONS});`,
      ),
    ).toEqual(EVERYTHING);
  });

  it('reads the call wherever it is written, including inside a function the application calls', async () => {
    // The call is what is recognized, not the binding it is assigned to, so a helper that wraps
    // the factory around literal options hides nothing.
    expect(
      await reading(
        [
          'function buildPolicy(): unknown {',
          `  return createPathPrefixLocalePolicy(${LITERAL_OPTIONS});`,
          '}',
          'export const routePolicy = buildPolicy();',
        ].join('\n'),
      ),
    ).toEqual(EVERYTHING);
  });

  it('reads through an assertion on a table', async () => {
    expect(
      await reading(
        [
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          `  locales: ${TABLE} as const,`,
          `  aliases: (${ALIASES} satisfies Record<string, string>),`,
          `  localeNeutralRoots: ${ROOTS} as const,`,
          '});',
        ].join('\n'),
      ),
    ).toEqual(EVERYTHING);
  });
});

describe('options the call does not spell out are not read at all', () => {
  it.each([
    [
      'options held in a constant',
      [
        `const options = ${LITERAL_OPTIONS};`,
        'export const routePolicy = createPathPrefixLocalePolicy(options);',
      ],
    ],
    [
      'options returned by a function',
      [
        'function policyOptions() {',
        `  return ${LITERAL_OPTIONS};`,
        '}',
        'export const routePolicy = createPathPrefixLocalePolicy(policyOptions());',
      ],
    ],
    [
      'options spread from a constant',
      [
        `const options = ${LITERAL_OPTIONS};`,
        'export const routePolicy = createPathPrefixLocalePolicy({ ...options });',
      ],
    ],
    [
      'an assertion on the whole argument',
      [
        `export const routePolicy = createPathPrefixLocalePolicy(${LITERAL_OPTIONS} as const);`,
      ],
    ],
  ])('%s', async (_form, source) => {
    expect(await reading(source.join('\n'))).toEqual(NOTHING);
  });
});

describe('one option the call does not spell out is the part that goes unread', () => {
  it('a locale table held in a constant silences the whole locale comparison and the prefixes', async () => {
    // With no locale read there is nothing to compare, and the default locale is compared only
    // where a locale was read, so all three halves of EQ1408 go together.
    const expected: Reading = {
      ...NOTHING,
      claimed: ['alias', 'neutral root'],
      unread: ['locales'],
    };
    expect(
      await reading(
        [
          `const LOCALES = ${TABLE};`,
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          '  locales: LOCALES,',
          `  aliases: ${ALIASES},`,
          `  localeNeutralRoots: ${ROOTS},`,
          '});',
        ].join('\n'),
      ),
    ).toEqual(expected);
    expect(
      await reading(
        [
          `const locales = ${TABLE};`,
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          '  locales,',
          `  aliases: ${ALIASES},`,
          `  localeNeutralRoots: ${ROOTS},`,
          '});',
        ].join('\n'),
      ),
    ).toEqual(expected);
  });

  it('a prefix held in a constant keeps its locale and loses its claim', async () => {
    expect(
      await reading(
        [
          "const ARABIC_PREFIX = 'ar-eg';",
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          "  locales: { 'en-US': 'en-us', 'ar-EG': ARABIC_PREFIX, 'de-DE': 'de' },",
          `  aliases: ${ALIASES},`,
          `  localeNeutralRoots: ${ROOTS},`,
          '});',
        ].join('\n'),
      ),
    ).toEqual({
      ...EVERYTHING,
      claimed: ['alias', 'neutral root'],
      unread: ['locales'],
    });
  });

  it('a default locale held in a constant is not compared', async () => {
    expect(
      await reading(
        [
          "const DEFAULT_LOCALE = 'ar-EG';",
          'export const routePolicy = createPathPrefixLocalePolicy({',
          '  defaultLocale: DEFAULT_LOCALE,',
          `  locales: ${TABLE},`,
          `  aliases: ${ALIASES},`,
          `  localeNeutralRoots: ${ROOTS},`,
          '});',
        ].join('\n'),
      ),
    ).toEqual({
      ...EVERYTHING,
      defaultLocale: false,
      unread: ['defaultLocale'],
    });
  });

  it('aliases and locale-neutral roots held in constants claim nothing', async () => {
    expect(
      await reading(
        [
          `const ALIASES = ${ALIASES};`,
          `const ROOTS = ${ROOTS};`,
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          `  locales: ${TABLE},`,
          '  aliases: ALIASES,',
          '  localeNeutralRoots: [...ROOTS],',
          '});',
        ].join('\n'),
      ),
    ).toEqual({
      ...EVERYTHING,
      claimed: ['prefix'],
      unread: ['aliases', 'localeNeutralRoots'],
    });
  });

  it('options spread in beside a literal table leave the table read and the rest unread', async () => {
    expect(
      await reading(
        [
          'const REST = {',
          "  defaultLocale: 'ar-EG',",
          `  aliases: ${ALIASES},`,
          `  localeNeutralRoots: ${ROOTS},`,
          '};',
          'export const routePolicy = createPathPrefixLocalePolicy({',
          '  ...REST,',
          `  locales: ${TABLE},`,
          '});',
        ].join('\n'),
      ),
    ).toEqual({
      ...EVERYTHING,
      defaultLocale: false,
      claimed: ['prefix'],
      unread: ['defaultLocale', 'aliases', 'localeNeutralRoots'],
    });
  });
});

/**
 * A spread written after an option can replace it, because the later one wins in JavaScript.
 *
 * What the spread holds is not evaluated, so every option written before it is one the running
 * application may not be using, and reading it would compare a policy the application does not
 * have. An option written after the spread is the one that stands, and stays read.
 */
describe('an option a later spread can replace is not read', () => {
  it('reads nothing when the spread follows every option', async () => {
    // The spread makes this application agree with its configuration, so anything reported here
    // is reported against a correct application.
    expect(
      await reading(
        [
          'const OVERRIDES = {',
          "  defaultLocale: 'en-US',",
          "  locales: { 'en-US': 'en-us', 'ar-EG': 'ar', 'fr-FR': 'fr' },",
          '  aliases: {},',
          '  localeNeutralRoots: [],',
          '};',
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          `  locales: ${TABLE},`,
          `  aliases: ${ALIASES},`,
          `  localeNeutralRoots: ${ROOTS},`,
          '  ...OVERRIDES,',
          '});',
        ].join('\n'),
      ),
    ).toEqual(NOTHING);
  });

  it('reads the options after the spread and not the ones before it', async () => {
    expect(
      await reading(
        [
          'const MIDDLE = {};',
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          `  aliases: ${ALIASES},`,
          '  ...MIDDLE,',
          `  locales: ${TABLE},`,
          `  localeNeutralRoots: ${ROOTS},`,
          '});',
        ].join('\n'),
      ),
    ).toEqual({
      ...EVERYTHING,
      defaultLocale: false,
      claimed: ['neutral root', 'prefix'],
      unread: ['defaultLocale', 'aliases'],
    });
  });
});

/**
 * A table that is part literal is not read, the same as one held in a constant.
 *
 * Reading only the entries that are spelled out would report the others as configured locales with
 * no address, which blocks an application whose policy addresses every one of them. So each
 * application below is one the build has to stay silent about on the locale comparison.
 */
describe('a locale table written partly as literals is not read', () => {
  const UNREAD_TABLE: Reading = {
    ...NOTHING,
    claimed: ['alias', 'neutral root'],
    unread: ['locales'],
  };

  it('a table with entries spread into it', async () => {
    expect(
      await reading(
        [
          "const BASE = { 'en-US': 'en-us', 'ar-EG': 'ar-eg' };",
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          "  locales: { ...BASE, 'de-DE': 'de' },",
          `  aliases: ${ALIASES},`,
          `  localeNeutralRoots: ${ROOTS},`,
          '});',
        ].join('\n'),
      ),
    ).toEqual(UNREAD_TABLE);
  });

  it('a table with an entry under a computed key', async () => {
    expect(
      await reading(
        [
          "const ARABIC = 'ar-EG';",
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          "  locales: { 'en-US': 'en-us', [ARABIC]: 'ar-eg', 'de-DE': 'de' },",
          `  aliases: ${ALIASES},`,
          `  localeNeutralRoots: ${ROOTS},`,
          '});',
        ].join('\n'),
      ),
    ).toEqual(UNREAD_TABLE);
  });

  it('a table with a shorthand entry', async () => {
    expect(
      await reading(
        [
          "const en = 'en-us';",
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          "  locales: { en, 'ar-EG': 'ar-eg', 'de-DE': 'de' },",
          `  aliases: ${ALIASES},`,
          `  localeNeutralRoots: ${ROOTS},`,
          '});',
        ].join('\n'),
      ),
    ).toEqual(UNREAD_TABLE);
  });

  it('a locale list with elements spread into it, under the policy that lists its locales', async () => {
    // The control first: the list written whole is read, so the silence below is about the
    // spread and not about this factory going unrecognized.
    expect(
      await reading(
        [
          'export const routePolicy = createLocaleNeutralPolicy({',
          "  defaultLocale: 'en-US',",
          "  locales: ['en-US', 'ar-EG'],",
          '});',
        ].join('\n'),
      ),
    ).toEqual({ ...NOTHING, noAddress: ['fr-FR'], unread: [] });
    expect(
      await reading(
        [
          "const BASE = ['en-US', 'ar-EG'];",
          'export const routePolicy = createLocaleNeutralPolicy({',
          "  defaultLocale: 'en-US',",
          "  locales: [...BASE, 'fr-FR'],",
          '});',
        ].join('\n'),
      ),
    ).toEqual({ ...NOTHING, unread: ['locales'] });
  });
});

describe('a policy the build did not read whole is said to be unchecked', () => {
  it('advises without blocking, at the file the policy is written in', async () => {
    const generated = await generateProject({
      project: await project(
        [
          `const LOCALES = ${TABLE};`,
          'export const routePolicy = createPathPrefixLocalePolicy({',
          "  defaultLocale: 'ar-EG',",
          '  locales: LOCALES,',
          '});',
        ].join('\n'),
      ),
    });
    const advisories = generated.diagnostics.filter(
      ({ code }) => code === 'EQ1417',
    );
    expect(advisories).toHaveLength(1);
    expect(advisories[0]?.severity).toBe('info');
    expect(advisories[0]?.summary).toContain('EQ1408');
    expect(advisories[0]?.summary).toContain('EQ1409');
    expect(JSON.stringify(advisories[0])).toContain('src/app.ts');
    expect(diagnosticsBlock(advisories)).toBe(false);
  });

  it('says nothing about a policy written as literals', async () => {
    const generated = await generateProject({
      project: await project(
        `export const routePolicy = createPathPrefixLocalePolicy(${LITERAL_OPTIONS});`,
      ),
    });
    expect(
      generated.diagnostics.filter(({ code }) => code === 'EQ1417'),
    ).toEqual([]);
  });
});
