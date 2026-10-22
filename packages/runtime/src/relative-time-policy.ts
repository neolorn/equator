import {
  type FormattingContext,
  type InstantValue,
  type LocalizationDiagnostic,
  type LocalizedFormattedValue,
} from '@neolorn/equator/core';
import { decimal, formatRelativeTime } from './formatting';

/**
 * Choosing which unit a relative timestamp is expressed in.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 5 divides relative time by owner. The
 * hard parts are settled elsewhere (an explicit reference instant, an explicit zone, structured
 * durations), leaving only the question of when "in 90 minutes" should become "in 2 hours", and
 * when a relative phrase should stop being used at all.
 *
 * That question splits in two, and the split is the whole answer:
 *
 * - **Which unit fits an elapsed span** is mechanism. The rule is the same everywhere: take the
 *   largest unit whose threshold the span reaches. Four applications should not each write it.
 * - **Where the thresholds sit, and when to stop being relative**, is a product decision. "3 days
 *   ago" is right for a chat message and wrong for an invoice date, and Equator has no basis for
 *   preferring either.
 *
 * So Equator owns the selection and the consumer owns the numbers, which is the same division used
 * for locale resolution and persistence: the mechanism ships, the policy is declared.
 */

/** Units this policy selects between, largest first. */
const UNIT_ORDER = [
  'year',
  'month',
  'week',
  'day',
  'hour',
  'minute',
  'second',
] as const;

/**
 * The seven units a relative phrase can be expressed in, from year down to second.
 *
 * Ordered largest first, which is the order selection walks: the unit chosen is the largest one the
 * span reaches.
 */
export type RelativeTimeUnit = (typeof UNIT_ORDER)[number];

const MILLISECONDS: Readonly<Record<RelativeTimeUnit, number>> = Object.freeze({
  year: 31_556_952_000, // mean Gregorian year, matching CLDR's own approximation
  month: 2_629_746_000, // mean Gregorian month
  week: 604_800_000,
  day: 86_400_000,
  hour: 3_600_000,
  minute: 60_000,
  second: 1_000,
});

/**
 * Where the thresholds sit for an application, and when a relative phrase stops being used.
 *
 * Every field is optional, and an empty policy names every unit with no ceiling. These are product
 * decisions rather than locale data: an hour old is recent for a chat message and stale for a
 * status page, and Equator has no basis for preferring either.
 */
export interface RelativeTimePolicy {
  /**
   * Smallest unit worth naming. A span shorter than this reports as this unit with a value of
   * zero, which is how "just now" is expressed without Equator inventing wording for it.
   */
  readonly smallestUnit?: RelativeTimeUnit;
  /**
   * Largest unit worth naming. A span beyond this is reported as out of range, so the consumer can
   * fall back to an absolute date rather than reading "14 months ago".
   */
  readonly largestUnit?: RelativeTimeUnit;
  /**
   * Elapsed milliseconds past which a relative phrase stops being useful at all. Reported as out
   * of range. Absent means no ceiling.
   */
  readonly absoluteAfterMilliseconds?: number;
}

/** A span the policy is willing to express relatively, as the unit and the number to say it in. */
export interface RelativeTimeSelection {
  /** The largest unit the span reached, within the policy's bounds. */
  readonly unit: RelativeTimeUnit;
  /** Signed, negative for the past, ready to hand to `formatRelativeTime`. */
  readonly value: number;
}

/** A span the policy will not express relatively, handed back for an absolute date instead. */
export interface RelativeTimeOutOfRange {
  /** Always absent, which is what distinguishes this from a selection at a glance. */
  readonly unit?: undefined;
  /** Elapsed milliseconds, so a consumer can format an absolute date instead. */
  readonly elapsedMilliseconds: number;
}

/**
 * A policy that cannot be applied, reported in place of a decision made under a guess at it.
 *
 * A policy is refused when it names a unit outside the seven, names a smallest unit larger than its
 * largest, or declares a ceiling that is not a number of milliseconds from zero up.
 */
export interface RelativeTimePolicyRefused {
  /** Always absent, as it is on a span that is out of range. */
  readonly unit?: undefined;
  /** Always absent, which is what tells a refused policy from a span that is out of range. */
  readonly elapsedMilliseconds?: undefined;
  /** What was refused, with the code `invalid-configuration`. */
  readonly diagnostic: LocalizationDiagnostic;
}

/**
 * What selection returns: a unit and value to say, the elapsed time and nothing to say it in, or a
 * diagnostic where the policy itself cannot be applied.
 *
 * Check `unit` to tell a selection from the rest, and `elapsedMilliseconds` to tell a span that is
 * out of range from a refused policy. Equator writes no absolute date itself, because the wording, the
 * fields and the zone of that date are the application's.
 */
export type RelativeTimeDecision =
  RelativeTimeSelection | RelativeTimeOutOfRange | RelativeTimePolicyRefused;

const policyRefused: RelativeTimePolicyRefused = Object.freeze({
  diagnostic: Object.freeze({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
    message: 'The relative-time policy is invalid.',
  }),
});

function epochMilliseconds(instant: InstantValue): number {
  // Instants are canonical epoch-nanosecond strings; only whole milliseconds matter here, and a
  // relative phrase has no use for finer precision than the unit it will be expressed in.
  return Number(BigInt(instant.epochNanoseconds) / 1_000_000n);
}

/**
 * Choose the unit and signed value for a relative timestamp.
 *
 * Returns an out-of-range decision rather than a unit when the span exceeds what the policy is
 * willing to express relatively. Equator does not substitute an absolute date itself: the wording,
 * the format and the zone of that date are the consumer's, and guessing them here would be the
 * product decision this function exists to avoid making.
 *
 * Returns a refusal, and selects nothing, under a policy that cannot be applied.
 */
export function selectRelativeTime(
  target: InstantValue,
  reference: InstantValue,
  policy: RelativeTimePolicy = {},
): RelativeTimeDecision {
  // No ceiling is a ceiling no span passes.
  const ceiling: unknown =
    policy.absoluteAfterMilliseconds === undefined
      ? Infinity
      : policy.absoluteAfterMilliseconds;
  const largestIndex = UNIT_ORDER.indexOf(policy.largestUnit ?? 'year');
  const smallestIndex = UNIT_ORDER.indexOf(policy.smallestUnit ?? 'second');
  if (
    largestIndex < 0 ||
    // Also a smallest unit outside the seven, whose index is below every index a unit has.
    smallestIndex < largestIndex ||
    !(typeof ceiling === 'number' && ceiling >= 0)
  ) {
    return policyRefused;
  }

  const elapsed = epochMilliseconds(target) - epochMilliseconds(reference);
  const magnitude = Math.abs(elapsed);

  if (magnitude > ceiling) {
    return Object.freeze({ elapsedMilliseconds: elapsed });
  }

  const largest = UNIT_ORDER[largestIndex] as RelativeTimeUnit;
  if (magnitude >= MILLISECONDS[largest] * 2 && largestIndex > 0) {
    // Beyond the largest unit the consumer is willing to name. Reporting "24 months" when the
    // policy stops at months would be technically true and useless.
    return Object.freeze({ elapsedMilliseconds: elapsed });
  }

  // The largest unit the span reaches, and the smallest one for a span that reaches none.
  let index = largestIndex;
  while (
    index < smallestIndex &&
    magnitude < MILLISECONDS[UNIT_ORDER[index] as RelativeTimeUnit]
  ) {
    index += 1;
  }
  const unit = UNIT_ORDER[index] as RelativeTimeUnit;
  // Truncate rather than round: "1 hour ago" for 119 minutes is wrong in the direction that
  // claims something is more recent than it is.
  const truncated = Math.trunc(elapsed / MILLISECONDS[unit]);
  // A span shorter than its own unit truncates to -0, and -0 is a value no caller wants to
  // meet: it compares equal to 0, serializes as 0, and survives as -0 in memory. A zero span
  // has no direction, so it is reported without one.
  return Object.freeze({ unit, value: truncated === 0 ? 0 : truncated });
}

/**
 * What a relative timestamp came to.
 *
 * Three outcomes, because there are genuinely three. `absolute` is not a failure: it is the policy
 * working, saying this span is too old to phrase relatively and handing back the elapsed span so
 * the consumer can render a date in its own format. Folding it into the failure channel would make
 * a correct answer look like a broken one.
 */
export type RelativeTimeOutcome =
  | {
      readonly kind: 'relative';
      readonly unit: RelativeTimeUnit;
      readonly value: number;
      readonly formatted: LocalizedFormattedValue;
    }
  | { readonly kind: 'absolute'; readonly elapsedMilliseconds: number }
  | {
      readonly kind: 'unavailable';
      readonly diagnostic: LocalizationDiagnostic;
    };

/** Select a unit and format it in one step. */
export function resolveRelativeTime(
  target: InstantValue,
  reference: InstantValue,
  policy: RelativeTimePolicy,
  context: FormattingContext,
  options: Intl.RelativeTimeFormatOptions = {},
): RelativeTimeOutcome {
  const decision = selectRelativeTime(target, reference, policy);
  if (decision.unit === undefined) {
    if (decision.elapsedMilliseconds === undefined) {
      return Object.freeze({
        kind: 'unavailable',
        diagnostic: decision.diagnostic,
      });
    }
    return Object.freeze({
      kind: 'absolute',
      elapsedMilliseconds: decision.elapsedMilliseconds,
    });
  }

  const result = formatRelativeTime(
    decimal(String(decision.value)),
    decision.unit,
    context,
    options,
  );

  return result.ok
    ? Object.freeze({
        kind: 'relative',
        unit: decision.unit,
        value: decision.value,
        formatted: result.value,
      })
    : Object.freeze({ kind: 'unavailable', diagnostic: result.diagnostic });
}
