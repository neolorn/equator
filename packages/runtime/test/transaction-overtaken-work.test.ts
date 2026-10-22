/**
 * What a locale change does to the work an earlier intent left running.
 *
 * `specs/06-runtime-and-angular.spec.md` section 7: the latest distinct intent wins, and
 * superseded work is cancelled where cancellation is possible and invalidated by transition
 * identity in every case. So a change tells running work to stop when it is asked for, not when it
 * gets its turn. What the change itself set going by initializing the context is no earlier
 * intent, and the change does not stop it on the way to its own work. A progressive scope that
 * lands after a newer change committed belongs to a snapshot that is gone and is dropped, and
 * participants that prepared for a change that was then superseded each end as superseded under
 * their own name.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';
import type {
  LocalizationParticipant,
  LocalizationParticipantReport,
} from '@neolorn/equator/core';

import { catalogKey } from './catalog-store-harness.js';
import {
  LAZY,
  SHELL,
  observed,
  participant,
  runtime,
  until,
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

/** A participant whose first preparation fails, so that it registers and shows nothing. */
function failingOnce(id: string) {
  const made = participant(id);
  const answers: LocalizationParticipantReport[] = [FAILED];
  const value: LocalizationParticipant = {
    ...made.value,
    prepare: async (context) =>
      answers.shift() ?? (await made.value.prepare(context)),
  };
  return { ...made, value };
}

describe('a locale change asked of a ready context', () => {
  it('has told a participant still preparing for the earlier locale to stop by the time changeLocale() returns', async () => {
    const region = participant('region', { hold: ['ar-EG'] });
    const { localization } = runtime();
    localization.registerParticipant(region.value, {
      coordination: 'progressive',
    });
    await localization.initialize();
    await localization.changeLocale('ar-EG');
    await until(() => region.calls.includes('prepare ar-EG'));

    const change = localization.changeLocale('en-US');
    const stopped = region.contexts.at(-1)?.signal.aborted;

    expect(stopped).toBe(true);
    region.release('ar-EG');
    await change;
    localization.dispose();
  });
});

describe('a locale change asked of a context that has not initialized', () => {
  it('leaves a participant the initialization set preparing alone until it has work of its own for it', async () => {
    const region = participant('region', { hold: ['en-US'] });
    const { localization, loads, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    const registration = localization.registerParticipant(region.value, {
      coordination: 'progressive',
    });

    const change = localization.changeLocale('ar-EG');
    // The change has initialized the context and is asking for its own catalog.
    await expect.poll(() => loads[catalogKey('shell', 'ar-EG')]).toBe(1);
    const stopped = region.contexts.map(({ signal }) => signal.aborted);

    expect(region.calls).toStrictEqual(['prepare en-US']);
    expect(stopped).toStrictEqual([false]);
    release(catalogKey('shell', 'ar-EG'));
    await change;
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('ar-EG');
    localization.dispose();
  });
});

describe('a progressive scope that cancellation did not reach', () => {
  it('is dropped when it lands after a newer change committed', async () => {
    let next: Promise<unknown> | undefined;
    const hook: LocalizationCommitHook = {
      apply: () => undefined,
      // Asked from inside the commit, so the change it supersedes starts its progressive scope
      // after the newer change has already told running work to stop.
      committed: (snapshot) => {
        if (snapshot.primaryLocale === 'ar-EG' && next === undefined) {
          next = made.localization.changeLocale('en-US');
        }
      },
    };
    const made = runtime({
      hold: [catalogKey('lazy', 'ar-EG')],
      options: { commitHooks: [hook] },
    });
    const { localization, release } = made;
    await localization.initialize();

    await localization.changeLocale('ar-EG', {
      mode: 'progressive',
      progressiveScopes: [LAZY],
    });
    await next;
    release(catalogKey('lazy', 'ar-EG'));
    await settled();

    expect(localization.snapshot()).toMatchObject({
      primaryLocale: 'en-US',
      loadedScopes: [SHELL],
    });
    localization.dispose();
  });

  it('is dropped, and nothing is thrown, when its catalog fails after a newer change committed', async () => {
    let next: Promise<unknown> | undefined;
    const hook: LocalizationCommitHook = {
      apply: () => undefined,
      committed: (snapshot) => {
        if (snapshot.primaryLocale === 'ar-EG' && next === undefined) {
          next = made.localization.changeLocale('en-US');
        }
      },
    };
    const watched = observed();
    const made = runtime({
      hold: [catalogKey('lazy', 'ar-EG')],
      fail: { [catalogKey('lazy', 'ar-EG')]: 1 },
      options: { commitHooks: [hook], observability: watched.emitter },
    });
    const { localization, release } = made;
    const failed = (): boolean =>
      watched
        .phase('catalog')
        .some(
          ({ status, scopeId, targetLocale }) =>
            status === 'failed' &&
            scopeId === 'lazy' &&
            targetLocale === 'ar-EG',
        );
    // Nothing awaits a progressive load, so a throw inside one surfaces here and nowhere else.
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', listener);
    await localization.initialize();

    try {
      await localization.changeLocale('ar-EG', {
        mode: 'progressive',
        progressiveScopes: [LAZY],
      });
      await next;
      release(catalogKey('lazy', 'ar-EG'));
      await expect.poll(failed).toBe(true);
      await settled();
    } finally {
      process.off('unhandledRejection', listener);
    }

    expect(unhandled).toStrictEqual([]);
    expect(localization.snapshot()).toMatchObject({
      primaryLocale: 'en-US',
      loadedScopes: [SHELL],
    });
    localization.dispose();
  });
});

describe('a change to the committed locale that two participants are behind on', () => {
  it('ends each participant as superseded under its own name when a newer change overtakes it after they answered', async () => {
    const north = failingOnce('north');
    const south = failingOnce('south');
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    await localization.initialize();
    const registrations = [north, south].map(({ value }) =>
      localization.registerParticipant(value),
    );
    const attempts = () =>
      registrations.map((registration) => registration.state().attempt);
    await expect
      .poll(() => attempts().map(({ status }) => status))
      .toStrictEqual(['failed', 'failed']);

    const change = localization.changeLocale('en-US');
    await until(() => attempts().every(({ status }) => status === 'prepared'));
    // Held on its catalog, so the newer change prepares no participant while the case reads.
    const newer = localization.changeLocale('ar-EG');

    await expect(change).resolves.toMatchObject({ status: 'superseded' });
    expect(
      attempts().map(({ status, diagnostic }) => [
        status,
        diagnostic?.code,
        diagnostic?.participantId,
      ]),
    ).toStrictEqual([
      ['superseded', 'superseded', 'north'],
      ['superseded', 'superseded', 'south'],
    ]);
    release(catalogKey('shell', 'ar-EG'));
    await newer;
    localization.dispose();
  });
});
