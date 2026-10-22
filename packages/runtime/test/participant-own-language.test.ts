import { describe, expect, it } from 'vitest';

import {
  ParticipantCoordinator,
  sanitizeParticipantReport,
} from '../src/participant-runtime.js';
import type {
  FormattingContext,
  LocalizationParticipant,
} from '@neolorn/equator/core';

/**
 * A region's state is what the region reported, and a report is all a region hands over.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 15. A progressive region whose content
 * exists only in English goes on showing English under an Arabic page, and its state has to say
 * so rather than repeat the locale it was asked for. And a report is the only thing that crosses
 * from the region into the transaction, so a report carrying anything its status does not name is
 * refused rather than trimmed, and no consumer payload has a way in.
 */

const ARABIC: FormattingContext = Object.freeze({
  locale: 'ar-EG',
  timeZone: 'UTC',
  calendar: 'gregory',
  numberingSystem: 'arab',
  hourCycle: 'h23',
});

const ENGLISH_ONLY = Object.freeze({
  status: 'ready' as const,
  representation: Object.freeze({
    kind: 'locale-bound' as const,
    supplyingLocale: 'en-US',
    direction: 'ltr' as const,
  }),
});

describe('a progressive region answering in another language', () => {
  it('keeps the language and direction it reported, under the locale it was asked for', async () => {
    const coordinator = new ParticipantCoordinator();
    const participant: LocalizationParticipant = Object.freeze({
      id: 'english-only-region',
      prepare: () => ENGLISH_ONLY,
    });
    coordinator.register(participant, { coordination: 'progressive' }, () =>
      Promise.reject(new Error('not retried here')),
    );
    const [registered] = coordinator.registrations();

    const state = await coordinator.runIndependent(
      registered!,
      'ar-EG',
      ARABIC,
      1,
      new AbortController().signal,
    );

    expect(state.current?.targetLocale).toBe('ar-EG');
    expect(state.current?.report).toStrictEqual(ENGLISH_ONLY);
    expect(state.attempt.status).toBe('ready');
    coordinator.dispose();
  });
});

describe('a participant report carrying a payload', () => {
  it('is refused, not trimmed to the fields its status names', () => {
    expect(
      sanitizeParticipantReport({
        ...ENGLISH_ONLY,
        headline: 'a headline from the application',
      }),
    ).toBeUndefined();
    // The control: the same report without the payload is accepted, so the refusal above is about
    // the extra field and not about the report.
    expect(sanitizeParticipantReport(ENGLISH_ONLY)).toStrictEqual(ENGLISH_ONLY);
  });
});
