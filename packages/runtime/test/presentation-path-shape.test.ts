import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  validateRouteProjection,
  type GeneratedRouteProjectionEntry,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The shape a route's path is held to, segment by segment, in the table and in a locale's spelling.
 *
 * A generated path is lower-case ASCII segments and parameter names. A localized spelling may be
 * written in any script, and is held to one normal form and to the same length in code units.
 * `routing-refusals.test.ts` holds the refusals of a whole path; the cases here are about one
 * segment among several, the two ends of a segment, and the bound at each side.
 *
 * Every projection is built inside its case and differs from the accepted one in one place.
 */

const IDENTITY = 'sha256-PresentationPathShapeTestIdentity0123456789';

const SLUG: RouteParameterCodec<string> = {
  parse: (value: string) => ({ ok: true, value }),
  serialize: (value: string) => value,
};

interface Changes {
  readonly identity?: string;
  readonly second?: string;
  readonly article?: {
    readonly path: string;
    readonly parameterNames: readonly string[];
  };
  readonly localizedSecond?: string;
}

const projectionWith = (changes: Changes = {}): RouteRuntimeProjection => {
  const article = changes.article ?? {
    path: 'articles/:slug',
    parameterNames: ['slug'],
  };
  const routes: readonly GeneratedRouteProjectionEntry[] = [
    { id: 'home', path: '', parameterNames: [] },
    { id: 'second', path: changes.second ?? 'second', parameterNames: [] },
    { id: 'article', ...article },
  ];
  return {
    generated: {
      profile: 'equator-route-projection/1',
      identity: changes.identity ?? IDENTITY,
      routes,
    },
    parameters: {
      article: Object.fromEntries(
        article.parameterNames.map((name) => [name, SLUG]),
      ),
    },
    ...(changes.localizedSecond === undefined
      ? {}
      : { localizedPaths: { second: { 'ar-EG': changes.localizedSecond } } }),
  };
};

/** The diagnostic code a projection is refused with, or `undefined` when it is accepted. */
const refusedAs = (changes: Changes = {}): string | undefined => {
  try {
    validateRouteProjection(projectionWith(changes));
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic.code;
    throw error;
  }
};

describe('the path a generated route is written with', () => {
  it('is accepted as the table every case below changes, the empty path included', () => {
    expect(refusedAs()).toBeUndefined();
  });

  it('may be a single character, and two', () => {
    expect(refusedAs({ second: 'a' })).toBeUndefined();
    expect(refusedAs({ second: 'ab' })).toBeUndefined();
    expect(refusedAs({ second: 'a/b' })).toBeUndefined();
  });

  it('is refused for one unsafe segment among safe ones', () => {
    for (const second of ['second/Upper', 'Upper/second', 'a/b_c/d']) {
      expect(refusedAs({ second }), second).toBe('invalid-configuration');
    }
  });

  it('holds a parameter name to its whole segment', () => {
    // The control: a name with a digit and an underscore after its first letter.
    expect(
      refusedAs({
        article: { path: 'articles/:slug_2', parameterNames: ['slug_2'] },
      }),
    ).toBeUndefined();
    // Each declares the name its path spells and has a codec under it, so the path alone is what
    // is refused: a name is a letter and then letters, digits and underscores, from the colon to
    // the end of the segment.
    for (const name of [':slug', 'slug!', 'slug.id']) {
      expect(
        refusedAs({
          article: { path: `articles/:${name}`, parameterNames: [name] },
        }),
        name,
      ).toBe('invalid-configuration');
    }
  });
});

describe('the identity a generated projection carries', () => {
  it('is the hash and nothing before it', () => {
    expect(refusedAs({ identity: `x${IDENTITY}` })).toBe(
      'invalid-configuration',
    );
    expect(refusedAs({ identity: ` ${IDENTITY}` })).toBe(
      'invalid-configuration',
    );
  });
});

describe("the path a locale's own spelling is written with", () => {
  it('may be written in the script of the locale', () => {
    expect(refusedAs({ localizedSecond: 'ثانية' })).toBeUndefined();
    expect(refusedAs({ localizedSecond: 'الصفحة-الثانية' })).toBeUndefined();
  });

  it('is refused for a segment that holds anything but letters, digits, marks and hyphens', () => {
    expect(refusedAs({ localizedSecond: 'الصفحة الثانية' })).toBe(
      'invalid-configuration',
    );
    expect(refusedAs({ localizedSecond: 'ثانية/a_b' })).toBe(
      'invalid-configuration',
    );
  });

  it('is refused for a segment that starts or ends with a hyphen', () => {
    expect(refusedAs({ localizedSecond: '-ثانية' })).toBe(
      'invalid-configuration',
    );
    expect(refusedAs({ localizedSecond: 'ثانية-' })).toBe(
      'invalid-configuration',
    );
  });

  it('is refused for a segment that is not in normal form C', () => {
    // The same word twice: a letter with a combining acute, then the one character normal form C
    // writes it as. Both are letters and marks, so the form is all that differs.
    expect(refusedAs({ localizedSecond: 'café' })).toBe(
      'invalid-configuration',
    );
    expect(refusedAs({ localizedSecond: 'café' })).toBeUndefined();
  });

  it('bounds a segment at 128 code units, however many characters that is', () => {
    expect(refusedAs({ localizedSecond: 'a'.repeat(128) })).toBeUndefined();
    expect(refusedAs({ localizedSecond: 'a'.repeat(129) })).toBe(
      'invalid-configuration',
    );
    // A Deseret letter is one character and two code units, so sixty-four of them reach the bound
    // and sixty-five pass it while still being far fewer than 128 characters.
    const letter = '\u{10437}';
    expect(refusedAs({ localizedSecond: letter.repeat(64) })).toBeUndefined();
    expect(refusedAs({ localizedSecond: letter.repeat(65) })).toBe(
      'invalid-configuration',
    );
  });
});
