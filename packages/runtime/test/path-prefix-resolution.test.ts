import { describe, expect, it } from 'vitest';

import {
  createDefaultLocalePrefixPolicy,
  createPathPrefixLocalePolicy,
  LocalizationError,
  resolveLocalizedRoute,
  type PathPrefixLocalePolicy,
  type RouteParameterCodec,
  type RouteParameterContext,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What a path-prefix policy answers for each kind of address, with every field of the answer.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` sections 3 to 6. The first segment is read before
 * anything else: a locale-neutral root is answered by nothing, a prefix names the locale, a prefix
 * in another case or an alias is corrected in one permanent hop, and anything else is either an
 * entry address with no locale stated or an address nothing serves. A host forwards the whole
 * answer, so each case holds the whole object and not only its status.
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

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-PathPrefixResolutionTestIdentity01234567890',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
      {
        id: 'account',
        path: 'account',
        parameterNames: [],
        indexing: 'private',
        caching: 'per-visitor',
      },
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  localizedPaths: { second: { 'ar-EG': 'thani' } },
  parameters: { article: { slug: SLUG } },
};

const LOCALES = { 'en-US': 'en-us', 'ar-EG': 'ar-eg' };

const PREFIXED = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: LOCALES,
  aliases: { ar: 'ar-EG' },
});

const UNPREFIXED_DEFAULT = createDefaultLocalePrefixPolicy({
  defaultLocale: 'en-US',
  locales: LOCALES,
});

const resolve = (
  target: string,
  policy: PathPrefixLocalePolicy = PREFIXED,
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

const entry = (locale: string, routeId: string, location: string) => ({
  status: 'redirect',
  reason: 'locale-entry',
  httpStatus: 307,
  cache: 'private-no-cache',
  locale,
  routeId,
  location,
});

describe('an address a path-prefix policy cannot read', () => {
  it('is malformed, in the default locale, with the code a host reports', () => {
    expect(resolve('/en-us/%zz')).toStrictEqual({
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

  it('is not found under a locale-neutral root, even one a route or a tag spells', () => {
    const policy = createPathPrefixLocalePolicy({
      defaultLocale: 'en-US',
      locales: LOCALES,
      localeNeutralRoots: ['api', 'second'],
    });
    // `api` has the shape of a language tag and `second` is a route. Neither reading is reached,
    // because the root is answered before the segment is read as anything else.
    for (const target of ['/api', '/api/health', '/second']) {
      expect(resolve(target, policy)).toStrictEqual({
        status: 'not-found',
        httpStatus: 404,
        presentationLocale: 'en-US',
      });
    }
  });

  it('names the locale it asked for where the first segment has the shape of a tag', () => {
    for (const requested of ['fr', 'fr-CA', 'zh-Hant-TW']) {
      expect(resolve(`/${requested}/second`)).toStrictEqual({
        status: 'unsupported-locale',
        httpStatus: 404,
        presentationLocale: 'en-US',
        requestedLocale: requested,
      });
    }
  });

  it('names no locale where the first segment is only a word', () => {
    // Each ends or begins the way a tag does and is not one as a whole.
    for (const target of ['/nowhere', '/nowhere/second', '/fr-C', '/fr_CA']) {
      expect(resolve(target)).toStrictEqual({
        status: 'not-found',
        httpStatus: 404,
        presentationLocale: 'en-US',
      });
    }
  });

  it('keeps the locale a prefix stated where only the page is unknown', () => {
    expect(resolve('/ar-eg/nowhere')).toStrictEqual({
      status: 'not-found',
      httpStatus: 404,
      presentationLocale: 'ar-EG',
      requestedLocale: 'ar-EG',
    });
  });
});

describe('an address under a locale prefix', () => {
  it('resolves to the route, with nothing in the answer the address did not carry', () => {
    expect(resolve('/en-us/second')).toStrictEqual({
      status: 'success',
      locale: 'en-US',
      direction: 'ltr',
      routeId: 'second',
      parameters: {},
      canonicalPath: '/en-us/second',
      query: [],
      indexing: 'indexable',
    });
  });

  it('carries the fragment, the indexing class and the caching class the route declares', () => {
    expect(resolve('/ar-eg/account?tab=1#top')).toStrictEqual({
      status: 'success',
      locale: 'ar-EG',
      direction: 'rtl',
      routeId: 'account',
      parameters: {},
      canonicalPath: '/ar-eg/account',
      query: [{ name: 'tab', value: '1' }],
      fragment: 'top',
      indexing: 'private',
      caching: 'per-visitor',
    });
  });

  it('resolves the root of a locale', () => {
    expect(resolve('/ar-eg')).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
      routeId: 'home',
      canonicalPath: '/ar-eg',
    });
  });

  it('is corrected in one permanent hop where the path is not the canonical spelling', () => {
    for (const target of [
      '/en-us/second/',
      '/en-us/SECOND',
      '/en-us/%73econd',
    ]) {
      expect(resolve(target)).toStrictEqual(
        correction('en-US', 'second', '/en-us/second'),
      );
    }
  });

  it('is corrected where the prefix is written in another case', () => {
    expect(resolve('/EN-US/second')).toStrictEqual(
      correction('en-US', 'second', '/en-us/second'),
    );
    expect(resolve('/Ar-Eg')).toStrictEqual(
      correction('ar-EG', 'home', '/ar-eg'),
    );
  });

  it('is corrected where the prefix is an alias, in any case', () => {
    for (const target of ['/ar/thani', '/AR/thani']) {
      expect(resolve(target)).toStrictEqual(
        correction('ar-EG', 'second', '/ar-eg/thani'),
      );
    }
    expect(resolve('/ar?page=2')).toStrictEqual(
      correction('ar-EG', 'home', '/ar-eg?page=2'),
    );
  });

  it('is corrected in one hop where the prefix and a segment both need it', () => {
    for (const target of ['/AR/THANI', '/AR-EG/Thani/', '/ar/THANI/']) {
      expect(resolve(target)).toStrictEqual(
        correction('ar-EG', 'second', '/ar-eg/thani'),
      );
    }
    expect(resolve('/EN-US/SECOND?page=2')).toStrictEqual(
      correction('en-US', 'second', '/en-us/second?page=2'),
    );
  });

  it('is refused where the policy names a locale it gave no prefix', () => {
    // A table written by hand can read a prefix as a locale it cannot write an address for. The
    // answer is a configuration error and not an address without a prefix, which would be read as
    // the default locale's.
    const policy: PathPrefixLocalePolicy = {
      ...PREFIXED,
      prefixes: { ...PREFIXED.prefixes, 'fr-fr': 'fr-FR' },
    };
    let thrown: unknown;
    try {
      resolve('/fr-fr/second', policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LocalizationError);
    expect((thrown as LocalizationError).diagnostic.code).toBe(
      'invalid-configuration',
    );
  });
});

describe('an address with no locale prefix', () => {
  it('is sent to the default locale, never cacheably, where nothing is preferred', () => {
    expect(resolve('/second')).toStrictEqual(
      entry('en-US', 'second', '/en-us/second'),
    );
    expect(resolve('/')).toStrictEqual(entry('en-US', 'home', '/en-us'));
    expect(resolve('/?page=2#top')).toStrictEqual(
      entry('en-US', 'home', '/en-us?page=2#top'),
    );
    expect(resolve('/articles/hello')).toStrictEqual(
      entry('en-US', 'article', '/en-us/articles/hello'),
    );
  });

  it("is sent to the preferred locale, in that locale's spelling", () => {
    expect(resolve('/second', PREFIXED, 'ar-EG')).toStrictEqual(
      entry('ar-EG', 'second', '/ar-eg/thani'),
    );
    expect(resolve('/?page=2', PREFIXED, 'ar-EG')).toStrictEqual(
      entry('ar-EG', 'home', '/ar-eg?page=2'),
    );
    expect(resolve('/second', PREFIXED, 'en-US')).toStrictEqual(
      entry('en-US', 'second', '/en-us/second'),
    );
  });

  it('is sent to the default locale where the preference names nothing served', () => {
    for (const preference of ['fr-FR', 'not a locale', '']) {
      expect(resolve('/second', PREFIXED, preference)).toStrictEqual(
        entry('en-US', 'second', '/en-us/second'),
      );
    }
  });

  it('is sent to the default locale where the preferred one cannot spell the page', () => {
    expect(resolve('/articles/english-only', PREFIXED, 'ar-EG')).toStrictEqual(
      entry('en-US', 'article', '/en-us/articles/english-only'),
    );
    // The control: a slug Arabic does spell goes where the preference points.
    expect(resolve('/articles/hello', PREFIXED, 'ar-EG')).toStrictEqual(
      entry('ar-EG', 'article', '/ar-eg/articles/hello'),
    );
  });

  it('is read as having none, even where a prefix or an alias is spelled `undefined`', () => {
    // A table keyed by text answers for the text `undefined` when it is asked about a segment that
    // is not there, and that is a spelling a policy accepts.
    const prefixed = createPathPrefixLocalePolicy({
      defaultLocale: 'en-US',
      locales: { 'en-US': 'en-us', 'ar-EG': 'undefined' },
    });
    expect(resolve('/', prefixed)).toStrictEqual(
      entry('en-US', 'home', '/en-us'),
    );
    expect(resolve('/undefined', prefixed)).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
    });

    const aliased = createPathPrefixLocalePolicy({
      defaultLocale: 'en-US',
      locales: LOCALES,
      aliases: { undefined: 'ar-EG' },
    });
    expect(resolve('/', aliased)).toStrictEqual(
      entry('en-US', 'home', '/en-us'),
    );
    expect(resolve('/second', aliased)).toStrictEqual(
      entry('en-US', 'second', '/en-us/second'),
    );
    expect(resolve('/undefined/thani', aliased)).toStrictEqual(
      correction('ar-EG', 'second', '/ar-eg/thani'),
    );
  });
});

describe('the default locale written without its prefix', () => {
  it('resolves an unprefixed address in the default locale', () => {
    expect(resolve('/second', UNPREFIXED_DEFAULT)).toStrictEqual({
      status: 'success',
      locale: 'en-US',
      direction: 'ltr',
      routeId: 'second',
      parameters: {},
      canonicalPath: '/second',
      query: [],
      indexing: 'indexable',
    });
    expect(resolve('/', UNPREFIXED_DEFAULT)).toMatchObject({
      status: 'success',
      routeId: 'home',
      canonicalPath: '/',
    });
  });

  it('carries the fragment, the indexing class and the caching class the route declares', () => {
    expect(resolve('/account?tab=1#top', UNPREFIXED_DEFAULT)).toStrictEqual({
      status: 'success',
      locale: 'en-US',
      direction: 'ltr',
      routeId: 'account',
      parameters: {},
      canonicalPath: '/account',
      query: [{ name: 'tab', value: '1' }],
      fragment: 'top',
      indexing: 'private',
      caching: 'per-visitor',
    });
  });

  it('ignores a preference, because the address already states the default locale', () => {
    expect(resolve('/second', UNPREFIXED_DEFAULT, 'ar-EG')).toMatchObject({
      status: 'success',
      locale: 'en-US',
    });
  });

  it('corrects a spelling that is not canonical in one permanent hop', () => {
    for (const target of ['/second/', '/SECOND', '/%73econd']) {
      expect(resolve(target, UNPREFIXED_DEFAULT)).toStrictEqual(
        correction('en-US', 'second', '/second'),
      );
    }
  });

  it("corrects the default locale's own prefix away", () => {
    expect(resolve('/en-us/second', UNPREFIXED_DEFAULT)).toStrictEqual(
      correction('en-US', 'second', '/second'),
    );
    expect(resolve('/en-us', UNPREFIXED_DEFAULT)).toStrictEqual(
      correction('en-US', 'home', '/'),
    );
  });

  it('keeps the prefix of every other locale', () => {
    expect(resolve('/ar-eg/thani', UNPREFIXED_DEFAULT)).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
      canonicalPath: '/ar-eg/thani',
    });
    expect(resolve('/ar-eg', UNPREFIXED_DEFAULT)).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
      canonicalPath: '/ar-eg',
    });
  });
});

describe('a projection changed after it was checked', () => {
  it('matches no address at a route whose codec is gone', () => {
    // A projection is checked once and kept, so one changed afterwards is met where it is read.
    for (const emptied of [undefined, {}, { article: {} }]) {
      const projection: {
        -readonly [
          Key in keyof RouteRuntimeProjection
        ]: RouteRuntimeProjection[Key];
      } = { ...PROJECTION };
      const asked = () =>
        resolveLocalizedRoute('/en-us/articles/hello', PREFIXED, projection);
      expect(asked()).toMatchObject({ status: 'success', routeId: 'article' });
      if (emptied === undefined) delete projection.parameters;
      else projection.parameters = emptied;
      expect(asked()).toStrictEqual({
        status: 'not-found',
        httpStatus: 404,
        presentationLocale: 'en-US',
        requestedLocale: 'en-US',
      });
    }
  });
});
