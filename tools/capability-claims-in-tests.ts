import { expect, onTestFinished } from 'vitest';

import {
  CLAIMS_META_KEY,
  claimRecord,
  type CapabilityObservation,
  type ClaimsMeta,
} from './capability-claims.ts';

export type { CapabilityObservation } from './capability-claims.ts';

/**
 * States, after a test's assertions, which capability they asserted and what context they ran in.
 *
 * Called last in the test, so every assertion before it has already passed by the time it runs. It
 * throws when nothing has been asserted yet, because a claim with no assertion before it is a claim
 * about nothing, and a test that makes one is wrong in a way its author should hear about at once.
 *
 * The claim is held until the attempt finishes and kept only if the attempt passed. A retried
 * test's failed attempts leave nothing, and `verify:matrix`'s reporter reads the test's final
 * state again before writing anything, so a test marked to fail that passes records nothing either.
 */
export function claimCapability(
  capability: `${string}:${string}`,
  observed?: CapabilityObservation,
): void {
  const assertions = expect.getState().assertionCalls;
  if (assertions === 0) {
    throw new Error(
      `claimCapability(${JSON.stringify(capability)}) was called before any assertion. A claim states what the assertions before it proved.`,
    );
  }
  const record = { ...claimRecord(capability, observed), assertions };
  onTestFinished(({ task }) => {
    if (task.result?.state !== 'pass') return;
    ((task.meta as ClaimsMeta)[CLAIMS_META_KEY] ??= []).push(record);
  });
}
