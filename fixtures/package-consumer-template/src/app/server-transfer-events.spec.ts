import { describe, expect, it } from 'vitest';

import { PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RUNTIME_EVENT_CODES,
  RUNTIME_OBSERVABILITY_PROFILE,
  Localization,
  provideLocalizationSetup,
  withFormattingContext,
  withLocaleAnnouncement,
  withObservability,
  type LocalizationFeature,
  type LocalizationObservabilityEvent,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';

import { runtimeExtensions } from './runtime-extensions';

/**
 * What a server render reports about the state it hands the browser.
 *
 * The transfer is written once per commit, after every other step of that commit has run, and an
 * application that installed a sink is told when the writing starts and how it ended. The browser
 * half of the same phase, the adoption of what was written, is reported in `observability.spec.ts`.
 */

const TRANSFER_KEY = makeStateKey<{ readonly primaryLocale: string } | null>(
  '@neolorn/equator:localization-state/1',
);

function onTheServer(
  events: LocalizationObservabilityEvent[],
  ...features: readonly LocalizationFeature[]
): Localization {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'server' },
      provideLocalizationSetup(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
        },
        withObservability({
          emit: (event) => {
            events.push(event);
          },
        }),
        ...features,
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  return TestBed.inject(Localization);
}

const transferPhase = (events: readonly LocalizationObservabilityEvent[]) =>
  events.filter(({ phase }) => phase === 'ssr-hydration');

const transferred = () =>
  TestBed.inject(TransferState).get(TRANSFER_KEY, null)?.primaryLocale;

describe('what a server render reports about its transfer', () => {
  it('reports the transfer of each commit as started and then succeeded', async () => {
    const events: LocalizationObservabilityEvent[] = [];
    const localization = onTheServer(events);
    await localization.initialize();

    expect(transferPhase(events)).toEqual([
      {
        profile: RUNTIME_OBSERVABILITY_PROFILE,
        code: RUNTIME_EVENT_CODES.ssrHydration,
        phase: 'ssr-hydration',
        status: 'started',
        targetLocale: 'en-US',
        snapshotId: 1,
      },
      {
        profile: RUNTIME_OBSERVABILITY_PROFILE,
        code: RUNTIME_EVENT_CODES.ssrHydration,
        phase: 'ssr-hydration',
        status: 'succeeded',
        targetLocale: 'en-US',
        snapshotId: 1,
      },
    ]);
    expect(transferred()).toBe('en-US');

    events.length = 0;
    const result = await localization.changeLocale('ar-EG');

    expect(result.status).toBe('committed');
    const snapshotId = localization.snapshot()?.id;
    expect(transferPhase(events)).toEqual([
      {
        profile: RUNTIME_OBSERVABILITY_PROFILE,
        code: RUNTIME_EVENT_CODES.ssrHydration,
        phase: 'ssr-hydration',
        status: 'started',
        targetLocale: 'ar-EG',
        snapshotId,
      },
      {
        profile: RUNTIME_OBSERVABILITY_PROFILE,
        code: RUNTIME_EVENT_CODES.ssrHydration,
        phase: 'ssr-hydration',
        status: 'succeeded',
        targetLocale: 'ar-EG',
        snapshotId,
      },
    ]);
    expect(transferred()).toBe('ar-EG');
    TestBed.resetTestingModule();
  });

  it('reports a failed transfer for a commit the application disposed of first', async () => {
    // The wording function runs in the same commit, ahead of the transfer, and an application is
    // free to tear the runtime down from inside it. Nothing is left to transfer by then.
    const events: LocalizationObservabilityEvent[] = [];
    let runtime: Localization | undefined;
    const localization = onTheServer(
      events,
      withLocaleAnnouncement(() => {
        runtime?.dispose();
        return undefined;
      }),
    );
    runtime = localization;
    await localization.initialize();
    events.length = 0;

    await localization.changeLocale('ar-EG');

    const [started, ended, ...rest] = transferPhase(events);
    expect(rest).toEqual([]);
    expect(started).toMatchObject({ status: 'started', targetLocale: 'ar-EG' });
    expect(ended).toEqual({
      profile: RUNTIME_OBSERVABILITY_PROFILE,
      code: RUNTIME_EVENT_CODES.ssrHydration,
      phase: 'ssr-hydration',
      status: 'failed',
      reason: 'internal-invariant',
      targetLocale: 'ar-EG',
      snapshotId: started?.snapshotId,
    });
    // What the browser would be handed is still the last commit that was whole.
    expect(transferred()).toBe('en-US');
    TestBed.resetTestingModule();
  });
});
