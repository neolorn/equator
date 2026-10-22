import { describe, expect, it } from 'vitest';

import { derivedScopes } from '../router/src/navigation-scopes.js';
import type { RouteRuntimeProjection } from '@neolorn/equator/core';

/**
 * The scopes a navigation loads because the generated route table lists them for its route.
 *
 * Section 9 of `specs/06-runtime-and-angular.spec.md` derives them from the route tree, and
 * generation leaves the field out of a route whose first render already carries everything it
 * reads, so a route with none is the ordinary case and not a table that is missing something.
 */

const LAZY = { providerId: '@example/app', scopeId: 'lazy' };

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-RouteDerivedScopesTestIdentity01234567890123',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      {
        id: 'route:reports',
        path: 'reports',
        parameterNames: [],
        scopes: [LAZY],
      },
    ],
  },
};

describe('the scopes the generated route table gives a route', () => {
  it('are the ones it lists', () => {
    expect(derivedScopes(PROJECTION, 'route:reports')).toStrictEqual([LAZY]);
  });

  it('are none for a route it lists without any', () => {
    expect(derivedScopes(PROJECTION, 'route:_index')).toStrictEqual([]);
  });

  it('are none for a route it does not list', () => {
    expect(derivedScopes(PROJECTION, 'route:elsewhere')).toStrictEqual([]);
  });
});
