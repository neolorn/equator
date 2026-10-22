/**
 * What unregistering a participant ends, and what it leaves alone.
 *
 * `specs/06-runtime-and-angular.spec.md` section 8 has a region take part in a locale transaction
 * for as long as it is registered, and section 11 has a destroyed context cancel its pending
 * work. A component unregisters when it is destroyed, which can be while its preparation is still
 * in flight and can be after the context that held it has gone, so the first ends the preparation
 * with a diagnostic that names the region and the change, and the second does nothing.
 */
import { describe, expect, it } from 'vitest';

import { ParticipantCoordinator } from '../src/participant-runtime.js';

import { rejectionOf } from './catalog-store-harness.js';
import {
  FORMATTING,
  live,
  recorded,
  settled,
  unanswered,
} from './participant-coordinator-harness.js';

describe('a participant unregistered while it prepares', () => {
  it('ends the preparation with a diagnostic naming the region and the change', async () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const region = recorded(coordinator, log, 'region', unanswered);
    const preparing = coordinator.prepareRequired(
      coordinator.required(),
      'ar-EG',
      FORMATTING,
      5,
      live(),
    );

    region.registration.unregister();

    const ended = {
      code: 'disposed',
      outcome: 'operational-failure',
      message: expect.any(String) as string,
      participantId: 'region',
      transitionId: 5,
      targetLocale: 'ar-EG',
    };
    expect(await settled(rejectionOf(() => preparing))).toStrictEqual(ended);
    expect(region.registration.state().attempt).toStrictEqual({
      status: 'cancelled',
      targetLocale: 'ar-EG',
      transitionId: 5,
      diagnostic: ended,
    });
    expect(log).toStrictEqual([
      'dispose region',
      'discard region 5 unanswered',
    ]);
    coordinator.dispose();
  });
});

describe('a participant unregistered after its coordinator was disposed', () => {
  it('is left as the disposal left it', () => {
    const coordinator = new ParticipantCoordinator();
    const log: string[] = [];
    const region = recorded(coordinator, log, 'region');
    coordinator.dispose();
    const revision = coordinator.registrationRevision();

    expect(() => region.registration.unregister()).not.toThrow();

    expect(log).toStrictEqual(['dispose region']);
    expect(coordinator.registrationRevision()).toBe(revision);
  });
});
