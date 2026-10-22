import { describe, expect, it } from 'vitest';

import {
  createLocaleNeutralPolicy,
  resolveLocalizedRoute,
  type LocaleNeutralPolicy,
  type RouteParameterCodec,
  type RouteParameterContext,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What a locale-neutral policy answers for each kind of address, with every field of the answer.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` sections 3 to 6. The address carries no locale, so
 * the answer is the route, the locale negotiated among the ones that spell the address, and one
 * permanent hop where the address is a variant of its canonical spelling.
 */

/** One article, read in any case and written `hello` in English and `marhaba` in Arabic. */
const SLUG: RouteParameterCodec<string> = Object.freeze({
  parse: (value: string) =>
    ['hello', 'marhaba'].includes(value.toLowerCase())
      ? Object.freeze({ ok: true as const, value: 'greeting' })
      : Object.freeze({ ok: false as const }),
  serialize: (value: string, context?: RouteParameterContext) =>
    value !== 'greeting'
      ? undefined
      : context?.locale === 'ar-EG'
        ? 'marhaba'
        : 'hello',
});

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-LocaleNeutralResolutionTestIdentity01234567',
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
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  localizedPaths: { second: { 'ar-EG': 'thani' } },
  parameters: { article: { slug: SLUG } },
};

const NEUTRAL = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});

const resolve = (
  target: string,
  policy: LocaleNeutralPolicy = NEUTRAL,
  preference?: string,
) =>
  resolveLocalizedRoute(
    target,
    policy,
    PROJECTION,
    preference === undefined ? {} : { locale: preference },
  );

const correction = (locale: string, routeId: string, location: string) => ({
  status: 'redirect',
  reason: 'canonical-correction',
  httpStatus: 308,
  cache: 'consumer-defined-permanent',
  locale,
  routeId,
  location,
});

describe('an address under a locale-neutral policy', () => {
  it('is malformed, in the default locale, with the code a host reports', () => {
    expect(resolve('/%zz')).toStrictEqual({
      status: 'malformed',
      httpStatus: 400,
      presentationLocale: 'en-US',
      diagnostic: {
        code: 'unsafe-route',
        outcome: 'operational-failure',
        message: expect.any(String) as string,
      },
    });
  });

  it('is not found under a locale-neutral root, even one a route spells', () => {
    const policy = createLocaleNeutralPolicy({
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
      localeNeutralRoots: ['api', 'second'],
    });
    for (const target of ['/api/health', '/second']) {
      expect(resolve(target, policy, 'ar-EG')).toStrictEqual({
        status: 'not-found',
        httpStatus: 404,
        presentationLocale: 'en-US',
      });
    }
    // The control: the root is the first segment as written and nothing else.
    expect(resolve('/account', policy)).toMatchObject({ status: 'success' });
  });

  it('resolves an address one locale alone spells, with nothing the address did not carry', () => {
    expect(resolve('/second')).toStrictEqual({
      status: 'success',
      locale: 'en-US',
      direction: 'ltr',
      routeId: 'second',
      parameters: {},
      canonicalPath: '/second',
      query: [],
      indexing: 'indexable',
    });
  });

  it('carries the fragment, the indexing class and the caching class the route declares', () => {
    expect(resolve('/account?tab=1#top', NEUTRAL, 'ar-EG')).toStrictEqual({
      status: 'success',
      locale: 'ar-EG',
      direction: 'rtl',
      routeId: 'account',
      parameters: {},
      canonicalPath: '/account',
      query: [{ name: 'tab', value: '1' }],
      fragment: 'top',
      indexing: 'private',
      caching: 'not-stored',
      variesBy: 'locale-preference',
    });
  });

  it('corrects a trailing slash in one permanent hop', () => {
    expect(resolve('/second/')).toStrictEqual(
      correction('en-US', 'second', '/second'),
    );
  });

  it('corrects a query or an escape that is not canonical, with no trailing slash to go by', () => {
    expect(resolve('/second?flag')).toStrictEqual(
      correction('en-US', 'second', '/second?flag='),
    );
    expect(resolve('/%73econd')).toStrictEqual(
      correction('en-US', 'second', '/second'),
    );
  });

  it('corrects a spelling no locale writes to the first locale that reads it', () => {
    expect(resolve('/SECOND')).toStrictEqual(
      correction('en-US', 'second', '/second'),
    );
    expect(resolve('/ACCOUNT', NEUTRAL, 'ar-EG')).toStrictEqual(
      correction('ar-EG', 'account', '/account'),
    );
  });

  it('names a correction in a locale that writes the corrected address', () => {
    // Both locales read `HELLO`, and each would write it differently. The correction goes to the
    // English spelling, so the Arabic preference, which writes another address, does not name it.
    expect(resolve('/articles/HELLO', NEUTRAL, 'ar-EG')).toStrictEqual(
      correction('en-US', 'article', '/articles/hello'),
    );
  });

  it('is not found, in the preferred locale, where nothing reads the address', () => {
    expect(resolve('/nowhere', NEUTRAL, 'ar-EG')).toStrictEqual({
      status: 'not-found',
      httpStatus: 404,
      presentationLocale: 'ar-EG',
    });
  });
});
