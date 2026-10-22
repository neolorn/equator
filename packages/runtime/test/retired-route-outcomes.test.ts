import { describe, expect, it } from 'vitest';

import {
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  resolveLocalizedRoute,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What a retired address answers under each policy.
 *
 * The status table in section 5 of `specs/07-routing-rendering-and-seo.spec.md` answers a declared
 * permanent removal with 410 and a declared replacement with 308. `RouteHistoricalOutcome` is where
 * an application declares either, and a replacement is written in the locale the request was read
 * in, with the query and fragment the request carried. History is consulted only after the routes
 * themselves have missed.
 */

const SLUG: RouteParameterCodec<string> = Object.freeze({
  parse: (value: string) => Object.freeze({ ok: true as const, value }),
  serialize: (value: string) => value,
});

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-RetiredRouteOutcomesTestIdentity01234567890',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  localizedPaths: { second: { 'ar-EG': 'thani' } },
  parameters: { article: { slug: SLUG } },
  historical: {
    removed: { kind: 'gone' },
    'archive/removed': { kind: 'gone' },
    legacy: { kind: 'replacement', routeId: 'second' },
    'legacy-article': {
      kind: 'replacement',
      routeId: 'article',
      parameters: { slug: 'hello' },
    },
  },
};

const PREFIXED = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const NEUTRAL = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});

const HOSTED = createHostLocalePolicy({
  defaultLocale: 'en-US',
  origins: { 'en-US': 'https://example.com', 'ar-EG': 'https://example.eg' },
});

const gone = (presentationLocale: string) => ({
  status: 'gone',
  httpStatus: 410,
  presentationLocale,
});

const replaced = (locale: string, routeId: string, location: string) => ({
  status: 'redirect',
  reason: 'replacement',
  httpStatus: 308,
  cache: 'consumer-defined-permanent',
  locale,
  routeId,
  location,
});

describe('a retired address that is gone', () => {
  it('answers 410 in the locale its prefix states', () => {
    expect(
      resolveLocalizedRoute('/en-us/removed', PREFIXED, PROJECTION),
    ).toStrictEqual(gone('en-US'));
    expect(
      resolveLocalizedRoute('/ar-eg/removed', PREFIXED, PROJECTION),
    ).toStrictEqual(gone('ar-EG'));
  });

  it('answers 410 in the default locale where the address has no prefix', () => {
    expect(
      resolveLocalizedRoute('/removed', PREFIXED, PROJECTION),
    ).toStrictEqual(gone('en-US'));
  });

  it('is found by its whole path where the path has several segments', () => {
    expect(
      resolveLocalizedRoute('/ar-eg/archive/removed', PREFIXED, PROJECTION),
    ).toStrictEqual(gone('ar-EG'));
    // The control: the same segments run together are not that entry.
    expect(
      resolveLocalizedRoute('/ar-eg/archiveremoved', PREFIXED, PROJECTION),
    ).toMatchObject({ status: 'not-found' });
  });

  it('answers 410 in the preferred locale under a locale-neutral policy', () => {
    expect(
      resolveLocalizedRoute('/removed', NEUTRAL, PROJECTION),
    ).toStrictEqual(gone('en-US'));
    expect(
      resolveLocalizedRoute('/removed', NEUTRAL, PROJECTION, {
        locale: 'ar-EG',
      }),
    ).toStrictEqual(gone('ar-EG'));
  });

  it('answers 410 in the locale of the origin under a host policy', () => {
    expect(
      resolveLocalizedRoute('https://example.eg/removed', HOSTED, PROJECTION),
    ).toStrictEqual(gone('ar-EG'));
  });
});

describe('a retired address that was replaced', () => {
  it('is one permanent hop to the replacement, with the query and fragment kept', () => {
    expect(
      resolveLocalizedRoute('/en-us/legacy?page=2#top', PREFIXED, PROJECTION),
    ).toStrictEqual(replaced('en-US', 'second', '/en-us/second?page=2#top'));
  });

  it('writes the replacement in the spelling of the locale the request was read in', () => {
    expect(
      resolveLocalizedRoute('/ar-eg/legacy', PREFIXED, PROJECTION),
    ).toStrictEqual(replaced('ar-EG', 'second', '/ar-eg/thani'));
    expect(
      resolveLocalizedRoute('https://example.eg/legacy', HOSTED, PROJECTION),
    ).toStrictEqual(replaced('ar-EG', 'second', 'https://example.eg/thani'));
    expect(
      resolveLocalizedRoute('/legacy', NEUTRAL, PROJECTION, {
        locale: 'ar-EG',
      }),
    ).toStrictEqual(replaced('ar-EG', 'second', '/thani'));
  });

  it("fills the replacement's parameters from the ones the entry declares", () => {
    expect(
      resolveLocalizedRoute('/ar-eg/legacy-article', PREFIXED, PROJECTION),
    ).toStrictEqual(replaced('ar-EG', 'article', '/ar-eg/articles/hello'));
  });

  it('is consulted for an unprefixed address before the segment is read as a tag', () => {
    expect(
      resolveLocalizedRoute('/legacy', PREFIXED, PROJECTION),
    ).toStrictEqual(replaced('en-US', 'second', '/en-us/second'));
  });
});
