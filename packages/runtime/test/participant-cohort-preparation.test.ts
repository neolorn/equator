/**
 * What the participants of one change go through while they prepare.
 *
 * `specs/06-runtime-and-angular.spec.md` section 7 has a coordinated change wait for every
 * required participant, and section 8 has one that reports unavailable or failed fail the
 * transition, makes a deadline's expiry an operational failure, and hands each participant a
 * cancellation signal. So a participant that cannot commit takes the others of its change with
 * it: each is told to discard what it fetched, each region's own state says how its attempt
 * ended, and the signal a region holds is closed only while its attempt can still be abandoned.
 */
import { describe, expect, it } from 'vitest';

import { ParticipantCoordinator } from '../src/participant-runtime.js';
import {
  LocalizationError,
  type LocalizationDiagnostic,
  type LocalizationParticipantReport,
} from '@neolorn/equator/core';

import { diagnosticOf, rejectionOf } from './catalog-store-harness.js';
import {
  FORMATTING,
  READY,
  UNAVAILABLE,
  deferred,
  live,
  pause,
  recorded,
  settled,
  unanswered,
} from './participant-coordinator-harness.js';

const diagnostic = (
  code: LocalizationDiagnostic['code'],
  participantId: string,
  transitionId: number,
  outcome: LocalizationDiagnostic['outcome'] = 'operational-failure',
) => ({
  code,
  outcome,
  message: expect.any(String) as string,
  participantId,
  targetLocale: 'ar-EG',
  transitionId,
});

describe('the required participants of one change', () => {
  it('are none for a change that no region holds up', async () => {
    const coordinator = new ParticipantCoordinator();

    await expect(
      coordinator.prepareRequired([], 'ar-EG', FORMATTING, 1, live()),
    ).resolves.toStrictEqual([]);
    coordinator.dispose();
  });

  it('fail the change as unavailable when one of them has nothing to show', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const sidebar = recorded(coordinator, log, 'sidebar');
    const article = recorded(coordinator, log, 'article', () => UNAVAILABLE);

    const refusal = await rejectionOf(() =>
      coordinator.prepareRequired(
        coordinator.required(),
        'ar-EG',
        FORMATTING,
        3,
        live(),
      ),
    );

    expect(refusal).toStrictEqual(
      diagnostic(
        'participant-unavailable',
        'article',
        3,
        'localized-representation-unavailable',
      ),
    );
    expect(article.registration.state().attempt).toStrictEqual({
      status: 'unavailable',
      targetLocale: 'ar-EG',
      transitionId: 3,
      report: UNAVAILABLE,
    });
    expect(sidebar.registration.state().attempt).toStrictEqual({
      status: 'cancelled',
      targetLocale: 'ar-EG',
      transitionId: 3,
      report: READY,
      diagnostic: diagnostic(
        'participant-unavailable',
        'sidebar',
        3,
        'localized-representation-unavailable',
      ),
    });
    expect(log).toStrictEqual([
      'discard sidebar 3 ready',
      'discard article 3 unavailable',
    ]);

    // Nothing of the change is left in flight for a later intent to withdraw.
    coordinator.supersedeAll();
    expect(sidebar.contexts[0]?.signal.aborted).toBe(false);
    expect(article.contexts[0]?.signal.aborted).toBe(false);
    coordinator.dispose();
  });

  it('fail the change with the failure of the one that failed', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const answer = deferred<LocalizationParticipantReport>();
    const sidebar = recorded(coordinator, log, 'sidebar');
    const footer = recorded(coordinator, log, 'footer', () => UNAVAILABLE);
    const article = recorded(coordinator, log, 'article', () => answer.promise);

    const preparing = rejectionOf(() =>
      coordinator.prepareRequired(
        coordinator.required(),
        'ar-EG',
        FORMATTING,
        5,
        live(),
      ),
    );
    await pause();
    expect(sidebar.registration.state().attempt.status).toBe('prepared');
    answer.reject(new Error('the article service is down'));

    expect(await preparing).toStrictEqual(
      diagnostic('participant-failed', 'article', 5),
    );
    expect(article.registration.state().attempt).toStrictEqual({
      status: 'failed',
      targetLocale: 'ar-EG',
      transitionId: 5,
      diagnostic: diagnostic('participant-failed', 'article', 5),
    });
    expect(sidebar.registration.state().attempt).toStrictEqual({
      status: 'cancelled',
      targetLocale: 'ar-EG',
      transitionId: 5,
      report: READY,
      diagnostic: diagnostic('participant-failed', 'sidebar', 5),
    });
    expect(footer.registration.state().attempt).toStrictEqual({
      status: 'unavailable',
      targetLocale: 'ar-EG',
      transitionId: 5,
      report: UNAVAILABLE,
    });
    expect(log).toStrictEqual([
      'discard article 5 unanswered',
      'discard sidebar 5 ready',
      'discard footer 5 unavailable',
    ]);
    coordinator.dispose();
  });

  it('stop preparing as soon as one of them fails', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const slow = recorded(coordinator, log, 'slow', unanswered);
    recorded(coordinator, log, 'broken', () => {
      throw new Error('the region is down');
    });

    const refusal = await settled(
      rejectionOf(() =>
        coordinator.prepareRequired(
          coordinator.required(),
          'ar-EG',
          FORMATTING,
          6,
          live(),
        ),
      ),
    );

    expect(refusal).toMatchObject({
      code: 'participant-failed',
      participantId: 'broken',
      transitionId: 6,
    });
    expect(slow.contexts[0]?.signal.aborted).toBe(true);
    expect(log).toStrictEqual([
      'discard broken 6 unanswered',
      'discard slow 6 unanswered',
    ]);
    coordinator.dispose();
  });

  it('are cancelled with the change, each under its own name', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const controller = new AbortController();
    const region = recorded(coordinator, log, 'region', unanswered);
    const zone = recorded(coordinator, log, 'zone', unanswered);

    const preparing = rejectionOf(() =>
      coordinator.prepareRequired(
        coordinator.required(),
        'ar-EG',
        FORMATTING,
        7,
        controller.signal,
      ),
    );
    controller.abort();

    // A diagnostic names a participant only by an identity one was registered under.
    expect(await settled(preparing)).toStrictEqual(
      diagnostic('cancelled', 'region', 7),
    );
    expect(region.registration.state().attempt).toStrictEqual({
      status: 'cancelled',
      targetLocale: 'ar-EG',
      transitionId: 7,
      diagnostic: diagnostic('cancelled', 'region', 7),
    });
    expect(zone.registration.state().attempt).toStrictEqual({
      status: 'cancelled',
      targetLocale: 'ar-EG',
      transitionId: 7,
      diagnostic: diagnostic('cancelled', 'zone', 7),
    });
    expect(log).toStrictEqual([
      'discard region 7 unanswered',
      'discard zone 7 unanswered',
    ]);
    coordinator.dispose();
  });

  it('end the way the change says it ended, when it gives a reason', async () => {
    const coordinator = new ParticipantCoordinator();
    const controller = new AbortController();
    const region = recorded(coordinator, [], 'region', unanswered);

    const preparing = rejectionOf(() =>
      coordinator.prepareRequired(
        coordinator.required(),
        'ar-EG',
        FORMATTING,
        7,
        controller.signal,
      ),
    );
    controller.abort(
      new LocalizationError({
        code: 'superseded',
        outcome: 'operational-failure',
        message: 'A newer intent took over.',
      }),
    );

    expect(await settled(preparing)).toMatchObject({ code: 'superseded' });
    expect(region.registration.state().attempt.status).toBe('superseded');
    coordinator.dispose();
  });

  it('are not waited for by a change cancelled before it asked them', async () => {
    const coordinator = new ParticipantCoordinator();
    const controller = new AbortController();
    controller.abort();
    const region = recorded(coordinator, [], 'region', unanswered);

    const refusal = await settled(
      rejectionOf(() =>
        coordinator.prepareRequired(
          coordinator.required(),
          'ar-EG',
          FORMATTING,
          8,
          controller.signal,
        ),
      ),
    );

    expect(refusal).toMatchObject({ code: 'cancelled', transitionId: 8 });
    expect(region.registration.state().attempt.status).toBe('cancelled');
    coordinator.dispose();
  });

  it('are refused an answer the change had not read when it was cancelled', async () => {
    const coordinator = new ParticipantCoordinator();
    const controller = new AbortController();
    // The answer is given first and the cancellation lands before anything reads it.
    const region = recorded(coordinator, [], 'region', () => {
      queueMicrotask(() => controller.abort());
      return READY;
    });

    const refusal = await settled(
      rejectionOf(() =>
        coordinator.prepareRequired(
          coordinator.required(),
          'ar-EG',
          FORMATTING,
          9,
          controller.signal,
        ),
      ),
    );

    expect(refusal).toMatchObject({ code: 'cancelled', transitionId: 9 });
    expect(region.registration.state().attempt.status).toBe('cancelled');
    coordinator.dispose();
  });

  it('are told through their signals of a cancellation that arrives once all have prepared', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const controller = new AbortController();
    const region = recorded(coordinator, log, 'region');
    const zone = recorded(coordinator, log, 'zone');

    const prepared = await coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      10,
      controller.signal,
    );
    const cancelled = new LocalizationError({
      code: 'cancelled',
      outcome: 'operational-failure',
      message: 'The change was cancelled.',
    });
    controller.abort(cancelled);

    expect(region.contexts[0]?.signal.reason).toBe(cancelled);
    expect(zone.contexts[0]?.signal.reason).toBe(cancelled);
    // A participant that was told its change is over is not then asked to commit it.
    expect(diagnosticOf(() => coordinator.commitPrepared(prepared))).toBe(
      cancelled.diagnostic,
    );
    expect(log).toStrictEqual([
      'discard region 10 ready',
      'discard zone 10 ready',
    ]);
    coordinator.dispose();
  });
});

describe('the signal a participant is handed', () => {
  const preparedUnder = async (controller: AbortController) => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const region = recorded(coordinator, log, 'region');
    const prepared = await coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      1,
      controller.signal,
    );
    return { coordinator, log, region, prepared };
  };

  it('stays open once a required region has committed', async () => {
    const controller = new AbortController();
    const { coordinator, log, region, prepared } =
      await preparedUnder(controller);

    coordinator.commitPrepared(prepared);
    controller.abort();

    expect(log).toStrictEqual(['commit region 1']);
    expect(region.contexts[0]?.signal.aborted).toBe(false);
    coordinator.dispose();
  });

  it('stays open once a prepared region has been discarded', async () => {
    const controller = new AbortController();
    const { coordinator, log, region, prepared } =
      await preparedUnder(controller);

    coordinator.discardPrepared(prepared);
    controller.abort();

    expect(log).toStrictEqual(['discard region 1 ready']);
    expect(region.contexts[0]?.signal.aborted).toBe(false);
    coordinator.dispose();
  });

  it('stays open once the region has committed', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const controller = new AbortController();
    const region = recorded(coordinator, log, 'region', () => READY, {
      coordination: 'progressive',
    });

    await coordinator.runIndependent(
      coordinator.progressive()[0]!,
      'ar-EG',
      FORMATTING,
      1,
      controller.signal,
    );
    controller.abort();
    coordinator.supersedeAll();

    expect(log).toStrictEqual(['commit region 1']);
    expect(region.contexts[0]?.signal.aborted).toBe(false);
    coordinator.dispose();
  });

  it('stays open once a preparation has failed, past its deadline too', async () => {
    const coordinator = new ParticipantCoordinator();
    const controller = new AbortController();
    const region = recorded(
      coordinator,
      [],
      'region',
      () => {
        throw new Error('the region is down');
      },
      { coordination: 'progressive', deadlineMilliseconds: 5 },
    );

    const state = await coordinator.runIndependent(
      coordinator.progressive()[0]!,
      'ar-EG',
      FORMATTING,
      2,
      controller.signal,
    );
    await pause(30);
    controller.abort();
    coordinator.supersedeAll();

    expect(state.attempt.status).toBe('failed');
    expect(region.contexts[0]?.signal.aborted).toBe(false);
    coordinator.dispose();
  });

  it('is not closed by a deadline the preparation met', async () => {
    const coordinator = new ParticipantCoordinator();
    const region = recorded(coordinator, [], 'region', () => READY, {
      deadlineMilliseconds: 5,
    });

    const prepared = await coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      3,
      live(),
    );
    await pause(30);

    expect(region.contexts[0]?.signal.aborted).toBe(false);
    coordinator.commitPrepared(prepared);
    expect(region.registration.state().attempt.status).toBe('ready');
    coordinator.dispose();
  });
});

describe('an attempt overtaken by a newer one for the same region', () => {
  it('ends without disturbing the newer attempt', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const answers = [
      deferred<LocalizationParticipantReport>(),
      deferred<LocalizationParticipantReport>(),
    ];
    let asked = 0;
    const region = recorded(
      coordinator,
      log,
      'region',
      () => answers[asked++]!.promise,
      { coordination: 'progressive' },
    );
    const registration = coordinator.progressive()[0]!;

    const older = coordinator.runIndependent(
      registration,
      'ar-EG',
      FORMATTING,
      1,
      live(),
    );
    const newer = coordinator.runIndependent(
      registration,
      'fr-FR',
      FORMATTING,
      2,
      live(),
    );

    expect((await older).attempt).toStrictEqual({
      status: 'preparing',
      targetLocale: 'fr-FR',
      transitionId: 2,
    });
    expect(region.contexts[0]?.signal.reason).toMatchObject({
      diagnostic: {
        code: 'superseded',
        outcome: 'operational-failure',
        participantId: 'region',
        targetLocale: 'fr-FR',
        transitionId: 2,
      },
    });

    answers[1]!.resolve(READY);

    expect(await newer).toMatchObject({
      current: { targetLocale: 'fr-FR', transitionId: 2 },
      attempt: { status: 'ready', transitionId: 2 },
    });
    expect(log).toStrictEqual([
      'discard region 1 unanswered',
      'commit region 2',
    ]);
    coordinator.dispose();
  });

  it('is discarded without disturbing the newer attempt', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const answer = deferred<LocalizationParticipantReport>();
    let asked = 0;
    const region = recorded(coordinator, log, 'region', () =>
      asked++ === 0 ? READY : answer.promise,
    );

    const first = await coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      1,
      live(),
    );
    const second = coordinator.prepareRequired(
      coordinator.required(),
      'fr-FR',
      FORMATTING,
      2,
      live(),
    );
    coordinator.discardPrepared(first);
    answer.resolve(READY);
    coordinator.commitPrepared(await second);

    expect(log).toStrictEqual(['discard region 1 ready', 'commit region 2']);
    expect(region.registration.state()).toMatchObject({
      current: { targetLocale: 'fr-FR', transitionId: 2 },
    });
    coordinator.dispose();
  });

  it('is discarded without ending a newer attempt made under the same transition', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const answer = deferred<LocalizationParticipantReport>();
    let asked = 0;
    const region = recorded(coordinator, log, 'region', () =>
      asked++ === 0 ? READY : answer.promise,
    );
    const again = () =>
      coordinator.prepareRequired(
        coordinator.required(),
        'ar-EG',
        FORMATTING,
        1,
        live(),
      );

    const first = await again();
    const second = again();
    coordinator.discardPrepared(first);

    // The attempts share a transition identity, so only the work each one started tells them apart.
    expect(region.registration.state().attempt).toStrictEqual({
      status: 'preparing',
      targetLocale: 'ar-EG',
      transitionId: 1,
    });
    answer.resolve(READY);
    coordinator.commitPrepared(await second);

    expect(log).toStrictEqual(['discard region 1 ready', 'commit region 1']);
    expect(region.registration.state().attempt.status).toBe('ready');
    coordinator.dispose();
  });

  it('is cancelled with its cohort without ending the newer attempt', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const neighbour = deferred<LocalizationParticipantReport>();
    const answer = deferred<LocalizationParticipantReport>();
    let asked = 0;
    const region = recorded(coordinator, log, 'region', () =>
      asked++ === 0 ? READY : answer.promise,
    );
    recorded(coordinator, log, 'sidebar', () => neighbour.promise);
    const [alone] = coordinator.required();

    const cohort = rejectionOf(() =>
      coordinator.prepareRequired(
        coordinator.required(),
        'ar-EG',
        FORMATTING,
        1,
        live(),
      ),
    );
    await pause();
    const newer = coordinator.prepareRequired(
      [alone!],
      'fr-FR',
      FORMATTING,
      2,
      live(),
    );
    neighbour.reject(new Error('the sidebar is down'));
    await cohort;

    expect(region.registration.state().attempt).toStrictEqual({
      status: 'preparing',
      targetLocale: 'fr-FR',
      transitionId: 2,
    });
    answer.resolve(READY);
    coordinator.commitPrepared(await newer);

    expect(region.registration.state().attempt.status).toBe('ready');
    expect(log).toStrictEqual([
      'discard sidebar 1 unanswered',
      'discard region 1 ready',
      'commit region 2',
    ]);
    coordinator.dispose();
  });

  it('is refused at commit without disturbing what the newer attempt committed', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const region = recorded(coordinator, log, 'region');

    const older = await coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      1,
      live(),
    );
    const newer = await coordinator.prepareRequired(
      coordinator.required(),
      'fr-FR',
      FORMATTING,
      2,
      live(),
    );
    coordinator.commitPrepared(newer);
    const committed = region.registration.state();

    expect(diagnosticOf(() => coordinator.commitPrepared(older))).toMatchObject(
      {
        code: 'superseded',
        transitionId: 2,
      },
    );

    // The page shows what the newer change committed, and the region's last attempt is that one.
    expect(region.registration.state()).toBe(committed);
    expect(committed).toMatchObject({
      current: { targetLocale: 'fr-FR', transitionId: 2 },
      attempt: { status: 'ready', targetLocale: 'fr-FR', transitionId: 2 },
    });
    expect(log).toStrictEqual(['commit region 2', 'discard region 1 ready']);
    coordinator.dispose();
  });

  it('is discarded after a newer attempt has come and failed', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    let asked = 0;
    recorded(coordinator, log, 'region', () => {
      if (asked++ === 0) return READY;
      throw new Error('the region is down');
    });

    const first = await coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      1,
      live(),
    );
    await rejectionOf(() =>
      coordinator.prepareRequired(
        coordinator.required(),
        'fr-FR',
        FORMATTING,
        2,
        live(),
      ),
    );
    coordinator.discardPrepared(first);

    expect(log).toStrictEqual([
      'discard region 2 unanswered',
      'discard region 1 ready',
    ]);
    coordinator.dispose();
  });
});
