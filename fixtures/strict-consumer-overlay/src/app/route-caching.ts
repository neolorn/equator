import type { RouteCachingClass } from '@neolorn/equator-toolkit';

/**
 * The caching class a deploy step reads off the route projection, to write one CDN rule per route.
 *
 * The step names the class so the mapping is one `switch` with a case per member and no `default`,
 * which under `noImplicitReturns` stops compiling when the union gains a member. `undefined` is a
 * route that names no class, so the CDN follows the headers the server sends for it.
 */
export function cdnRuleFor(caching: RouteCachingClass | undefined): string {
  switch (caching) {
    case undefined:
      return 'follow-origin';
    case 'per-visitor':
      return 'bypass';
    case 'not-stored':
      return 'no-store';
  }
}
