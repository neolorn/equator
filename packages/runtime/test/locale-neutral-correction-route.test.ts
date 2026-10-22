import { describe, expect, it } from 'vitest';

import {
  createLocaleNeutralPolicy,
  resolveLocalizedRoute,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * A case-folded address under a locale-neutral policy, where two locales read the corrected
 * spelling as two different routes.
 *
 * `/second` is the route `second` in en-US and the route `other` in ar-EG. The correction of
 * `/SECOND` names a locale and a route, and both come from one locale's reading, the one the
 * corrected address is then resolved by.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-NeutralCorrectionRouteTestIdentity012345678',
    routes: [
      { id: 'second', path: 'second', parameterNames: [] },
      { id: 'other', path: 'other', parameterNames: [] },
    ],
  },
  localizedPaths: {
    second: { 'ar-EG': 'thani' },
    other: { 'ar-EG': 'second' },
  },
};

const POLICY = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});

const answer = (address: string, locale?: string) =>
  resolveLocalizedRoute(
    address,
    POLICY,
    PROJECTION,
    locale === undefined ? {} : { locale },
  );

describe('a corrected address two locales read as two routes', () => {
  it('is resolved by the preferred locale where that locale spells it', () => {
    expect(answer('/second', 'ar-EG')).toMatchObject({
      status: 'success',
      locale: 'ar-EG',
      routeId: 'other',
    });
    expect(answer('/second')).toMatchObject({
      status: 'success',
      locale: 'en-US',
      routeId: 'second',
    });
  });

  it('names in its correction the route the corrected address resolves to', () => {
    for (const preferred of [undefined, 'en-US', 'ar-EG']) {
      const correction = answer('/SECOND', preferred);
      const settled = answer('/second', preferred);

      expect(correction, String(preferred)).toMatchObject({
        status: 'redirect',
        reason: 'canonical-correction',
        location: '/second',
      });
      expect(settled.status, String(preferred)).toBe('success');
      expect(
        correction.status === 'redirect' && [
          correction.locale,
          correction.routeId,
        ],
        String(preferred),
      ).toEqual(
        settled.status === 'success' && [settled.locale, settled.routeId],
      );
    }
  });
});
