/**
 * What disposing a context ends, releases and leaves readable.
 *
 * `specs/06-runtime-and-angular.spec.md` section 11: disposal releases what the context holds and
 * what its adapters and participants hold, once, and one adapter failing to release does not keep
 * the others from being asked. Section 5 leaves a disposed context with nothing current: no
 * snapshot, no target, and a lifecycle that is not `ready`. Section 7 ends a change the disposal
 * interrupted as cancelled, because nothing superseded it and nothing failed.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';
import type { LocalizationEventEmitter } from '../src/observability.js';

import {
  PROVIDER,
  catalogKey,
  rejectionOf,
  scope,
} from './catalog-store-harness.js';
import {
  observed,
  participant,
  runtime,
  until,
} from './transaction-runtime-harness.js';

/** A hook that writes down when it is released. */
const releasing = (events: string[], name: string): LocalizationCommitHook => ({
  apply: () => undefined,
  dispose: () => void events.push(`${name} dispose`),
});

describe('disposing a context', () => {
  it('releases each adapter once, however often it is asked', async () => {
    const events: string[] = [];
    const { localization } = runtime({
      options: { commitHooks: [releasing(events, 'hook')] },
    });
    await localization.initialize();

    localization.dispose();
    expect(() => localization.dispose()).not.toThrow();

    expect(events).toStrictEqual(['hook dispose']);
  });

  it('releases the adapters last first', async () => {
    const events: string[] = [];
    const { localization } = runtime({
      options: {
        commitHooks: [releasing(events, 'first'), releasing(events, 'second')],
      },
    });
    await localization.initialize();

    localization.dispose();

    expect(events).toStrictEqual(['second dispose', 'first dispose']);
  });

  it('reports nothing for an adapter that has nothing to release', async () => {
    const watched = observed();
    const { localization } = runtime({
      options: {
        commitHooks: [{ apply: () => undefined }],
        observability: watched.emitter,
      },
    });
    await localization.initialize();

    localization.dispose();

    expect(watched.phase('integration')).toStrictEqual([]);
  });

  it('reports an adapter that failed to release against the snapshot it was released under, and releases the rest', async () => {
    const events: string[] = [];
    const watched = observed();
    const failing: LocalizationCommitHook = {
      apply: () => undefined,
      dispose: () => {
        throw new Error('the adapter under test failed to release');
      },
    };
    const { localization } = runtime({
      options: {
        commitHooks: [releasing(events, 'first'), failing],
        observability: watched.emitter,
      },
    });
    const snapshot = await localization.initialize();

    expect(() => localization.dispose()).not.toThrow();

    expect(events).toStrictEqual(['first dispose']);
    expect(watched.phase('integration')).toStrictEqual([
      {
        status: 'failed',
        reason: 'internal-invariant',
        targetLocale: 'en-US',
        snapshotId: snapshot.id,
      },
    ]);
  });

  it('releases the rest after an adapter failed to release, with no emitter to report it to', async () => {
    const events: string[] = [];
    const { localization } = runtime({
      options: {
        commitHooks: [
          releasing(events, 'first'),
          {
            apply: () => undefined,
            dispose: () => {
              throw new Error('the adapter under test failed to release');
            },
          },
        ],
      },
    });
    await localization.initialize();

    expect(() => localization.dispose()).not.toThrow();

    expect(events).toStrictEqual(['first dispose']);
    expect(localization.snapshot()).toBeUndefined();
  });

  it('reports an adapter that failed to release against no snapshot when there never was one', () => {
    const watched = observed();
    const { localization } = runtime({
      options: {
        commitHooks: [
          {
            apply: () => undefined,
            dispose: () => {
              throw new Error('the adapter under test failed to release');
            },
          },
        ],
        observability: watched.emitter,
      },
    });

    localization.dispose();

    expect(watched.phase('integration')).toStrictEqual([
      { status: 'failed', reason: 'internal-invariant' },
    ]);
  });

  it('releases each participant once', async () => {
    const region = participant('region');
    let released = 0;
    const { localization } = runtime();
    localization.registerParticipant({
      ...region.value,
      dispose: () => {
        released += 1;
      },
    });
    await localization.initialize();

    localization.dispose();
    localization.dispose();

    expect(released).toBe(1);
  });

  it('lets go of the catalogs its snapshot held, which a cache with no room for them then drops', async () => {
    const watched = observed();
    const { localization } = runtime({
      setup: { maximumCachedCatalogs: 1 },
      options: { observability: watched.emitter },
    });
    await localization.initialize();
    await localization.changeLocale('ar-EG');
    const before = watched.phase('cache').length;

    localization.dispose();

    // Both catalogs were held by the snapshot and so over the bound. Released one after the
    // other, the first has no room and the second is the one catalog the bound allows.
    expect(watched.phase('cache').slice(before)).toStrictEqual([
      {
        status: 'succeeded',
        providerId: PROVIDER,
        scopeId: 'shell',
        targetLocale: 'ar-EG',
        count: 1,
      },
    ]);
  });

  it('leaves no snapshot, no target and a lifecycle that is not ready', async () => {
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    await localization.initialize();
    const change = localization.changeLocale('ar-EG');
    await until(() => localization.targetLocale() === 'ar-EG');

    localization.dispose();

    expect(localization.snapshot()).toBeUndefined();
    expect(localization.targetLocale()).toBeUndefined();
    expect(localization.lifecycle()).toBe('failed');
    expect(localization.ready()).toBe(false);
    release(catalogKey('shell', 'ar-EG'));
    await change;
    expect(localization.targetLocale()).toBeUndefined();
    expect(localization.lifecycle()).toBe('failed');
  });

  it('leaves a scope that was ready failed as disposed, to a reader from before and to a later one', async () => {
    const { localization } = runtime();
    await localization.initialize();
    const shell = localization.scopeReadiness(scope('shell'));
    expect(shell()).toMatchObject({ status: 'ready', targetLocale: 'en-US' });

    localization.dispose();

    // The signal read before the disposal answers for it, as one asked for afterwards does.
    for (const readiness of [
      shell(),
      localization.scopeReadiness(scope('shell'))(),
    ]) {
      expect(readiness).toMatchObject({
        scope: scope('shell'),
        status: 'failed',
        supplyingLocales: [],
        diagnostic: {
          code: 'disposed',
          outcome: 'operational-failure',
          message: 'The localization context is disposed.',
        },
      });
      expect(readiness.transitionId).toBeUndefined();
    }
  });

  it('ends the change it interrupted as cancelled, with the change named', async () => {
    const { localization } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    await localization.initialize();
    const change = localization.changeLocale('ar-EG');
    await until(() => localization.targetLocale() === 'ar-EG');

    localization.dispose();

    await expect(change).resolves.toMatchObject({
      status: 'cancelled',
      transitionId: 1,
      targetLocale: 'ar-EG',
      diagnostic: { code: 'cancelled', targetLocale: 'ar-EG', transitionId: 1 },
    });
  });

  it('ends the initialization it interrupted as disposed, and leaves no target behind', async () => {
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'en-US')],
    });
    const initialization = rejectionOf(() => localization.initialize());
    await until(() => localization.targetLocale() === 'en-US');

    localization.dispose();
    release(catalogKey('shell', 'en-US'));

    await expect(initialization).resolves.toMatchObject({ code: 'disposed' });
    expect(localization.targetLocale()).toBeUndefined();
    expect(localization.lifecycle()).toBe('failed');
  });
});

describe('a context disposed by the hook that is told of its first snapshot', () => {
  /** A context whose initialization commits and is disposed in the same step. */
  const leavingAtOnce = (fixture: Parameters<typeof runtime>[0] = {}) => {
    const made = runtime({
      ...fixture,
      options: {
        ...fixture.options,
        commitHooks: [
          {
            apply: () => undefined,
            committed: () => made.localization.dispose(),
          } satisfies LocalizationCommitHook,
        ],
      },
    });
    return made;
  };

  it('answers the initialization with the snapshot it committed, and is not ready', async () => {
    const { localization } = leavingAtOnce();

    await expect(localization.initialize()).resolves.toMatchObject({
      primaryLocale: 'en-US',
    });

    expect(localization.snapshot()).toBeUndefined();
    expect(localization.lifecycle()).toBe('failed');
    expect(localization.ready()).toBe(false);
  });

  it('refuses as disposed a scope request that was waiting for the initialization', async () => {
    const { localization, loads } = leavingAtOnce();

    await expect(
      rejectionOf(() => localization.ensureScope(scope('lazy'))),
    ).resolves.toMatchObject({ code: 'disposed' });
    expect(loads[catalogKey('lazy', 'en-US')]).toBeUndefined();
  });

  it('refuses as disposed a participant retry that was waiting for the initialization', async () => {
    const region = participant('region');
    const { localization } = leavingAtOnce();
    const registration = localization.registerParticipant(region.value, {
      coordination: 'progressive',
    });

    await expect(
      rejectionOf(() => registration.retry()),
    ).resolves.toMatchObject({ code: 'disposed' });
    expect(region.calls).toStrictEqual([]);
  });
});

describe('a disposed context asked for more work', () => {
  it('refuses a retry, a registration and a registration retry as disposed', async () => {
    const region = participant('region');
    const { localization } = runtime();
    const registration = localization.registerParticipant(region.value);
    await localization.initialize();
    localization.dispose();

    await expect(
      rejectionOf(() => localization.retry()),
    ).resolves.toMatchObject({ code: 'disposed' });
    await expect(
      rejectionOf(() => registration.retry()),
    ).resolves.toMatchObject({ code: 'disposed' });
    await expect(
      rejectionOf(() =>
        Promise.resolve().then(() =>
          localization.registerParticipant(participant('late').value),
        ),
      ),
    ).resolves.toMatchObject({ code: 'disposed' });
  });

  it('refuses a scope request, a preload and a change as disposed', async () => {
    const { localization, loads } = runtime();
    await localization.initialize();
    localization.dispose();

    await expect(
      rejectionOf(() => localization.ensureScope(scope('lazy'))),
    ).resolves.toMatchObject({ code: 'disposed' });
    await expect(
      rejectionOf(() => localization.preloadScope(scope('lazy'), 'ar-EG')),
    ).resolves.toMatchObject({ code: 'disposed' });
    await expect(
      rejectionOf(() => localization.changeLocale('ar-EG')),
    ).resolves.toMatchObject({ code: 'disposed' });
    expect(loads[catalogKey('lazy', 'en-US')]).toBeUndefined();
    expect(loads[catalogKey('lazy', 'ar-EG')]).toBeUndefined();
  });
});

describe('a context disposed in the turn a scope finished loading', () => {
  // An observer is told of a finished load before the runtime does anything with it, so one that
  // disposes the context there leaves the runtime holding catalogs for a context that is gone.
  const leavingWhenLoaded = () => {
    const rejections: unknown[] = [];
    const watched = observed();
    const emitter: LocalizationEventEmitter = {
      emit: (input) => {
        watched.emitter.emit(input);
        if (
          input.phase === 'catalog' &&
          input.status === 'succeeded' &&
          input.scopeId === 'lazy'
        ) {
          made.localization.dispose();
        }
      },
    };
    const made = runtime({ options: { observability: emitter } });
    return { ...made, watched, rejections };
  };

  it('drops a scope that was loading beside a change, and fails nothing', async () => {
    const { localization, watched, rejections } = leavingWhenLoaded();
    const record = (reason: unknown): void => void rejections.push(reason);
    process.on('unhandledRejection', record);
    await localization.initialize();
    await localization.changeLocale('ar-EG', {
      mode: 'progressive',
      progressiveScopes: [scope('lazy')],
    });

    await expect.poll(() => localization.snapshot()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', record);

    // The load ended well and was reported so, and nothing after it found the context gone the
    // hard way.
    expect(rejections).toStrictEqual([]);
    expect(
      watched
        .phase('catalog')
        .filter(({ scopeId }) => scopeId === 'lazy')
        .map(({ status }) => status),
    ).toStrictEqual(['started', 'succeeded']);
    expect(localization.snapshot()).toBeUndefined();
  });

  it('refuses as disposed the request that asked for the scope', async () => {
    const { localization } = leavingWhenLoaded();
    await localization.initialize();

    await expect(
      rejectionOf(() => localization.ensureScope(scope('lazy'))),
    ).resolves.toMatchObject({ code: 'disposed' });
    expect(localization.snapshot()).toBeUndefined();
  });
});

describe('a method called on an object that only inherits from a context', () => {
  it('is refused by the library and not by a read of nothing', () => {
    const { localization } = runtime();
    // The state of a context is held against the context itself, so an object that has its
    // methods and is not it has none.
    const inheriting = Object.create(localization) as typeof localization;
    let thrown: unknown;

    try {
      void inheriting.initialize();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(TypeError);
    localization.dispose();
  });
});
