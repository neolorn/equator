/**
 * What becomes of a participant once it has prepared, and of all of them when the context goes.
 *
 * `specs/06-runtime-and-angular.spec.md` section 8 leaves a region's payload with the application,
 * so commit, rollback, discard and dispose are all a participant has to keep its own store in
 * step with the page: each prepared answer is committed or discarded once and never both, and a
 * commit that fails is undone in the reverse of the order it was made. Section 10 has the server
 * hand each region's record to the browser, and a record carries what the region shows and how
 * far its attempt got, without an attempt that was abandoned.
 */
import { describe, expect, it } from 'vitest';

import {
  ParticipantCoordinator,
  sanitizeParticipantTransferRecords,
} from '../src/participant-runtime.js';
import type {
  LocalizationDiagnostic,
  LocalizationParticipantReport,
} from '@neolorn/equator/core';

import { diagnosticOf, rejectionOf } from './catalog-store-harness.js';
import {
  FAILED,
  FORMATTING,
  READY,
  live,
  recorded,
  settled,
  unanswered,
} from './participant-coordinator-harness.js';

const diagnostic = (
  code: LocalizationDiagnostic['code'],
  transitionId: number,
  targetLocale = 'ar-EG',
) => ({
  code,
  outcome: 'operational-failure',
  message: expect.any(String) as string,
  participantId: 'region',
  targetLocale,
  transitionId,
});

const prepare = (
  coordinator: ParticipantCoordinator,
  transitionId: number,
  targetLocale = 'ar-EG',
) =>
  coordinator.prepareRequired(
    coordinator.required(),
    targetLocale,
    FORMATTING,
    transitionId,
    live(),
  );

/** One required region named `region`, and the log it writes. */
function one() {
  const coordinator = new ParticipantCoordinator();
  const log: string[] = [];
  const region = recorded(coordinator, log, 'region');
  return { coordinator, log, region };
}

describe('a prepared participant', () => {
  it('is discarded once, however often it is handed back', async () => {
    const { coordinator, log } = one();
    const prepared = await prepare(coordinator, 1);

    coordinator.discardPrepared(prepared);
    coordinator.discardPrepared(prepared);

    expect(log).toStrictEqual(['discard region 1 ready']);
    coordinator.dispose();
  });

  it('ends its attempt as cancelled when it is discarded', async () => {
    const { coordinator, region } = one();
    const prepared = await prepare(coordinator, 1);

    coordinator.discardPrepared(prepared);

    expect(region.registration.state().attempt).toStrictEqual({
      status: 'cancelled',
      targetLocale: 'ar-EG',
      transitionId: 1,
      report: READY,
      diagnostic: diagnostic('cancelled', 1),
    });
    coordinator.dispose();
  });

  it('ends its attempt the way its change ended, when the change was overtaken first', async () => {
    const { coordinator, region } = one();
    const prepared = await prepare(coordinator, 1);

    coordinator.supersedeAll('fr-FR', 9);
    coordinator.discardPrepared(prepared);

    expect(region.registration.state().attempt).toStrictEqual({
      status: 'superseded',
      targetLocale: 'ar-EG',
      transitionId: 1,
      report: READY,
      diagnostic: diagnostic('superseded', 9, 'fr-FR'),
    });
    coordinator.dispose();
  });

  it('is not discarded once it has committed', async () => {
    const { coordinator, log } = one();
    const prepared = await prepare(coordinator, 1);

    coordinator.commitPrepared(prepared);
    coordinator.discardPrepared(prepared);

    expect(log).toStrictEqual(['commit region 1']);
    coordinator.dispose();
  });

  it('is committed once, and keeps what it shows when asked again', async () => {
    const { coordinator, log, region } = one();
    const prepared = await prepare(coordinator, 1);
    coordinator.commitPrepared(prepared);
    const committed = region.registration.state();

    expect(
      diagnosticOf(() => coordinator.commitPrepared(prepared)),
    ).toStrictEqual(diagnostic('disposed', 1));

    expect(log).toStrictEqual(['commit region 1']);
    expect(region.registration.state()).toBe(committed);
    coordinator.dispose();
  });

  it('is not committed once it has been discarded', async () => {
    const { coordinator, log } = one();
    const prepared = await prepare(coordinator, 1);
    coordinator.discardPrepared(prepared);

    expect(
      diagnosticOf(() => coordinator.commitPrepared(prepared)),
    ).toStrictEqual(diagnostic('disposed', 1));

    expect(log).toStrictEqual(['discard region 1 ready']);
    coordinator.dispose();
  });

  it('is refused at commit for the reason its attempt was withdrawn, and discarded once', async () => {
    const { coordinator, log, region } = one();
    const prepared = await prepare(coordinator, 1);

    coordinator.supersedeAll('fr-FR', 9);

    expect(
      diagnosticOf(() => coordinator.commitPrepared(prepared)),
    ).toStrictEqual(diagnostic('superseded', 9, 'fr-FR'));
    expect(region.registration.state().attempt).toMatchObject({
      status: 'superseded',
      targetLocale: 'ar-EG',
      transitionId: 1,
      report: READY,
    });
    coordinator.discardPrepared(prepared);
    expect(log).toStrictEqual(['discard region 1 ready']);
    coordinator.dispose();
  });

  it('is withdrawn under its own change when the newer intent names none', async () => {
    const { coordinator, region } = one();
    const prepared = await prepare(coordinator, 1);

    coordinator.supersedeAll();

    expect(
      diagnosticOf(() => coordinator.commitPrepared(prepared)),
    ).toStrictEqual(diagnostic('superseded', 1));
    expect(region.contexts[0]?.signal.aborted).toBe(true);
    coordinator.dispose();
  });

  it('is refused at commit once its coordinator has been disposed', async () => {
    const { coordinator, log, region } = one();
    const prepared = await prepare(coordinator, 1);

    coordinator.dispose();

    expect(
      diagnosticOf(() => coordinator.commitPrepared(prepared)),
    ).toStrictEqual(diagnostic('disposed', 1));
    expect(region.registration.state().attempt.status).toBe('cancelled');
    expect(log).toStrictEqual(['dispose region', 'discard region 1 ready']);
  });

  it('is rolled back with the others in the reverse of the order they committed in', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    recorded(coordinator, log, 'first');
    recorded(coordinator, log, 'second');
    recorded(coordinator, log, 'third', () => READY, undefined, {
      commit: () => {
        throw new Error('the swap failed');
      },
    });
    const prepared = await prepare(coordinator, 4);

    expect(
      diagnosticOf(() => coordinator.commitPrepared(prepared)),
    ).toMatchObject({ code: 'participant-failed', participantId: 'third' });
    coordinator.discardPrepared(prepared);

    expect(log).toStrictEqual([
      'commit first 4',
      'commit second 4',
      'rollback third 4',
      'rollback second 4',
      'rollback first 4',
      'discard first 4 ready',
      'discard second 4 ready',
      'discard third 4 ready',
    ]);
    coordinator.dispose();
  });
});

describe('what a participant is told of a server-rendered region', () => {
  const FIELDS = ['targetLocale', 'formatting', 'transitionId', 'signal'];

  it('is nothing, for a region that committed here and prepares again', async () => {
    const { coordinator, region } = one();
    coordinator.commitPrepared(await prepare(coordinator, 1));

    coordinator.discardPrepared(await prepare(coordinator, 2, 'fr-FR'));

    expect(Object.keys(region.contexts[1] ?? {})).toStrictEqual(FIELDS);
    coordinator.dispose();
  });

  it('is nothing, for a record that shows nothing', async () => {
    const coordinator = new ParticipantCoordinator([
      {
        profile: 'equator-participant-state/1',
        participantId: 'region',
        coordination: 'required',
        attempt: {
          status: 'preparing',
          targetLocale: 'ar-EG',
          transitionId: 4,
        },
      },
    ]);
    const region = recorded(coordinator, [], 'region');

    coordinator.discardPrepared(await prepare(coordinator, 5));

    expect(Object.keys(region.contexts[0] ?? {})).toStrictEqual(FIELDS);
    coordinator.dispose();
  });
});

describe('the participants a locale is still waiting for', () => {
  it('are the ones not showing it', async () => {
    const { coordinator } = one();
    const listed = coordinator.required();
    coordinator.commitPrepared(await prepare(coordinator, 1));

    expect(coordinator.pendingFor(listed, 'ar-EG')).toStrictEqual([]);
    expect(coordinator.pendingFor(listed, 'fr-FR')).toStrictEqual(listed);
    coordinator.dispose();
  });

  it('include a region that left after the list was taken', async () => {
    const { coordinator, region } = one();
    const listed = coordinator.required();
    coordinator.commitPrepared(await prepare(coordinator, 1));

    region.registration.unregister();

    // Its absence is reported where it is asked to prepare, which names the participant.
    expect(coordinator.pendingFor(listed, 'ar-EG')).toStrictEqual(listed);
    await expect(
      rejectionOf(() =>
        coordinator.prepareRequired(listed, 'ar-EG', FORMATTING, 2, live()),
      ),
    ).resolves.toStrictEqual({
      code: 'disposed',
      outcome: 'operational-failure',
      message: expect.any(String) as string,
      participantId: 'region',
    });
    coordinator.dispose();
  });
});

describe('the state of a participant', () => {
  it('is refused for an identity nothing is registered under', () => {
    const coordinator = new ParticipantCoordinator();

    expect(diagnosticOf(() => coordinator.state('missing'))).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: expect.any(String) as string,
      participantId: 'missing',
    });
    coordinator.dispose();
  });
});

describe('a coordinator that is disposed', () => {
  it('releases its participants once, last registered first', () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    recorded(coordinator, log, 'first');
    recorded(coordinator, log, 'second');
    recorded(coordinator, log, 'third');

    coordinator.dispose();
    coordinator.dispose();

    expect(log).toStrictEqual([
      'dispose third',
      'dispose second',
      'dispose first',
    ]);
  });

  it('releases the others when the release of one throws', () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    recorded(coordinator, log, 'first');
    recorded(coordinator, log, 'second', () => READY, undefined, {
      dispose: () => {
        throw new Error('the region would not let go');
      },
    });
    recorded(coordinator, log, 'third');

    coordinator.dispose();

    expect(log).toStrictEqual(['dispose third', 'dispose first']);
    expect(coordinator.registrations()).toStrictEqual([]);
  });

  it('has nothing registered, and says once that the set changed', () => {
    const { coordinator } = one();
    const before = coordinator.registrationRevision();
    expect(coordinator.states()).toHaveLength(1);

    coordinator.dispose();
    const after = coordinator.registrationRevision();

    expect(after).toBeGreaterThan(before);
    expect(coordinator.registrations()).toStrictEqual([]);
    expect(coordinator.states()).toStrictEqual([]);

    coordinator.dispose();

    expect(coordinator.registrationRevision()).toBe(after);
  });

  it('ends work in flight as cancelled by the disposal', async () => {
    const coordinator = new ParticipantCoordinator();
    const region = recorded(coordinator, [], 'region', unanswered, {
      coordination: 'progressive',
    });
    const running = coordinator.runIndependent(
      coordinator.progressive()[0]!,
      'ar-EG',
      FORMATTING,
      5,
      live(),
    );

    coordinator.dispose();

    expect(await settled(rejectionOf(() => running))).toMatchObject({
      code: 'disposed',
      participantId: 'region',
    });
    expect(region.registration.state().attempt).toStrictEqual({
      status: 'cancelled',
      targetLocale: 'ar-EG',
      transitionId: 5,
      diagnostic: diagnostic('disposed', 5),
    });
  });
});

describe('the records a server-rendered page hands on', () => {
  const PROFILE = 'equator-participant-state/1';
  const progressive = { coordination: 'progressive' } as const;

  /** Runs every progressive region once, each under the next transition identity. */
  const runEach = (coordinator: ParticipantCoordinator, from: number) =>
    coordinator
      .progressive()
      .map((registration, index) =>
        coordinator.runIndependent(
          registration,
          'ar-EG',
          FORMATTING,
          from + index,
          live(),
        ),
      );

  it('carry what each region shows and how far its attempt got', async () => {
    const coordinator = new ParticipantCoordinator();
    recorded(coordinator, [], 'idle');
    recorded(coordinator, [], 'shown', () => READY, progressive);
    recorded(coordinator, [], 'asking', unanswered, progressive);
    recorded(
      coordinator,
      [],
      'refused',
      () => ({ status: 'ready' }) as unknown as LocalizationParticipantReport,
      progressive,
    );
    recorded(coordinator, [], 'down', () => FAILED, progressive);

    const [shown, asking, refused, down] = runEach(coordinator, 1);
    await Promise.all([shown, refused, down]);
    const records = coordinator.transferRecords();

    expect(records).toStrictEqual([
      { profile: PROFILE, participantId: 'idle', coordination: 'required' },
      {
        profile: PROFILE,
        participantId: 'shown',
        coordination: 'progressive',
        current: { targetLocale: 'ar-EG', transitionId: 1, report: READY },
        attempt: {
          status: 'ready',
          targetLocale: 'ar-EG',
          transitionId: 1,
          report: READY,
        },
      },
      {
        profile: PROFILE,
        participantId: 'asking',
        coordination: 'progressive',
        attempt: {
          status: 'preparing',
          targetLocale: 'ar-EG',
          transitionId: 2,
        },
      },
      {
        profile: PROFILE,
        participantId: 'refused',
        coordination: 'progressive',
        attempt: { status: 'failed', targetLocale: 'ar-EG', transitionId: 3 },
      },
      {
        profile: PROFILE,
        participantId: 'down',
        coordination: 'progressive',
        attempt: {
          status: 'failed',
          targetLocale: 'ar-EG',
          transitionId: 4,
          report: FAILED,
        },
      },
    ]);
    // What a server writes is what a browser admits.
    expect(sanitizeParticipantTransferRecords(records)).toStrictEqual(records);
    coordinator.dispose();
    await expect(
      rejectionOf(() => Promise.resolve(asking)),
    ).resolves.toMatchObject({ code: 'disposed', participantId: 'asking' });
  });

  it('leave out an attempt that was abandoned, and keep what the region shows', async () => {
    const coordinator = new ParticipantCoordinator();
    const answers = new Map<string, number>();
    const once = (id: string) => () => {
      const asked = answers.get(id) ?? 0;
      answers.set(id, asked + 1);
      return asked === 0 ? READY : unanswered();
    };
    recorded(coordinator, [], 'overtaken', once('overtaken'), progressive);
    recorded(coordinator, [], 'cancelled', once('cancelled'), progressive);
    await Promise.all(runEach(coordinator, 1));
    const [overtaken, cancelled] = coordinator.progressive();
    const controller = new AbortController();

    const superseding = coordinator.runIndependent(
      overtaken!,
      'fr-FR',
      FORMATTING,
      3,
      live(),
    );
    coordinator.supersedeAll();
    const cancelling = coordinator.runIndependent(
      cancelled!,
      'fr-FR',
      FORMATTING,
      4,
      controller.signal,
    );
    controller.abort();
    const states = await settled(Promise.all([superseding, cancelling]));

    expect(states).toMatchObject([
      { attempt: { status: 'superseded' } },
      { attempt: { status: 'cancelled' } },
    ]);
    expect(coordinator.transferRecords()).toStrictEqual([
      {
        profile: PROFILE,
        participantId: 'overtaken',
        coordination: 'progressive',
        current: { targetLocale: 'ar-EG', transitionId: 1, report: READY },
      },
      {
        profile: PROFILE,
        participantId: 'cancelled',
        coordination: 'progressive',
        current: { targetLocale: 'ar-EG', transitionId: 2, report: READY },
      },
    ]);
    coordinator.dispose();
  });
});
