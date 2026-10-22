import { describe, expect, it } from 'vitest';

import { createLocaleRequestHandler } from '../http/src/handler.js';
import {
  createIdentifierParameterCodec,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * Where a response sends a reader comes from configuration, never from what the request says about
 * where it was sent.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 16. `Host` and the forwarding headers are
 * written by whoever sends the request, and a location or a canonical built from one is a redirect
 * to an origin of the sender's choosing, cached for every later reader of the address.
 */

const HOSTED: LocaleUrlPolicy = {
  kind: 'locale-host',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'https://example.com', 'ar-EG': 'https://example.eg' },
  origins: { 'https://example.com': 'en-US', 'https://example.eg': 'ar-EG' },
  localeNeutralRoots: [],
};

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-ForgedHostTestIdentity0123456789abcdefghijk',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  parameters: { article: { slug: createIdentifierParameterCodec() } },
};

const handler = createLocaleRequestHandler({
  policy: HOSTED,
  projection: PROJECTION,
  cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
  render: ({ locale }) => new Response(`<html lang="${locale}"></html>`),
});

const FORGED = {
  host: 'evil.example',
  'x-forwarded-host': 'evil.example',
  'x-forwarded-proto': 'https',
  forwarded: 'host=evil.example;proto=https',
};

describe('a request that names another host in its headers', () => {
  it('is corrected on the origin the policy gives its locale', async () => {
    const corrected = await handler(
      new Request('https://example.eg/articles/hello/', { headers: FORGED }),
    );

    expect(corrected.status).toBe(308);
    expect(corrected.headers.get('location')).toBe(
      'https://example.eg/articles/hello',
    );
  });

  it('is refused at an origin the policy does not have, and sent nowhere', async () => {
    const refused = await handler(
      new Request('https://evil.example/articles/hello/', { headers: FORGED }),
    );

    expect(refused.status).toBe(400);
    expect(refused.headers.get('location')).toBeNull();
  });
});
