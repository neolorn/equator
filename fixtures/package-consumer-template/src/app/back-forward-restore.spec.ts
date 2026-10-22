import { describe, expect, it, vi } from 'vitest';

import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserPlatformLocation, PlatformLocation } from '@angular/common';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import {
  Localization,
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  memoryStore,
  provideLocalizationSetup,
  withLocaleSources,
  withPersistence,
  withRouting,
  type LocaleUrlPolicy,
  type LocalizationLocaleSource,
  type LocalizationPersistenceStore,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { runtimeExtensions } from './runtime-extensions';
import { routePolicy, appRouteProjection } from './localization.routes';
import { localeInPath, pagePath } from './addresses';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * A page the browser restores from its back-forward cache, after the visitor chose another language.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 5 lets a browser keep a page whose language
 * came from a cookie, on the condition that it asks the server again before reusing it. A restored
 * page is the one reuse that does not ask: the browser brings back the page as it was in memory. So
 * the page asks itself, on `pageshow`, and moves only where the address it is at would not have
 * chosen its current language.
 */

const NEUTRAL: LocaleUrlPolicy = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG', 'en-Arab-XB'],
  xDefaultPath: '/',
});

interface Seat {
  readonly localization: Localization;
  /** What another tab writes, standing in for the cookie every tab of the site shares. */
  readonly shared: LocalizationPersistenceStore;
  readonly reads: () => number;
  readonly written: readonly string[];
}

/**
 * `hold`, where given, keeps each read out until it settles, answering with the value the store had
 * when the read was asked, as a slow store would.
 */
function setup(policy: LocaleUrlPolicy, hold?: () => Promise<void>): Seat {
  const shared = memoryStore()();
  let reads = 0;
  const written: string[] = [];
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
        withRouting({ policy, projection: appRouteProjection }),
        withPersistence(() => ({
          id: 'shared',
          read: async () => {
            reads += 1;
            const value = shared.read();
            await hold?.();
            return value;
          },
          write: (locale: string) => {
            written.push(locale);
            return shared.write(locale);
          },
        })),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  return {
    localization: TestBed.inject(Localization),
    shared,
    reads: () => reads,
    written,
  };
}

function restore(persisted: boolean): void {
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted }));
}

async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe('a page restored from the back-forward cache', () => {
  it('moves to the language chosen since it was left, and records nothing', async () => {
    const seat = setup(NEUTRAL);
    expect((await seat.localization.initialize()).primaryLocale).toBe('en-US');

    await seat.shared.write('ar-EG');
    restore(true);

    await vi.waitFor(() =>
      expect(seat.localization.snapshot()?.primaryLocale).toBe('ar-EG'),
    );
    // Resolved rather than chosen, and only a deliberate change is written.
    expect(seat.written).toEqual([]);
  });

  // Where the path states the language. A document's origin cannot be moved from here, so the
  // origin's own case below names this document's origin instead.
  it.runIf(localeInPath)(
    'stays in the language its address states',
    async () => {
      history.replaceState(null, '', pagePath('home', 'en-US'));
      const seat = setup(routePolicy);
      expect((await seat.localization.initialize()).primaryLocale).toBe(
        'en-US',
      );

      await seat.shared.write('ar-EG');
      const before = seat.reads();
      restore(true);
      await new Promise((done) => setTimeout(done, 0));

      // The store was consulted, which is what makes staying put an answer rather than a miss.
      expect(seat.reads()).toBeGreaterThan(before);
      expect(seat.localization.targetLocale()).toBeUndefined();
      expect(seat.localization.snapshot()?.primaryLocale).toBe('en-US');
    },
  );

  it('stays in the language its origin states', async () => {
    // This document's own origin, named as the Arabic one, so the origin is the only thing here
    // that states Arabic: the path is the same in every locale.
    const seat = setup(
      createHostLocalePolicy({
        defaultLocale: 'en-US',
        origins: {
          'en-US': 'http://en-us.localhost',
          'ar-EG': location.origin,
        },
      }),
    );
    expect((await seat.localization.initialize()).primaryLocale).toBe('ar-EG');

    await seat.shared.write('en-US');
    const before = seat.reads();
    restore(true);
    await new Promise((done) => setTimeout(done, 0));

    expect(seat.reads()).toBeGreaterThan(before);
    expect(seat.localization.targetLocale()).toBeUndefined();
    expect(seat.localization.snapshot()?.primaryLocale).toBe('ar-EG');
  });

  it('gives way to a choice the reader makes while the stores are read', async () => {
    let holding: Promise<void> | undefined;
    let release!: () => void;
    const seat = setup(NEUTRAL, () => holding ?? Promise.resolve());
    expect((await seat.localization.initialize()).primaryLocale).toBe('en-US');

    // Chosen in another tab, and read by a store slow enough for the reader to act first.
    await seat.shared.write('ar-EG');
    holding = new Promise((resolve) => {
      release = resolve;
    });
    const before = seat.reads();
    restore(true);
    await vi.waitFor(() => expect(seat.reads()).toBeGreaterThan(before));

    // The language already on screen, chosen again, which commits nothing new.
    await seat.localization.changeLocale('en-US');
    release();
    await new Promise((done) => setTimeout(done, 0));

    expect(seat.localization.targetLocale()).toBeUndefined();
    expect(
      seat.localization.snapshot()?.primaryLocale,
      'the choice made while the stores were read',
    ).toBe('en-US');
  });

  it('does nothing on a first showing', async () => {
    const seat = setup(NEUTRAL);
    await seat.localization.initialize();
    await seat.shared.write('ar-EG');
    const before = seat.reads();

    restore(false);
    await settled();

    expect(seat.reads()).toBe(before);
  });

  it('lets go of the window once the application is gone', async () => {
    // A listener left on the window keeps the whole application reachable after it is destroyed.
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const pageshow = (calls: readonly (readonly unknown[])[]) =>
      calls
        .filter(([type]) => type === 'pageshow')
        .map(([, listener]) => listener);
    try {
      const seat = setup(NEUTRAL);
      await seat.localization.initialize();
      const listeners = pageshow(added.mock.calls);

      TestBed.resetTestingModule();

      expect(listeners).toHaveLength(1);
      expect(pageshow(removed.mock.calls)).toEqual(
        expect.arrayContaining(listeners),
      );
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });
});

@Component({ template: '' })
class Page {}

interface RoutedSeat {
  readonly localization: Localization;
  readonly shared: LocalizationPersistenceStore;
  readonly reads: () => number;
}

/**
 * An application whose addresses state no locale, moved by Angular's own router, with an order
 * that ranks another source over the stored choice.
 *
 * The browser's own history stands in for the testing module's, so a navigation moves the address
 * a restore reads, as it does on a page.
 */
function routedSetup(sources: readonly LocalizationLocaleSource[]): RoutedSeat {
  const shared = memoryStore()();
  let reads = 0;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformLocation, useClass: BrowserPlatformLocation },
      provideRouter([{ path: '**', component: Page }]),
      provideLocalizationSetup(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        withLocaleSources(...sources),
        withPersistence(() => ({
          id: 'shared',
          read: () => {
            reads += 1;
            return shared.read();
          },
          write: (locale: string) => shared.write(locale),
        })),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  return {
    localization: TestBed.inject(Localization),
    shared,
    reads: () => reads,
  };
}

/** Two router navigations, and how many of them completed after the first. */
async function clientNavigations(): Promise<number> {
  const router = TestBed.inject(Router);
  let completed = 0;
  const counting = router.events.subscribe((event) => {
    if (event instanceof NavigationEnd) completed += 1;
  });
  try {
    await router.navigateByUrl('/first');
    await router.navigateByUrl('/second');
  } finally {
    counting.unsubscribe();
  }
  expect(location.pathname, 'the address the router moved to').toBe('/second');
  return completed - 1;
}

/**
 * A restore applies a stored choice only where the declared order would choose it now
 * (`specs/03-locale-identity-and-resolution.spec.md` section 7). So a source ranked over `stored`
 * decides a restore after a client navigation: a choice it does not name leaves the page where it
 * is, and one it names moves the page.
 */
describe('a restore after a client navigation, under an order that ranks a source first', () => {
  it("is decided by the reader's languages where the order puts them first", async () => {
    const seat = routedSetup(['browser', 'stored', 'default']);
    try {
      // The test document's languages, `navigator.languages`, name English first.
      expect(
        (await seat.localization.initialize()).primaryLocale,
        "the reader's languages",
      ).toBe('en-US');
      const navigations = await clientNavigations();

      await seat.shared.write('ar-EG');
      const before = seat.reads();
      restore(true);
      await new Promise((done) => setTimeout(done, 0));
      expect(seat.reads()).toBeGreaterThan(before);
      expect(
        seat.localization.snapshot()?.primaryLocale,
        "a stored choice the reader's languages outrank",
      ).toBe('en-US');

      await seat.localization.changeLocale('ar-EG', { remember: false });
      await seat.shared.write('en-US');
      restore(true);
      await vi.waitFor(() =>
        expect(
          seat.localization.snapshot()?.primaryLocale,
          "a stored choice the reader's languages name",
        ).toBe('en-US'),
      );
      const observed = {
        platform: TestBed.inject(PLATFORM_ID) as string,
        clientNavigations: navigations,
      };
      claimCapability('source:browser', observed);
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('is decided by the default where the order puts it first', async () => {
    const seat = routedSetup(['default', 'stored']);
    try {
      expect(
        (await seat.localization.initialize()).primaryLocale,
        'the configured default',
      ).toBe('en-US');
      const navigations = await clientNavigations();

      await seat.shared.write('ar-EG');
      const before = seat.reads();
      restore(true);
      await new Promise((done) => setTimeout(done, 0));
      expect(seat.reads()).toBeGreaterThan(before);
      expect(
        seat.localization.snapshot()?.primaryLocale,
        'a stored choice the default outranks',
      ).toBe('en-US');

      await seat.localization.changeLocale('ar-EG', { remember: false });
      await seat.shared.write('en-US');
      restore(true);
      await vi.waitFor(() =>
        expect(
          seat.localization.snapshot()?.primaryLocale,
          'a stored choice the default names',
        ).toBe('en-US'),
      );
      const observed = {
        platform: TestBed.inject(PLATFORM_ID) as string,
        clientNavigations: navigations,
      };
      claimCapability('source:default', observed);
    } finally {
      history.replaceState(null, '', '/');
    }
  });
});
