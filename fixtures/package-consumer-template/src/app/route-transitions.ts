import type { RouteLocalizationOptions } from '@neolorn/equator/router';

/**
 * How a navigation changes the page: the earlier view held until everything the next one needs is
 * ready.
 *
 * A module of its own because it is a decision about the whole application, and a consumer row
 * that lets a navigation land ahead of what is still arriving replaces it, as a row under another
 * URL policy replaces `route-policy.ts`.
 */
export const routeTransitions = {
  mode: 'coordinated',
} as const satisfies Pick<RouteLocalizationOptions, 'mode'>;
