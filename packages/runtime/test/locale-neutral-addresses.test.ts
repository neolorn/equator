import { describe, expect, it } from 'vitest';

import { createLocaleRequestHandler } from '../http/src/handler.js';
import { createLocalizationRuntime } from '../src/localization.js';
import {
  createLocaleNeutralPolicy,
  defineRouteProjection,
  localeFromRoute,
  localizedServerRoutes,
  resolveLocalizedRoute,
  type GeneratedConfiguration,
  type LocaleUrlPolicy,
  type LocalizationSetup,
  type RouteParameterCodec,
  type RouteParameterContext,
} from '@neolorn/equator/core';

import { claimCapability } from '../../../tools/capability-claims-in-tests.ts';

/**
 * Under a locale-neutral policy an address states a locale exactly when one locale alone spells it.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 3. A path or a parameter one locale spells on
 * its own is that locale's address, as a prefixed one is: arriving there commits it, and a
 * preference changes nothing about the answer. An address several locales spell is negotiated
 * among them, the default first where nothing chooses one, and is per visitor, so a cache keys it by
 * preference (section 5) and a build does not prerender it (section 9).
 */

const SLUG: RouteParameterCodec<string> = Object.freeze({
  parse: (slug: string) =>
    Object.freeze(
      slug === 'handbook' || slug === 'دليل'
        ? { ok: true, value: 'handbook' }
        : { ok: false },
    ),
  serialize: (entityId: string, context?: RouteParameterContext) =>
    entityId !== 'handbook'
      ? undefined
      : context?.locale === 'ar-EG'
        ? 'دليل'
        : 'handbook',
});

/** A route every locale spells alike, one with its own Arabic path, and one with an Arabic slug. */
const SHAPES = defineRouteProjection({
  generated: Object.freeze({
    profile: 'equator-route-projection/1',
    identity: 'sha256-LocaleNeutralAddressesTestIdentity012345678',
    routes: Object.freeze([
      Object.freeze({
        id: 'alike',
        path: 'second',
        parameterNames: Object.freeze([]),
        indexing: 'indexable',
      }),
      Object.freeze({
        id: 'spelled',
        path: 'third',
        parameterNames: Object.freeze([]),
        indexing: 'indexable',
      }),
      Object.freeze({
        id: 'article',
        path: 'articles/:slug',
        parameterNames: Object.freeze(['slug']),
        indexing: 'indexable',
      }),
    ]),
  } as const),
  parameters: Object.freeze({ article: Object.freeze({ slug: SLUG }) }),
  localizedPaths: Object.freeze({
    spelled: Object.freeze({ 'ar-EG': 'الثالث' }),
  }),
});

/** German spells nothing of its own, so every English address is shared with it. */
const NEUTRAL = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG', 'de-DE'],
});

const ARABIC_ARTICLE = `/articles/${encodeURIComponent('دليل')}`;
const ARABIC_THIRD = `/${encodeURIComponent('الثالث')}`;

/** What an arrival resolves to, reduced to the facts the rule is about. */
const arrival = (
  address: string,
  preference?: string,
  policy: LocaleUrlPolicy = NEUTRAL,
) => {
  const resolution = resolveLocalizedRoute(
    address,
    policy,
    SHAPES,
    preference === undefined ? undefined : { locale: preference },
  );
  return resolution.status === 'success'
    ? {
        status: resolution.status,
        locale: resolution.locale,
        varies: resolution.variesBy !== undefined,
      }
    : resolution.status === 'redirect'
      ? { status: resolution.status, location: resolution.location }
      : { status: resolution.status };
};

describe('an address one locale alone spells', () => {
  it('is that locale whatever the request prefers', () => {
    for (const preference of [undefined, 'en-US', 'ar-EG', 'fr-FR']) {
      for (const address of [ARABIC_ARTICLE, ARABIC_THIRD]) {
        expect(arrival(address, preference)).toStrictEqual({
          status: 'success',
          locale: 'ar-EG',
          varies: false,
        });
      }
    }
    claimCapability('policy:locale-neutral', { policy: NEUTRAL });
  });

  it('keeps an English slug in English under an Arabic preference', () => {
    // Corrected to the Arabic spelling, a shared cache holding that 308 sent every later reader of
    // the English article to the Arabic one, and the Arabic one sent a reader with no preference
    // back again.
    const english = createLocaleNeutralPolicy({
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
    });
    expect(arrival('/articles/handbook', 'ar-EG', english)).toStrictEqual({
      status: 'success',
      locale: 'en-US',
      varies: false,
    });
    claimCapability('policy:locale-neutral', { policy: english });
  });

  it('is the locale an arrival there commits', () => {
    expect(localeFromRoute(ARABIC_THIRD, NEUTRAL, SHAPES)).toBe('ar-EG');
    expect(localeFromRoute(ARABIC_ARTICLE, NEUTRAL, SHAPES)).toBe('ar-EG');
    // Corrected first, and the corrected address states the locale.
    expect(localeFromRoute(`${ARABIC_THIRD}/`, NEUTRAL, SHAPES)).toBe('ar-EG');
    // The control: every locale spells this one, so it states none and the next source answers.
    expect(localeFromRoute('/second', NEUTRAL, SHAPES)).toBeUndefined();
    claimCapability('policy:locale-neutral', { policy: NEUTRAL });
  });
});

describe('an address several locales spell', () => {
  it('is negotiated among them, and varies', () => {
    expect(arrival('/second', 'ar-EG')).toStrictEqual({
      status: 'success',
      locale: 'ar-EG',
      varies: true,
    });
    expect(arrival('/second')).toStrictEqual({
      status: 'success',
      locale: 'en-US',
      varies: true,
    });
    // `ar-EG` spells these routes its own way, so it is not among the locales here, and a
    // preference for it leaves the choice to the default.
    for (const address of ['/third', '/articles/handbook']) {
      expect(arrival(address, 'ar-EG')).toStrictEqual({
        status: 'success',
        locale: 'en-US',
        varies: true,
      });
    }
    expect(arrival('/articles/handbook', 'de-DE')).toStrictEqual({
      status: 'success',
      locale: 'de-DE',
      varies: true,
    });
    claimCapability('policy:locale-neutral', { policy: NEUTRAL });
  });

  it('goes to the default where nothing chooses, wherever the policy lists it', () => {
    const germanFirst = createLocaleNeutralPolicy({
      defaultLocale: 'en-US',
      locales: ['de-DE', 'ar-EG', 'en-US'],
    });
    for (const address of ['/second', '/articles/handbook']) {
      expect(arrival(address, undefined, germanFirst)).toStrictEqual({
        status: 'success',
        locale: 'en-US',
        varies: true,
      });
    }
    // The default spells this one its own way, so the others decide, in the order they are listed.
    const arabicDefault = createLocaleNeutralPolicy({
      defaultLocale: 'ar-EG',
      locales: ['en-US', 'de-DE', 'ar-EG'],
    });
    expect(arrival('/third', undefined, arabicDefault)).toStrictEqual({
      status: 'success',
      locale: 'en-US',
      varies: true,
    });
    claimCapability('policy:locale-neutral', { policy: germanFirst });
  });

  it('treats a preference for a locale the site does not have as no preference', () => {
    for (const preference of ['fr-FR', 'not a locale']) {
      expect(arrival('/second', preference)).toStrictEqual({
        status: 'success',
        locale: 'en-US',
        varies: true,
      });
    }
    claimCapability('policy:locale-neutral', { policy: NEUTRAL });
  });

  it('corrects to one location whatever the request prefers', () => {
    for (const preference of [undefined, 'ar-EG', 'de-DE', 'fr-FR']) {
      expect(arrival('/second/', preference)).toStrictEqual({
        status: 'redirect',
        location: '/second',
      });
    }
    claimCapability('policy:locale-neutral', { policy: NEUTRAL });
  });
});

describe('the preference a request handler reads', () => {
  const policy = createLocaleNeutralPolicy({
    defaultLocale: 'en-US',
    locales: ['en-US', 'ar-EG'],
  });
  const answering = createLocaleRequestHandler({
    policy,
    projection: SHAPES,
    cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
    cookie: { name: 'equator-locale' },
    render: () => new Response('<!doctype html>'),
  });

  const answer = async (headers: Record<string, string>) => {
    const response = await answering(
      new Request('https://site.example/second', { headers }),
    );
    return [response.status, response.headers.get('content-language')];
  };

  it('passes over a remembered locale the site does not have to the next signal', async () => {
    expect(
      await answer({
        cookie: 'equator-locale=fr-FR',
        'accept-language': 'ar-EG',
      }),
    ).toStrictEqual([200, 'ar-EG']);
    expect(await answer({ cookie: 'equator-locale=fr-FR' })).toStrictEqual([
      200,
      'en-US',
    ]);
    claimCapability('policy:locale-neutral', { policy });
  });

  it('takes the first language the site has, not only the first one asked for', async () => {
    expect(
      await answer({ 'accept-language': 'fr-FR, ar-EG;q=0.8' }),
    ).toStrictEqual([200, 'ar-EG']);
    claimCapability('policy:locale-neutral', { policy });
  });
});

/** A generated configuration, with the pseudo-locale list a build that generated one writes. */
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
    scopes: [
      {
        providerId: 'app',
        scopeId: 'app',
        applicationContractFingerprint: 'sha256-application-contract-fixture',
        semanticRegistryFingerprint: 'sha256-semantic-registry-fixture',
        requiredExtensions: [],
      },
    ],
  };
}

/** The policy an application declares once for both of its builds. */
const DECLARED = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG', 'en-Arab-XB'],
});
const PRODUCTION = configurationFor(['en-US', 'ar-EG']);
const DEVELOPMENT = configurationFor(
  ['en-US', 'ar-EG', 'en-Arab-XB'],
  ['en-Arab-XB'],
);

/** The table a build renders from, with the prerendered parameters expanded. */
async function table(
  configuration: GeneratedConfiguration,
  routeId: 'alike' | 'spelled' | 'article',
  options: { readonly canonicalRenderMode?: 'server' } = {
    canonicalRenderMode: 'server',
  },
) {
  const entries = localizedServerRoutes(
    DECLARED,
    SHAPES,
    configuration,
    [
      routeId === 'article'
        ? {
            routeId,
            renderMode: 'prerender',
            prerender: [{ slug: 'handbook' }],
          }
        : { routeId, renderMode: 'prerender' },
    ],
    options,
  );
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

describe('the server route table under a locale-neutral policy', () => {
  it('prerenders each locale at its own spelling', async () => {
    expect(await table(PRODUCTION, 'article')).toStrictEqual([
      {
        path: 'articles/:slug',
        renderMode: 'prerender',
        prerendered: [{ slug: 'handbook' }, { slug: 'دليل' }],
      },
    ]);
    expect(await table(PRODUCTION, 'spelled')).toStrictEqual([
      { path: 'third', renderMode: 'prerender' },
      { path: 'الثالث', renderMode: 'prerender' },
    ]);
    claimCapability('policy:locale-neutral', { policy: DECLARED });
  });

  it('renders on request an address one translation shares only with generated pseudo-locales', async () => {
    // The pseudo-locale spells the English slug and the English path, so in this build they are
    // shared, and the build without it prerenders them from the same table.
    expect(await table(DEVELOPMENT, 'article')).toStrictEqual([
      {
        path: 'articles/:slug',
        renderMode: 'prerender',
        prerendered: [{ slug: 'دليل' }],
      },
    ]);
    expect(await table(DEVELOPMENT, 'spelled')).toStrictEqual([
      { path: 'third', renderMode: 'server' },
      { path: 'الثالث', renderMode: 'prerender' },
    ]);
    await expect(table(DEVELOPMENT, 'spelled', {})).rejects.toThrow(
      /canonicalRenderMode/u,
    );
    claimCapability('policy:locale-neutral', { policy: DECLARED });
  });

  it('leaves an address two translations share to the prerender refusal', async () => {
    // Shared by `en-US` and `ar-EG`, so it is per visitor in every build. A build told to
    // prerender it fails when it renders it, where the refusal for every per-visitor page is.
    expect(await table(PRODUCTION, 'alike')).toStrictEqual([
      { path: 'second', renderMode: 'prerender' },
    ]);
    claimCapability('policy:locale-neutral', { policy: DECLARED });
  });
});

/**
 * The generated list of pseudo-locales, refused wherever it could mark a translation as one.
 *
 * Each case goes to both readers: the runtime, where the rest of the generated configuration is
 * checked, and the server route table, which is the list's one use.
 */
describe('the pseudo-locales a generated configuration lists', () => {
  const runtimeReading = (configuration: GeneratedConfiguration) => {
    try {
      createLocalizationRuntime({
        setup: { configuration } as LocalizationSetup,
        bootstrapScopes: [],
      });
    } catch (error) {
      return (error as Error).message;
    }
    return 'accepted';
  };
  const tableReading = (configuration: GeneratedConfiguration) =>
    table(configuration, 'alike').then(
      () => 'accepted',
      (error: unknown) => (error as Error).message,
    );

  it('accepts the list a build writes', async () => {
    // Read exactly as the same configuration without it, so the list is admitted and changes
    // nothing else the runtime reads. This stub setup is refused further on, for its catalogs.
    const unlisted = configurationFor(['en-US', 'ar-EG', 'en-Arab-XB']);
    expect(runtimeReading(DEVELOPMENT)).toBe(runtimeReading(unlisted));
    expect(runtimeReading(DEVELOPMENT)).not.toMatch(/inconsistent/u);
    expect(await tableReading(DEVELOPMENT)).toBe('accepted');
  });

  it('refuses one that is not a locale of the build', async () => {
    const edited = configurationFor(['en-US', 'ar-EG'], ['en-Arab-XB']);
    expect(runtimeReading(edited)).toMatch(/inconsistent/u);
    expect(await tableReading(edited)).toMatch(/pseudo-locales/u);
  });

  it('refuses one listed twice', async () => {
    const edited = configurationFor(
      ['en-US', 'ar-EG', 'en-Arab-XB'],
      ['en-Arab-XB', 'en-Arab-XB'],
    );
    expect(runtimeReading(edited)).toMatch(/inconsistent/u);
    expect(await tableReading(edited)).toMatch(/pseudo-locales/u);
  });

  it('refuses a translation listed as one', async () => {
    const edited = configurationFor(['en-US', 'ar-EG'], ['ar-EG']);
    expect(runtimeReading(edited)).toMatch(/inconsistent/u);
    expect(await tableReading(edited)).toMatch(/pseudo-locales/u);
  });

  it('refuses one whose region claims what it is not', async () => {
    // XB is English right to left and XA English left to right, and each of these is the other.
    for (const pseudo of ['en-Latn-XB', 'en-Arab-XA', 'de-Latn-XA']) {
      const edited = configurationFor(
        ['en-US', 'ar-EG', 'en-Arab-XB', pseudo],
        ['en-Arab-XB', pseudo],
      );
      expect(runtimeReading(edited)).toMatch(/inconsistent/u);
      expect(await tableReading(edited)).toMatch(/pseudo-locales/u);
    }
  });

  it('refuses one that names no script, which no build writes', async () => {
    const edited = configurationFor(
      ['en-US', 'ar-EG', 'en-Arab-XB', 'en-XA'],
      ['en-Arab-XB', 'en-XA'],
    );
    expect(runtimeReading(edited)).toMatch(/inconsistent/u);
    expect(await tableReading(edited)).toMatch(/pseudo-locales/u);
  });

  it('accepts one under a region UTS #35 leaves free', async () => {
    const locales = ['en-US', 'ar-EG', 'en-Arab-XB', 'en-Latn-XC'];
    const listed = configurationFor(locales, ['en-Arab-XB', 'en-Latn-XC']);
    expect(runtimeReading(listed)).toBe(
      runtimeReading(configurationFor(locales)),
    );
    expect(await tableReading(listed)).toBe('accepted');
  });

  it('refuses an empty list, which no build writes', async () => {
    const edited = configurationFor(['en-US', 'ar-EG'], []);
    expect(runtimeReading(edited)).toMatch(/inconsistent/u);
    expect(await tableReading(edited)).toMatch(/pseudo-locales/u);
  });
});
