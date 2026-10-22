/**
 * What a participant's hooks may answer, and what becomes of one that answers with a promise.
 *
 * `specs/06-runtime-and-angular.spec.md` section 8 makes commit, rollback, discard and disposal
 * synchronous: every participant of a change is told in one pass, and nothing waits for work a
 * hook left running. A commit that answers with a promise fails the change. The other three are
 * told of a change whose outcome is already decided, so a promise from one of them is reported
 * under the same code, with the participant it came from, and the outcome stands.
 */
import { describe, expect, it } from 'vitest';

import { ParticipantCoordinator } from '../src/participant-runtime.js';
import type {
  LocalizationDiagnostic,
  LocalizationParticipant,
} from '@neolorn/equator/core';

import { diagnosticOf } from './catalog-store-harness.js';
import {
  FORMATTING,
  READY,
  live,
  recorded,
} from './participant-coordinator-harness.js';

const pending = () => new Promise<void>(() => undefined);

/** A coordinator that keeps every refusal it reports. */
function reporting() {
  const refused: LocalizationDiagnostic[] = [];
  const coordinator = new ParticipantCoordinator([], (diagnostic) => {
    refused.push(diagnostic);
  });
  return { coordinator, refused };
}

const prepare = (coordinator: ParticipantCoordinator, transitionId: number) =>
  coordinator.prepareRequired(
    coordinator.required(),
    'ar-EG',
    FORMATTING,
    transitionId,
    live(),
  );

const rejected = (participantId: string, transitionId: number) => ({
  code: 'participant-contract-rejected',
  outcome: 'operational-failure',
  message: expect.any(String) as string,
  participantId,
  targetLocale: 'ar-EG',
  transitionId,
});

type Hook = 'discard' | 'rollback' | 'dispose';

/** A hook that answers with `answer`, typed as the hook it replaces. */
const answering = (hook: Hook, answer: () => unknown) =>
  ({ [hook]: answer }) as unknown as Partial<LocalizationParticipant>;

describe('a discard that answers with a promise', () => {
  it('is reported as a contract rejection naming the participant and the change', async () => {
    const { coordinator, refused } = reporting();
    recorded(
      coordinator,
      [],
      'region',
      () => READY,
      undefined,
      answering('discard', pending),
    );

    coordinator.discardPrepared(await prepare(coordinator, 3));

    expect(refused).toStrictEqual([rejected('region', 3)]);
    coordinator.dispose();
  });

  it('is reported for a preparation that failed, whose failure stands', async () => {
    const { coordinator, refused } = reporting();
    const region = recorded(
      coordinator,
      [],
      'region',
      () => {
        throw new Error('the region is down');
      },
      undefined,
      answering('discard', pending),
    );

    await expect(prepare(coordinator, 4)).rejects.toMatchObject({
      diagnostic: { code: 'participant-failed', participantId: 'region' },
    });

    expect(refused).toStrictEqual([rejected('region', 4)]);
    expect(region.registration.state().attempt).toMatchObject({
      status: 'failed',
      diagnostic: { code: 'participant-failed' },
    });
    coordinator.dispose();
  });
});

describe('a rollback that answers with a promise', () => {
  it('is reported, and the commit failure it followed is the one the change carries', async () => {
    const { coordinator, refused } = reporting();
    const log: string[] = [];
    recorded(
      coordinator,
      log,
      'first',
      () => READY,
      undefined,
      answering('rollback', pending),
    );
    recorded(coordinator, log, 'second', () => READY, undefined, {
      commit: () => {
        throw new Error('the swap failed');
      },
    });
    const prepared = await prepare(coordinator, 5);

    expect(
      diagnosticOf(() => coordinator.commitPrepared(prepared)),
    ).toMatchObject({ code: 'participant-failed', participantId: 'second' });

    expect(refused).toStrictEqual([rejected('first', 5)]);
    expect(log).toStrictEqual([
      'commit first 5',
      'rollback second 5',
      'discard first 5 ready',
      'discard second 5 ready',
    ]);
    coordinator.dispose();
  });
});

describe('a disposal that answers with a promise', () => {
  const unbound = (participantId: string) => ({
    code: 'participant-contract-rejected',
    outcome: 'operational-failure',
    message: expect.any(String) as string,
    participantId,
  });

  it('is reported when the participant unregisters, and the registration still ends', () => {
    const { coordinator, refused } = reporting();
    const region = recorded(
      coordinator,
      [],
      'region',
      () => READY,
      undefined,
      answering('dispose', pending),
    );

    region.registration.unregister();

    expect(refused).toStrictEqual([unbound('region')]);
    expect(coordinator.registrations()).toStrictEqual([]);
    coordinator.dispose();
  });

  it('is reported when the coordinator is disposed, and the others are still released', () => {
    const { coordinator, refused } = reporting();
    const log: string[] = [];
    recorded(coordinator, log, 'first');
    recorded(
      coordinator,
      log,
      'second',
      () => READY,
      undefined,
      answering('dispose', pending),
    );
    recorded(coordinator, log, 'third');

    coordinator.dispose();

    expect(refused).toStrictEqual([unbound('second')]);
    expect(log).toStrictEqual(['dispose third', 'dispose first']);
  });
});

describe.each<Hook>(['discard', 'rollback', 'dispose'])('a %s hook', (hook) => {
  /** Runs one change far enough that every hook of `region` has been called. */
  const exercised = async (answer: () => unknown, report = true) => {
    const refused: LocalizationDiagnostic[] = [];
    const coordinator = report
      ? new ParticipantCoordinator([], (diagnostic) => {
          refused.push(diagnostic);
        })
      : new ParticipantCoordinator();
    const calls: string[] = [];
    recorded(coordinator, [], 'region', () => READY, undefined, {
      ...answering(hook, () => {
        calls.push(hook);
        return answer();
      }),
    });
    recorded(coordinator, [], 'zone', () => READY, undefined, {
      commit: () => {
        throw new Error('the swap failed');
      },
    });
    const prepared = await prepare(coordinator, 6);
    const refusal = diagnosticOf(() => coordinator.commitPrepared(prepared));
    coordinator.dispose();
    return { refused, calls, refusal };
  };

  it.each([
    ['a promise', () => Promise.resolve()],
    ['a record that can be awaited', () => ({ then: () => undefined })],
    [
      'a function that can be awaited',
      () => Object.assign(() => undefined, { then: () => undefined }),
    ],
  ])('is reported for %s', async (_name, answer) => {
    const { refused, calls } = await exercised(answer);

    expect(calls).toStrictEqual([hook]);
    expect(refused).toMatchObject([
      { code: 'participant-contract-rejected', participantId: 'region' },
    ]);
  });

  it.each([
    ['nothing', () => undefined],
    ['null', () => null],
    ['text', () => 'done'],
    ['a record with a field named then', () => ({ then: 'later' })],
    ['a function', () => () => undefined],
  ])('is taken as done for %s', async (_name, answer) => {
    const { refused, calls } = await exercised(answer);

    expect(calls).toStrictEqual([hook]);
    expect(refused).toStrictEqual([]);
  });

  it('is not reported for throwing, which the change already outlived', async () => {
    const { refused, refusal } = await exercised(() => {
      throw new Error('the hook failed');
    });

    expect(refused).toStrictEqual([]);
    expect(refusal).toMatchObject({
      code: 'participant-failed',
      participantId: 'zone',
    });
  });

  it('changes nothing for a coordinator nobody listens to', async () => {
    const { calls, refusal } = await exercised(pending, false);

    expect(calls).toStrictEqual([hook]);
    expect(refusal).toMatchObject({
      code: 'participant-failed',
      participantId: 'zone',
    });
  });
});
