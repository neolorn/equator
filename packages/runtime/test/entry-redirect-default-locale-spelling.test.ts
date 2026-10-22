import { expect, it } from 'vitest';

import {
  createPathPrefixLocalePolicy,
  resolveLocalizedRoute,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

// The codec refuses, by throwing, the canonical spelling it writes. The match has read the
// parameter in the default locale already, so the redirect to that locale's prefix has nothing
// left to ask the codec.
const SHOUTED: RouteParameterCodec<string> = {
  parse: (text: string) => {
    if (text !== text.toUpperCase()) throw new Error('lower case');
    return { ok: true, value: text.toLowerCase() };
  },
  serialize: (value: string) => value,
};

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-RouteProjectionTestIdentity012345678901234_',
    routes: [
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  parameters: { article: { slug: SHOUTED } },
};

it('sends an unprefixed address to the default locale with the segments the match read', () => {
  const resolution = resolveLocalizedRoute(
    '/articles/HANDBOOK',
    POLICY,
    PROJECTION,
    { locale: 'en-US' },
  );
  expect(resolution.status).toBe('redirect');
  expect(resolution.status === 'redirect' && resolution.location).toBe(
    '/en-us/articles/handbook',
  );
});
