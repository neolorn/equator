import { describe, expect, it } from 'vitest';

import { createLocaleRequestHandler } from '../http/src/handler.js';
import type {
  LocaleUrlPolicy,
  RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The request handler reads `Accept-Language` as the runtime does.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 7 names request language preferences as
 * one source of a first request's locale, and spec 01 section 6 forbids a correctness-bearing
 * answer from differing between the server and the browser. So the handler negotiates through
 * `negotiateLocale(parseAcceptLanguage(...))`, the pair the Angular runtime uses: a regional
 * variant the build does not carry reaches the served locale of its language, and a weight above 1
 * counts as 1.
 */

const POLICY: LocaleUrlPolicy = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: ['assets'],
  omitDefaultPrefix: false,
};

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-BuiltLocaleAddressesTestIdentity01234567890',
    routes: [{ id: 'route:_index', path: '', parameterNames: [] }],
  },
};

const answer = createLocaleRequestHandler({
  policy: POLICY,
  projection: PROJECTION,
  cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
  cookie: false,
});

async function entryFor(acceptLanguage: string): Promise<string | null> {
  const response = await answer(
    new Request('https://site.example/', {
      headers: { 'accept-language': acceptLanguage },
    }),
  );
  expect(response.status).toBe(307);
  return response.headers.get('location');
}

describe('the language a request prefers, as the handler reads it', () => {
  it('reaches the served locale of a regional variant the build does not carry', async () => {
    expect(await entryFor('ar-SA,en;q=0.5')).toBe('/ar-eg');
  });

  it('counts a weight above 1 as 1, so the order the client wrote decides', async () => {
    expect(await entryFor('ar-EG;q=1, en-US;q=1.5')).toBe('/ar-eg');
  });

  it('still takes the first served language, which is the control', async () => {
    expect(await entryFor('en-US,ar-EG;q=0.9')).toBe('/en-us');
  });
});
