/**
 * A context disposed while something it started is still running.
 *
 * `specs/06-runtime-and-angular.spec.md` section 11: destroying a context cancels its pending
 * work. Disposal ends what the context started without waiting for it: an initialization that had
 * prepared everything commits nothing, so no commit hook is handed a snapshot; a restore waiting
 * on a store ends without the store's answer; and a progressive scope whose loader has not
 * answered is reported cancelled then, not whenever the loader gets round to answering.
 */
import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import type { LocalizationCommitHook } from '../src/localization.js';
import type { LocalizationPersistenceStore } from '../src/persistence.js';

import { catalogKey } from './catalog-store-harness.js';
import {
  LAZY,
  observed,
  participant,
  runtime,
  until,
} from './transaction-runtime-harness.js';

/** Every microtask and timer already due, for a case that releases nothing it holds. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('a context disposed with work still running', () => {
  it('hands no commit hook the snapshot of an initialization that had prepared everything', async () => {
    const applied: string[] = [];
    const hook: LocalizationCommitHook = {
      apply: (snapshot) => void applied.push(snapshot.primaryLocale),
    };
    const region = participant('region', { hold: ['en-US'] });
    const { localization } = runtime({ options: { commitHooks: [hook] } });
    const registration = localization.registerParticipant(region.value);

    const initializing = localization.initialize();
    // Held until the catalogs are in, so that nothing but the commit is left once it answers.
    await expect.poll(() => region.calls).toStrictEqual(['prepare en-US']);
    region.release('en-US');
    await until(() => registration.state().attempt.status === 'prepared');
    localization.dispose();

    const failure: unknown = await initializing.catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(LocalizationError);
    expect(failure).toMatchObject({ diagnostic: { code: 'disposed' } });
    // The disposal is the failure itself and stands for nothing else, so it carries no cause.
    expect((failure as LocalizationError).cause).toBeUndefined();
    expect(applied).toStrictEqual([]);
  });

  it('ends a restore that is waiting on a store, without the answer of the store', async () => {
    let asked = false;
    const store: LocalizationPersistenceStore = {
      id: 'never-answers',
      read: () => {
        if (!asked) return undefined;
        return new Promise<string | undefined>(() => undefined);
      },
      write: () => undefined,
    };
    const { localization } = runtime({ options: { persistence: [store] } });
    await localization.initialize();
    asked = true;
    let ended = false;
    void localization.ɵrestoreLocale({ url: '/second' }).then((result) => {
      ended = result === undefined;
    });
    await settled();

    localization.dispose();
    await settled();

    expect(ended).toBe(true);
  });

  it('reports a progressive scope as cancelled while its loader has still not answered', async () => {
    const watched = observed();
    const { localization, loads } = runtime({
      hold: [catalogKey('lazy', 'ar-EG')],
      options: { observability: watched.emitter },
    });
    await localization.initialize();
    await localization.changeLocale('ar-EG', {
      mode: 'progressive',
      progressiveScopes: [LAZY],
    });
    await expect.poll(() => loads[catalogKey('lazy', 'ar-EG')]).toBe(1);

    localization.dispose();
    await settled();

    expect(
      watched
        .phase('catalog')
        .filter(({ scopeId }) => scopeId === LAZY.scopeId)
        .map(({ status, reason }) => [status, reason]),
    ).toStrictEqual([
      ['started', undefined],
      ['cancelled', 'disposed'],
    ]);
  });
});
