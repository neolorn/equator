import { describe, expect, it } from 'vitest';

import {
  buildLocalizedRoute,
  createDefaultLocalePrefixPolicy,
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  LocalizationError,
  resolveLocalizedRoute,
  type RouteParameterCodec,
  type RouteParameterContext,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * Where an address in another locale's spelling is corrected, and where it is left not found.
 *
 * Section 6 of `specs/07-routing-rendering-and-seo.spec.md` answers a variant of one canonical URL
 * with a 308 to it. The correction is only made to an address Equator can itself read back: one the
 * requested locale can spell, and whose first segment the policy has not already claimed as a
 * prefix, an alias or a locale-neutral root where no prefix stands in front of it.
 */

/** Reads any lower-case slug, and has no Arabic spelling for one of them. */
const SLUG: RouteParameterCodec<string> = Object.freeze({
  parse: (value: string) =>
    /^[a-z-]+$/u.test(value)
      ? Object.freeze({ ok: true as const, value })
      : Object.freeze({ ok: false as const }),
  serialize: (value: string, context?: RouteParameterContext) =>
    value === 'english-only' && context?.locale === 'ar-EG' ? undefined : value,
});

/** Arabic spells the home page `bayt`, the second page `api`, and articles `maqalat`. */
const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-SpellingCorrectionLimitsTestIdentity0123456',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  localizedPaths: {
    home: { 'ar-EG': 'bayt' },
    second: { 'ar-EG': 'api' },
    article: { 'ar-EG': 'maqalat/:slug' },
  },
  parameters: { article: { slug: SLUG } },
};

const LOCALES = { 'en-US': 'en-us', 'ar-EG': 'ar-eg' };
const ORIGINS = {
  'en-US': 'https://example.com',
  'ar-EG': 'https://example.eg',
};

const correction = (locale: string, routeId: string, location: string) => ({
  status: 'redirect',
  reason: 'canonical-correction',
  httpStatus: 308,
  cache: 'consumer-defined-permanent',
  locale,
  routeId,
  location,
});

const missing = (locale: string) => ({
  status: 'not-found',
  httpStatus: 404,
  presentationLocale: locale,
  requestedLocale: locale,
});

describe("a correction to this locale's spelling", () => {
  it('carries the whole answer a permanent correction carries', () => {
    expect(
      resolveLocalizedRoute(
        '/ar-eg/articles/hello?page=2#top',
        createPathPrefixLocalePolicy({
          defaultLocale: 'en-US',
          locales: LOCALES,
        }),
        PROJECTION,
      ),
    ).toStrictEqual(
      correction('ar-EG', 'article', '/ar-eg/maqalat/hello?page=2#top'),
    );
  });

  it('is not made where this locale cannot spell the page', () => {
    const policy = createPathPrefixLocalePolicy({
      defaultLocale: 'en-US',
      locales: LOCALES,
    });
    expect(
      resolveLocalizedRoute('/ar-eg/articles/english-only', policy, PROJECTION),
    ).toStrictEqual(missing('ar-EG'));
    expect(
      resolveLocalizedRoute(
        'https://example.eg/articles/english-only',
        createHostLocalePolicy({ defaultLocale: 'en-US', origins: ORIGINS }),
        PROJECTION,
      ),
    ).toStrictEqual(missing('ar-EG'));
  });

  it('is made to the root where this locale spells the page as its root', () => {
    expect(
      resolveLocalizedRoute(
        'https://example.com/bayt',
        createHostLocalePolicy({ defaultLocale: 'en-US', origins: ORIGINS }),
        PROJECTION,
      ),
    ).toStrictEqual(correction('en-US', 'home', 'https://example.com/'));
    expect(
      resolveLocalizedRoute(
        '/en-us/bayt',
        createPathPrefixLocalePolicy({
          defaultLocale: 'en-US',
          locales: LOCALES,
        }),
        PROJECTION,
      ),
    ).toStrictEqual(correction('en-US', 'home', '/en-us'));
    // No prefix and no segment: the address is the bare root, and nothing in it can be claimed.
    expect(
      resolveLocalizedRoute(
        '/en-us/bayt',
        createDefaultLocalePrefixPolicy({
          defaultLocale: 'en-US',
          locales: LOCALES,
          localeNeutralRoots: ['api'],
        }),
        PROJECTION,
      ),
    ).toStrictEqual(correction('en-US', 'home', '/'));
  });

  it('is not made to an address whose first segment is a locale-neutral root', () => {
    // On its own origin the Arabic spelling `api` would be the first segment of the address, and
    // the resolver answers that root with nothing.
    expect(
      resolveLocalizedRoute(
        'https://example.eg/second',
        createHostLocalePolicy({
          defaultLocale: 'en-US',
          origins: ORIGINS,
          localeNeutralRoots: ['api'],
        }),
        PROJECTION,
      ),
    ).toStrictEqual(missing('ar-EG'));
    // The control: with no such root the same address is corrected.
    expect(
      resolveLocalizedRoute(
        'https://example.eg/second',
        createHostLocalePolicy({ defaultLocale: 'en-US', origins: ORIGINS }),
        PROJECTION,
      ),
    ).toStrictEqual(correction('ar-EG', 'second', 'https://example.eg/api'));
  });

  it('is made behind a locale prefix, where the root is no longer the first segment', () => {
    expect(
      resolveLocalizedRoute(
        '/ar-eg/second',
        createPathPrefixLocalePolicy({
          defaultLocale: 'en-US',
          locales: LOCALES,
          localeNeutralRoots: ['api'],
        }),
        PROJECTION,
      ),
    ).toStrictEqual(correction('ar-EG', 'second', '/ar-eg/api'));
  });
});

describe('an address Equator would write and could not read back', () => {
  const refusal = (call: () => unknown): string | undefined => {
    try {
      call();
      return undefined;
    } catch (error) {
      if (error instanceof LocalizationError) return error.diagnostic.code;
      throw error;
    }
  };

  const unprefixed = createDefaultLocalePrefixPolicy({
    defaultLocale: 'en-US',
    locales: LOCALES,
    aliases: { ar: 'ar-EG' },
    localeNeutralRoots: ['assets'],
  });

  it("is built where its first segment is the route's own", () => {
    expect(buildLocalizedRoute(unprefixed, PROJECTION, 'second', 'en-US')).toBe(
      '/second',
    );
    expect(
      buildLocalizedRoute(unprefixed, PROJECTION, 'article', 'en-US', {
        slug: 'hello',
      }),
    ).toBe('/articles/hello');
    expect(
      buildLocalizedRoute(
        createHostLocalePolicy({
          defaultLocale: 'en-US',
          origins: ORIGINS,
          localeNeutralRoots: ['assets'],
        }),
        PROJECTION,
        'second',
        'ar-EG',
      ),
    ).toBe('https://example.eg/api');
    expect(
      buildLocalizedRoute(
        createLocaleNeutralPolicy({
          defaultLocale: 'en-US',
          locales: ['en-US', 'ar-EG'],
          localeNeutralRoots: ['assets'],
        }),
        PROJECTION,
        'second',
        'en-US',
      ),
    ).toBe('/second');
  });

  it('is refused where its first segment spells a prefix, an alias or a root', () => {
    const leading: RouteRuntimeProjection = {
      generated: {
        profile: 'equator-route-projection/1',
        identity: 'sha256-ClaimedLeadingSegmentTestIdentity0123456789',
        routes: [{ id: 'page', path: ':slug', parameterNames: ['slug'] }],
      },
      parameters: { page: { slug: SLUG } },
    };
    for (const slug of ['ar-eg', 'en-us', 'ar', 'assets']) {
      expect(
        refusal(() =>
          buildLocalizedRoute(unprefixed, leading, 'page', 'en-US', { slug }),
        ),
      ).toBe('invalid-configuration');
    }
    // The controls: any other slug, and the same slugs behind a locale prefix.
    expect(
      buildLocalizedRoute(unprefixed, leading, 'page', 'en-US', {
        slug: 'hello',
      }),
    ).toBe('/hello');
    expect(
      buildLocalizedRoute(unprefixed, leading, 'page', 'ar-EG', {
        slug: 'assets',
      }),
    ).toBe('/ar-eg/assets');
  });
});
