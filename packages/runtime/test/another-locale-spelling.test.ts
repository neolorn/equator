import { describe, expect, it } from 'vitest';

import {
  createIdentifierParameterCodec,
  resolveLocalizedRoute,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

import { claimCapability } from '../../../tools/capability-claims-in-tests.ts';

/**
 * An address spelled the way another locale spells the route.
 *
 * `/ar-eg/articles/hello` names the Arabic locale and the English spelling of a route Arabic spells
 * `مقالات`. Nothing in Arabic answers it, and every locale that reads it reads the same route with
 * the same parameters, so it is a variant of one canonical address and section 6 of
 * `specs/07-routing-rendering-and-seo.spec.md` answers a variant with a 308 to that address. Where
 * the spellings of two locales name two different routes, the address is a variant of neither.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-AnotherLocaleSpellingTestIdentity0123456789',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  localizedPaths: {
    'route:second': { 'en-US': 'second', 'ar-EG': 'الثاني' },
    article: { 'en-US': 'articles/:slug', 'ar-EG': 'مقالات/:slug' },
  },
  parameters: { article: { slug: createIdentifierParameterCodec() } },
};

const PREFIXED: LocaleUrlPolicy = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: [],
  omitDefaultPrefix: false,
};

const HOSTED: LocaleUrlPolicy = {
  kind: 'locale-host',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'https://example.com', 'ar-EG': 'https://example.eg' },
  origins: { 'https://example.com': 'en-US', 'https://example.eg': 'ar-EG' },
  localeNeutralRoots: [],
};

/** The decoded spellings: SECOND_ENC is الثاني and ARTICLES_ENC is مقالات. */
const SECOND_ENC = '%D8%A7%D9%84%D8%AB%D8%A7%D9%86%D9%8A';
const ARTICLES_ENC = '%D9%85%D9%82%D8%A7%D9%84%D8%A7%D8%AA';

describe("an address in another locale's spelling", () => {
  it("is corrected to this locale's spelling, with the query kept", () => {
    expect(
      resolveLocalizedRoute(
        '/ar-eg/articles/hello?page=2',
        PREFIXED,
        PROJECTION,
      ),
    ).toMatchObject({
      status: 'redirect',
      reason: 'canonical-correction',
      httpStatus: 308,
      locale: 'ar-EG',
      routeId: 'article',
      location: `/ar-eg/${ARTICLES_ENC}/hello?page=2`,
    });
    expect(
      resolveLocalizedRoute(`/en-us/${SECOND_ENC}`, PREFIXED, PROJECTION),
    ).toMatchObject({
      status: 'redirect',
      httpStatus: 308,
      locale: 'en-US',
      location: '/en-us/second',
    });
    claimCapability('policy:path-prefix', { policy: PREFIXED });
  });

  it('rebuilds the query and fragment it keeps rather than copying their text', () => {
    // Every value is decoded, bounded and encoded again, so what reaches the location is what the
    // parser accepted and nothing the request wrote around it.
    expect(
      resolveLocalizedRoute(
        '/ar-eg/articles/hello?flag&x=%7e&q=a%20b#%74op',
        PREFIXED,
        PROJECTION,
      ),
    ).toMatchObject({
      status: 'redirect',
      reason: 'canonical-correction',
      location: `/ar-eg/${ARTICLES_ENC}/hello?flag=&x=~&q=a%20b#top`,
    });
    claimCapability('policy:path-prefix', { policy: PREFIXED });
  });

  it('is corrected on its own origin under a host policy', () => {
    expect(
      resolveLocalizedRoute(
        'https://example.eg/articles/hello?page=2',
        HOSTED,
        PROJECTION,
      ),
    ).toMatchObject({
      status: 'redirect',
      reason: 'canonical-correction',
      httpStatus: 308,
      locale: 'ar-EG',
      location: `https://example.eg/${ARTICLES_ENC}/hello?page=2`,
    });
    claimCapability('policy:locale-host', { policy: HOSTED });
  });

  it("leaves an address this locale spells to this locale's route", () => {
    expect(
      resolveLocalizedRoute(
        `/ar-eg/${ARTICLES_ENC}/hello`,
        PREFIXED,
        PROJECTION,
      ),
    ).toMatchObject({ status: 'success', routeId: 'article', locale: 'ar-EG' });
  });

  it('is not found where two locales spell two different routes that way', () => {
    // English spells `one` as `alpha` and German spells `two` the same way. The address is a
    // variant of two canonical addresses, so it is a variant of neither.
    const crossed: RouteRuntimeProjection = {
      generated: {
        profile: 'equator-route-projection/1',
        identity: 'sha256-CrossedSpellingsTestIdentity0123456789abcde',
        routes: [
          { id: 'route:one', path: 'one', parameterNames: [] },
          { id: 'route:two', path: 'two', parameterNames: [] },
        ],
      },
      localizedPaths: {
        'route:one': { 'en-US': 'alpha', 'ar-EG': 'ا', 'de-DE': 'eins' },
        'route:two': { 'en-US': 'beta', 'ar-EG': 'ب', 'de-DE': 'alpha' },
      },
    };
    const policy: LocaleUrlPolicy = {
      ...PREFIXED,
      locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'de-DE': 'de-de' },
      prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG', 'de-de': 'de-DE' },
    };

    expect(
      resolveLocalizedRoute('/ar-eg/alpha', policy, crossed),
    ).toMatchObject({
      status: 'not-found',
      httpStatus: 404,
      requestedLocale: 'ar-EG',
    });
    // The control: a spelling only one of them has is corrected.
    expect(resolveLocalizedRoute('/ar-eg/beta', policy, crossed)).toMatchObject(
      {
        status: 'redirect',
        location: `/ar-eg/${encodeURIComponent('ب')}`,
      },
    );
  });

  it('is not found where no locale spells it', () => {
    expect(
      resolveLocalizedRoute('/ar-eg/nothing-here', PREFIXED, PROJECTION),
    ).toMatchObject({ status: 'not-found', httpStatus: 404 });
  });
});
