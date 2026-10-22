import type { LocaleRequestHandlerOptions } from '@neolorn/equator/http';

/**
 * How long a shared cache may keep what this deployment answers, which is a fact about the
 * deployment rather than one Equator can guess.
 *
 * `successMaxAge` is deliberately not `0`. A zero is a deployment that revalidates every request,
 * which makes a response marked `public` behave privately and hides the difference between a
 * correct classification and a leaked one. This fixture is what the gate reads; a fixture that is
 * safe whatever Equator says cannot show that Equator is right.
 *
 * A file of its own because a consumer row that declares a floor for every page replaces it, and
 * `server.ts` stays one file for every row.
 */
export const responseCaching: LocaleRequestHandlerOptions['cache'] = {
  successMaxAge: 600,
  permanentRedirectMaxAge: 86_400,
};
