import { describe, expect, it } from 'vitest';

import {
  createHostLocalePolicy,
  resolveLocalizedRoute,
  type RouteResolutionContext,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What a locale-host policy answers for each kind of address, with every field of the answer.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` sections 3 to 6. The origin names the locale, so the
 * answer is the route read in that locale, an absolute canonical URL on that origin, and one
 * permanent hop where the address is a variant of its canonical spelling.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-LocaleHostResolutionTestIdentity0123456789a',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
      {
        id: 'account',
        path: 'account',
        parameterNames: [],
        indexing: 'private',
        caching: 'not-stored',
      },
    ],
  },
  localizedPaths: { second: { 'ar-EG': 'thani' } },
  historical: {
    removed: { kind: 'gone' },
    legacy: { kind: 'replacement', routeId: 'account' },
  },
};

const HOSTED = createHostLocalePolicy({
  defaultLocale: 'en-US',
  origins: { 'en-US': 'https://example.com', 'ar-EG': 'https://example.eg' },
  localeNeutralRoots: ['assets'],
});

const resolve = (target: string, context?: RouteResolutionContext) =>
  resolveLocalizedRoute(target, HOSTED, PROJECTION, context);

const malformed = (presentationLocale: string) => ({
  status: 'malformed',
  httpStatus: 400,
  presentationLocale,
  diagnostic: {
    code: 'unsafe-route',
    outcome: 'operational-failure',
    message: expect.any(String) as string,
  },
});

const correction = (locale: string, routeId: string, location: string) => ({
  status: 'redirect',
  reason: 'canonical-correction',
  httpStatus: 308,
  cache: 'consumer-defined-permanent',
  locale,
  routeId,
  location,
});

describe('the origin a locale-host policy reads an address on', () => {
  it('is that of the default locale where the request names none', () => {
    expect(resolve('/second')).toMatchObject({
      status: 'success',
      locale: 'en-US',
      canonicalUrl: 'https://example.com/second',
    });
  });

  it('is the one the request arrived on where the target is a path', () => {
    expect(resolve('/thani', { origin: 'https://example.eg' })).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
      routeId: 'second',
      canonicalUrl: 'https://example.eg/thani',
    });
    // Compared as an origin, so the spelling a platform hands over does not have to be canonical.
    expect(resolve('/thani', { origin: 'HTTPS://EXAMPLE.EG/' })).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
    });
  });

  it('is the one the target names where the target is absolute, whatever the request arrived on', () => {
    expect(
      resolve('https://example.eg/thani', { origin: 'https://example.com' }),
    ).toMatchObject({ status: 'success', locale: 'ar-EG' });
  });

  it('is malformed, in the default locale, where the policy has no such origin', () => {
    expect(
      resolve('/second', { origin: 'https://other.example' }),
    ).toStrictEqual(malformed('en-US'));
    expect(resolve('https://other.example/second')).toStrictEqual(
      malformed('en-US'),
    );
  });

  it('is malformed, in the default locale, where it is not an origin at all', () => {
    for (const origin of ['not an origin', '', 'example.eg']) {
      expect(resolve('/second', { origin }), origin).toStrictEqual(
        malformed('en-US'),
      );
    }
  });
});

describe('an address under a locale-host policy', () => {
  it('is malformed, in the locale of its origin, with the code a host reports', () => {
    expect(resolve('https://example.eg/%zz')).toStrictEqual(malformed('ar-EG'));
    expect(resolve('/%zz')).toStrictEqual(malformed('en-US'));
  });

  it('is not found under a locale-neutral root, and states no locale there', () => {
    expect(resolve('https://example.eg/assets/logo.svg')).toStrictEqual({
      status: 'not-found',
      httpStatus: 404,
      presentationLocale: 'ar-EG',
    });
    expect(resolve('https://example.eg/assets')).toStrictEqual({
      status: 'not-found',
      httpStatus: 404,
      presentationLocale: 'ar-EG',
    });
  });

  it('is not found, in the locale its origin states, where no route reads it', () => {
    // The control for the root above: the same answer, and the locale the origin named with it.
    expect(resolve('https://example.eg/nowhere')).toStrictEqual({
      status: 'not-found',
      httpStatus: 404,
      presentationLocale: 'ar-EG',
      requestedLocale: 'ar-EG',
    });
  });

  it('resolves with nothing the address did not carry', () => {
    expect(resolve('/second')).toStrictEqual({
      status: 'success',
      locale: 'en-US',
      direction: 'ltr',
      routeId: 'second',
      parameters: {},
      canonicalPath: '/second',
      canonicalUrl: 'https://example.com/second',
      query: [],
      indexing: 'indexable',
    });
  });

  it('carries the fragment, the indexing class and the caching class the route declares', () => {
    expect(resolve('https://example.eg/account?tab=1#top')).toStrictEqual({
      status: 'success',
      locale: 'ar-EG',
      direction: 'rtl',
      routeId: 'account',
      parameters: {},
      canonicalPath: '/account',
      canonicalUrl: 'https://example.eg/account',
      query: [{ name: 'tab', value: '1' }],
      fragment: 'top',
      indexing: 'private',
      caching: 'not-stored',
    });
  });

  it('resolves the root to the origin and one slash', () => {
    for (const target of ['https://example.eg/', 'https://example.eg']) {
      expect(resolve(target)).toStrictEqual({
        status: 'success',
        locale: 'ar-EG',
        direction: 'rtl',
        routeId: 'home',
        parameters: {},
        canonicalPath: '/',
        canonicalUrl: 'https://example.eg/',
        query: [],
        indexing: 'indexable',
      });
    }
  });

  it('corrects a trailing slash in one permanent hop to an absolute address', () => {
    expect(resolve('https://example.eg/thani/')).toStrictEqual(
      correction('ar-EG', 'second', 'https://example.eg/thani'),
    );
    expect(resolve('/second/?page=2#top')).toStrictEqual(
      correction('en-US', 'second', 'https://example.com/second?page=2#top'),
    );
  });

  it('corrects a spelling in another case', () => {
    expect(resolve('/SECOND')).toStrictEqual(
      correction('en-US', 'second', 'https://example.com/second'),
    );
  });

  it('corrects a query or an escape that is not canonical, with no trailing slash to go by', () => {
    expect(resolve('/second?flag')).toStrictEqual(
      correction('en-US', 'second', 'https://example.com/second?flag='),
    );
    expect(resolve('/%73econd')).toStrictEqual(
      correction('en-US', 'second', 'https://example.com/second'),
    );
  });

  it('answers a retired address before it looks for a spelling of another locale', () => {
    expect(resolve('https://example.eg/removed')).toStrictEqual({
      status: 'gone',
      httpStatus: 410,
      presentationLocale: 'ar-EG',
    });
    expect(resolve('https://example.eg/legacy')).toStrictEqual({
      status: 'redirect',
      reason: 'replacement',
      httpStatus: 308,
      cache: 'consumer-defined-permanent',
      locale: 'ar-EG',
      routeId: 'account',
      location: 'https://example.eg/account',
    });
  });

  it('corrects an address another locale spells to the spelling its own origin uses', () => {
    expect(resolve('https://example.eg/second')).toStrictEqual(
      correction('ar-EG', 'second', 'https://example.eg/thani'),
    );
    expect(resolve('/thani')).toStrictEqual(
      correction('en-US', 'second', 'https://example.com/second'),
    );
  });
});
