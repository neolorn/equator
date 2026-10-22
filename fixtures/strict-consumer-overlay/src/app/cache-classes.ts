import type {
  RouteHttpDescriptor,
  RouteResolution,
} from '@neolorn/equator/core';

/**
 * The cache class, read by a host that answers more than Equator's own headers.
 *
 * A host behind a CDN often writes a second header of its own, a surrogate rule or a log field,
 * from the same class Equator derives `Cache-Control` from. Under `noImplicitReturns` that host is
 * a `switch` with a case per class and no `default`, and it is the shape that stops compiling when
 * the union gains a member. A class nobody decided for then reaches the host as a build error
 * rather than as a response.
 */
export function cacheLogField(cache: RouteHttpDescriptor['cache']): string {
  switch (cache) {
    case 'public':
      return 'shared';
    case 'varies-by-locale-preference':
      return 'shared-per-language';
    case 'private-no-cache':
      return 'browser-revalidated';
    case 'private-no-store':
      return 'not-stored';
    case 'consumer-defined-permanent':
      return 'shared-permanent';
  }
}

type RedirectCache = Extract<
  RouteResolution,
  { readonly status: 'redirect' }
>['cache'];

/**
 * The same reading one step earlier, before a descriptor exists.
 *
 * A host that answers redirects itself reads the class off the resolution, and a redirect has two
 * of the five, so its `switch` is exhaustive over those two and no more.
 */
export function redirectLogField(cache: RedirectCache): string {
  switch (cache) {
    case 'private-no-cache':
      return 'browser-revalidated';
    case 'consumer-defined-permanent':
      return 'shared-permanent';
  }
}
