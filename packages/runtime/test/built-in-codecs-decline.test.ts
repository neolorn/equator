import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  buildLocalizedRoute,
  createIdentifierParameterCodec,
  createIntegerParameterCodec,
  createPathPrefixLocalePolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The codecs Equator ships, asked to write a value they refuse.
 *
 * Section 2 of `specs/07-routing-rendering-and-seo.spec.md`: declining is an answer and a throw is
 * not, and a codec that throws is a defect in the consumer application. A codec declines a value by
 * writing nothing. The two built-in codecs are held to the contract stated for every codec, so a
 * value one refuses is a parameter with no spelling, and the address built from it is refused as a
 * route with no address there and never as the application's code throwing.
 */

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-BuiltInCodecsDeclineTestIdentity01234567890',
    routes: [
      { id: 'topic', path: 'topics/:topic', parameterNames: ['topic'] },
      { id: 'page', path: 'pages/:page', parameterNames: ['page'] },
    ],
  },
  parameters: {
    topic: { topic: createIdentifierParameterCodec() },
    page: { page: createIntegerParameterCodec(1, 500) },
  },
};

/** The diagnostic a call refuses with, or `undefined` when it did not refuse. */
const refusal = (call: () => unknown) => {
  try {
    call();
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic;
    throw error;
  }
};

describe('createIdentifierParameterCodec', () => {
  it('writes nothing for a value its pattern refuses', () => {
    const codec = createIdentifierParameterCodec();
    for (const value of ['../etc', '', 'a/b', '-leading', 'a'.repeat(129)]) {
      expect(codec.serialize(value), JSON.stringify(value)).toBeUndefined();
    }
    expect(
      createIdentifierParameterCodec(/^[a-z]+$/u).serialize('Upper'),
    ).toBeUndefined();
  });

  it('writes a value its pattern takes as it is', () => {
    expect(createIdentifierParameterCodec().serialize('typed-urls')).toBe(
      'typed-urls',
    );
  });
});

describe('createIntegerParameterCodec', () => {
  it('writes nothing for a value outside its range or not a whole number', () => {
    const codec = createIntegerParameterCodec(1, 500);
    for (const value of [0, 501, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codec.serialize(value), String(value)).toBeUndefined();
    }
    expect(
      createIntegerParameterCodec().serialize(Number.MAX_SAFE_INTEGER + 1),
    ).toBeUndefined();
  });

  it('writes a value in its range as digits', () => {
    expect(createIntegerParameterCodec(1, 500).serialize(42)).toBe('42');
    expect(createIntegerParameterCodec().serialize(-7)).toBe('-7');
  });
});

describe('an address built from a value a built-in codec refuses', () => {
  it.each([
    ['topic', { topic: '../etc' }],
    ['page', { page: 501 }],
  ] as const)(
    'is refused as route %s having no address there, and not as a codec that threw',
    (routeId, parameters) => {
      for (const locale of ['en-US', 'ar-EG']) {
        const diagnostic = refusal(() =>
          buildLocalizedRoute(
            POLICY,
            PROJECTION,
            routeId,
            locale,
            parameters as never,
          ),
        );
        expect(diagnostic).toMatchObject({
          code: 'route-unavailable',
          outcome: 'localized-representation-unavailable',
        });
        expect(diagnostic?.reason).not.toBe('consumer-code-threw');
      }
    },
  );

  it('is built from a value the codec takes', () => {
    expect(
      buildLocalizedRoute(POLICY, PROJECTION, 'topic', 'en-US', {
        topic: 'typed-urls',
      } as never),
    ).toBe('/en-us/topics/typed-urls');
    expect(
      buildLocalizedRoute(POLICY, PROJECTION, 'page', 'ar-EG', {
        page: 42,
      } as never),
    ).toBe('/ar-eg/pages/42');
  });
});
