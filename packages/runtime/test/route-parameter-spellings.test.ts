import { describe, expect, it } from 'vitest';

import {
  createIdentifierParameterCodec,
  createIntegerParameterCodec,
  createPathPrefixLocalePolicy,
  LocalizationError,
  resolveLocalizedRoute,
  validateRouteProjection,
  type RouteParameterCodec,
  type RouteParameterContext,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What a codec is asked, what it answers, and which of its spellings an address may carry.
 *
 * A codec writes the segment an address is published with, so what it writes is held to the same
 * rule as a segment that arrives: one segment, in one normal form, that reads as what it is.
 * Everything here is built inside its case, so a codec or a projection that could not be built
 * fails the case that needed it.
 */

const IDENTITY = 'sha256-ParameterSpellingsTestIdentity0123456789abc';

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

const projectionWith = (
  slug: RouteParameterCodec,
  historical?: RouteRuntimeProjection['historical'],
): RouteRuntimeProjection => ({
  generated: {
    profile: 'equator-route-projection/1',
    identity: IDENTITY,
    routes: [
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  parameters: { article: { slug } },
  ...(historical === undefined ? {} : { historical }),
});

const policy = () =>
  createPathPrefixLocalePolicy({
    defaultLocale: 'en-US',
    locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  });

describe('an identifier route parameter codec', () => {
  it('writes what it would read, and writes nothing for what it would not', () => {
    const codec = createIdentifierParameterCodec();
    expect(codec.serialize('handbook-2')).toBe('handbook-2');
    expect(codec.serialize('has space')).toBeUndefined();
    expect(codec.serialize('')).toBeUndefined();
  });

  it('refuses a pattern that remembers where its last match ended', () => {
    // A global or a sticky pattern carries `lastIndex` between calls, so the same segment would
    // match on one request and not on the next.
    expect(codeOf(() => createIdentifierParameterCodec(/^[a-z]+$/gu))).toBe(
      'invalid-configuration',
    );
    expect(codeOf(() => createIdentifierParameterCodec(/^[a-z]+$/uy))).toBe(
      'invalid-configuration',
    );
    const narrowed = createIdentifierParameterCodec(/^[a-z]+$/u);
    expect(narrowed.parse('handbook')).toStrictEqual({
      ok: true,
      value: 'handbook',
    });
    expect(narrowed.parse('handbook-2')).toStrictEqual({ ok: false });
  });
});

describe('what an integer route parameter codec answers', () => {
  it('answers a number in range with the number, and anything else with a refusal alone', () => {
    const codec = createIntegerParameterCodec(1, 10);
    expect(codec.parse('7')).toStrictEqual({ ok: true, value: 7 });
    // Not a number at all, and a number outside the range: the same answer, carrying no value.
    expect(codec.parse('seven')).toStrictEqual({ ok: false });
    expect(codec.parse('11')).toStrictEqual({ ok: false });
    expect(codec.parse('0')).toStrictEqual({ ok: false });
  });

  it('writes a number in range and writes nothing for one outside it', () => {
    const codec = createIntegerParameterCodec(1, 10);
    expect(codec.serialize(1)).toBe('1');
    expect(codec.serialize(10)).toBe('10');
    expect(codec.serialize(0)).toBeUndefined();
    expect(codec.serialize(11)).toBeUndefined();
    expect(codec.serialize(2.5)).toBeUndefined();
  });

  it('is built from any ordered pair of safe integers, and from none', () => {
    expect(createIntegerParameterCodec(-5, 5).parse('-5')).toStrictEqual({
      ok: true,
      value: -5,
    });
    expect(createIntegerParameterCodec().serialize(42)).toBe('42');
  });
});

describe('the spelling a codec writes for a segment', () => {
  /** How an address resolves when the codec reads any segment and writes `written` for it. */
  const resolvedWhenWriting = (written: unknown) =>
    resolveLocalizedRoute(
      '/en-us/articles/asked',
      policy(),
      projectionWith({
        parse: () => ({ ok: true, value: 'entity' }),
        serialize: () => written as string,
      }),
    ).status;

  it('is the address where it is what was asked, and corrects the address where it is not', () => {
    expect(resolvedWhenWriting('asked')).toBe('success');
    expect(resolvedWhenWriting('canonical')).toBe('redirect');
  });

  it('may be as long as 1024 code units and no longer', () => {
    expect(resolvedWhenWriting('x'.repeat(1024))).toBe('redirect');
    expect(resolvedWhenWriting('x'.repeat(1025))).toBe('not-found');
  });

  it('is refused where it is empty', () => {
    expect(resolvedWhenWriting('')).toBe('not-found');
  });

  it('is refused where it is not in normal form C', () => {
    // The letter and a combining acute, which normal form C writes as one character.
    expect(resolvedWhenWriting('café')).toBe('not-found');
    expect(resolvedWhenWriting('café')).toBe('redirect');
  });

  it('is refused where it names this directory or the one above', () => {
    expect(resolvedWhenWriting('.')).toBe('not-found');
    expect(resolvedWhenWriting('..')).toBe('not-found');
    // A dot is otherwise text.
    expect(resolvedWhenWriting('...')).toBe('redirect');
    expect(resolvedWhenWriting('v1.2')).toBe('redirect');
  });

  it('is refused where it holds a separator', () => {
    for (const written of ['/', '\\', 'a/b', 'a\\b']) {
      expect(resolvedWhenWriting(written), written).toBe('not-found');
    }
  });

  it('is refused where it holds a control or an invisible mark', () => {
    for (const written of ['a\u0000b', 'a​b', 'a‮b', '﻿']) {
      expect(resolvedWhenWriting(written), JSON.stringify(written)).toBe(
        'not-found',
      );
    }
  });

  it('is refused where it is not text', () => {
    // A codec is typed to write a string, and one written without the types can write anything.
    for (const written of [7, ['asked'], { length: 5 }, true, null]) {
      expect(resolvedWhenWriting(written), JSON.stringify(written)).toBe(
        'not-found',
      );
    }
  });
});

describe('what a codec is told about the parameter it is asked for', () => {
  it('is told the locale of the address it is reading', () => {
    const asked: (RouteParameterContext | undefined)[] = [];
    resolveLocalizedRoute(
      '/ar-eg/articles/asked',
      policy(),
      projectionWith({
        parse: (value: string, context?: RouteParameterContext) => {
          asked.push(context);
          return { ok: true, value };
        },
        serialize: (value: unknown) => value as string,
      }),
    );
    expect(asked).toStrictEqual([
      { routeId: 'article', parameterName: 'slug', locale: 'ar-EG' },
    ]);
  });

  it('is told no locale for a retired address, which is checked before any request', () => {
    const asked: (RouteParameterContext | undefined)[] = [];
    validateRouteProjection(
      projectionWith(
        {
          parse: (value: string) => ({ ok: true, value }),
          serialize: (value: unknown, context?: RouteParameterContext) => {
            asked.push(context);
            return value as string;
          },
        },
        {
          legacy: {
            kind: 'replacement',
            routeId: 'article',
            parameters: { slug: 'handbook' },
          },
        },
      ),
    );
    // Strict, so a `locale` field holding nothing is told apart from no `locale` field.
    expect(asked).toStrictEqual([
      { routeId: 'article', parameterName: 'slug' },
    ]);
  });
});
