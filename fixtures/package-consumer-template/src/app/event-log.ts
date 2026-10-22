import { type LocalizationObservabilitySink } from '@neolorn/equator';

/**
 * Where this application sends what Equator reports: one line per event on the console, which is
 * the process's standard output on the server and while the build prerenders, and the developer
 * console in a browser. A deployment hands the same lines to its own log collection.
 *
 * The event goes out as JSON because it is data. It holds codes and identities and no sentence in
 * any language, so it reads the same whichever locale the page was in.
 */
export const eventLog = Object.freeze<LocalizationObservabilitySink>({
  emit: (event) => console.info(`equator-event ${JSON.stringify(event)}`),
});
