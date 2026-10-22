import { type LocalizationObservabilitySink } from '@neolorn/equator';

/**
 * Where the panel sends what Equator reports: one line per event on the console. The panel moves
 * between locales on what its stores hold rather than on an address, so when it is in the wrong
 * language these lines are what say whether the stores were read and how that ended.
 */
export const eventLog = Object.freeze<LocalizationObservabilitySink>({
  emit: (event) => console.info(`equator-event ${JSON.stringify(event)}`),
});
