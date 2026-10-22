/**
 * What the consumer's event log wrote, and the claims it supports.
 *
 * The consumer installs a `LocalizationObservabilitySink` with `withObservability` that puts each
 * event on the console as one `equator-event` line: the server's standard output, the build's
 * output while it prerenders, and a browser's console. The stages read those lines back here.
 */
import assert from 'node:assert/strict';

import { recordCapabilityClaim } from './capability-evidence.mjs';

/** Each event in `text`, in the order it was written. */
export function loggedEvents(text) {
  return [...text.matchAll(/equator-event (\{[^\n]*\})/gu)].map(([, json]) =>
    JSON.parse(json),
  );
}

/**
 * That the sink was told the snapshot for `locale` was handed over: by a server render or a
 * prerender, which writes it into the page, or by a browser, which adopts it from the page.
 */
export function claimLoggedHandOver(check, events, locale, context) {
  assert.ok(
    events.some(
      (event) =>
        event.phase === 'ssr-hydration' &&
        event.status === 'succeeded' &&
        event.targetLocale === locale,
    ),
    `${check}: the LocalizationObservabilitySink installed with withObservability was told of no ${locale} snapshot handed over. It was told:\n${JSON.stringify(events, null, 2)}`,
  );
  recordCapabilityClaim(check, 'feature:withObservability', context);
  recordCapabilityClaim(check, 'extension:observability-sink', context);
}

/**
 * That the sink was told how a change to `locale` ended: committed in the page, or, where the locale
 * is the origin, sent to a document navigation.
 */
export function claimLoggedChange(check, events, locale, status, context) {
  assert.ok(
    events.some(
      (event) =>
        event.phase === 'transition' &&
        event.status === status &&
        event.targetLocale === locale,
    ),
    `${check}: the LocalizationObservabilitySink installed with withObservability was not told the change to ${locale} ended ${status}. It was told:\n${JSON.stringify(events, null, 2)}`,
  );
  recordCapabilityClaim(check, 'feature:withObservability', context);
  recordCapabilityClaim(check, 'extension:observability-sink', context);
}
