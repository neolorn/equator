import type { LocaleRequestHandlerOptions } from '@neolorn/equator/http';

/**
 * The development row's durations, and a deployment that lets a cache serve a stale success
 * without asking again.
 *
 * Declared in this row because every other row keeps the default, so the two answers the gate
 * reads for the same page, with and without `must-revalidate`, come from one declaration and
 * nothing else.
 */
export const responseCaching: LocaleRequestHandlerOptions['cache'] = {
  successMaxAge: 600,
  permanentRedirectMaxAge: 86_400,
  revalidateSuccess: false,
};
