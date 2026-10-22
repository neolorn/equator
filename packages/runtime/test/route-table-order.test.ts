import { describe, expect, it } from 'vitest';

import {
  createIdentifierParameterCodec,
  createPathPrefixLocalePolicy,
  resolveLocalizedRoute,
  type GeneratedRouteProjectionEntry,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * Two routes that both fit one address.
 *
 * A parameterised route and a static one can spell the same address, and the table's own order
 * decides between them: the one written first answers. A lookup that finds the static route
 * directly must still give way to a parameterised route written before it, and must not give way
 * to one written after.
 */

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us' },
});

const ARTICLE: GeneratedRouteProjectionEntry = {
  id: 'article',
  path: 'articles/:slug',
  parameterNames: ['slug'],
};
const LATEST: GeneratedRouteProjectionEntry = {
  id: 'latest',
  path: 'articles/latest',
  parameterNames: [],
};
const ARCHIVE: GeneratedRouteProjectionEntry = {
  id: 'archive',
  path: 'archive/:slug',
  parameterNames: ['slug'],
};

const table = (
  identity: string,
  routes: readonly GeneratedRouteProjectionEntry[],
): RouteRuntimeProjection => ({
  generated: { profile: 'equator-route-projection/1', identity, routes },
  parameters: {
    article: { slug: createIdentifierParameterCodec() },
    archive: { slug: createIdentifierParameterCodec() },
  },
});

const routeAt = (target: string, projection: RouteRuntimeProjection) => {
  const resolution = resolveLocalizedRoute(target, POLICY, projection);
  return resolution.status === 'success'
    ? resolution.routeId
    : resolution.status;
};

describe('an address two routes spell', () => {
  it("is the parameterised route's where that route is written first", () => {
    const projection = table(
      'sha256-RouteTableOrderParameterFirstIdentity012345',
      [ARCHIVE, ARTICLE, LATEST],
    );
    expect(routeAt('/en-us/articles/latest', projection)).toBe('article');
    expect(routeAt('/en-us/articles/other', projection)).toBe('article');
  });

  it("is the static route's where that route is written first", () => {
    const projection = table(
      'sha256-RouteTableOrderStaticFirstIdentity012345678',
      [ARCHIVE, LATEST, ARTICLE],
    );
    expect(routeAt('/en-us/articles/latest', projection)).toBe('latest');
    expect(routeAt('/en-us/articles/other', projection)).toBe('article');
    expect(routeAt('/en-us/archive/other', projection)).toBe('archive');
  });
});
