/**
 * A retry asked for again before the attempt it started has ended.
 *
 * `specs/06-runtime-and-angular.spec.md` section 5: equivalent concurrent initialization is one
 * attempt, and an explicit retry starts a new attempt. Two retry controls on one page, or an
 * application calling `retry()` beside the control, ask twice for the same thing.
 */
import { describe, expect, it } from 'vitest';

import {
  catalogKey,
  diagnosticOf,
  rejectionOf,
} from './catalog-store-harness.js';
import { runtime } from './transaction-runtime-harness.js';

const SOURCE = catalogKey('shell', 'en-US');

/** A runtime whose first `failures` loads of the source catalog fail, after its first attempt. */
async function failed(failures = 1) {
  const made = runtime({ fail: { [SOURCE]: failures } });
  await rejectionOf(() => made.localization.initialize());
  return made;
}

describe('a retry asked for while an attempt that followed a failure is in flight', () => {
  it('is that attempt, and loads nothing twice', async () => {
    const { localization, loads } = await failed();

    const first = localization.retry();
    const second = localization.retry();

    expect(second).toBe(first);
    const snapshot = await first;
    expect(snapshot).toBe(localization.snapshot());
    expect(loads[SOURCE]).toBe(2);
    localization.dispose();
  });

  it('ends as that attempt does when it fails, and a later retry is a new attempt', async () => {
    const { localization, loads } = await failed(2);

    const first = localization.retry();
    const second = localization.retry();

    await expect(rejectionOf(() => first)).resolves.toMatchObject({
      code: 'catalog-load-failed',
    });
    await expect(rejectionOf(() => second)).resolves.toMatchObject({
      code: 'catalog-load-failed',
    });
    expect(loads[SOURCE]).toBe(2);

    await expect(localization.retry()).resolves.toMatchObject({
      primaryLocale: 'en-US',
    });
    expect(loads[SOURCE]).toBe(3);
    localization.dispose();
  });

  it('is the attempt another request began after the failure', async () => {
    const { localization, loads } = await failed();

    const attempt = localization.initialize();
    const retried = localization.retry();

    expect(retried).toBe(attempt);
    await attempt;
    expect(loads[SOURCE]).toBe(2);
    localization.dispose();
  });
});

describe('a retry asked for while the first attempt is in flight', () => {
  it('is refused, because nothing has failed', async () => {
    const { localization } = runtime();
    const first = localization.initialize();

    expect(diagnosticOf(() => localization.retry())).toMatchObject({
      code: 'invalid-configuration',
    });
    await first;
    localization.dispose();
  });
});
