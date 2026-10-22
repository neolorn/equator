/**
 * What the live region says, and what it says when the application says it instead.
 *
 * Section 11 of `specs/09-safe-content-and-ux.spec.md` makes the announcement unconditional and
 * makes `withLocaleAnnouncement` a replacement of the wording alone. A replacement that supplies no
 * wording is still a replacement, and is how an application that announces the change through a
 * region of its own keeps the change from being announced twice.
 *
 * `document-locale-withdrawal.spec.ts` covers the region's existence and its withdrawal. This file
 * is about what goes into it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Localization,
  provideLocalizationSetup,
  withLocaleAnnouncement,
  withOverlayLocale,
  withRouting,
  type LocalizationSnapshot,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';
import { messages } from '#i18n/shell';

import { runtimeExtensions } from './runtime-extensions';
import { routePolicy, appRouteProjection } from './localization.routes';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

const ANNOUNCER = '[data-equator-announcer]';

const announced = () =>
  document.querySelector(ANNOUNCER)?.textContent ?? undefined;

/**
 * Past the frame the announcement waits for, so an empty region is one nothing was written to
 * rather than one nothing has been written to yet.
 */
const pastTheFrame = () => new Promise((resolve) => setTimeout(resolve, 32));

function setup(
  format?: (snapshot: LocalizationSnapshot) => string | undefined,
): Localization {
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
          routeProjection,
        },
        // The row's policy, because what is announced must not depend on how addresses carry the
        // locale. Without the localized router a change under locale-host commits in this document.
        withRouting({ policy: routePolicy, projection: appRouteProjection }),
        ...(format === undefined ? [] : [withLocaleAnnouncement(format)]),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  return TestBed.inject(Localization);
}

describe('what a locale change is announced as', () => {
  beforeEach(() => {
    for (const region of document.querySelectorAll(ANNOUNCER)) region.remove();
  });

  afterEach(() => {
    for (const region of document.querySelectorAll(ANNOUNCER)) region.remove();
  });

  it('is the arriving language’s own name, written in that language', async () => {
    const localization = setup();
    await localization.initialize();

    await localization.changeLocale('ar-EG');

    await vi.waitFor(() => {
      expect(announced() ?? '').not.toBe('');
    });
    // The name rather than the tag, and in Arabic letters rather than in the language being left.
    // Announcing "ar-EG", or announcing "Arabic" in English, is what this rules out.
    expect(announced()).not.toBe('ar-EG');
    expect(announced()).toMatch(/\p{Script=Arabic}/u);
  });

  it('is the application’s sentence where it supplies one', async () => {
    const localization = setup((snapshot) => `now ${snapshot.primaryLocale}`);
    await localization.initialize();

    await localization.changeLocale('ar-EG');

    await vi.waitFor(() => {
      expect(announced(), 'the wording withLocaleAnnouncement supplied').toBe(
        'now ar-EG',
      );
    });
    claimCapability('feature:withLocaleAnnouncement', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it('is worded from the catalog of the locale arrived at', async () => {
    // The sentence an application writes is a message, and reading it is what the wording is for:
    // asked before the change is published, the runtime answers in the language being left.
    let reader: Localization | undefined;
    const localization = setup(() => reader?.text(messages.appTitle));
    reader = localization;
    await localization.initialize();

    await localization.changeLocale('ar-EG');

    await vi.waitFor(() => {
      expect(announced()).toBe(localization.text(messages.appTitle));
    });
    expect(announced()).toMatch(/\p{Script=Arabic}/u);
  });

  it('is the default wording where the application’s cannot be said', async () => {
    // A replacement replaces the wording and not the decision to announce, and the change itself is
    // not the announcement's to refuse.
    const localization = setup(() => 'line\nbreak');
    await localization.initialize();

    const result = await localization.changeLocale('ar-EG');

    expect(result.status).toBe('committed');
    await vi.waitFor(() => {
      expect(announced() ?? '').toMatch(/\p{Script=Arabic}/u);
    });
  });
});

describe('an application that announces the change itself', () => {
  beforeEach(() => {
    for (const region of document.querySelectorAll(ANNOUNCER)) region.remove();
  });

  afterEach(() => {
    for (const region of document.querySelectorAll(ANNOUNCER)) region.remove();
  });

  it('supplies no wording, and the change is not announced twice', async () => {
    const localization = setup(() => undefined);
    await localization.initialize();

    const result = await localization.changeLocale('ar-EG');
    await pastTheFrame();

    // The change still happened, and the region is still there. Supplying no wording is not a
    // refusal of the change and not a withdrawal of the document effects.
    expect(result.status).toBe('committed');
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    expect(document.querySelector(ANNOUNCER)).not.toBeNull();
    expect(announced()).toBe('');
  });

  it('is announced again as soon as it supplies wording', async () => {
    // A change that says nothing must not leave the hook believing the page is still in the locale
    // it was in, or the next change compares against the wrong one and says nothing either.
    const localization = setup((snapshot) =>
      snapshot.primaryLocale === 'ar-EG' ? undefined : 'back in English',
    );
    await localization.initialize();

    await localization.changeLocale('ar-EG');
    await pastTheFrame();
    expect(announced()).toBe('');

    await localization.changeLocale('en-US');

    await vi.waitFor(() => {
      expect(announced()).toBe('back in English');
    });
  });
});

/**
 * A switch that fails says nothing.
 *
 * Section 11 rules out announcing a failed switch as a success: a reader told the page is now in
 * Arabic, on a page that stayed in English, is given the wrong pronunciation rules for everything
 * after it. Two failures, because they fail at different points of the commit: an overlay adapter
 * fails before the announcement's own step has run, and a required participant fails after every
 * document step has run, the announcement's included.
 */
describe('a locale change that fails', () => {
  beforeEach(() => {
    for (const region of document.querySelectorAll(ANNOUNCER)) region.remove();
  });

  afterEach(() => {
    for (const region of document.querySelectorAll(ANNOUNCER)) region.remove();
  });

  function failingSetup(feature: 'overlay' | 'participant'): Localization {
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
          withLocaleAnnouncement((snapshot) => `now ${snapshot.primaryLocale}`),
          ...(feature === 'overlay'
            ? [
                withOverlayLocale(() => ({
                  apply: (snapshot: { readonly primaryLocale: string }) => {
                    if (snapshot.primaryLocale === 'ar-EG') {
                      throw new Error('intentional overlay failure');
                    }
                  },
                })),
              ]
            : []),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });
    const localization = TestBed.inject(Localization);
    if (feature === 'participant') {
      localization.registerParticipant({
        id: 'failing-commit',
        prepare: (context) => ({
          status: 'ready',
          representation: {
            kind: 'locale-bound',
            supplyingLocale: context.targetLocale,
            direction: context.targetLocale === 'ar-EG' ? 'rtl' : 'ltr',
          },
        }),
        commit: (context) => {
          if (context.targetLocale === 'ar-EG') {
            throw new Error('intentional participant failure');
          }
        },
      });
    }
    return localization;
  }

  for (const feature of ['overlay', 'participant'] as const) {
    it(`is not announced when the ${feature} fails the commit`, async () => {
      const localization = failingSetup(feature);
      await localization.initialize();

      const result = await localization.changeLocale('ar-EG');
      await pastTheFrame();

      expect(result.status).toBe('failed');
      expect(localization.snapshot()?.primaryLocale).toBe('en-US');
      expect(document.querySelector(ANNOUNCER)).not.toBeNull();
      expect(announced()).toBe('');
    });
  }
});
