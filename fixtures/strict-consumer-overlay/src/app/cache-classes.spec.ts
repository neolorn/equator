import {
  resolveLocalizedRoute,
  routeHttpDescriptor,
} from '@neolorn/equator/core';

import { cacheLogField, redirectLogField } from './cache-classes';
import { appRouteProjection, routePolicy } from './localization.routes';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * What proves the union from this seat is the source above compiling under this row's options.
 * These keep the two readings tied to classes resolution actually produces.
 */
describe('the cache class read by a host', () => {
  it('reads locale entry as kept by the browser and revalidated', () => {
    const entry = resolveLocalizedRoute('/', routePolicy, appRouteProjection);
    if (entry.status !== 'redirect') {
      throw new Error(`Expected locale entry, got ${entry.status}.`);
    }

    expect(redirectLogField(entry.cache)).toBe('browser-revalidated');
    expect(cacheLogField(routeHttpDescriptor(entry).cache)).toBe(
      'browser-revalidated',
    );
    claimCapability('entry:@neolorn/equator/core', { policy: routePolicy });
  });

  it('reads an address that states its locale as shared', () => {
    expect(
      cacheLogField(
        routeHttpDescriptor(
          resolveLocalizedRoute('/en-us', routePolicy, appRouteProjection),
        ).cache,
      ),
    ).toBe('shared');
    claimCapability('entry:@neolorn/equator/core', { policy: routePolicy });
  });
});
