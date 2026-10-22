import type { LocaleRequestHandlerOptions } from '@neolorn/equator/http';

/**
 * The development row's durations, and a floor for every page this deployment serves.
 *
 * The floor stands for a fact that holds on every page, such as a nonce every response carries. It
 * is declared in this row because the origin names the locale here, so every page is otherwise
 * shared: each page it raises shows the floor applied, and each redirect it leaves alone shows the
 * floor kept off a response that carries no page.
 */
export const responseCaching: LocaleRequestHandlerOptions['cache'] = {
  successMaxAge: 600,
  permanentRedirectMaxAge: 86_400,
  pageCaching: 'per-visitor',
};
