/**
 * A locale change that is interrupted late: cancelled after its required participants have
 * prepared, or left without a context by the commit it made.
 *
 * `specs/06-runtime-and-angular.spec.md` section 7 ends a cancelled change without committing
 * anything, and section 8 has a required participant take part in the change it prepared for. A
 * participant that has answered is therefore owed exactly one of commit and discard, and a change
 * cancelled between the answer and the commit owes it the discard. The same holds for a change to
 * the locale already committed, which has nothing to do except bring a participant that is not
 * showing that locale up to it, and which is in transition towards that locale while it waits.
 * Section 11 lets a context be destroyed at any time, which includes from the hook that is told of
 * a commit, and a change whose snapshot reached the hooks did commit.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';
import type {
  LocalizationParticipant,
  LocalizationParticipantReport,
} from '@neolorn/equator/core';

import {
  LAZY,
  SHELL,
  observed,
  participant,
  runtime,
  until,
  type Runtime,
} from './transaction-runtime-harness.js';

/** Every microtask and timer already due, for a case that states what did not happen. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const FAILED: LocalizationParticipantReport = Object.freeze({
  status: 'failed',
  outcome: 'operational-failure',
  reason: 'environment-failure',
});

/**
 * A ready context in `en-US` with one required participant that is not showing it.
 *
 * The participant registers after the first snapshot and fails the preparation that brings it up
 * to date, so it stays registered and shows nothing, which is the state a change to the committed
 * locale has work to do in.
 */
async function behind(fixture: Parameters<typeof participant>[1] = {}) {
  const region = participant('region', fixture);
  const answers: LocalizationParticipantReport[] = [FAILED];
  const value: LocalizationParticipant = {
    ...region.value,
    prepare: async (context) =>
      answers.shift() ?? (await region.value.prepare(context)),
  };
  const { localization } = runtime();
  await localization.initialize();
  const registration = localization.registerParticipant(value);
  await expect.poll(() => registration.state().attempt.status).toBe('failed');
  region.calls.length = 0;
  return { localization, region, registration };
}

describe('a change to the committed locale that a participant is behind on', () => {
  it('is in transition towards that locale while the participant prepares', async () => {
    const { localization, region, registration } = await behind({
      hold: ['en-US'],
    });

    const change = localization.changeLocale('en-US');
    await until(() => region.calls.includes('prepare en-US'));

    expect(localization.lifecycle()).toBe('transitioning');
    expect(localization.targetLocale()).toBe('en-US');

    region.release('en-US');
    await expect(change).resolves.toMatchObject({ status: 'committed' });
    expect(localization.lifecycle()).toBe('ready');
    expect(localization.targetLocale()).toBeUndefined();
    expect(region.calls).toStrictEqual(['prepare en-US', 'commit en-US']);
    expect(registration.state().current?.targetLocale).toBe('en-US');
    localization.dispose();
  });

  it('discards the participant when it is cancelled after the participant answered', async () => {
    const { localization, region, registration } = await behind();

    const change = localization.changeLocale('en-US');
    await until(() => registration.state().attempt.status === 'prepared');
    localization.cancelTransition();

    await expect(change).resolves.toMatchObject({
      status: 'cancelled',
      diagnostic: { code: 'cancelled' },
    });
    expect(region.calls).toStrictEqual(['prepare en-US', 'discard en-US']);
    expect(registration.state().current).toBeUndefined();
    expect(localization.lifecycle()).toBe('ready');
    localization.dispose();
  });
});

describe('a change to another locale', () => {
  it('discards a participant that answered when it is cancelled before it commits', async () => {
    const region = participant('region');
    const { localization } = runtime();
    const registration = localization.registerParticipant(region.value);
    const committed = await localization.initialize();
    // Warmed first, so that the change waits on nothing that a turn of the queue does not bring.
    await localization.preloadScope(SHELL, 'ar-EG');

    const change = localization.changeLocale('ar-EG');
    await until(() => {
      const { status, targetLocale } = registration.state().attempt;
      return status === 'prepared' && targetLocale === 'ar-EG';
    });
    localization.cancelTransition();

    await expect(change).resolves.toMatchObject({ status: 'cancelled' });
    expect(region.calls).toStrictEqual([
      'prepare en-US',
      'commit en-US',
      'prepare ar-EG',
      'discard ar-EG',
    ]);
    expect(registration.state().current?.targetLocale).toBe('en-US');
    expect(localization.snapshot()).toBe(committed);
    localization.dispose();
  });
});

describe('a change whose commit hook destroys the context', () => {
  it.each(['coordinated', 'progressive'] as const)(
    'reports the %s change as committed, with the snapshot the hook was told of',
    async (mode) => {
      let localization!: Runtime;
      const told: string[] = [];
      const hook: LocalizationCommitHook = {
        apply: () => undefined,
        committed: (snapshot) => {
          told.push(snapshot.primaryLocale);
          if (snapshot.primaryLocale === 'ar-EG') localization.dispose();
        },
      };
      const watched = observed();
      const stored: string[] = [];
      ({ localization } = runtime({
        options: {
          commitHooks: [hook],
          observability: watched.emitter,
          persistence: [
            {
              id: 'memory',
              read: () => undefined,
              write: (locale) => void stored.push(locale),
            },
          ],
        },
      }));
      await localization.initialize();

      const result = await localization.changeLocale('ar-EG', {
        mode,
        progressiveScopes: [LAZY],
      });
      await settled();

      expect(result).toMatchObject({
        status: 'committed',
        targetLocale: 'ar-EG',
        snapshot: { primaryLocale: 'ar-EG' },
      });
      expect(told).toStrictEqual(['en-US', 'ar-EG']);
      expect(localization.snapshot()).toBeUndefined();
      // The change committed, so the choice is remembered. The context it left behind is not
      // ready, and nothing is loaded into it afterwards.
      expect(stored).toStrictEqual(['ar-EG']);
      expect(localization.lifecycle()).toBe('failed');
      expect(
        watched
          .phase('catalog')
          .filter(
            ({ scopeId, targetLocale, status }) =>
              scopeId === 'lazy' &&
              targetLocale === 'ar-EG' &&
              status === 'started',
          ),
      ).toHaveLength(mode === 'coordinated' ? 1 : 0);
    },
  );

  it('reports a change committed by a participant that then destroys the context', async () => {
    const { localization, region } = await behind();
    const leaving: LocalizationParticipant = {
      ...region.value,
      id: 'leaving',
      commit: () => localization.dispose(),
    };
    const snapshot = localization.snapshot();
    localization.registerParticipant(leaving);

    const result = await localization.changeLocale('en-US');

    expect(result).toMatchObject({ status: 'committed', snapshot });
    expect(localization.snapshot()).toBeUndefined();
    expect(localization.lifecycle()).toBe('failed');
  });
});
