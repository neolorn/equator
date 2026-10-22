import { expect, it } from 'vitest';

import { routeCacheHeaders, withBasePath } from '@neolorn/equator/core';

// A base that reads as absolute and names no authority has no path to take a prefix from.
it('reads a base of slashes alone as no prefix', () => {
  expect(withBasePath('/x', '///')).toBe('/x');
  expect(withBasePath('/x', 'http:///')).toBe('/x');
});

// The handler passes what `Headers.get` answers, which is text; a direct caller can pass anything.
it("reads a page's cache-control that is not text as no directive", () => {
  expect(
    routeCacheHeaders(
      { status: 200, cache: 'public' },
      {
        successMaxAge: 600,
        permanentRedirectMaxAge: 86_400,
        localePreference: 'none',
      },
      { 'cache-control': 60 as unknown as string },
    ),
  ).toStrictEqual({ 'cache-control': 'public, max-age=600, must-revalidate' });
});
