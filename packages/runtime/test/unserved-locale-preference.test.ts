import { describe, expect, it } from 'vitest';

import {
  createLocaleNeutralPolicy,
  resolveLocalizedRoute,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * A preference for a locale a locale-neutral policy does not serve.
 *
 * The preference chooses among the locales the policy has, so one that names another locale, or
 * names none, chooses nothing: the address is answered as it is for a request that stated no
 * preference, and never in a locale the application does not have.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-UnservedLocalePreferenceTestIdentity0123456',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'account', path: 'account', parameterNames: [] },
    ],
  },
  historical: { removed: { kind: 'gone' } },
};

const NEUTRAL = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});

const resolve = (target: string, locale?: string) =>
  resolveLocalizedRoute(
    target,
    NEUTRAL,
    PROJECTION,
    locale === undefined ? {} : { locale },
  );

const UNSERVED = ['de-DE', 'not a locale', '', 'toString'];

describe('a preference a locale-neutral policy does not serve', () => {
  it('resolves an address every locale spells in the default locale', () => {
    for (const preference of UNSERVED) {
      expect(resolve('/account', preference), preference).toMatchObject({
        status: 'success',
        locale: 'en-US',
      });
      expect(resolve('/', preference), preference).toMatchObject({
        status: 'success',
        locale: 'en-US',
        canonicalPath: '/',
      });
    }
  });

  it('presents an address no route reads in the default locale', () => {
    for (const preference of UNSERVED) {
      expect(resolve('/nowhere', preference), preference).toStrictEqual({
        status: 'not-found',
        httpStatus: 404,
        presentationLocale: 'en-US',
      });
      expect(resolve('/removed', preference), preference).toStrictEqual({
        status: 'gone',
        httpStatus: 410,
        presentationLocale: 'en-US',
      });
    }
  });

  it('is told apart from one the policy serves, in any spelling of its tag', () => {
    for (const preference of ['ar-EG', 'ar-eg', 'AR-EG']) {
      expect(resolve('/account', preference), preference).toMatchObject({
        status: 'success',
        locale: 'ar-EG',
      });
      expect(resolve('/nowhere', preference), preference).toStrictEqual({
        status: 'not-found',
        httpStatus: 404,
        presentationLocale: 'ar-EG',
      });
    }
  });
});
