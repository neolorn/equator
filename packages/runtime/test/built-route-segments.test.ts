import { describe, expect, it } from 'vitest';

import {
  buildLocalizedRoute,
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
 * The segments an address is built from, one route in one locale.
 *
 * A static segment is written as the locale declares it. A parameter is written by its codec, or
 * by a spelling declared for that locale, and what is written has to be a segment the resolver
 * reads back: `buildLocalizedRoute` refuses to hand out an address it could not resolve.
 */

const IDENTITY = 'sha256-BuiltRouteSegmentsTestIdentity0123456789abc';

const PREFIXED = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'de-DE': 'de-de' },
});

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

/** Reads any segment as itself and writes any value as text, so each case bends one half. */
const TEXT: RouteParameterCodec = {
  parse: (value: string) => ({ ok: true, value }),
  serialize: (value: unknown) => String(value),
};

const projectionWith = (slug: RouteParameterCodec): RouteRuntimeProjection => ({
  generated: {
    profile: 'equator-route-projection/1',
    identity: IDENTITY,
    routes: [
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  parameters: { article: { slug } },
});

describe('the static segments of a built address', () => {
  const projection: RouteRuntimeProjection = {
    generated: {
      profile: 'equator-route-projection/1',
      identity: IDENTITY,
      routes: [
        { id: 'home', path: '', parameterNames: [] },
        { id: 'about', path: 'about', parameterNames: [] },
        { id: 'team', path: 'team', parameterNames: [] },
        { id: 'press', path: 'press', parameterNames: [] },
        { id: 'legal', path: 'legal/terms', parameterNames: [] },
      ],
    },
    localizedPaths: {
      about: { 'de-DE': 'ÜBER' },
      team: { 'de-DE': 'Team' },
      press: { 'de-DE': 'presseSTELLE' },
      legal: { 'de-DE': 'Recht/agb' },
    },
  };

  it('are none for the root route', () => {
    expect(buildLocalizedRoute(PREFIXED, projection, 'home', 'ar-EG')).toBe(
      '/ar-eg',
    );
    expect(
      buildLocalizedRoute(
        createLocaleNeutralPolicy({
          defaultLocale: 'en-US',
          locales: ['en-US', 'ar-EG'],
        }),
        projection,
        'home',
        'ar-EG',
      ),
    ).toBe('/');
    expect(
      buildLocalizedRoute(
        createHostLocalePolicy({
          defaultLocale: 'en-US',
          origins: {
            'en-US': 'https://example.com',
            'ar-EG': 'https://example.eg',
          },
        }),
        projection,
        'home',
        'ar-EG',
      ),
    ).toBe('https://example.eg/');
  });

  it('keep the case a locale declared them in', () => {
    // Matching compares a declared spelling that has a capital as written, so an address built in
    // any other case is one the resolver does not read.
    const built = {
      about: `/de-de/${encodeURIComponent('ÜBER')}`,
      team: '/de-de/Team',
      press: '/de-de/presseSTELLE',
      legal: '/de-de/Recht/agb',
    } as const;
    for (const [routeId, address] of Object.entries(built)) {
      expect(
        buildLocalizedRoute(PREFIXED, projection, routeId, 'de-DE'),
        routeId,
      ).toBe(address);
      expect(
        resolveLocalizedRoute(address, PREFIXED, projection),
      ).toMatchObject({ status: 'success', locale: 'de-DE', routeId });
    }
  });
});

describe('a parameter of a built address', () => {
  it('is required, whatever the codec would write for nothing', () => {
    const lenient: RouteParameterCodec = {
      parse: (value: string) => ({ ok: true, value }),
      serialize: (value: unknown) =>
        value === undefined ? 'untitled' : String(value),
    };
    const projection = projectionWith(lenient);
    expect(
      buildLocalizedRoute(PREFIXED, projection, 'article', 'en-US', {
        slug: 'handbook',
      }),
    ).toBe('/en-us/articles/handbook');
    expect(
      codeOf(() =>
        buildLocalizedRoute(PREFIXED, projection, 'article', 'en-US'),
      ),
    ).toBe('invalid-configuration');
    expect(
      codeOf(() =>
        buildLocalizedRoute(PREFIXED, projection, 'article', 'en-US', {
          other: 'handbook',
        }),
      ),
    ).toBe('invalid-configuration');
  });

  it('is refused as a configuration mistake where its codec is no longer there', () => {
    // A projection is checked once and kept, so one changed afterwards is met here first.
    for (const emptied of [undefined, {}]) {
      const projection: {
        -readonly [
          Key in keyof RouteRuntimeProjection
        ]: RouteRuntimeProjection[Key];
      } = projectionWith(TEXT);
      expect(
        buildLocalizedRoute(PREFIXED, projection, 'article', 'en-US', {
          slug: 'handbook',
        }),
      ).toBe('/en-us/articles/handbook');
      if (emptied === undefined) delete projection.parameters;
      else projection.parameters = emptied;
      expect(
        codeOf(() =>
          buildLocalizedRoute(PREFIXED, projection, 'article', 'en-US', {
            slug: 'handbook',
          }),
        ),
      ).toBe('invalid-configuration');
    }
  });

  it('is reported as missing where its codec is gone, and not as a codec that threw', () => {
    const projection: {
      -readonly [
        Key in keyof RouteRuntimeProjection
      ]: RouteRuntimeProjection[Key];
    } = projectionWith(TEXT);
    buildLocalizedRoute(PREFIXED, projection, 'article', 'en-US', {
      slug: 'handbook',
    });
    projection.parameters = { article: {} };
    let refused: unknown;
    try {
      buildLocalizedRoute(PREFIXED, projection, 'article', 'en-US', {
        slug: 'handbook',
      });
    } catch (error) {
      refused = error;
    }
    expect((refused as LocalizationError).diagnostic).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: 'Route article requires parameter slug.',
    });
  });

  it('is unavailable in a locale its codec writes nothing for', () => {
    const englishOnly: RouteParameterCodec = {
      parse: (value: string) => ({ ok: true, value }),
      serialize: (value: unknown, context?: RouteParameterContext) =>
        context?.locale === 'en-US' ? String(value) : undefined,
    };
    const projection = projectionWith(englishOnly);
    expect(
      buildLocalizedRoute(PREFIXED, projection, 'article', 'en-US', {
        slug: 'handbook',
      }),
    ).toBe('/en-us/articles/handbook');
    expect(
      codeOf(() =>
        buildLocalizedRoute(PREFIXED, projection, 'article', 'ar-EG', {
          slug: 'handbook',
        }),
      ),
    ).toBe('route-unavailable');
  });

  it('is refused where its codec writes more than one segment, though the codec reads it back', () => {
    const projection = projectionWith(TEXT);
    expect(
      buildLocalizedRoute(PREFIXED, projection, 'article', 'en-US', {
        slug: 'a-b',
      }),
    ).toBe('/en-us/articles/a-b');
    for (const slug of ['a/b', '..', '']) {
      expect(
        codeOf(() =>
          buildLocalizedRoute(PREFIXED, projection, 'article', 'en-US', {
            slug,
          }),
        ),
        slug,
      ).toBe('invalid-configuration');
    }
  });

  it('is refused where its codec reads what it wrote as nothing', () => {
    // The spelling is the same on the way back, and no value came with it.
    const valueless: RouteParameterCodec = {
      parse: () => ({ ok: true, value: undefined }),
      serialize: () => 'handbook',
    };
    expect(
      codeOf(() =>
        buildLocalizedRoute(
          PREFIXED,
          projectionWith(valueless),
          'article',
          'en-US',
          { slug: 'handbook' },
        ),
      ),
    ).toBe('invalid-configuration');
  });

  it('is refused where its codec does not read what it wrote', () => {
    const unread: RouteParameterCodec = {
      parse: () => ({ ok: false }),
      serialize: (value: unknown) => String(value),
    };
    expect(
      codeOf(() =>
        buildLocalizedRoute(
          PREFIXED,
          projectionWith(unread),
          'article',
          'en-US',
          { slug: 'handbook' },
        ),
      ),
    ).toBe('invalid-configuration');
  });
});

describe('a spelling declared for one parameter of several', () => {
  const projection: RouteRuntimeProjection = {
    generated: {
      profile: 'equator-route-projection/1',
      identity: IDENTITY,
      routes: [
        {
          id: 'entry',
          path: 'sections/:section/:slug',
          parameterNames: ['section', 'slug'],
        },
      ],
    },
    parameters: { entry: { section: TEXT, slug: TEXT } },
  };

  it('replaces that parameter and leaves the others to their codecs', () => {
    expect(
      buildLocalizedRoute(
        PREFIXED,
        projection,
        'entry',
        'ar-EG',
        { section: 'news', slug: 'handbook' },
        [],
        undefined,
        { section: { 'ar-EG': 'akhbar' } },
      ),
    ).toBe('/ar-eg/sections/akhbar/handbook');
  });

  it('replaces nothing in a locale it was not declared for', () => {
    expect(
      buildLocalizedRoute(
        PREFIXED,
        projection,
        'entry',
        'en-US',
        { section: 'news', slug: 'handbook' },
        [],
        undefined,
        { section: { 'ar-EG': 'akhbar' } },
      ),
    ).toBe('/en-us/sections/news/handbook');
  });
});
