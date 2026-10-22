import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestBed } from '@angular/core/testing';
import {
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
 * What the live region says when the ordinary way of saying it is not available.
 *
 * Section 11 of `specs/09-safe-content-and-ux.spec.md` makes the announcement unconditional, so
 * each thing it normally leans on has an answer for when it is missing: the platform's name for a
 * language, a wording the application supplied that can be said, and an animation frame to wait
 * for. `locale-announcement.spec.ts` covers the wording when all three are present.
 */

const ANNOUNCER = '[data-equator-announcer]';

const announced = () =>
  document.querySelector(ANNOUNCER)?.textContent ?? undefined;

function setup(...features: readonly LocalizationFeature[]): Localization {
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
        ...features,
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  return TestBed.inject(Localization);
}

/** A document view that schedules no frames, as a nonvisual DOM has. */
function withoutAnimationFrames(): () => void {
  const original = Object.getOwnPropertyDescriptor(
    window,
    'requestAnimationFrame',
  );
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  return () => {
    if (original === undefined)
      Reflect.deleteProperty(window, 'requestAnimationFrame');
    else Object.defineProperty(window, 'requestAnimationFrame', original);
  };
}

describe('the locale announcement without what it normally leans on', () => {
  let restore: (() => void) | undefined;

  beforeEach(() => {
    for (const region of document.querySelectorAll(ANNOUNCER)) region.remove();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    for (const region of document.querySelectorAll(ANNOUNCER)) region.remove();
  });

  it('is the locale tag where the platform cannot name the language', async () => {
    const localization = setup();
    await localization.initialize();
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(function () {
      throw new RangeError('This platform names no languages.');
    } as unknown as () => Intl.DisplayNames);

    const result = await localization.changeLocale('ar-EG');

    expect(result.status).toBe('committed');
    await vi.waitFor(() => {
      expect(announced()).toBe('ar-EG');
    });
  });

  for (const [reason, wording] of [
    ['holds a control character', 'now\u0007Arabic'],
    ['is longer than 512 characters', 'a'.repeat(513)],
  ] as const) {
    it(`reports a wording that ${reason}, and says the default instead`, async () => {
      const events: LocalizationObservabilityEvent[] = [];
      const localization = setup(
        withLocaleAnnouncement(() => wording),
        withObservability({
          emit: (event) => {
            events.push(event);
          },
        }),
      );
      await localization.initialize();

      const result = await localization.changeLocale('ar-EG');

      // The change is not the announcement's to refuse.
      expect(result.status).toBe('committed');
      expect(
        events.filter(({ phase }) => phase === 'integration'),
      ).toMatchObject([
        {
          phase: 'integration',
          status: 'failed',
          reason: 'effect-failed',
          targetLocale: 'ar-EG',
        },
      ]);
      await vi.waitFor(() => {
        expect(announced() ?? '').toMatch(/\p{Script=Arabic}/u);
      });
    });
  }

  it('says a wording of exactly 512 characters as it was given', async () => {
    const wording = 'a'.repeat(512);
    const localization = setup(withLocaleAnnouncement(() => wording));
    await localization.initialize();

    await localization.changeLocale('ar-EG');

    await vi.waitFor(() => {
      expect(announced()).toBe(wording);
    });
  });

  it('is said at once where the document view schedules no frames', async () => {
    const localization = setup(
      withLocaleAnnouncement((snapshot) => `now ${snapshot.primaryLocale}`),
    );
    await localization.initialize();
    restore = withoutAnimationFrames();

    await localization.changeLocale('ar-EG');
    // Behind one microtask and no frame, so nothing here waits for a timer.
    await Promise.resolve();

    expect(announced()).toBe('now ar-EG');
  });
});
