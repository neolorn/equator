/**
 * The formatting capabilities a supported host can lack, and the hosts each release is run on that
 * lack one.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 3 lets a supported runtime lack a
 * capability only if the runtime answers with the typed unsupported result and the release names
 * the capability and the runtime in its documentation. The compatibility page renders the second
 * list below, and `verify:platform` holds that page against what its probe measures on every Node
 * row and every browser engine, in both directions.
 *
 * The second list is a record of measurements, so changing it is a deliberate edit rather than
 * something a run writes: a record a failing run could rewrite would only ever move towards green.
 */

/**
 * The probe's optional capabilities that the runtime detects and answers with
 * `unsupported-formatting-capability` when a host lacks them, keyed by the probe's own names.
 *
 * `native` is how the page names the capability, and `fails` is what stops working on that host, written as the page writes it.
 */
export const reportedCapabilities = Object.freeze({
  durationFormat: Object.freeze({
    native: 'Intl.DurationFormat',
    fails: Object.freeze(['`formatDuration`', 'the `localizedDuration` pipe']),
  }),
  numberRange: Object.freeze({
    native: 'Intl.NumberFormat.prototype.formatRange',
    fails: Object.freeze(['`formatNumberRange`']),
  }),
  segmenter: Object.freeze({
    native: 'Intl.Segmenter',
    fails: Object.freeze(['`segmentText`']),
  }),
});

/**
 * The probe's optional capabilities Equator formats nothing with, so a host without one returns no
 * unsupported result and the page has nothing to say about it.
 */
export const unreportedCapabilities = Object.freeze([
  'pluralRange',
  'temporal',
]);

/** Each host a release is run on that lacks a reported capability, as `verify:platform` names it. */
export const hostCapabilityGaps = Object.freeze([
  Object.freeze({
    host: 'Node',
    version: '22.22.3',
    capability: 'durationFormat',
  }),
]);
