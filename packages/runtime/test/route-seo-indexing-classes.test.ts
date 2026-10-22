import { describe, expect, it } from 'vitest';

import {
  createPathPrefixLocalePolicy,
  projectRouteSeo,
  resolveLocalizedRoute,
  routeHttpDescriptor,
  type GeneratedConfiguration,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What a route says to a crawler by its indexing class, and what an address may be advertised as.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` sections 10 and 14. A page a crawler may not index
 * carries a robots directive and no canonical URL or alternates. An indexable page advertises a
 * locale only at an address that serves it, and an `x-default` only where the policy declares one.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-RouteSeoIndexingClassesTestIdentity01234567',
    routes: [
      { id: 'second', path: 'second', parameterNames: [] },
      {
        id: 'account',
        path: 'account',
        parameterNames: [],
        indexing: 'private',
      },
      {
        id: 'search',
        path: 'search',
        parameterNames: [],
        indexing: 'non-indexable',
      },
    ],
  },
  localizedPaths: { second: { 'ar-EG': 'الثاني' } },
  historical: { withdrawn: { kind: 'gone' } },
};

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const CONFIGURATION: GeneratedConfiguration = {
  generatedAbi: 'equator-generated/1',
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
  aliases: {},
  applicationContractFingerprint: 'sha256-application-contract-fixture',
  semanticRegistryFingerprint: 'sha256-semantic-registry-fixture',
  scopes: [],
};

const ORIGIN = 'https://site.example';

function seoAt(
  address: string,
  policy: LocaleUrlPolicy = POLICY,
  addresses?: Readonly<Record<string, string>>,
) {
  const resolution = resolveLocalizedRoute(address, policy, PROJECTION);
  if (resolution.status !== 'success') {
    throw new Error(`${address} resolved as ${resolution.status}`);
  }
  return projectRouteSeo(
    resolution,
    policy,
    PROJECTION,
    CONFIGURATION,
    ORIGIN,
    undefined,
    addresses,
  );
}

describe('a page a crawler may not index', () => {
  it('tells a crawler to neither index nor follow a private page, and advertises nothing', () => {
    expect(seoAt('/en-us/account')).toStrictEqual({
      indexing: 'private',
      alternates: [],
      robots: 'noindex, nofollow',
    });
  });

  it('tells a crawler not to index a non-indexable page, and advertises nothing', () => {
    expect(seoAt('/en-us/search')).toStrictEqual({
      indexing: 'non-indexable',
      alternates: [],
      robots: 'noindex',
    });
  });
});

describe('an indexable page', () => {
  it('names no x-default where the policy declares none', () => {
    expect(seoAt('/en-us/second')).toStrictEqual({
      indexing: 'indexable',
      canonical: 'https://site.example/en-us/second',
      alternates: [
        {
          locale: 'en-US',
          hreflang: 'en-US',
          url: 'https://site.example/en-us/second',
        },
        {
          locale: 'ar-EG',
          hreflang: 'ar-EG',
          url: 'https://site.example/ar-eg/%D8%A7%D9%84%D8%AB%D8%A7%D9%86%D9%8A',
        },
      ],
    });
  });

  it('names the declared x-default path on the same site', () => {
    const declaring = createPathPrefixLocalePolicy({
      defaultLocale: 'en-US',
      locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
      xDefaultPath: '/choose',
    });
    expect(seoAt('/en-us/second', declaring).xDefault).toBe(
      'https://site.example/choose',
    );
  });

  it('does not advertise a locale at an address that redirects, even to that locale', () => {
    // The decoded spelling is corrected to the encoded one with a 308 that names Arabic. A crawler
    // arriving there is not served the page, so the address is not one to publish.
    const seo = seoAt('/en-us/second', POLICY, {
      'en-US': '/en-us/second',
      'ar-EG': '/ar-eg/الثاني',
    });
    expect(seo.alternates.map(({ locale }) => locale)).toEqual(['en-US']);
  });
});

describe('the response for an address that cannot be read', () => {
  it('is a 400 no crawler indexes and no cache stores', () => {
    const resolution = resolveLocalizedRoute('//second', POLICY, PROJECTION);
    expect(resolution.status).toBe('malformed');
    expect(routeHttpDescriptor(resolution)).toStrictEqual({
      status: 400,
      contentLanguage: 'en-US',
      robots: 'noindex',
      cache: 'private-no-store',
    });
  });
});

describe('the response for an address that states its locale', () => {
  it('is a 200 in that locale, with nothing it varies by', () => {
    const resolution = resolveLocalizedRoute(
      '/ar-eg/account',
      POLICY,
      PROJECTION,
    );
    expect(routeHttpDescriptor(resolution)).toStrictEqual({
      status: 200,
      contentLanguage: 'ar-EG',
      robots: 'noindex, nofollow',
      cache: 'private-no-store',
    });
    expect(
      routeHttpDescriptor(
        resolveLocalizedRoute('/en-us/second', POLICY, PROJECTION),
      ),
    ).toStrictEqual({
      status: 200,
      contentLanguage: 'en-US',
      cache: 'public',
    });
  });
});

describe('the response for a retired address with no replacement', () => {
  it('is a 410 no crawler indexes and no cache stores', () => {
    const resolution = resolveLocalizedRoute(
      '/ar-eg/withdrawn',
      POLICY,
      PROJECTION,
    );
    expect(resolution.status).toBe('gone');
    expect(routeHttpDescriptor(resolution)).toStrictEqual({
      status: 410,
      contentLanguage: 'ar-EG',
      robots: 'noindex',
      cache: 'private-no-store',
    });
  });
});

describe('the response for an address no route answers', () => {
  it('is a 404 no crawler indexes and no cache stores', () => {
    const resolution = resolveLocalizedRoute(
      '/ar-eg/nowhere',
      POLICY,
      PROJECTION,
    );
    expect(resolution.status).toBe('not-found');
    expect(routeHttpDescriptor(resolution)).toStrictEqual({
      status: 404,
      contentLanguage: 'ar-EG',
      robots: 'noindex',
      cache: 'private-no-store',
    });
  });
});
