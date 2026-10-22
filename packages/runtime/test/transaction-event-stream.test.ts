/**
 * What a runtime tells its observer about the work a transaction does.
 *
 * `specs/06-runtime-and-angular.spec.md` section 9 has a runtime report what it loaded for which
 * locale and how each load ended, and section 7 has a failure reported where it happened and never
 * swallowed. An observer is how an application sees both without reading the context, so an event
 * carries the locale, the scope, the transition and the reason it belongs to, and a runtime built
 * without an observer does the same work and reports to nobody.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';
import { LocalizationError } from '@neolorn/equator/core';

import { PROVIDER, catalogKey } from './catalog-store-harness.js';
import {
  LAZY,
  SHELL,
  UNCOMPILED,
  observed,
  participant,
  runtime,
  withUncompiledScope,
  withUntranslatedLocale,
} from './transaction-runtime-harness.js';

describe('the events of an initialization', () => {
  it('open and close the attempt, with the snapshot it committed', async () => {
    const watched = observed();
    const { localization } = runtime({
      options: { observability: watched.emitter },
    });

    await localization.initialize();

    expect(watched.phase('initialization')).toStrictEqual([
      { status: 'started', transitionId: 0 },
      {
        status: 'succeeded',
        targetLocale: 'en-US',
        transitionId: 0,
        snapshotId: 1,
      },
    ]);
    localization.dispose();
  });

  it('name each catalog load and the locale that supplied it', async () => {
    const watched = observed();
    const { localization } = runtime({
      options: { observability: watched.emitter },
    });

    await localization.initialize();

    expect(watched.phase('catalog')).toStrictEqual([
      {
        status: 'started',
        targetLocale: 'en-US',
        providerId: PROVIDER,
        scopeId: 'shell',
        transitionId: 0,
      },
      {
        status: 'succeeded',
        targetLocale: 'en-US',
        supplyingLocale: 'en-US',
        providerId: PROVIDER,
        scopeId: 'shell',
        transitionId: 0,
        count: 1,
      },
    ]);
    localization.dispose();
  });

  it('count the source locale behind the target one', async () => {
    const watched = observed();
    const { localization } = runtime({
      options: { observability: watched.emitter },
    });
    await localization.initialize();

    await localization.changeLocale('ar-EG');

    expect(watched.phase('catalog').at(-1)).toMatchObject({
      status: 'succeeded',
      targetLocale: 'ar-EG',
      supplyingLocale: 'ar-EG',
      transitionId: 1,
      count: 2,
    });
    localization.dispose();
  });

  it('close a failed attempt with its reason and the locale it was for', async () => {
    const watched = observed();
    const { localization } = runtime({
      fail: { [catalogKey('shell', 'ar-EG')]: 1 },
      options: { initialLocale: 'ar-EG', observability: watched.emitter },
    });

    await expect(localization.initialize()).rejects.toBeDefined();

    expect(watched.phase('initialization')).toStrictEqual([
      { status: 'started', transitionId: 0 },
      {
        status: 'failed',
        reason: 'catalog-load-failed',
        targetLocale: 'ar-EG',
        transitionId: 0,
      },
    ]);
    localization.dispose();
  });

  it('close an attempt the context was disposed under as cancelled', async () => {
    const watched = observed();
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'en-US')],
      options: { observability: watched.emitter },
    });

    const initializing = localization.initialize();
    localization.dispose();
    release(catalogKey('shell', 'en-US'));
    await expect(initializing).rejects.toBeDefined();

    expect(watched.phase('initialization').at(-1)).toMatchObject({
      status: 'cancelled',
      targetLocale: 'en-US',
      transitionId: 0,
    });
  });
});

describe('the event that closes a catalog load that did not succeed', () => {
  it('says the scope is unavailable when a strict policy refuses the source locale', async () => {
    const watched = observed();
    const { localization } = runtime({
      set: withUntranslatedLocale(),
      setup: { fallbackPolicy: 'strict' },
      options: { observability: watched.emitter },
    });
    await localization.initialize();

    await localization.changeLocale('fr-FR');

    expect(watched.phase('catalog').at(-1)).toMatchObject({
      status: 'unavailable',
      reason: 'scope-unavailable',
      targetLocale: 'fr-FR',
      providerId: PROVIDER,
      scopeId: 'shell',
      transitionId: 1,
    });
    localization.dispose();
  });

  it('says the load failed when the scope has no source catalog', async () => {
    const watched = observed();
    const { localization } = runtime({
      set: withUncompiledScope(),
      options: { observability: watched.emitter },
    });
    await localization.initialize();

    await localization.changeLocale('ar-EG', {
      requiredScopes: [SHELL, UNCOMPILED],
    });

    expect(
      watched
        .phase('catalog')
        .filter(({ scopeId }) => scopeId === 'uncompiled')
        .at(-1),
    ).toMatchObject({
      status: 'failed',
      reason: 'invalid-configuration',
      targetLocale: 'ar-EG',
      providerId: PROVIDER,
      transitionId: 1,
    });
    localization.dispose();
  });

  it('says the load failed when a loader did', async () => {
    const watched = observed();
    const { localization } = runtime({
      fail: { [catalogKey('lazy', 'ar-EG')]: 1 },
      options: { observability: watched.emitter },
    });
    await localization.initialize();

    await localization.changeLocale('ar-EG', { requiredScopes: [SHELL, LAZY] });

    expect(
      watched
        .phase('catalog')
        .filter(({ scopeId }) => scopeId === 'lazy')
        .at(-1),
    ).toMatchObject({
      status: 'failed',
      reason: 'catalog-load-failed',
      targetLocale: 'ar-EG',
      providerId: PROVIDER,
      transitionId: 1,
    });
    localization.dispose();
  });

  it('says the load was superseded when a newer locale overtook it', async () => {
    const watched = observed();
    const { localization, release } = runtime({
      hold: [catalogKey('lazy', 'ar-EG')],
      options: { observability: watched.emitter },
    });
    await localization.initialize();
    await localization.changeLocale('ar-EG', {
      mode: 'progressive',
      progressiveScopes: [LAZY],
    });
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('loading');

    await localization.changeLocale('en-US');
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('failed');

    expect(
      watched
        .phase('catalog')
        .filter(
          ({ scopeId, targetLocale }) =>
            scopeId === 'lazy' && targetLocale === 'ar-EG',
        )
        .at(-1),
    ).toMatchObject({ status: 'superseded', reason: 'superseded' });
    release(catalogKey('lazy', 'ar-EG'));
    localization.dispose();
  });

  it('says the load was cancelled when the context was disposed under it', async () => {
    const watched = observed();
    const { localization, release } = runtime({
      hold: [catalogKey('lazy', 'en-US')],
      options: { observability: watched.emitter },
    });
    await localization.initialize();
    const ensured = localization.ensureScope(LAZY);
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('loading');

    localization.dispose();
    release(catalogKey('lazy', 'en-US'));
    await expect(ensured).rejects.toBeDefined();

    expect(
      watched
        .phase('catalog')
        .filter(({ scopeId }) => scopeId === 'lazy')
        .at(-1),
    ).toMatchObject({ status: 'cancelled', reason: 'disposed' });
  });
});

describe('the event of a locale change that runs no transaction', () => {
  it('reports a refused locale as a failed transition', async () => {
    const watched = observed();
    const { localization } = runtime({
      options: { observability: watched.emitter },
    });
    await localization.initialize();

    await localization.changeLocale('de-DE');

    expect(watched.phase('transition')).toStrictEqual([
      {
        status: 'failed',
        reason: 'unsupported-locale',
        targetLocale: 'de-DE',
        transitionId: 1,
      },
    ]);
    localization.dispose();
  });

  it('reports a change another origin serves as redirected', async () => {
    const watched = observed();
    const { localization } = runtime({
      options: { observability: watched.emitter },
    });
    await localization.initialize();
    localization.ɵclaimLocaleChange((locale) =>
      locale === 'ar-EG' ? 'https://ar.example.test/' : undefined,
    );

    await localization.changeLocale('ar-EG');

    expect(watched.phase('transition')).toStrictEqual([
      { status: 'redirected', targetLocale: 'ar-EG', transitionId: 1 },
    ]);
    localization.dispose();
  });
});

describe('the event of a snapshot that was refused or badly received', () => {
  const refusing: LocalizationCommitHook = {
    apply: (snapshot) => {
      if (snapshot.primaryLocale === 'ar-EG') {
        throw new Error('the hook under test refused the snapshot');
      }
    },
  };

  it('names no participant when a hook refused it', async () => {
    const watched = observed();
    const { localization } = runtime({
      options: { commitHooks: [refusing], observability: watched.emitter },
    });
    await localization.initialize();

    await localization.changeLocale('ar-EG');

    expect(watched.phase('integration')).toStrictEqual([
      {
        status: 'failed',
        reason: 'internal-invariant',
        targetLocale: 'ar-EG',
        snapshotId: 2,
      },
    ]);
    localization.dispose();
  });

  it('names the participant a hook blames once the snapshot is current', async () => {
    const watched = observed();
    const { localization } = runtime({
      options: {
        commitHooks: [
          {
            apply: () => undefined,
            committed: () => {
              throw new LocalizationError({
                code: 'participant-failed',
                outcome: 'operational-failure',
                message: 'the hook under test blamed a participant',
                participantId: 'region',
              });
            },
          },
        ],
        observability: watched.emitter,
      },
    });

    await localization.initialize();

    expect(watched.phase('integration')).toStrictEqual([
      {
        status: 'failed',
        reason: 'participant-failed',
        targetLocale: 'en-US',
        participantId: 'region',
        snapshotId: 1,
      },
    ]);
    localization.dispose();
  });

  it('names the participant whose preparation failed the change', async () => {
    const watched = observed();
    const region = participant('region');
    const { localization } = runtime({
      options: { observability: watched.emitter },
    });
    localization.registerParticipant({
      ...region.value,
      prepare: (context) => {
        if (context.targetLocale === 'ar-EG') {
          throw new Error('the participant under test failed to prepare');
        }
        return region.value.prepare(context);
      },
    });
    await localization.initialize();

    await localization.changeLocale('ar-EG');

    expect(watched.phase('integration')).toStrictEqual([
      {
        status: 'failed',
        reason: 'participant-failed',
        targetLocale: 'ar-EG',
        participantId: 'region',
        transitionId: 1,
      },
    ]);
    localization.dispose();
  });
});

describe('a runtime built without an observer', () => {
  it('commits a snapshot whose hook failed after the commit', async () => {
    const { localization } = runtime({
      options: {
        commitHooks: [
          {
            apply: () => undefined,
            committed: () => {
              throw new Error('the hook under test failed after the commit');
            },
          },
        ],
      },
    });

    const snapshot = await localization.initialize();

    expect(localization.snapshot()).toBe(snapshot);
    expect(localization.lifecycle()).toBe('ready');
    localization.dispose();
  });
});

describe('the events of a locale change the application cancelled', () => {
  it('close the catalog load it was waiting for as cancelled', async () => {
    const watched = observed();
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
      options: { observability: watched.emitter },
    });
    await localization.initialize();
    const change = localization.changeLocale('ar-EG');
    await expect
      .poll(() => localization.scopeReadiness(SHELL)().status)
      .toBe('loading');

    localization.cancelTransition();
    release(catalogKey('shell', 'ar-EG'));

    await expect(change).resolves.toMatchObject({ status: 'cancelled' });
    expect(watched.phase('catalog').at(-1)).toMatchObject({
      status: 'cancelled',
      reason: 'cancelled',
      targetLocale: 'ar-EG',
      scopeId: 'shell',
    });
    localization.dispose();
  });

  it('name no participant, because none of them failed', async () => {
    const watched = observed();
    const region = participant('region', { hold: ['ar-EG'] });
    const { localization } = runtime({
      options: { observability: watched.emitter },
    });
    localization.registerParticipant(region.value);
    await localization.initialize();
    const change = localization.changeLocale('ar-EG');
    await expect
      .poll(() => region.calls)
      .toStrictEqual(['prepare en-US', 'commit en-US', 'prepare ar-EG']);

    localization.cancelTransition();

    await expect(change).resolves.toMatchObject({ status: 'cancelled' });
    expect(watched.phase('integration')).toStrictEqual([
      {
        status: 'failed',
        reason: 'cancelled',
        targetLocale: 'ar-EG',
        transitionId: 1,
      },
    ]);
    region.release('ar-EG');
    localization.dispose();
  });

  it('name a participant whose discard answered with a promise, after the cancellation', async () => {
    const watched = observed();
    const region = participant('region', { hold: ['ar-EG'] });
    const { localization } = runtime({
      options: { observability: watched.emitter },
    });
    localization.registerParticipant({
      ...region.value,
      discard: (() => Promise.resolve()) as unknown as () => void,
    });
    await localization.initialize();
    const change = localization.changeLocale('ar-EG');
    await expect
      .poll(() => region.calls)
      .toStrictEqual(['prepare en-US', 'commit en-US', 'prepare ar-EG']);

    localization.cancelTransition();

    await expect(change).resolves.toMatchObject({
      status: 'cancelled',
      diagnostic: { code: 'cancelled' },
    });
    expect(watched.phase('integration')).toStrictEqual([
      {
        status: 'failed',
        reason: 'participant-contract-rejected',
        participantId: 'region',
        targetLocale: 'ar-EG',
        transitionId: 1,
      },
      {
        status: 'failed',
        reason: 'cancelled',
        targetLocale: 'ar-EG',
        transitionId: 1,
      },
    ]);
    region.release('ar-EG');
    localization.dispose();
  });

  it('report a disposal that answered with a promise, naming the participant alone', async () => {
    const watched = observed();
    const { localization } = runtime({
      options: { observability: watched.emitter },
    });
    localization.registerParticipant({
      ...participant('region').value,
      dispose: (() => Promise.resolve()) as unknown as () => void,
    });
    await localization.initialize();

    localization.dispose();

    expect(watched.phase('integration')).toStrictEqual([
      {
        status: 'failed',
        reason: 'participant-contract-rejected',
        participantId: 'region',
      },
    ]);
  });
});
