import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  validateRouteProjection,
  type RouteHistoricalOutcome,
  type RouteParameterCodec,
  type RouteParameterContext,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What a projection's `historical` table is refused for.
 *
 * The table says what became of an address that is no longer served: it moved to a route, or it is
 * gone. A resolver answers from it with a permanent redirect or a 410, so an entry it cannot answer
 * from is refused when the projection is first read, and not on the request that reaches it.
 *
 * One case per condition, because an entry that breaks two of them is refused by whichever is read
 * first and says nothing about the other.
 */

const SLUG: RouteParameterCodec<string> = Object.freeze({
  parse: (value: string) => Object.freeze({ ok: true as const, value }),
  serialize: (value: string) => value,
});

/** Spells a value only where it is told the locale, as a codec with per-locale spellings does. */
const SPELLED_PER_LOCALE: RouteParameterCodec<string> = Object.freeze({
  parse: (value: string) => Object.freeze({ ok: true as const, value }),
  serialize: (value: string, context?: RouteParameterContext) =>
    context?.locale === undefined ? undefined : value,
});

type Historical = Readonly<Record<string, RouteHistoricalOutcome>>;

const projection = (
  historical: Historical,
  slug: RouteParameterCodec<string> = SLUG,
): RouteRuntimeProjection => ({
  generated: {
    profile: 'equator-route-projection/1',
    identity: `sha256-${'RetiredRouteDeclarationsIdentity'.padEnd(43, '0')}`,
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  parameters: { article: { slug } },
  historical,
});

/**
 * The code a projection is refused with, or `undefined` where it is accepted.
 *
 * Anything thrown that is not a refusal is thrown again, so a table that makes the check itself
 * fail is not counted as a table it refused.
 */
const refusal = (
  historical: Historical,
  slug?: RouteParameterCodec<string>,
): string | undefined => {
  try {
    validateRouteProjection(projection(historical, slug));
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic.code;
    throw error;
  }
};

const GONE: RouteHistoricalOutcome = { kind: 'gone' };

const retired = (count: number): Historical =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`retired-${index}`, GONE]),
  );

describe('the address a retired route was served at', () => {
  it('is accepted in the spelling a generated path has', () => {
    expect(
      refusal({
        old: GONE,
        a: GONE,
        'old-page': GONE,
        'old/page': GONE,
        'archive/2019/old-page': GONE,
        [`a${'b'.repeat(126)}c`]: GONE,
      }),
    ).toBeUndefined();
  });

  it('is refused where a live route is still served there', () => {
    expect(refusal({ second: GONE })).toBe('invalid-configuration');
    // The root is a live route here as well, and it is also not a path with a segment in it.
    expect(refusal({ '': GONE })).toBe('invalid-configuration');
  });

  it('is refused where it is not a plain relative path', () => {
    for (const path of ['/old', 'old/', 'old//page']) {
      expect(refusal({ [path]: GONE }), path).toBe('invalid-configuration');
    }
  });

  it('is refused where any one segment is outside the generated spelling', () => {
    for (const path of [
      'Old',
      'olD',
      'oLd',
      '-old',
      'old-',
      'old page',
      'old_page',
      // One segment is right and the other is not, on each side.
      'old/Page',
      'Page/old',
      `a${'b'.repeat(127)}c`,
    ]) {
      expect(refusal({ [path]: GONE }), path).toBe('invalid-configuration');
    }
  });

  it('is refused past 256 entries, and accepted at 256', () => {
    expect(refusal(retired(256))).toBeUndefined();
    expect(refusal(retired(257))).toBe('invalid-configuration');
  });
});

describe('the route a retired address is replaced by', () => {
  it('is accepted where the projection has it', () => {
    expect(
      refusal({ old: { kind: 'replacement', routeId: 'second' } }),
    ).toBeUndefined();
  });

  it('is refused where the projection has no route of that identity', () => {
    expect(refusal({ old: { kind: 'replacement', routeId: 'third' } })).toBe(
      'invalid-configuration',
    );
  });

  it('is accepted with a value for every parameter the route takes', () => {
    expect(
      refusal({
        old: {
          kind: 'replacement',
          routeId: 'article',
          parameters: { slug: 'hello' },
        },
      }),
    ).toBeUndefined();
  });

  it('is refused without a value for a parameter the route takes', () => {
    expect(refusal({ old: { kind: 'replacement', routeId: 'article' } })).toBe(
      'invalid-configuration',
    );
    expect(
      refusal({
        old: {
          kind: 'replacement',
          routeId: 'article',
          parameters: { page: 'hello' },
        },
      }),
    ).toBe('invalid-configuration');
  });

  it('is refused where the value is spelled as something a segment cannot hold', () => {
    for (const slug of ['a/b', '..', '', 'x'.repeat(1025)]) {
      expect(
        refusal({
          old: {
            kind: 'replacement',
            routeId: 'article',
            parameters: { slug },
          },
        }),
        slug.slice(0, 8),
      ).toBe('invalid-configuration');
    }
  });

  it('is accepted where the codec spells the value only once it knows the locale', () => {
    // The table is read before any request, so no locale is known yet. The redirect is built for
    // the locale of the request that reaches it, and the spelling is judged there.
    expect(
      refusal(
        {
          old: {
            kind: 'replacement',
            routeId: 'article',
            parameters: { slug: 'hello' },
          },
        },
        SPELLED_PER_LOCALE,
      ),
    ).toBeUndefined();
  });
});
