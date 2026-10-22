import { expect, it } from 'vitest';

import {
  createPathPrefixLocalePolicy,
  LocalizationError,
  localizedRouteAddresses,
  resolveLocalizedRoute,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * Listing a page's addresses under a written-out policy that names no locales.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md` holds a written-out policy to the
 * tables a constructor writes, wherever a policy is read. The list has one address per locale, so
 * a policy of no locales would otherwise come back as an empty list, which reads as a page with no
 * address anywhere and not as a policy no constructor writes.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-AddressesUnderNoLocalesTestIdentity01234567',
    routes: [{ id: 'second', path: 'second', parameterNames: [] }],
  },
};

const PREFIXED = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

it('refuses the policy and lists nothing', () => {
  const resolution = resolveLocalizedRoute(
    '/en-us/second',
    PREFIXED,
    PROJECTION,
  );
  if (resolution.status !== 'success') throw new Error('not resolved');

  expect(localizedRouteAddresses(resolution, PREFIXED, PROJECTION)).toEqual({
    'en-US': '/en-us/second',
    'ar-EG': '/ar-eg/second',
  });

  const noLocales = { ...PREFIXED, locales: {} } as LocaleUrlPolicy;
  let listed: unknown;
  let thrown: unknown;
  try {
    listed = localizedRouteAddresses(resolution, noLocales, PROJECTION);
  } catch (error) {
    thrown = error;
  }
  expect(listed).toBeUndefined();
  expect(thrown).toBeInstanceOf(LocalizationError);
  expect((thrown as LocalizationError).diagnostic).toMatchObject({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
  });
});
