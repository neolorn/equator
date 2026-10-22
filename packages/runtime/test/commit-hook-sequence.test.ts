/**
 * What an effect adapter is told about a snapshot, and when.
 *
 * `specs/06-runtime-and-angular.spec.md` section 11 stages the coherence-critical effects with the
 * snapshot they belong to and runs the rest after the commit. A commit hook is how an adapter takes
 * part in both: `apply` is called with the candidate before it is current and may refuse it,
 * `rollback` undoes what `apply` did when the commit does not happen, and `committed` is called
 * once the snapshot is the current one. Section 4 makes the snapshot the only thing published, so
 * a route restated for the current locale reaches a hook the same way a locale change does.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';
import type { LocalizationSnapshot } from '@neolorn/equator/core';

import { catalogKey } from './catalog-store-harness.js';
import {
  observed,
  participant,
  route,
  runtime,
  type Runtime,
} from './transaction-runtime-harness.js';

/** A hook that writes down each call with the locale and identity of the snapshot it was given. */
function recorder(events: string[], name = 'hook'): LocalizationCommitHook {
  const told = (snapshot: LocalizationSnapshot | undefined) =>
    snapshot === undefined
      ? 'nothing'
      : `${snapshot.primaryLocale}#${snapshot.id}`;
  return {
    apply: (snapshot) => void events.push(`${name} apply ${told(snapshot)}`),
    rollback: (snapshot) =>
      void events.push(`${name} rollback ${told(snapshot)}`),
    committed: (snapshot) =>
      void events.push(`${name} committed ${told(snapshot)}`),
    dispose: () => void events.push(`${name} dispose`),
  };
}

describe('a commit hook', () => {
  it('is handed a snapshot before it is current, and again once it is', async () => {
    const current: (string | undefined)[] = [];
    let localization!: Runtime;
    const hook: LocalizationCommitHook = {
      apply: (snapshot) =>
        void current.push(
          `apply ${snapshot.primaryLocale} over ${localization.snapshot()?.primaryLocale}`,
        ),
      committed: (snapshot) =>
        void current.push(
          `committed ${snapshot.primaryLocale} over ${localization.snapshot()?.primaryLocale}`,
        ),
    };
    ({ localization } = runtime({ options: { commitHooks: [hook] } }));

    const first = await localization.initialize();
    await localization.changeLocale('ar-EG');

    expect(first.primaryLocale).toBe('en-US');
    expect(current).toStrictEqual([
      'apply en-US over undefined',
      'committed en-US over en-US',
      'apply ar-EG over en-US',
      'committed ar-EG over ar-EG',
    ]);
    localization.dispose();
  });

  it('is told of the snapshots in the order they were committed', async () => {
    const events: string[] = [];
    const { localization } = runtime({
      options: { commitHooks: [recorder(events, 'first'), recorder(events)] },
    });

    await localization.initialize();
    await localization.changeLocale('ar-EG');

    expect(events).toStrictEqual([
      'first apply en-US#1',
      'hook apply en-US#1',
      'first committed en-US#1',
      'hook committed en-US#1',
      'first apply ar-EG#2',
      'hook apply ar-EG#2',
      'first committed ar-EG#2',
      'hook committed ar-EG#2',
    ]);
    localization.dispose();
  });

  it('is released and told of no snapshot when the context is disposed', async () => {
    const events: string[] = [];
    const { localization } = runtime({
      options: { commitHooks: [recorder(events)] },
    });
    await localization.initialize();
    events.length = 0;

    expect(() => localization.dispose()).not.toThrow();

    expect(events).toStrictEqual(['hook dispose']);
    expect(localization.snapshot()).toBeUndefined();
  });

  it('commits the participants after every hook has accepted the snapshot', async () => {
    const events: string[] = [];
    const region = participant('region');
    const { localization } = runtime({
      options: { commitHooks: [recorder(events)] },
    });
    const registration = localization.registerParticipant({
      ...region.value,
      commit: (context) =>
        void events.push(`region commit ${context.targetLocale}`),
    });

    await localization.initialize();

    expect(events).toStrictEqual([
      'hook apply en-US#1',
      'region commit en-US',
      'hook committed en-US#1',
    ]);
    expect(registration.state().current).toMatchObject({
      targetLocale: 'en-US',
      transitionId: 0,
    });
    localization.dispose();
  });
});

describe('a commit hook that refuses a snapshot', () => {
  /** Two hooks, the second of which refuses Arabic until it is told to stop. */
  function refusing(fixture: Parameters<typeof runtime>[0] = {}) {
    const events: string[] = [];
    const state = { refuse: true };
    const second = recorder(events, 'second');
    const made = runtime({
      ...fixture,
      options: {
        commitHooks: [
          recorder(events, 'first'),
          {
            ...second,
            apply: (snapshot) => {
              second.apply(snapshot);
              if (state.refuse && snapshot.primaryLocale === 'ar-EG') {
                throw new Error('the hook under test refused the snapshot');
              }
            },
          },
        ],
      },
    });
    return { ...made, events, state };
  }

  it('fails the change and leaves the committed snapshot current', async () => {
    const { localization } = refusing();
    const committed = await localization.initialize();

    const result = await localization.changeLocale('ar-EG');

    expect(result).toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: { code: 'internal-invariant' },
    });
    expect(localization.snapshot()).toBe(committed);
    expect(localization.lifecycle()).toBe('ready');
    localization.dispose();
  });

  it('has every hook that was handed the snapshot roll back to the previous one, last first', async () => {
    const { localization, events } = refusing();
    await localization.initialize();
    events.length = 0;

    await localization.changeLocale('ar-EG');

    expect(events).toStrictEqual([
      'first apply ar-EG#2',
      'second apply ar-EG#2',
      'second rollback en-US#1',
      'first rollback en-US#1',
    ]);
    localization.dispose();
  });

  it('lets go of the catalogs the refused snapshot held', async () => {
    const { localization, loads, state } = refusing({
      setup: { maximumCachedCatalogs: 1 },
    });
    await localization.initialize();
    await localization.changeLocale('ar-EG');

    state.refuse = false;
    await expect(localization.changeLocale('ar-EG')).resolves.toMatchObject({
      status: 'committed',
    });

    // The cache has room for one catalog nobody holds, and the source catalog is held throughout,
    // so the Arabic one was loaded again only if the refused snapshot had let go of it.
    expect(loads[catalogKey('shell', 'ar-EG')]).toBe(2);
    localization.dispose();
  });
});

describe('a route restated for the current locale', () => {
  it('is on the current snapshot as soon as it is restated', async () => {
    const { localization } = runtime();
    const first = await localization.initialize();

    localization.ɵrestateRoute(route('/en-us/about'));

    expect(localization.snapshot()).toMatchObject({
      primaryLocale: 'en-US',
      route: route('/en-us/about'),
    });
    expect(localization.snapshot()?.id).toBeGreaterThan(first.id);
    localization.dispose();
  });

  it('is published after the snapshot a hook was being told of, when the hook restates it', async () => {
    const seen: (readonly [number, string | undefined])[] = [];
    let localization!: Runtime;
    const restating: LocalizationCommitHook = {
      apply: () => undefined,
      committed: (snapshot) => {
        if (snapshot.route === undefined) {
          localization.ɵrestateRoute(route('/en-us'));
        }
      },
    };
    const watching: LocalizationCommitHook = {
      apply: () => undefined,
      committed: (snapshot) =>
        void seen.push([snapshot.id, snapshot.route?.canonicalPath]),
    };
    ({ localization } = runtime({
      options: { commitHooks: [restating, watching] },
    }));

    await localization.initialize();

    expect(seen).toStrictEqual([
      [1, undefined],
      [2, '/en-us'],
    ]);
    expect(localization.snapshot()?.route).toStrictEqual(route('/en-us'));
    localization.dispose();
  });
});

describe('a commit hook that refuses the first snapshot', () => {
  it('rolls back to nothing, and the initialization fails', async () => {
    const events: string[] = [];
    const hook = recorder(events);
    const { localization } = runtime({
      options: {
        commitHooks: [
          {
            ...hook,
            apply: (snapshot) => {
              hook.apply(snapshot);
              throw new Error('the hook under test refused the snapshot');
            },
          },
        ],
      },
    });

    await expect(localization.initialize()).rejects.toMatchObject({
      diagnostic: { code: 'internal-invariant' },
    });

    expect(events).toStrictEqual([
      'hook apply en-US#1',
      'hook rollback nothing',
    ]);
    expect(localization.snapshot()).toBeUndefined();
    expect(localization.lifecycle()).toBe('failed');
    localization.dispose();
  });
});

describe('a participant that fails to commit', () => {
  /** A required participant whose commit throws for Arabic, behind one recording hook. */
  async function failing(fixture: Parameters<typeof runtime>[0] = {}) {
    const events: string[] = [];
    const region = participant('region');
    const made = runtime({
      ...fixture,
      options: { ...fixture.options, commitHooks: [recorder(events)] },
    });
    const registration = made.localization.registerParticipant({
      ...region.value,
      commit: (context) => {
        if (context.targetLocale === 'ar-EG') {
          throw new Error('the participant under test failed to commit');
        }
      },
    });
    const committed = await made.localization.initialize();
    events.length = 0;
    return { ...made, events, registration, committed };
  }

  it('fails the change by name, and every hook rolls back to the committed snapshot', async () => {
    const { localization, events, registration, committed } = await failing();

    const result = await localization.changeLocale('ar-EG');

    expect(result).toMatchObject({
      status: 'failed',
      diagnostic: { code: 'participant-failed', participantId: 'region' },
    });
    expect(events).toStrictEqual([
      'hook apply ar-EG#2',
      'hook rollback en-US#1',
    ]);
    expect(localization.snapshot()).toBe(committed);
    expect(registration.state().current?.targetLocale).toBe('en-US');
    localization.dispose();
  });

  it('is reported as an integration failure against the snapshot that did not commit', async () => {
    const watched = observed();
    const { localization } = await failing({
      options: { observability: watched.emitter },
    });

    await localization.changeLocale('ar-EG');

    expect(watched.phase('integration')).toStrictEqual([
      {
        status: 'failed',
        reason: 'participant-failed',
        targetLocale: 'ar-EG',
        participantId: 'region',
        snapshotId: 2,
      },
    ]);
    localization.dispose();
  });
});

describe('what a commit hook does once a snapshot is current', () => {
  it('is optional, and a hook without it reports no failure', async () => {
    const watched = observed();
    const { localization } = runtime({
      options: {
        commitHooks: [{ apply: () => undefined }],
        observability: watched.emitter,
      },
    });

    await localization.initialize();

    expect(watched.phase('integration')).toStrictEqual([]);
    localization.dispose();
  });

  it('is reported when it throws, and does not keep the hooks after it from being told', async () => {
    const events: string[] = [];
    const watched = observed();
    const { localization } = runtime({
      options: {
        commitHooks: [
          {
            apply: () => undefined,
            committed: () => {
              throw new Error('the hook under test failed after the commit');
            },
          },
          recorder(events),
        ],
        observability: watched.emitter,
      },
    });

    const snapshot = await localization.initialize();

    expect(localization.snapshot()).toBe(snapshot);
    expect(events).toStrictEqual([
      'hook apply en-US#1',
      'hook committed en-US#1',
    ]);
    expect(watched.phase('integration')).toStrictEqual([
      {
        status: 'failed',
        reason: 'internal-invariant',
        targetLocale: 'en-US',
        snapshotId: 1,
      },
    ]);
    localization.dispose();
  });
});
