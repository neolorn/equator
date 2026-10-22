import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlatformLocation } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { Component, Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationSkippedCode,
  Router,
  RouterOutlet,
  UrlHandlingStrategy,
  type Event as RouterEvent,
  type UrlTree,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import {
  Localization,
  createPathPrefixLocalePolicy,
  withFormattingContext,
  withRouting,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { routes } from './app.routes';
import { appRouteProjection } from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

/**
 * The address bar after a navigation the Router skipped.
 *
 * A history entry an application pushed for itself can hold the page's address in the language
 * that was committed when it was written. Returning to it names the route already active, so the
 * Router skips the navigation and writes nothing, and the entry's address would stay on screen
 * over a page in another language. The address is put right on that skip. The Router's other skip,
 * an address its URL handling strategy declined, is one the application asked to keep, and it is
 * left as it stands.
 */

const PATH_PREFIX = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'en-Arab-XB': 'en-arab-xb' },
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/',
});

const ORIGIN = 'https://site.example';

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

/** A strategy of the application's own, which stops answering for addresses when told to. */
@Injectable()
class WithdrawingUrlHandling extends UrlHandlingStrategy {
  static declining = false;

  override shouldProcessUrl(): boolean {
    return !WithdrawingUrlHandling.declining;
  }

  override extract(url: UrlTree): UrlTree {
    return url;
  }

  override merge(newUrlPart: UrlTree): UrlTree {
    return newUrlPart;
  }
}

interface Arrived {
  readonly router: Router;
  readonly platform: PlatformLocation;
  readonly skipped: () => Promise<RouterEvent>;
}

async function arrivedAt(
  path: string,
  providers: readonly unknown[] = [],
): Promise<Arrived> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: `${ORIGIN}${path}` },
      },
      provideLocalizedRouter(routes, { origin: ORIGIN }),
      provideLocalizationTesting(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        withRouting({ policy: PATH_PREFIX, projection: appRouteProjection }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
      ...(providers as never[]),
    ],
  });
  await TestBed.inject(Localization).initialize();
  const router = TestBed.inject(Router);
  const fixture = TestBed.createComponent(RootHost);
  const landed = firstValueFrom(
    router.events.pipe(
      filter(
        (event) =>
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError,
      ),
    ),
  );
  router.initialNavigation();
  expect(await landed).toBeInstanceOf(NavigationEnd);
  await fixture.whenStable();
  return {
    router,
    platform: TestBed.inject(PlatformLocation),
    skipped: () =>
      firstValueFrom(
        router.events.pipe(
          filter((event) => event instanceof NavigationSkipped),
        ),
      ),
  };
}

afterEach(() => {
  WithdrawingUrlHandling.declining = false;
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

describe('the address bar after a navigation the Router skipped', () => {
  it('is put back in the committed locale where the route was already active', async () => {
    const { router, platform, skipped } = await arrivedAt('/en-us/second');
    // The entry an application pushed while Arabic was committed, returned to in English.
    platform.replaceState(platform.getState(), '', '/ar-eg/second');
    expect(platform.pathname).toBe('/ar-eg/second');

    const skip = skipped();
    await router.navigateByUrl('/second');

    expect(((await skip) as NavigationSkipped).code).toBe(
      NavigationSkippedCode.IgnoredSameUrlNavigation,
    );
    expect(platform.pathname).toBe('/en-us/second');
  });

  it('is left alone where the application’s URL handling strategy declined the address', async () => {
    // The strategy is the application's, which the startup diagnostics report.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { router, platform, skipped } = await arrivedAt('/en-us/second', [
      { provide: UrlHandlingStrategy, useClass: WithdrawingUrlHandling },
    ]);
    platform.replaceState(platform.getState(), '', '/ar-eg/second');
    WithdrawingUrlHandling.declining = true;

    const skip = skipped();
    await router.navigateByUrl('/elsewhere');

    expect(((await skip) as NavigationSkipped).code).toBe(
      NavigationSkippedCode.IgnoredByUrlHandlingStrategy,
    );
    expect(platform.pathname).toBe('/ar-eg/second');
  });
});
