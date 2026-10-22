/**
 * What a context with no event sink does where one with a sink would report.
 *
 * `specs/06-runtime-and-angular.spec.md` section 1 lists the observability sink among the
 * features an application chooses. A context without a sink has nobody to tell, and the outcome it
 * would have reported beside is the same outcome: a disposal goes through, a restore that has
 * nothing to do answers with nothing, and a failed initialization fails with the failure that
 * ended it.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationParticipant } from '@neolorn/equator/core';

import { catalogKey, rejectionOf } from './catalog-store-harness.js';
import { TITLE, participant, runtime } from './transaction-runtime-harness.js';

const HERE = { url: '/second' };

describe('a context with no event sink', () => {
  it('is disposed although a participant answered its disposal with a promise', async () => {
    const region = participant('region');
    const value: LocalizationParticipant = {
      ...region.value,
      dispose: (() => Promise.resolve()) as unknown as () => void,
    };
    const { localization } = runtime();
    localization.registerParticipant(value);
    await localization.initialize();

    expect(() => localization.dispose()).not.toThrow();
    expect(localization.snapshot()).toBeUndefined();
  });

  it('answers a restore after hydration with nothing where the browser drew the page itself', async () => {
    const { localization } = runtime();
    await localization.initialize();

    await expect(
      localization.ɵrestoreAfterHydration({
        hydrated: Promise.resolve(),
        destroyed: () => false,
        address: () => HERE,
      }),
    ).resolves.toBeUndefined();
    localization.dispose();
  });

  it('answers a restore after hydration with nothing where the application was destroyed first', async () => {
    const { localization } = runtime({ options: { initialLocale: 'en-US' } });
    await localization.initialize();

    await expect(
      localization.ɵrestoreAfterHydration({
        hydrated: Promise.resolve(),
        destroyed: () => true,
        address: () => HERE,
      }),
    ).resolves.toBeUndefined();
    localization.dispose();
  });

  it('fails an initialization with the load failure where the recovery message cannot be evaluated', async () => {
    const { localization } = runtime({
      fail: { [catalogKey('shell', 'en-US')]: 1 },
      setup: {
        recoveryPayload: [
          {
            identity: TITLE.identity,
            locale: 'en-US',
            sourceFingerprint: 'recovery-fixture',
            body: null,
          },
        ],
      },
      options: { recoveryMessageIdentity: TITLE.identity },
    });

    await expect(
      rejectionOf(() => localization.initialize()),
    ).resolves.toMatchObject({ code: 'catalog-load-failed' });
    expect(localization.lifecycle()).toBe('failed');
    expect(localization.recovery()).toBeUndefined();
    localization.dispose();
  });
});
