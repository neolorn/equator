import { describe, expect, it } from 'vitest';

import {
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  LocalizationError,
  localizedServerRoutes,
  type GeneratedConfiguration,
  type LocaleUrlPolicy,
  type LocalizedServerRoutesOptions,
  type PrerenderParameterValues,
  type RouteParameterCodec,
  type RouteParameterContext,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The entries `localizedServerRoutes` writes for a build, one declaration at a time.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 9. An entry is an address the build renders,
 * so the table holds each address once, carries values to enumerate only where the declaration gave
 * some, and refuses an address the resolver would read as something other than the route.
 */

const IDENTITY = 'sha256-ServerRouteTableEntriesTestIdentity01234567';

/** One entity with a spelling of its own in Arabic, read back from either. */
const SLUG: RouteParameterCodec<string> = {
  parse: (slug: string) =>
    slug === 'handbook' || slug === 'دليل'
      ? { ok: true, value: 'handbook' }
      : { ok: false },
  serialize: (entity: string, context?: RouteParameterContext) =>
    entity !== 'handbook'
      ? undefined
      : context?.locale === 'ar-EG'
        ? 'دليل'
        : 'handbook',
};

/** Reads any segment as itself, so a case chooses the values and nothing else. */
const TEXT: RouteParameterCodec<string> = {
  parse: (value: string) => ({ ok: true, value }),
  serialize: (value: string) => value,
};

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: IDENTITY,
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
      {
        id: 'comparison',
        path: 'compare/:left/:right',
        parameterNames: ['left', 'right'],
      },
      { id: 'user', path: 'uid/:id', parameterNames: ['id'] },
    ],
  },
  localizedPaths: {
    second: { 'ar-EG': 'الثاني' },
    article: { 'ar-EG': 'مقالات/:slug' },
  },
  parameters: {
    article: { slug: SLUG },
    comparison: { left: TEXT, right: TEXT },
    user: { id: TEXT },
  },
};

function configurationFor(
  locales: readonly string[],
  pseudoLocales?: readonly string[],
): GeneratedConfiguration {
  return {
    generatedAbi: 'equator-generated/1',
    sourceLocale: 'en-US',
    defaultLocale: 'en-US',
    locales,
    aliases: {},
    ...(pseudoLocales === undefined ? {} : { pseudoLocales }),
    applicationContractFingerprint: 'sha256-application-contract-fixture',
    semanticRegistryFingerprint: 'sha256-semantic-registry-fixture',
    scopes: [],
  };
}

const BOTH = configurationFor(['en-US', 'ar-EG']);

const PREFIXED = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const UNPREFIXED_DEFAULT = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  omitDefaultPrefix: true,
});

const NEUTRAL = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});

interface Declared {
  readonly routeId: string;
  readonly prerender?: PrerenderParameterValues;
}

const SERVER: LocalizedServerRoutesOptions<string> = {
  canonicalRenderMode: 'server',
};

function tableFor(
  policy: LocaleUrlPolicy,
  declared: readonly Declared[],
  options: LocalizedServerRoutesOptions<string> = SERVER,
  projection: RouteRuntimeProjection = PROJECTION,
  configuration: GeneratedConfiguration = BOTH,
) {
  return localizedServerRoutes(
    policy,
    projection,
    configuration,
    declared.map((declaration) => ({
      ...declaration,
      renderMode: 'prerender',
    })),
    options,
  );
}

/** The table with the values each entry enumerates asked for, as a build asks. */
async function expanded(entries: ReturnType<typeof tableFor>) {
  return Promise.all(
    entries.map(async (entry) => ({
      path: entry.path,
      renderMode: entry.renderMode,
      ...(entry.getPrerenderParams === undefined
        ? {}
        : { prerendered: await entry.getPrerenderParams() }),
    })),
  );
}

/** The diagnostic code a call refuses with, or `undefined` when it did not refuse. */
const codeOf = (call: () => unknown): string | undefined => {
  try {
    call();
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic.code;
    throw error;
  }
};

describe('a route declared more than once', () => {
  it('has one entry per address under a prefix, and one canonical entry', () => {
    const entries = tableFor(PREFIXED, [
      { routeId: 'second' },
      { routeId: 'second' },
    ]);
    expect(entries.map((entry) => entry.path)).toEqual([
      'en-us/second',
      'ar-eg/الثاني',
      'second',
    ]);
  });

  it('has one entry per spelling under a locale-neutral policy', () => {
    const entries = tableFor(NEUTRAL, [
      { routeId: 'second' },
      { routeId: 'second' },
    ]);
    expect(entries.map((entry) => entry.path)).toEqual(['second', 'الثاني']);
  });
});

describe('a declaration with no values to enumerate', () => {
  it('writes entries that ask for none under a prefix', () => {
    // Whether a parameterised route needs enumerating is its render mode's question, and the
    // build's own error where it does. An entry that offered an enumeration here would answer it.
    expect(tableFor(PREFIXED, [{ routeId: 'article' }])).toStrictEqual([
      { path: 'en-us/articles/:slug', renderMode: 'prerender' },
      { path: 'ar-eg/مقالات/:slug', renderMode: 'prerender' },
      { path: 'articles/:slug', renderMode: 'server' },
    ]);
  });

  it('writes entries that ask for none under a locale-neutral policy', () => {
    expect(tableFor(NEUTRAL, [{ routeId: 'article' }])).toStrictEqual([
      { path: 'articles/:slug', renderMode: 'prerender' },
      { path: 'مقالات/:slug', renderMode: 'prerender' },
    ]);
  });
});

describe('values declared for a route that takes none', () => {
  it('are refused, because there is nothing for them to fill', () => {
    for (const policy of [PREFIXED, NEUTRAL]) {
      expect(
        codeOf(() =>
          tableFor(policy, [{ routeId: 'second', prerender: [{ slug: 'x' }] }]),
        ),
      ).toBe('invalid-configuration');
      expect(
        codeOf(() => tableFor(policy, [{ routeId: 'second', prerender: [] }])),
      ).toBe('invalid-configuration');
    }
  });
});

describe('a locale the policy names and the build did not generate', () => {
  it('has no entry at a spelling of its own under a locale-neutral policy', () => {
    expect(
      tableFor(
        NEUTRAL,
        [{ routeId: 'second' }],
        SERVER,
        PROJECTION,
        configurationFor(['en-US']),
      ),
    ).toStrictEqual([{ path: 'second', renderMode: 'prerender' }]);
  });
});

describe('the canonical layer and the fallback', () => {
  it('asks for no canonical mode where every canonical address is already a locale address', () => {
    // With the default prefix omitted the path the Router matches is the default locale's own
    // address, so there is no second layer to choose a mode for.
    const entries = tableFor(UNPREFIXED_DEFAULT, [{ routeId: 'home' }], {});
    expect(entries).toStrictEqual([
      { path: '', renderMode: 'prerender' },
      { path: 'ar-eg', renderMode: 'prerender' },
    ]);
  });

  it('refuses a canonical address no visitor reaches without a mode to render it in', () => {
    expect(codeOf(() => tableFor(PREFIXED, [{ routeId: 'second' }], {}))).toBe(
      'invalid-configuration',
    );
  });

  it('ends the table with the fallback where one is given', () => {
    const entries = tableFor(PREFIXED, [{ routeId: 'second' }], {
      canonicalRenderMode: 'server',
      fallback: 'client',
    });
    expect(entries.at(-1)).toStrictEqual({ path: '**', renderMode: 'client' });
    expect(entries).toHaveLength(4);
  });
});

describe('a spelling whose first segment the policy has claimed', () => {
  const guide = (
    localized: Readonly<Record<string, string>>,
  ): RouteRuntimeProjection => ({
    generated: {
      profile: 'equator-route-projection/1',
      identity: IDENTITY,
      routes: [{ id: 'guide', path: 'guide', parameterNames: [] }],
    },
    localizedPaths: { guide: localized },
  });

  it('is refused where the locale is written without a prefix', () => {
    // The default locale's page would be scheduled at `/ar-eg/guide`, which the resolver reads as
    // the Arabic prefix followed by a route.
    expect(
      codeOf(() =>
        tableFor(
          UNPREFIXED_DEFAULT,
          [{ routeId: 'guide' }],
          SERVER,
          guide({ 'en-US': 'ar-eg/guide' }),
        ),
      ),
    ).toBe('invalid-configuration');
    expect(
      codeOf(() =>
        tableFor(
          UNPREFIXED_DEFAULT,
          [{ routeId: 'guide' }],
          SERVER,
          guide({ 'en-US': 'ar-eg' }),
        ),
      ),
    ).toBe('invalid-configuration');
  });

  it('is an ordinary segment behind a prefix, which the resolver removes first', () => {
    const entries = tableFor(
      PREFIXED,
      [{ routeId: 'guide' }],
      SERVER,
      guide({ 'ar-EG': 'en-us/guide' }),
    );
    expect(entries.map((entry) => entry.path)).toEqual([
      'en-us/guide',
      'ar-eg/en-us/guide',
      'guide',
    ]);
  });

  it('is refused under a locale-neutral policy, where nothing stands in front of it', () => {
    const rooted = createLocaleNeutralPolicy({
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
      localeNeutralRoots: ['help'],
    });
    expect(
      codeOf(() =>
        tableFor(
          rooted,
          [{ routeId: 'guide' }],
          SERVER,
          guide({ 'ar-EG': 'help/guide' }),
        ),
      ),
    ).toBe('invalid-configuration');
    expect(
      codeOf(() =>
        tableFor(
          rooted,
          [{ routeId: 'guide' }],
          SERVER,
          guide({ 'ar-EG': 'help' }),
        ),
      ),
    ).toBe('invalid-configuration');
    // The control: the same table with a spelling the policy has not claimed.
    expect(
      codeOf(() =>
        tableFor(
          rooted,
          [{ routeId: 'guide' }],
          SERVER,
          guide({ 'ar-EG': 'helpful' }),
        ),
      ),
    ).toBeUndefined();
  });
});

describe('the values a locale-neutral entry enumerates', () => {
  it('spells a path one locale has of its own in that locale alone', async () => {
    expect(
      await expanded(
        tableFor(NEUTRAL, [
          { routeId: 'article', prerender: [{ slug: 'handbook' }] },
        ]),
      ),
    ).toStrictEqual([
      {
        path: 'articles/:slug',
        renderMode: 'prerender',
        prerendered: [{ slug: 'handbook' }],
      },
      {
        path: 'مقالات/:slug',
        renderMode: 'prerender',
        prerendered: [{ slug: 'دليل' }],
      },
    ]);
  });

  it('keeps two pages whose values differ only in where one ends and the next begins', async () => {
    const [entry] = await expanded(
      tableFor(NEUTRAL, [
        {
          routeId: 'comparison',
          prerender: [
            { left: 'a', right: 'bc' },
            { left: 'ab', right: 'c' },
          ],
        },
      ]),
    );
    expect(entry?.prerendered).toStrictEqual([
      { left: 'a', right: 'bc' },
      { left: 'ab', right: 'c' },
    ]);
  });

  it('enumerates an address once where both locales spell it, or a value is written twice', async () => {
    // Both locales spell this route's path alike and write these values alike, so each value is
    // one address whichever locale it is serialized for.
    const [entry] = await expanded(
      tableFor(NEUTRAL, [
        {
          routeId: 'comparison',
          prerender: [
            { left: 'a', right: 'b' },
            { left: 'c', right: 'd' },
            { left: 'a', right: 'b' },
          ],
        },
      ]),
    );
    expect(entry?.prerendered).toStrictEqual([
      { left: 'a', right: 'b' },
      { left: 'c', right: 'd' },
    ]);
  });
});

/**
 * An address a translation shares with generated pseudo-locales alone is rendered on request, so
 * the build without them prerenders it from the same table.
 */
describe('an address shared with generated pseudo-locales', () => {
  const declared = (locales: readonly string[]) =>
    createLocaleNeutralPolicy({ defaultLocale: 'en-US', locales });

  it('is rendered on request where one translation shares it with several of them', () => {
    const locales = ['en-US', 'en-Arab-XB', 'en-Latn-XA'];
    expect(
      tableFor(
        declared(locales),
        [{ routeId: 'second' }],
        SERVER,
        PROJECTION,
        configurationFor(locales, ['en-Arab-XB', 'en-Latn-XA']),
      ),
    ).toStrictEqual([{ path: 'second', renderMode: 'server' }]);
  });

  it('keeps its declared mode where two translations share it as well', () => {
    const locales = ['en-US', 'de-DE', 'en-Arab-XB'];
    expect(
      tableFor(
        declared(locales),
        [{ routeId: 'second' }],
        SERVER,
        PROJECTION,
        configurationFor(locales, ['en-Arab-XB']),
      ),
    ).toStrictEqual([{ path: 'second', renderMode: 'prerender' }]);
  });

  it('is rendered on request at the root address too', () => {
    const locales = ['en-US', 'en-Arab-XB'];
    const configuration = configurationFor(locales, ['en-Arab-XB']);
    expect(
      tableFor(
        declared(locales),
        [{ routeId: 'home' }],
        SERVER,
        PROJECTION,
        configuration,
      ),
    ).toStrictEqual([{ path: '', renderMode: 'server' }]);
    expect(
      codeOf(() =>
        tableFor(
          declared(locales),
          [{ routeId: 'home' }],
          {},
          PROJECTION,
          configuration,
        ),
      ),
    ).toBe('invalid-configuration');
  });

  it('leaves a value out of the enumeration where its address is one of them', async () => {
    const locales = ['en-US', 'en-Arab-XB'];
    const [entry] = await expanded(
      tableFor(
        declared(locales),
        [{ routeId: 'user', prerender: [{ id: '7' }] }],
        SERVER,
        PROJECTION,
        configurationFor(locales, ['en-Arab-XB']),
      ),
    );
    expect(entry).toStrictEqual({
      path: 'uid/:id',
      renderMode: 'prerender',
      prerendered: [],
    });
  });
});

describe('a codec the projection no longer holds when the values are asked for', () => {
  // The table is built once and its values are asked for later, by the build. A projection that
  // lost a codec in between is a configuration mistake, and it is reported as one.
  const refusal = async (lost: 'route' | 'projection'): Promise<unknown> => {
    const projection: {
      -readonly [
        Key in keyof RouteRuntimeProjection
      ]: RouteRuntimeProjection[Key];
    } = {
      generated: {
        profile: 'equator-route-projection/1',
        identity: IDENTITY,
        routes: [
          { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
        ],
      },
      parameters: { article: { slug: SLUG } },
    };
    const [entry] = tableFor(
      PREFIXED,
      [{ routeId: 'article', prerender: [{ slug: 'handbook' }] }],
      SERVER,
      projection,
    );
    if (lost === 'route') projection.parameters = {};
    else delete projection.parameters;
    return entry?.getPrerenderParams?.().then(
      () => undefined,
      (error: unknown) => error,
    );
  };

  it('refuses where the route has no codecs left', async () => {
    const error = await refusal('route');
    expect(error).toBeInstanceOf(LocalizationError);
    // Named as the codec that is missing, and not as one that threw when it was asked.
    expect((error as LocalizationError).diagnostic).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: 'Route article has no codec for parameter slug.',
    });
  });

  it('refuses where the projection has no codecs left', async () => {
    const error = await refusal('projection');
    expect(error).toBeInstanceOf(LocalizationError);
    expect((error as LocalizationError).diagnostic.code).toBe(
      'invalid-configuration',
    );
  });
});
