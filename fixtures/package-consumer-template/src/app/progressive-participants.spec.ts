import { describe, expect, it, vi } from 'vitest';

import {
  PLATFORM_ID,
  inject,
  provideEnvironmentInitializer,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Localization,
  languagePresentation,
  provideLocalizationSetup,
  type LocalizationParticipant,
  type LocalizationParticipantContext,
  type LocalizationParticipantRegistration,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';

import { runtimeExtensions } from './runtime-extensions';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * Progressive participants, which is Equator's answer to the region that must not hold up the page.
 *
 * Nothing else guards this invariant: with `startIndependentParticipants` handed an empty list,
 * the rest of the consumer suite passes, because this application registers exactly one participant
 * and it is `required`. Progressive coordination otherwise has a public option, a runtime path, and
 * no consumer.
 *
 * The failure this prevents is not a crash. A region registered as progressive simply never
 * localizes: the page commits, everything else is in the new locale, and one panel silently keeps
 * the old one forever. Nothing throws, so nothing without a test notices.
 *
 * Both halves are needed and neither is sufficient. That the region *starts* would still hold if
 * Equator awaited it like a required participant, which is the opposite bug and the one that makes
 * progressive coordination pointless. That it *finishes* would hold in that world too. What pins
 * the behaviour is the pair: the primary commit lands with the region still in flight, and the
 * region completes afterwards on its own.
 */

/**
 * A participant whose `prepare` can be held open, so "the primary UI did not wait" is asserted
 * against a region that provably had not finished rather than against a race that usually resolves
 * the convenient way.
 */
class IndependentRegion {
  private release: (() => void) | undefined;
  private gate: Promise<void> = Promise.resolve();

  /** `prepare:<locale>` and `commit:<locale>`, in the order they actually happened. */
  readonly events: string[] = [];

  close(): void {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  open(): void {
    this.release?.();
    this.release = undefined;
    this.gate = Promise.resolve();
  }

  readonly participant: LocalizationParticipant = Object.freeze({
    id: 'independent-region',
    prepare: async (context: LocalizationParticipantContext) => {
      this.events.push(`prepare:${context.targetLocale}`);
      await this.gate;
      return Object.freeze({
        status: 'ready' as const,
        representation: Object.freeze({
          kind: 'locale-bound' as const,
          supplyingLocale: context.targetLocale,
          direction: languagePresentation(context.targetLocale).direction,
        }),
      });
    },
    commit: (context: LocalizationParticipantContext) => {
      this.events.push(`commit:${context.targetLocale}`);
    },
  });
}

function setup(region: { readonly participant: LocalizationParticipant }) {
  let registration: LocalizationParticipantRegistration | undefined;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalizationSetup(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
        },
        withFormattingContext({ timeZone: 'UTC' }),
      ),
      // From a provider, which is where an application registers a participant and is the reason
      // this reaches the path it does. Registering imperatively after `TestBed.inject` looks
      // equivalent and is not: by then Equator's app initializer has already started, so the
      // registration arrives late and is picked up by the catch-up path instead of by the
      // dispatch that runs at the end of initialization. Both paths work; only one of them is
      // this invariant, and the other is the one a test reaches by accident.
      provideEnvironmentInitializer(() => {
        registration = inject(Localization).registerParticipant(
          region.participant,
          { coordination: 'progressive' },
        );
      }),
    ],
  });
  const localization = TestBed.inject(Localization);
  return {
    localization,
    registration: registration as LocalizationParticipantRegistration,
  };
}

describe('a progressive participant does not hold up the primary UI', () => {
  it('commits the page while the independent region is still preparing', async () => {
    const region = new IndependentRegion();
    region.close();
    const { localization } = setup(region);

    await localization.initialize();

    // The page is usable. The region is not done, and is provably not done, because its gate is
    // still shut.
    expect(localization.lifecycle()).toBe('ready');
    expect(region.events).not.toContain('commit:en-US');

    // It did start, though. A region that is never dispatched is the failure this whole file
    // exists for, and it looks identical to a region that is merely slow.
    await vi.waitFor(() => {
      expect(region.events).toContain('prepare:en-US');
    });
    expect(region.events).not.toContain('commit:en-US');

    region.open();
  });

  it('finishes the independent region after the page has already committed', async () => {
    const region = new IndependentRegion();
    region.close();
    const { localization, registration } = setup(region);

    await localization.initialize();
    expect(localization.lifecycle()).toBe('ready');

    region.open();

    await vi.waitFor(() => {
      expect(
        region.events,
        'what the application’s LocalizationParticipant was asked, in order',
      ).toEqual(['prepare:en-US', 'commit:en-US']);
    });
    expect(registration.state().current?.report.status).toBe('ready');
    expect(registration.state().current?.targetLocale).toBe('en-US');
    expect(registration.state().coordination).toBe('progressive');
    claimCapability('extension:locale-participant', {
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it('runs the region independently on a locale change too, without holding the change', async () => {
    const region = new IndependentRegion();
    const { localization, registration } = setup(region);

    await localization.initialize();
    await vi.waitFor(() => {
      expect(region.events).toContain('commit:en-US');
    });

    // A locale change is where progressive coordination earns its keep: the visitor clicked, and
    // the page must turn over now rather than when the slowest panel is ready.
    region.close();
    const result = await localization.changeLocale('ar-EG');

    expect(result.status).toBe('committed');
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    expect(region.events).not.toContain('commit:ar-EG');

    region.open();
    await vi.waitFor(() => {
      expect(region.events).toContain('commit:ar-EG');
    });
    expect(registration.state().current?.targetLocale).toBe('ar-EG');
  });
});

/** A region whose Arabic representation cannot be had, for however many times it is asked. */
class FailingRegion {
  readonly events: string[] = [];

  readonly participant: LocalizationParticipant = Object.freeze({
    id: 'failing-region',
    prepare: (context: LocalizationParticipantContext) => {
      this.events.push(`prepare:${context.targetLocale}`);
      if (context.targetLocale === 'ar-EG') {
        throw new Error('The region has no Arabic representation.');
      }
      return Object.freeze({
        status: 'ready' as const,
        representation: Object.freeze({
          kind: 'locale-bound' as const,
          supplyingLocale: context.targetLocale,
          direction: languagePresentation(context.targetLocale).direction,
        }),
      });
    },
    commit: (context: LocalizationParticipantContext) => {
      this.events.push(`commit:${context.targetLocale}`);
    },
  });

  count(event: string): number {
    return this.events.filter((entry) => entry === event).length;
  }
}

function setupFailing(region: FailingRegion) {
  let registration: LocalizationParticipantRegistration | undefined;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalizationSetup(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
        },
        withFormattingContext({ timeZone: 'UTC' }),
      ),
      provideEnvironmentInitializer(() => {
        registration = inject(Localization).registerParticipant(
          region.participant,
          { coordination: 'progressive' },
        );
      }),
    ],
  });
  return {
    localization: TestBed.inject(Localization),
    registration: registration as LocalizationParticipantRegistration,
  };
}

describe('a progressive participant that fails', () => {
  // `specs/06-runtime-and-angular.spec.md` section 7: in progressive mode a region's failure is
  // the region's, and the commit it followed stands.
  it('leaves the committed locale in place', async () => {
    const region = new FailingRegion();
    const { localization, registration } = setupFailing(region);
    await localization.initialize();
    await vi.waitFor(() => {
      expect(region.events).toContain('commit:en-US');
    });

    const result = await localization.changeLocale('ar-EG');
    expect(result.status).toBe('committed');
    await vi.waitFor(() => {
      expect(registration.state().attempt.status).toBe('failed');
    });

    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    expect(localization.lifecycle()).toBe('ready');
    expect(registration.state().current?.targetLocale).toBe('en-US');
    expect(region.events).not.toContain('commit:ar-EG');
  });

  // The same section: what a failed region shows, and whether it tries again, is the application's
  // to decide. A runtime that retried on its own would be deciding it.
  it('is asked again only when the application retries it', async () => {
    const region = new FailingRegion();
    const { localization, registration } = setupFailing(region);
    await localization.initialize();
    await localization.changeLocale('ar-EG');
    await vi.waitFor(() => {
      expect(registration.state().attempt.status).toBe('failed');
    });
    await new Promise((settle) => setTimeout(settle, 50));

    expect(region.count('prepare:ar-EG')).toBe(1);

    await registration.retry();
    await new Promise((settle) => setTimeout(settle, 50));

    expect(region.count('prepare:ar-EG')).toBe(2);
    expect(registration.state().attempt.status).toBe('failed');
  });
});

describe('a progressive region that fails', () => {
  it('fails alone: the locale still commits and the page is ready', async () => {
    const region = new IndependentRegion();
    const failing = {
      participant: Object.freeze({
        ...region.participant,
        prepare: (context: LocalizationParticipantContext) =>
          context.targetLocale === 'ar-EG'
            ? Promise.reject(new Error('the region is down'))
            : region.participant.prepare(context),
      }),
    };
    const { localization, registration } = setup(failing);
    await localization.initialize();
    await vi.waitFor(() => {
      expect(registration.state().current?.targetLocale).toBe('en-US');
    });

    const result = await localization.changeLocale('ar-EG', {
      remember: false,
    });

    expect(result.status).toBe('committed');
    expect(localization.lifecycle()).toBe('ready');
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    await vi.waitFor(() => {
      expect(registration.state().attempt.status).toBe('failed');
    });
    // What the region was showing stays on screen, labelled as what it is.
    expect(registration.state().current?.targetLocale).toBe('en-US');
  });
});
