import { describe, expect, it } from 'vitest';

import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  Router,
  RouterOutlet,
  type Event as RouterEvent,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import {
  Localization,
  withRouting,
  withFormattingContext,
} from '@neolorn/equator';
import {
  RouteLocalizationError,
  provideLocalizedRouter,
} from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { runtimeExtensions } from './runtime-extensions';
import { routes } from './app.routes';
import { routePolicy, appRouteProjection } from './localization.routes';
import { localeOrigin, pagePath } from './addresses';

/**
 * What an application's navigation error handling is handed for an address Equator cannot read.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 15 answers a malformed address with 400. In
 * the browser that answer reaches the application as the Router's NavigationError, and the error
 * it carries is the one the router entry point publishes, so a handler can read the resolution off
 * it rather than parse a message.
 */

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

describe('a navigation to an address the route table cannot read', () => {
  it('ends in a RouteLocalizationError carrying the malformed resolution', async () => {
    const origin = localeOrigin('en-US');
    // An encoded separator inside a parameter: the Router matches the item route, and the address
    // is refused because it no longer says which segments it has.
    const address = pagePath('item', 'en-US').replace(/42$/u, '4%2F2');
    expect(address).toContain('%2F');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      // The Router also hands the error to the application's error handler, which TestBed
      // rethrows; an application only logs it, and this case reads the NavigationError instead.
      rethrowApplicationErrors: false,
      providers: [
        {
          provide: MOCK_PLATFORM_LOCATION_CONFIG,
          useValue: { startUrl: `${origin}${pagePath('home', 'en-US')}` },
        },
        provideLocalizedRouter(routes, { origin }),
        provideLocalizationTesting(
          {
            configuration,
            catalogSet,
            catalogLoaders,
            recoveryPayload,
            extensions: runtimeExtensions,
            routeProjection,
          },
          withRouting({ policy: routePolicy, projection: appRouteProjection }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });
    await TestBed.inject(Localization).initialize();
    const router = TestBed.inject(Router);
    TestBed.createComponent(RootHost);
    const settled = (): Promise<RouterEvent> =>
      firstValueFrom(
        router.events.pipe(
          filter(
            (event) =>
              event instanceof NavigationEnd ||
              event instanceof NavigationCancel ||
              event instanceof NavigationError,
          ),
        ),
      );
    const home = settled();
    router.initialNavigation();
    await home;

    const outcome = settled();
    void router.navigateByUrl(address).catch(() => undefined);
    const event = await outcome;

    expect(event).toBeInstanceOf(NavigationError);
    const error = (event as NavigationError).error as unknown;
    expect(error).toBeInstanceOf(RouteLocalizationError);
    expect((error as RouteLocalizationError).resolution).toMatchObject({
      status: 'malformed',
      httpStatus: 400,
    });
    TestBed.resetTestingModule();
  });
});
