/**
 * What a participant registration is held to, and what the region is told afterwards.
 *
 * `specs/06-runtime-and-angular.spec.md` section 8 has a region take part in a locale transaction
 * by registering a participant, required or progressive, with an optional cancellable deadline. A
 * participant and its options are written by application code, so a registration is refused whole
 * when its identity, its mode, its deadline or one of its callbacks is not what the contract
 * names, and the registry is bounded. Section 7 has each region expose its own readiness: the
 * state a registration starts in, the state an abandoned attempt ends in, and the record a
 * server-rendered region hands to the browser are all read from the registration itself.
 */
import { describe, expect, it } from 'vitest';

import {
  ParticipantCoordinator,
  type ParticipantTransferRecord,
} from '../src/participant-runtime.js';
import type {
  FormattingContext,
  LocalizationParticipant,
  LocalizationParticipantContext,
  LocalizationParticipantOptions,
  LocalizationDiagnostic,
  LocalizationParticipantReport,
} from '@neolorn/equator/core';

// Local, because the harness that has these also compiles a catalog set, and nothing here loads one.
const carried = (error: unknown): LocalizationDiagnostic => {
  const diagnostic = (error as { diagnostic?: LocalizationDiagnostic })
    .diagnostic;
  if (diagnostic === undefined) throw error;
  return diagnostic;
};

/** The diagnostic a refusal carries, or `undefined` when nothing was refused. */
function diagnosticOf(
  action: () => unknown,
): LocalizationDiagnostic | undefined {
  try {
    action();
  } catch (error) {
    return carried(error);
  }
  return undefined;
}

/** The diagnostic a rejection carries, or `undefined` when the promise resolved. */
async function rejectionOf(
  action: () => Promise<unknown>,
): Promise<LocalizationDiagnostic | undefined> {
  try {
    await action();
  } catch (error) {
    return carried(error);
  }
  return undefined;
}

const FORMATTING: FormattingContext = Object.freeze({
  locale: 'ar-EG',
  timeZone: 'UTC',
  calendar: 'gregory',
  numberingSystem: 'arab',
  hourCycle: 'h23',
});

const READY: LocalizationParticipantReport = Object.freeze({
  status: 'ready',
  representation: Object.freeze({ kind: 'language-independent' }),
});

const FAILED: LocalizationParticipantReport = Object.freeze({
  status: 'failed',
  outcome: 'operational-failure',
  reason: 'environment-failure',
});

const noRetry = () => Promise.reject(new Error('not retried here'));

const region = (
  id: string,
  more: Partial<LocalizationParticipant> = {},
): LocalizationParticipant => ({ id, prepare: () => READY, ...more });

/** A preparation that never answers, so the attempt ends only by being abandoned. */
const unanswered = () =>
  new Promise<LocalizationParticipantReport>(() => undefined);

const live = () => new AbortController().signal;

/** Registers application-shaped input the types would refuse, the way plain JavaScript can. */
const registerLoose = (
  coordinator: ParticipantCoordinator,
  participant: unknown,
  options: unknown = {},
) =>
  coordinator.register(
    participant as LocalizationParticipant,
    options as LocalizationParticipantOptions,
    noRetry,
  );

describe('a participant registration', () => {
  it('holds a change up unless it says otherwise, and starts idle', () => {
    const coordinator = new ParticipantCoordinator();

    const registration = coordinator.register(region('region'), {}, noRetry);

    expect(registration.id).toBe('region');
    expect(registration.state()).toStrictEqual({
      participantId: 'region',
      coordination: 'required',
      attempt: { status: 'idle' },
    });
    expect(coordinator.registrations()).toStrictEqual([
      { id: 'region', coordination: 'required' },
    ]);
    expect(coordinator.required()).toHaveLength(1);
    expect(coordinator.progressive()).toHaveLength(0);
    coordinator.dispose();
  });

  it('keeps the mode and the deadline it was given', () => {
    const coordinator = new ParticipantCoordinator();

    coordinator.register(
      region('sidebar'),
      { coordination: 'progressive', deadlineMilliseconds: 1 },
      noRetry,
    );
    coordinator.register(
      region('article'),
      { coordination: 'required', deadlineMilliseconds: 2_147_483_647 },
      noRetry,
    );

    expect(coordinator.progressive()).toStrictEqual([
      { id: 'sidebar', coordination: 'progressive', deadlineMilliseconds: 1 },
    ]);
    expect(coordinator.required()).toStrictEqual([
      {
        id: 'article',
        coordination: 'required',
        deadlineMilliseconds: 2_147_483_647,
      },
    ]);
    coordinator.dispose();
  });

  it.each([
    ['one character', 'a'],
    ['the longest the bound allows', `a${'b'.repeat(127)}`],
    ['every punctuation mark of the set', 'a._:-9'],
  ])('takes an identity of %s', (_name, id) => {
    const coordinator = new ParticipantCoordinator();

    const registration = coordinator.register(region(id), {}, noRetry);

    expect(registration.state().participantId).toBe(id);
    coordinator.dispose();
  });

  it.each([
    ['an identity that is a number', { id: 5 }, {}],
    ['an empty identity', { id: '' }, {}],
    ['an identity past the bound', { id: `a${'b'.repeat(128)}` }, {}],
    ['an identity opening outside the set', { id: '!region' }, {}],
    ['an identity opening with punctuation', { id: '-region' }, {}],
    ['an identity ending outside the set', { id: 'region!' }, {}],
    ['an identity holding a separator', { id: 'region/one' }, {}],
    ['a preparation that is not a function', { prepare: 'ready' }, {}],
    ['no preparation', { prepare: undefined }, {}],
    ['a mode nothing defines', {}, { coordination: 'optional' }],
    ['an empty mode', {}, { coordination: '' }],
    ['a deadline of zero', {}, { deadlineMilliseconds: 0 }],
    ['a fractional deadline', {}, { deadlineMilliseconds: 1.5 }],
    ['a deadline past the bound', {}, { deadlineMilliseconds: 2_147_483_648 }],
    ['a commit that is not a function', { commit: 'swap' }, {}],
    ['a rollback that is not a function', { rollback: 'restore' }, {}],
    ['a discard that is not a function', { discard: 'drop' }, {}],
    ['a disposal that is not a function', { dispose: 'release' }, {}],
  ])('is refused for %s', (_name, fields, options) => {
    const coordinator = new ParticipantCoordinator();

    expect(
      diagnosticOf(() =>
        registerLoose(coordinator, { ...region('region'), ...fields }, options),
      ),
    ).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
    expect(coordinator.registrations()).toStrictEqual([]);
    coordinator.dispose();
  });

  it('names the participant in a refusal only when the identity is text', () => {
    const coordinator = new ParticipantCoordinator();

    expect(
      diagnosticOf(() => registerLoose(coordinator, { ...region('a'), id: 5 })),
    ).not.toHaveProperty('participantId');
    expect(
      diagnosticOf(() => coordinator.register(region('region!'), {}, noRetry)),
    ).toHaveProperty('participantId', 'region!');
    coordinator.dispose();
  });

  it('is refused under an identity already registered', () => {
    const coordinator = new ParticipantCoordinator();
    coordinator.register(region('region'), {}, noRetry);

    expect(
      diagnosticOf(() =>
        coordinator.register(
          region('region'),
          { coordination: 'progressive' },
          noRetry,
        ),
      ),
    ).toMatchObject({ code: 'invalid-configuration', participantId: 'region' });
    expect(coordinator.registrations()).toStrictEqual([
      { id: 'region', coordination: 'required' },
    ]);
    coordinator.dispose();
  });

  it('is refused once the registry is full, and taken again once one has left', () => {
    const coordinator = new ParticipantCoordinator();
    const registered = Array.from({ length: 128 }, (_unused, index) =>
      coordinator.register(region(`region-${index}`), {}, noRetry),
    );

    expect(
      diagnosticOf(() => coordinator.register(region('late'), {}, noRetry)),
    ).toMatchObject({ code: 'invalid-configuration', participantId: 'late' });
    expect(coordinator.registrations()).toHaveLength(128);

    registered[0]?.unregister();
    coordinator.register(region('late'), {}, noRetry);

    expect(coordinator.registrations()).toHaveLength(128);
    coordinator.dispose();
  });

  it('is refused on a coordinator that has been disposed', () => {
    const coordinator = new ParticipantCoordinator();
    coordinator.dispose();

    expect(
      diagnosticOf(() => coordinator.register(region('region'), {}, noRetry)),
    ).toMatchObject({ code: 'disposed', outcome: 'operational-failure' });
  });

  it('asks again through the retry it was registered with, until it is unregistered', async () => {
    const coordinator = new ParticipantCoordinator();
    const asked: string[] = [];
    const registration = coordinator.register(region('region'), {}, (id) => {
      asked.push(id);
      return Promise.resolve(coordinator.state(id));
    });

    await expect(registration.retry()).resolves.toBe(registration.state());
    expect(asked).toStrictEqual(['region']);

    registration.unregister();

    await expect(
      rejectionOf(() => registration.retry()),
    ).resolves.toMatchObject({ code: 'disposed', participantId: 'region' });
    expect(asked).toStrictEqual(['region']);
    coordinator.dispose();
  });

  it('refuses a retry once its coordinator has been disposed', async () => {
    const coordinator = new ParticipantCoordinator();
    const asked: string[] = [];
    const registration = coordinator.register(region('region'), {}, (id) => {
      asked.push(id);
      return noRetry();
    });

    coordinator.dispose();

    await expect(
      rejectionOf(() => registration.retry()),
    ).resolves.toMatchObject({
      code: 'disposed',
      outcome: 'operational-failure',
      participantId: 'region',
    });
    expect(asked).toStrictEqual([]);
  });

  it('is not removed by the handle of an earlier registration under its identity', () => {
    const coordinator = new ParticipantCoordinator();
    const earlier = coordinator.register(region('region'), {}, noRetry);
    earlier.unregister();
    let released = 0;
    coordinator.register(
      region('region', { dispose: () => void (released += 1) }),
      { coordination: 'progressive' },
      noRetry,
    );

    earlier.unregister();

    expect(released).toBe(0);
    expect(coordinator.registrations()).toStrictEqual([
      { id: 'region', coordination: 'progressive' },
    ]);
    coordinator.dispose();
  });
});

describe('the list of participant states', () => {
  const ids = (coordinator: ParticipantCoordinator) =>
    coordinator.states().map(({ participantId }) => participantId);

  it('follows every registration and removal, in identity order', () => {
    const coordinator = new ParticipantCoordinator();
    expect(ids(coordinator)).toStrictEqual([]);

    const second = coordinator.register(region('b'), {}, noRetry);
    expect(ids(coordinator)).toStrictEqual(['b']);

    coordinator.register(region('a'), {}, noRetry);
    expect(ids(coordinator)).toStrictEqual(['a', 'b']);

    coordinator.register(region('c'), {}, noRetry);
    expect(ids(coordinator)).toStrictEqual(['a', 'b', 'c']);

    second.unregister();
    expect(ids(coordinator)).toStrictEqual(['a', 'c']);
    coordinator.dispose();
  });

  it('stays in identity order for a full registry registered out of order', () => {
    const coordinator = new ParticipantCoordinator();
    const names = Array.from(
      { length: 128 },
      (_unused, index) => `region-${String(index).padStart(3, '0')}`,
    );
    // A fixed scramble: 37 shares no factor with 128, so every identity is registered once.
    for (let index = 0; index < names.length; index += 1) {
      const name = names[(index * 37 + 11) % names.length] as string;
      coordinator.register(region(name), {}, noRetry);
    }

    expect(ids(coordinator)).toStrictEqual(names);
    coordinator.dispose();
  });

  it('has a new revision for a set that changed and changed back', () => {
    const coordinator = new ParticipantCoordinator();
    coordinator.register(region('kept'), {}, noRetry);
    const before = coordinator.registrationRevision();

    coordinator.register(region('passing'), {}, noRetry).unregister();

    expect(coordinator.registrationRevision()).toBeGreaterThan(before);
    coordinator.dispose();
  });
});

describe('the callbacks of a registered participant', () => {
  it('commits what it prepared, with the context it was prepared under', async () => {
    const coordinator = new ParticipantCoordinator();
    const commits: unknown[] = [];
    const contexts: LocalizationParticipantContext[] = [];
    const registration = coordinator.register(
      region('region', {
        prepare: (context) => {
          contexts.push(context);
          return READY;
        },
        commit: (context, report) => void commits.push([context, report]),
      }),
      {},
      noRetry,
    );

    const prepared = await coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      7,
      live(),
    );
    coordinator.commitPrepared(prepared);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).not.toHaveProperty('transferred');
    expect(commits).toStrictEqual([[contexts[0], READY]]);
    expect(registration.state()).toStrictEqual({
      participantId: 'region',
      coordination: 'required',
      current: { targetLocale: 'ar-EG', transitionId: 7, report: READY },
      attempt: {
        status: 'ready',
        targetLocale: 'ar-EG',
        transitionId: 7,
        report: READY,
      },
    });
    coordinator.dispose();
  });

  it('rolls back the participants that committed when a later one fails to', async () => {
    const coordinator = new ParticipantCoordinator();
    const calls: string[] = [];
    const first = coordinator.register(
      region('first', {
        commit: () => void calls.push('commit first'),
        rollback: (context, report) =>
          void calls.push(
            `rollback first ${context.targetLocale} ${report.status}`,
          ),
        discard: () => void calls.push('discard first'),
      }),
      {},
      noRetry,
    );
    const second = coordinator.register(
      region('second', {
        commit: () => {
          throw new Error('the swap failed');
        },
        discard: () => void calls.push('discard second'),
      }),
      {},
      noRetry,
    );
    const prepared = await coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      2,
      live(),
    );

    expect(
      diagnosticOf(() => coordinator.commitPrepared(prepared)),
    ).toMatchObject({
      code: 'participant-failed',
      outcome: 'operational-failure',
      participantId: 'second',
      targetLocale: 'ar-EG',
      transitionId: 2,
    });
    expect(calls).toStrictEqual([
      'commit first',
      'rollback first ar-EG ready',
      'discard first',
      'discard second',
    ]);
    expect(first.state()).toMatchObject({ attempt: { status: 'cancelled' } });
    expect(first.state()).not.toHaveProperty('current');
    expect(second.state()).toMatchObject({ attempt: { status: 'failed' } });
    coordinator.dispose();
  });

  it('discards a preparation whose report is refused, with no report to hand over', async () => {
    const coordinator = new ParticipantCoordinator();
    const discards: unknown[] = [];
    const registration = coordinator.register(
      region('region', {
        prepare: () =>
          ({ status: 'ready' }) as unknown as LocalizationParticipantReport,
        discard: (context, report) =>
          void discards.push([context.targetLocale, report]),
      }),
      { coordination: 'progressive' },
      noRetry,
    );

    const state = await coordinator.runIndependent(
      coordinator.progressive()[0]!,
      'ar-EG',
      FORMATTING,
      3,
      live(),
    );

    expect(state).toBe(registration.state());
    expect(state.attempt).toStrictEqual({
      status: 'failed',
      targetLocale: 'ar-EG',
      transitionId: 3,
      diagnostic: {
        code: 'participant-contract-rejected',
        outcome: 'operational-failure',
        message: expect.any(String) as string,
        participantId: 'region',
        targetLocale: 'ar-EG',
        transitionId: 3,
      },
    });
    expect(discards).toStrictEqual([['ar-EG', undefined]]);
    coordinator.dispose();
  });

  it('discards a preparation that reported a failure, with the report it made', async () => {
    const coordinator = new ParticipantCoordinator();
    const discards: unknown[] = [];
    coordinator.register(
      region('region', {
        prepare: () => FAILED,
        discard: (context, report) =>
          void discards.push([context.transitionId, report]),
      }),
      { coordination: 'progressive' },
      noRetry,
    );

    const state = await coordinator.runIndependent(
      coordinator.progressive()[0]!,
      'ar-EG',
      FORMATTING,
      4,
      live(),
    );

    expect(state.attempt).toMatchObject({
      status: 'failed',
      report: FAILED,
      diagnostic: {
        code: 'participant-failed',
        outcome: 'operational-failure',
        participantId: 'region',
      },
    });
    expect(discards).toStrictEqual([[4, FAILED]]);
    coordinator.dispose();
  });

  it('releases the participant once when it is unregistered', () => {
    const coordinator = new ParticipantCoordinator();
    let released = 0;
    const registration = coordinator.register(
      region('region', { dispose: () => void (released += 1) }),
      {},
      noRetry,
    );

    registration.unregister();
    registration.unregister();

    expect(released).toBe(1);
    expect(coordinator.registrations()).toStrictEqual([]);
    coordinator.dispose();
  });
});

describe('a commit callback that answers', () => {
  const committing = async (answer: () => unknown) => {
    const coordinator = new ParticipantCoordinator();
    const registration = coordinator.register(
      region('region', { commit: () => answer() as undefined }),
      {},
      noRetry,
    );
    const prepared = await coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      1,
      live(),
    );
    return {
      coordinator,
      registration,
      diagnostic: diagnosticOf(() => coordinator.commitPrepared(prepared)),
    };
  };

  // A commit is synchronous, because every participant commits in the same pass. Anything that
  // can be awaited says the swap has not happened yet, whatever kind of value carries the `then`.
  it.each([
    ['a promise', () => Promise.resolve()],
    ['a record that can be awaited', () => ({ then: () => undefined })],
    [
      'a function that can be awaited',
      () => Object.assign(() => undefined, { then: () => undefined }),
    ],
  ])('is refused for %s, and nothing is committed', async (_name, answer) => {
    const { coordinator, registration, diagnostic } = await committing(answer);

    expect(diagnostic).toMatchObject({
      code: 'participant-contract-rejected',
      outcome: 'operational-failure',
      participantId: 'region',
      targetLocale: 'ar-EG',
      transitionId: 1,
    });
    expect(registration.state()).toMatchObject({
      attempt: { status: 'failed' },
    });
    expect(registration.state()).not.toHaveProperty('current');
    coordinator.dispose();
  });

  it.each([
    ['nothing', () => undefined],
    ['null', () => null],
    ['text', () => 'swapped'],
    ['a record with a field named then', () => ({ then: 'later' })],
    ['a function', () => () => undefined],
  ])('is committed for %s', async (_name, answer) => {
    const { coordinator, registration, diagnostic } = await committing(answer);

    expect(diagnostic).toBeUndefined();
    expect(registration.state()).toMatchObject({
      current: { targetLocale: 'ar-EG', transitionId: 1 },
      attempt: { status: 'ready' },
    });
    coordinator.dispose();
  });
});

describe('an attempt that is abandoned while it prepares', () => {
  const preparing = (options: LocalizationParticipantOptions = {}) => {
    const coordinator = new ParticipantCoordinator();
    const registration = coordinator.register(
      region('region', { prepare: unanswered }),
      { coordination: 'progressive', ...options },
      noRetry,
    );
    const controller = new AbortController();
    const running = coordinator.runIndependent(
      coordinator.progressive()[0]!,
      'ar-EG',
      FORMATTING,
      5,
      controller.signal,
    );
    return { coordinator, registration, controller, running };
  };

  it('ends superseded when a newer intent overtakes it', async () => {
    const { coordinator, running } = preparing();

    coordinator.supersedeAll();

    expect((await running).attempt).toMatchObject({
      status: 'superseded',
      targetLocale: 'ar-EG',
      transitionId: 5,
      diagnostic: { code: 'superseded', participantId: 'region' },
    });
    coordinator.dispose();
  });

  it('ends cancelled when the change it belonged to is cancelled', async () => {
    const { coordinator, controller, running } = preparing();

    controller.abort();

    expect((await running).attempt).toMatchObject({
      status: 'cancelled',
      targetLocale: 'ar-EG',
      transitionId: 5,
      diagnostic: { code: 'cancelled', participantId: 'region' },
    });
    coordinator.dispose();
  });

  it('ends cancelled when its participant is unregistered', async () => {
    const { coordinator, registration, running } = preparing();

    registration.unregister();

    await expect(rejectionOf(() => running)).resolves.toMatchObject({
      code: 'disposed',
    });
    expect(registration.state().attempt).toMatchObject({
      status: 'cancelled',
      targetLocale: 'ar-EG',
      transitionId: 5,
      diagnostic: { code: 'disposed', participantId: 'region' },
    });
    coordinator.dispose();
  });

  it('ends failed when its deadline expires', async () => {
    const { coordinator, running } = preparing({ deadlineMilliseconds: 1 });

    expect((await running).attempt).toStrictEqual({
      status: 'failed',
      targetLocale: 'ar-EG',
      transitionId: 5,
      diagnostic: {
        code: 'participant-timeout',
        outcome: 'operational-failure',
        message: expect.any(String) as string,
        participantId: 'region',
        targetLocale: 'ar-EG',
        transitionId: 5,
      },
    });
    coordinator.dispose();
  });
});

describe('a participant taking over a server-rendered region', () => {
  const CURRENT = Object.freeze({
    targetLocale: 'ar-EG',
    transitionId: 4,
    report: READY,
  } as const);
  const RECORD: ParticipantTransferRecord = Object.freeze({
    profile: 'equator-participant-state/1',
    participantId: 'region',
    coordination: 'required',
    current: CURRENT,
    attempt: Object.freeze({
      status: 'ready',
      targetLocale: 'ar-EG',
      transitionId: 4,
      report: READY,
    }),
  });

  it('starts from what the server recorded for it', () => {
    const coordinator = new ParticipantCoordinator([RECORD]);

    const registration = coordinator.register(region('region'), {}, noRetry);

    expect(registration.state()).toStrictEqual({
      participantId: 'region',
      coordination: 'required',
      current: CURRENT,
      attempt: {
        status: 'ready',
        targetLocale: 'ar-EG',
        transitionId: 4,
        report: READY,
      },
    });
    coordinator.dispose();
  });

  it('starts idle and showing nothing from a record that holds neither', () => {
    const coordinator = new ParticipantCoordinator([
      {
        profile: 'equator-participant-state/1',
        participantId: 'region',
        coordination: 'required',
      },
    ]);

    const registration = coordinator.register(region('region'), {}, noRetry);

    expect(registration.state()).toStrictEqual({
      participantId: 'region',
      coordination: 'required',
      attempt: { status: 'idle' },
    });
    coordinator.dispose();
  });

  it('starts from an attempt the server left unanswered, with no report in it', () => {
    const coordinator = new ParticipantCoordinator([
      {
        profile: 'equator-participant-state/1',
        participantId: 'region',
        coordination: 'progressive',
        attempt: {
          status: 'preparing',
          targetLocale: 'ar-EG',
          transitionId: 4,
        },
      },
    ]);

    const registration = coordinator.register(
      region('region'),
      { coordination: 'progressive' },
      noRetry,
    );

    expect(registration.state()).toStrictEqual({
      participantId: 'region',
      coordination: 'progressive',
      attempt: { status: 'preparing', targetLocale: 'ar-EG', transitionId: 4 },
    });
    coordinator.dispose();
  });

  it('is handed what it was showing on its first preparation, and is prepared even for that locale', async () => {
    const coordinator = new ParticipantCoordinator([RECORD]);
    const contexts: LocalizationParticipantContext[] = [];
    coordinator.register(
      region('region', {
        prepare: (context) => {
          contexts.push(context);
          return READY;
        },
      }),
      {},
      noRetry,
    );

    expect(
      coordinator.pendingFor(coordinator.required(), 'ar-EG'),
    ).toHaveLength(1);
    const prepared = await coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      9,
      live(),
    );
    coordinator.commitPrepared(prepared);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.transferred).toStrictEqual(CURRENT);
    expect(
      coordinator.pendingFor(coordinator.required(), 'ar-EG'),
    ).toHaveLength(0);
    coordinator.dispose();
  });

  it('ignores a record made under the other mode', () => {
    const coordinator = new ParticipantCoordinator([RECORD]);

    const registration = coordinator.register(
      region('region'),
      { coordination: 'progressive' },
      noRetry,
    );

    expect(registration.state()).toStrictEqual({
      participantId: 'region',
      coordination: 'progressive',
      attempt: { status: 'idle' },
    });
    coordinator.dispose();
  });

  it('ignores a record made for another participant', () => {
    const coordinator = new ParticipantCoordinator([RECORD]);

    const registration = coordinator.register(region('other'), {}, noRetry);

    expect(registration.state()).toStrictEqual({
      participantId: 'other',
      coordination: 'required',
      attempt: { status: 'idle' },
    });
    coordinator.dispose();
  });

  it('adopts a record once, so a region created again starts fresh', () => {
    const coordinator = new ParticipantCoordinator([RECORD]);
    coordinator.register(region('region'), {}, noRetry).unregister();

    const registration = coordinator.register(region('region'), {}, noRetry);

    expect(registration.state()).toStrictEqual({
      participantId: 'region',
      coordination: 'required',
      attempt: { status: 'idle' },
    });
    coordinator.dispose();
  });
});
