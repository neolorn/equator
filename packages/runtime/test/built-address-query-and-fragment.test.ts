import { describe, expect, it } from 'vitest';

import {
  buildLocalizedRoute,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  LocalizationError,
  type RouteQueryValue,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What follows the path in an address `buildLocalizedRoute` writes, and the locale it writes it in.
 *
 * The query and the fragment are carried as they were given, each encoded, within the bounds the
 * resolver reads an address under: an address written past them is one it would refuse to read.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-BuiltAddressQueryAndFragmentTestIdentity012',
    routes: [{ id: 'second', path: 'second', parameterNames: [] }],
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

const entries = (count: number): readonly RouteQueryValue[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `n${index}`,
    value: 'v',
  }));

const build = (query?: readonly RouteQueryValue[], fragment?: string): string =>
  buildLocalizedRoute(
    PREFIXED,
    PROJECTION,
    'second',
    'en-US',
    {},
    query,
    fragment,
  );

describe('the query of a built address', () => {
  it('is written in the order given, one entry after another', () => {
    expect(
      build([
        { name: 'page', value: '2' },
        { name: 'sort', value: 'new est' },
      ]),
    ).toBe('/en-us/second?page=2&sort=new%20est');
  });

  it('is followed by the fragment', () => {
    expect(build([{ name: 'page', value: '2' }], 'top of page')).toBe(
      '/en-us/second?page=2#top%20of%20page',
    );
    expect(build(undefined, 'top')).toBe('/en-us/second#top');
  });

  it('holds thirty-two entries and is refused at thirty-three', () => {
    expect(build(entries(32)).split('&')).toHaveLength(32);
    expect(codeOf(() => build(entries(33)))).toBe('invalid-configuration');
  });
});

describe('the fragment of a built address', () => {
  it('holds 512 characters and is refused at 513', () => {
    expect(build(undefined, 'f'.repeat(512))).toBe(
      `/en-us/second#${'f'.repeat(512)}`,
    );
    expect(codeOf(() => build(undefined, 'f'.repeat(513)))).toBe(
      'invalid-configuration',
    );
  });
});

describe('the locale an address is asked for in', () => {
  it('is refused where the policy does not serve it, whatever the policy puts in the path', () => {
    // A locale-neutral address carries nothing of the locale, so only this refusal stands between
    // a locale the application does not have and an address handed out for it.
    expect(
      codeOf(() => buildLocalizedRoute(NEUTRAL, PROJECTION, 'second', 'fr-FR')),
    ).toBe('invalid-configuration');
    expect(buildLocalizedRoute(NEUTRAL, PROJECTION, 'second', 'ar-EG')).toBe(
      '/second',
    );
  });
});
