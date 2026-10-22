import { describe, expect, it } from 'vitest';

import {
  createHostLocalePolicy,
  createPathPrefixLocalePolicy,
  resolveLocalizedRoute,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * A request target given as an absolute URL.
 *
 * Section 4 of `specs/07-routing-rendering-and-seo.spec.md` has the target classified as it
 * arrived. An absolute `http:` or `https:` address is split into its origin and the target after
 * it, the target is then read exactly as a path-only one is, and an address whose authority is
 * missing or does not parse is malformed and never read as a path.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-AbsoluteRequestTargetsTestIdentity012345678',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
    ],
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

const malformed = (presentationLocale: string) => ({
  status: 'malformed',
  httpStatus: 400,
  presentationLocale,
  diagnostic: {
    code: 'unsafe-route',
    outcome: 'operational-failure',
    message: expect.any(String) as string,
  },
});

describe('an absolute request target under a path policy', () => {
  it('is read as the target after its origin', () => {
    for (const target of [
      'https://example.com/ar-eg/second',
      'http://example.com/ar-eg/second',
      'https://example.com:8443/ar-eg/second',
    ]) {
      expect(resolveLocalizedRoute(target, PREFIXED, PROJECTION)).toMatchObject(
        {
          status: 'success',
          locale: 'ar-EG',
          routeId: 'second',
          canonicalPath: '/ar-eg/second',
        },
      );
    }
  });

  it('asks for the root where nothing follows the authority', () => {
    expect(
      resolveLocalizedRoute('https://example.com', PREFIXED, PROJECTION),
    ).toMatchObject({ status: 'redirect', location: '/en-us' });
    expect(
      resolveLocalizedRoute('https://example.com?page=2', PREFIXED, PROJECTION),
    ).toMatchObject({ status: 'redirect', location: '/en-us?page=2' });
  });

  it('is malformed where the authority is empty', () => {
    // A URL parser skips the extra slash and reads `en-us` as the host. Read as written, there is
    // no host here at all.
    for (const target of ['https:///en-us/second', 'https://', 'http://?x']) {
      expect(resolveLocalizedRoute(target, PREFIXED, PROJECTION)).toStrictEqual(
        malformed('en-US'),
      );
    }
  });

  it('is malformed where the authority does not parse', () => {
    for (const target of [
      'https://[/en-us/second',
      'https://exa mple.com/en-us/second',
    ]) {
      expect(resolveLocalizedRoute(target, PREFIXED, PROJECTION)).toStrictEqual(
        malformed('en-US'),
      );
    }
  });

  it('is malformed where the scheme is not HTTP or the scheme is not at the start', () => {
    for (const target of [
      'ftp://example.com/en-us/second',
      'en-us/second',
      'x-https://example.com/en-us/second',
    ]) {
      expect(resolveLocalizedRoute(target, PREFIXED, PROJECTION)).toStrictEqual(
        malformed('en-US'),
      );
    }
  });
});

describe('an absolute request target under a host policy', () => {
  it('takes its locale from its own origin and not from the default', () => {
    expect(
      resolveLocalizedRoute('https://example.eg/second', HOSTED, PROJECTION),
    ).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
      canonicalUrl: 'https://example.eg/second',
    });
    expect(
      resolveLocalizedRoute('https://example.eg', HOSTED, PROJECTION),
    ).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
      canonicalUrl: 'https://example.eg/',
    });
  });

  it('is malformed where the authority does not parse', () => {
    expect(
      resolveLocalizedRoute('https://[/second', HOSTED, PROJECTION),
    ).toStrictEqual(malformed('en-US'));
  });

  it('is given to no origin where its scheme does not begin the address', () => {
    // A URL parser reads the first `http:/` as a scheme and the second `http` as the host. Read as
    // written the address has no authority, so the locale of the origin `http://http` does not
    // answer for it.
    const policy = createHostLocalePolicy({
      defaultLocale: 'en-US',
      origins: { 'en-US': 'https://example.com', 'ar-EG': 'http://http' },
    });
    expect(
      resolveLocalizedRoute('http://http/second', policy, PROJECTION),
    ).toMatchObject({ status: 'success', locale: 'ar-EG' });
    expect(
      resolveLocalizedRoute(
        'http:/http://example.com/second',
        policy,
        PROJECTION,
      ),
    ).toStrictEqual(malformed('en-US'));
  });
});
