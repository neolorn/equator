import { describe, expect, it } from 'vitest';

import { ParticipantCoordinator } from '../src/participant-runtime.js';
import type {
  FormattingContext,
  LocalizationParticipant,
  LocalizationParticipantContext,
} from '@neolorn/equator/core';

/**
 * A progressive region that fails stays failed on its own.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 7 confines a progressive region's failure
 * to that region. The page has already committed by the time a progressive region runs, so a
 * failure that escaped the region would surface as a rejection nobody is waiting for, and a
 * failure that reached a neighbour would take down content that had nothing wrong with it.
 */

const ARABIC: FormattingContext = Object.freeze({
  locale: 'ar-EG',
  timeZone: 'UTC',
  calendar: 'gregory',
  numberingSystem: 'arab',
  hourCycle: 'h23',
});

const ready = (context: LocalizationParticipantContext) =>
  Object.freeze({
    status: 'ready' as const,
    representation: Object.freeze({
      kind: 'locale-bound' as const,
      supplyingLocale: context.targetLocale,
      direction: 'rtl' as const,
    }),
  });

describe('a progressive region whose preparation throws', () => {
  it('reports its own failure and leaves the region beside it ready', async () => {
    const coordinator = new ParticipantCoordinator();
    const failing: LocalizationParticipant = Object.freeze({
      id: 'failing-region',
      prepare: () => Promise.reject(new Error('the region is down')),
    });
    const healthy: LocalizationParticipant = Object.freeze({
      id: 'healthy-region',
      prepare: ready,
    });
    const retry = () => Promise.reject(new Error('not retried here'));
    coordinator.register(failing, { coordination: 'progressive' }, retry);
    coordinator.register(healthy, { coordination: 'progressive' }, retry);
    const signal = new AbortController().signal;

    const [failed, succeeded] = await Promise.all(
      coordinator
        .registrations()
        .map((registration) =>
          coordinator.runIndependent(registration, 'ar-EG', ARABIC, 1, signal),
        ),
    ).then(
      (states) => states,
      (error: unknown) => [error, undefined] as const,
    );

    expect(failed).toMatchObject({
      participantId: 'failing-region',
      attempt: { status: 'failed', targetLocale: 'ar-EG' },
    });
    expect(failed).not.toHaveProperty('current');
    expect(succeeded).toMatchObject({
      participantId: 'healthy-region',
      current: { targetLocale: 'ar-EG' },
      attempt: { status: 'ready' },
    });
    coordinator.dispose();
  });
});
