import type { RouteLocalizationOptions } from '@neolorn/equator/router';

/**
 * How a navigation changes the page: it lands with what is ready, and a scope a route names as
 * progressive arrives beside it.
 *
 * The address table beside this file says so too, under `navigationMode`, so the checks that
 * expect it fail when this declaration goes missing instead of switching off.
 */
export const routeTransitions = {
  mode: 'progressive',
} as const satisfies Pick<RouteLocalizationOptions, 'mode'>;
