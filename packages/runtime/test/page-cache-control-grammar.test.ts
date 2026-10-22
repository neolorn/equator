import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROUTE_CACHING_FIELD,
  routeCacheHeaders,
  type RouteHttpDescriptor,
} from '@neolorn/equator/core';

/**
 * How a page's own `Cache-Control` and `Vary` are read before they narrow Equator's.
 *
 * `route-cache-headers.test.ts` holds what each directive does. This holds the reading itself: a
 * value is read by RFC 9111 section 5.2's grammar rather than split on commas, so a quoted argument,
 * an escape inside one and text that is not a directive each have one reading, and a lifetime is a
 * whole number or it is stale.
 */

const FRESHNESS = {
  successMaxAge: 600,
  permanentRedirectMaxAge: 86_400,
  localePreference: 'none',
} as const;

const descriptorFor = (
  cache: RouteHttpDescriptor['cache'],
): RouteHttpDescriptor =>
  cache === 'consumer-defined-permanent'
    ? { status: 308, location: '/en-us', cache }
    : { status: 200, contentLanguage: 'en-US', cache };

const pageSaid = (
  cacheControl: string,
  cache: RouteHttpDescriptor['cache'] = 'public',
) =>
  routeCacheHeaders(descriptorFor(cache), FRESHNESS, {
    'cache-control': cacheControl,
  })['cache-control'];

describe("how a page's Cache-Control is read", () => {
  it('reads a lifetime with anything but digits in it as stale', () => {
    // RFC 9111 section 4.2.1: a lifetime that is not a whole number is read as stale. A unit after
    // the digits and a sign before them are each most of a number, and neither is one.
    expect(pageSaid('max-age=60s')).toBe('public, max-age=0, must-revalidate');
    expect(pageSaid('max-age=+60')).toBe('public, max-age=0, must-revalidate');
    expect(pageSaid('max-age=6 0')).toBe('public, max-age=6, must-revalidate');
  });

  it('reads a quoted argument to its closing quote, or to the end where there is none', () => {
    expect(pageSaid('max-age="60", no-transform')).toBe(
      'public, max-age=60, must-revalidate, no-transform',
    );
    // A value cut off inside a quoted argument still ends, and is read for what it held.
    expect(pageSaid('max-age="60')).toBe('public, max-age=60, must-revalidate');
  });

  it('reads an escaped character inside a quoted argument as the character', () => {
    // RFC 9110 section 5.6.4: a backslash inside a quoted string stands for the octet after it.
    expect(pageSaid('max-age="6\\0"')).toBe(
      'public, max-age=60, must-revalidate',
    );
    // An escaped quote does not close the argument, so the comma after it is still inside.
    expect(pageSaid('private="a\\", no-store"')).toBe('private, no-cache');
  });

  it('keeps a comma inside a quoted argument inside it', () => {
    expect(pageSaid('private="a, no-store"')).toBe('private, no-cache');
  });

  it('reads a directive that follows another with no comma between them', () => {
    // RFC 9111 section 5.2.2.5 has no-store forbid storing any part of the response, so a value
    // that left out a comma cannot be read as leaving out the directive after it.
    expect(pageSaid('max-age=60 no-store')).toBe('private, no-store');
    expect(pageSaid('max-age=60 private')).toBe('private, no-cache');
    expect(pageSaid('max-age="60" no-store')).toBe('private, no-store');
    expect(pageSaid('public no-store')).toBe('private, no-store');
    // Reading resumes after a closing quote, so a directive written against it is still one.
    expect(pageSaid('private="a"no-store')).toBe('private, no-store');
    expect(pageSaid('max-age=600 s-maxage=30 no-transform')).toBe(
      'public, max-age=600, must-revalidate, s-maxage=30, no-transform',
    );
    expect(pageSaid('max-age=60 no-store, no-transform')).toBe(
      'private, no-store, no-transform',
    );
  });

  it('reads quoted text as an argument wherever it stands, never as directives', () => {
    // The second quoted text follows an equals sign with no name before it, so it is the argument
    // of a directive that has none, and the commas inside it separate nothing.
    expect(pageSaid('no-transform="a,"="x, no-store, y"')).toBe(
      'public, max-age=600, must-revalidate, no-transform',
    );
  });

  it('keeps a shared lifetime only where it is shorter than the lifetime beside it', () => {
    // RFC 9111 section 4.2.1 has a shared cache prefer `s-maxage`, so an equal one says nothing.
    expect(pageSaid('s-maxage=600')).toBe(
      'public, max-age=600, must-revalidate',
    );
    expect(pageSaid('s-maxage=599')).toBe(
      'public, max-age=600, must-revalidate, s-maxage=599',
    );
    expect(pageSaid('max-age=60, s-maxage=60')).toBe(
      'public, max-age=60, must-revalidate',
    );
  });

  it('raises a permanent redirect the page says nothing may keep', () => {
    expect(pageSaid('no-store', 'consumer-defined-permanent')).toBe(
      'private, no-store',
    );
    expect(pageSaid('private', 'consumer-defined-permanent')).toBe(
      'private, no-cache',
    );
  });

  it('writes each class as its own directive', () => {
    expect(pageSaid('no-store')).toBe('private, no-store');
    expect(pageSaid('no-cache')).toBe('private, no-cache');
    expect(pageSaid('max-age=600')).toBe(
      'public, max-age=600, must-revalidate',
    );
  });
});

describe("how a page's Vary is read", () => {
  it('lets `*` stand alone whatever is named beside it', () => {
    // RFC 9110 section 12.5.5: `*` says nothing about the request can show the response fits.
    expect(
      routeCacheHeaders(descriptorFor('public'), FRESHNESS, {
        vary: 'Accept-Encoding, *',
      }).vary,
    ).toBe('*');
    expect(
      routeCacheHeaders(
        descriptorFor('varies-by-locale-preference'),
        { ...FRESHNESS, localePreference: 'accept-language' },
        { vary: '*, Accept-Encoding' },
      ).vary,
    ).toBe('*');
  });
});

describe('the route-data field a caching class is read from', () => {
  it('is `equatorCaching` where a consumer names none', () => {
    expect(DEFAULT_ROUTE_CACHING_FIELD).toBe('equatorCaching');
  });
});
