import { describe, expect, it } from 'vitest';

import { DEFAULT_ROUTE_INDEXING_FIELD } from '@neolorn/equator/core';

/**
 * The name of the route-data field an indexing class is read from by default.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 14 has the declaration read from the
 * provider file's source text, so the name is what an application writes in its route data and is
 * asserted as the value it is.
 */

describe('the route-data field an indexing class is read from', () => {
  it('is `equatorIndexing` where a consumer names none', () => {
    expect(DEFAULT_ROUTE_INDEXING_FIELD).toBe('equatorIndexing');
  });
});
