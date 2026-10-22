import { describe, expect, it } from 'vitest';

import {
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  LocalizationError,
  localeFromRoute,
  resolveInitialRouteLocale,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What the two readers of a request's address take from the context a platform hands them.
 *
 * The context is whatever the platform supplies: a URL as text, an object carrying `url`, or one
 * carrying a `request` that carries it. `resolveInitialRouteLocale` always answers, with the
 * default where the address says nothing. `localeFromRoute` answers only where the address states
 * a locale, so the next source in a resolution chain is asked where it does not.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-RequestContextLocaleTestIdentity0123456789a',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
      { id: 'account', path: 'account', parameterNames: [] },
    ],
  },
  localizedPaths: { second: { 'ar-EG': 'thani' } },
  historical: {
    removed: { kind: 'gone' },
    legacy: { kind: 'replacement', routeId: 'second' },
  },
};

const PREFIXED = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const HOSTED = createHostLocalePolicy({
  defaultLocale: 'en-US',
  origins: { 'en-US': 'https://example.com', 'ar-EG': 'https://example.eg' },
});

const NEUTRAL = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});

const POLICIES: readonly LocaleUrlPolicy[] = [PREFIXED, HOSTED, NEUTRAL];

const initial = (context: unknown, policy: LocaleUrlPolicy) =>
  resolveInitialRouteLocale(context, policy, PROJECTION);

const stated = (context: unknown, policy: LocaleUrlPolicy) =>
  localeFromRoute(context, policy, PROJECTION);

describe('a context that carries no address', () => {
  const EMPTY: readonly unknown[] = [
    undefined,
    null,
    7,
    true,
    {},
    { url: 7 },
    { url: null },
    { request: {} },
    { request: null },
    { request: { url: 7 } },
    ['/ar-eg/thani'],
  ];

  it('starts in the default locale', () => {
    for (const policy of POLICIES) {
      for (const context of EMPTY) {
        expect(initial(context, policy), JSON.stringify(context)).toBe('en-US');
      }
    }
  });

  it('states no locale', () => {
    for (const policy of POLICIES) {
      for (const context of EMPTY) {
        expect(
          stated(context, policy),
          JSON.stringify(context),
        ).toBeUndefined();
      }
    }
  });
});

describe('where a context carries its address', () => {
  const CARRIERS: readonly unknown[] = [
    '/ar-eg/thani',
    { url: '/ar-eg/thani' },
    { request: { url: '/ar-eg/thani' } },
    // A `url` that is not text is not the address, so the request's own is read.
    { url: 7, request: { url: '/ar-eg/thani' } },
    'https://example.com/ar-eg/thani',
    { url: 'https://example.com/ar-eg/thani' },
  ];

  it('is read as text, from `url`, or from the `url` of `request`', () => {
    for (const context of CARRIERS) {
      const label = JSON.stringify(context);
      expect(initial(context, PREFIXED), label).toBe('ar-EG');
      expect(stated(context, PREFIXED), label).toBe('ar-EG');
    }
  });

  it('prefers the `url` of the context to the one its `request` carries', () => {
    const context = {
      url: '/ar-eg/thani',
      request: { url: '/en-us/second' },
    };
    expect(initial(context, PREFIXED)).toBe('ar-EG');
    expect(stated(context, PREFIXED)).toBe('ar-EG');
  });

  it('answers as for no address where the text is neither a path nor an HTTP address', () => {
    for (const context of ['ar-eg/thani', 'ftp://example.eg/thani', '']) {
      for (const policy of POLICIES) {
        expect(initial(context, policy), context).toBe('en-US');
        expect(stated(context, policy), context).toBeUndefined();
      }
    }
  });
});

describe('the origin a context carries, under a locale-host policy', () => {
  it('names the locale where the address is a path', () => {
    const context = { url: '/thani', origin: 'https://example.eg' };
    expect(initial(context, HOSTED)).toBe('ar-EG');
    expect(stated(context, HOSTED)).toBe('ar-EG');
  });

  it('is that of the default locale where the context carries none', () => {
    expect(initial({ url: '/second' }, HOSTED)).toBe('en-US');
    expect(stated({ url: '/second' }, HOSTED)).toBe('en-US');
    expect(initial('/second', HOSTED)).toBe('en-US');
    expect(stated('/second', HOSTED)).toBe('en-US');
  });

  it('is refused where it is not text, under every policy', () => {
    // A URL object reads as the Arabic origin once it is turned into text, and it is not text.
    // Read at the default origin instead, the request would be answered in English.
    for (const origin of [new URL('https://example.eg'), null, 7]) {
      const context = { url: '/second', origin };
      for (const policy of POLICIES) {
        expect(() => initial(context, policy)).toThrow(LocalizationError);
        expect(() => stated(context, policy)).toThrow(LocalizationError);
      }
    }
    try {
      initial({ url: '/second', origin: 7 }, HOSTED);
    } catch (error) {
      expect((error as LocalizationError).diagnostic).toMatchObject({
        code: 'invalid-configuration',
        reason: 'malformed-input',
      });
    }
    expect(initial({ url: '/second', origin: undefined }, HOSTED)).toBe(
      'en-US',
    );
  });

  it('answers in the default locale and states none where the policy has no such origin', () => {
    const context = { url: '/second', origin: 'https://other.example' };
    expect(initial(context, HOSTED)).toBe('en-US');
    expect(stated(context, HOSTED)).toBeUndefined();
  });
});

describe('the locale a request starts in', () => {
  it('is the one a resolved address is in', () => {
    expect(initial('/ar-eg/thani', PREFIXED)).toBe('ar-EG');
    expect(initial('/en-us/second', PREFIXED)).toBe('en-US');
    expect(initial('https://example.eg/thani', HOSTED)).toBe('ar-EG');
  });

  it('is the one a corrected address is sent to', () => {
    expect(initial('/ar-eg/thani/', PREFIXED)).toBe('ar-EG');
    expect(initial('/AR-EG/thani', PREFIXED)).toBe('ar-EG');
    expect(initial('https://example.eg/thani/', HOSTED)).toBe('ar-EG');
    expect(initial('/ar-eg/legacy', PREFIXED)).toBe('ar-EG');
  });

  it('is the default where an address with no prefix is sent to its entry', () => {
    expect(initial('/second', PREFIXED)).toBe('en-US');
  });

  it('is the one the address is presented in where there is no page to send it to', () => {
    expect(initial('/ar-eg/removed', PREFIXED)).toBe('ar-EG');
    expect(initial('/ar-eg/%zz', PREFIXED)).toBe('en-US');
  });
});

describe('the locale an address states under a prefix policy', () => {
  it('is the one a corrected or a replaced address is sent to', () => {
    expect(stated('/ar-eg/thani/', PREFIXED)).toBe('ar-EG');
    expect(stated('/AR-EG/thani', PREFIXED)).toBe('ar-EG');
    expect(stated('/ar-eg/legacy', PREFIXED)).toBe('ar-EG');
  });

  it('is none where the address has no prefix, though a route reads it', () => {
    expect(stated('/second', PREFIXED)).toBeUndefined();
    expect(stated('/', PREFIXED)).toBeUndefined();
  });

  it('is none where the address is malformed or its page is gone', () => {
    expect(stated('/ar-eg/%zz', PREFIXED)).toBeUndefined();
    expect(stated('/ar-eg/removed', PREFIXED)).toBeUndefined();
  });
});

describe('the locale an address states under a locale-neutral policy', () => {
  it('is the one locale that spells it', () => {
    expect(stated('/thani', NEUTRAL)).toBe('ar-EG');
    expect(stated('/second', NEUTRAL)).toBe('en-US');
  });

  it('is none where more than one locale spells it', () => {
    expect(stated('/account', NEUTRAL)).toBeUndefined();
  });

  it('is the one the corrected address states, read after one correction', () => {
    expect(stated('/thani/', NEUTRAL)).toBe('ar-EG');
    expect(stated('/account/', NEUTRAL)).toBeUndefined();
  });

  it('is none for a retired address, though one locale alone spells its replacement', () => {
    expect(stated('/legacy', NEUTRAL)).toBeUndefined();
    expect(stated('/removed', NEUTRAL)).toBeUndefined();
  });
});
