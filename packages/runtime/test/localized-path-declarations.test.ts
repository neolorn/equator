import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  validateRouteProjection,
  type GeneratedRouteProjectionEntry,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What a projection's `localizedPaths` table is refused for beyond a single entry's spelling.
 *
 * A localized path respells a route's fixed segments for one locale. It keeps the parameters the
 * route takes, by name and in order, and within one locale it leaves every route at an address of
 * its own. Both are read when the projection is first handed over.
 */

const SLUG: RouteParameterCodec<string> = Object.freeze({
  parse: (value: string) => Object.freeze({ ok: true as const, value }),
  serialize: (value: string) => value,
});

const projection = (
  routes: readonly GeneratedRouteProjectionEntry[],
  localizedPaths: NonNullable<RouteRuntimeProjection['localizedPaths']>,
  parameters: NonNullable<RouteRuntimeProjection['parameters']> = {},
): RouteRuntimeProjection => ({
  generated: {
    profile: 'equator-route-projection/1',
    identity: `sha256-${'LocalizedPathDeclarationsIdentity'.padEnd(43, '0')}`,
    routes,
  },
  parameters,
  localizedPaths,
});

/** The code a projection is refused with, or `undefined` where it is accepted. */
const refusal = (value: RouteRuntimeProjection): string | undefined => {
  try {
    validateRouteProjection(value);
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic.code;
    throw error;
  }
};

describe('the parameters a localized path keeps', () => {
  const ONE: readonly GeneratedRouteProjectionEntry[] = [
    { id: 'items', path: 'items/:ab', parameterNames: ['ab'] },
  ];
  const TWO: readonly GeneratedRouteProjectionEntry[] = [
    { id: 'items', path: 'items/:a/:b', parameterNames: ['a', 'b'] },
  ];
  const CODECS = { items: { a: SLUG, b: SLUG, ab: SLUG } };

  it('are the same names in the same order', () => {
    expect(
      refusal(projection(TWO, { items: { 'ar-EG': 'ashya/:a/:b' } }, CODECS)),
    ).toBeUndefined();
    expect(
      refusal(projection(TWO, { items: { 'ar-EG': 'ashya/:b/:a' } }, CODECS)),
    ).toBe('invalid-configuration');
  });

  it('are not one parameter split into two whose names run together to the same text', () => {
    expect(
      refusal(projection(ONE, { items: { 'ar-EG': 'ashya/:a/:b' } }, CODECS)),
    ).toBe('invalid-configuration');
  });

  it('are not two parameters merged into one whose name is the two run together', () => {
    expect(
      refusal(projection(TWO, { items: { 'ar-EG': 'ashya/:ab' } }, CODECS)),
    ).toBe('invalid-configuration');
  });
});

describe('two routes in one locale', () => {
  const ROUTES: readonly GeneratedRouteProjectionEntry[] = [
    { id: 'home', path: '', parameterNames: [] },
    { id: 'second', path: 'second', parameterNames: [] },
    { id: 'third', path: 'third', parameterNames: [] },
  ];

  it('are refused one address, where a localized path takes the path another route kept', () => {
    expect(refusal(projection(ROUTES, { third: { 'ar-EG': 'second' } }))).toBe(
      'invalid-configuration',
    );
  });

  it('are refused one address, where two localized paths are spelled alike', () => {
    expect(
      refusal(
        projection(ROUTES, {
          second: { 'ar-EG': 'thani' },
          third: { 'ar-EG': 'thani' },
        }),
      ),
    ).toBe('invalid-configuration');
  });

  it('may exchange addresses, because each is still served at one', () => {
    expect(
      refusal(
        projection(ROUTES, {
          second: { 'ar-EG': 'third' },
          third: { 'ar-EG': 'second' },
        }),
      ),
    ).toBeUndefined();
  });

  it('may share a spelling across two locales, because the locale tells them apart', () => {
    expect(
      refusal(
        projection(ROUTES, {
          second: { 'ar-EG': 'thani' },
          third: { 'fr-FR': 'thani' },
        }),
      ),
    ).toBeUndefined();
  });
});

describe('the locale a localized path is written for', () => {
  const ROUTES: readonly GeneratedRouteProjectionEntry[] = [
    { id: 'second', path: 'second', parameterNames: [] },
  ];

  it('is a language tag, and a key that is not one is refused', () => {
    for (const key of ['undefined', 'null', 'en_US', 'not a locale']) {
      expect(
        refusal(projection(ROUTES, { second: { [key]: 'thani' } })),
        key,
      ).toBe('invalid-configuration');
    }
  });
});
