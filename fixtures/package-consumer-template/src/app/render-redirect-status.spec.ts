import { afterEach, describe, expect, it } from 'vitest';

import { PlatformLocation } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { Component, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  Router,
  RouterOutlet,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import {
  Localization,
  createPathPrefixLocalePolicy,
  withRouting,
  type LocaleUrlPolicy,
  withFormattingContext,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { runtimeExtensions } from './runtime-extensions';
import { routes } from './app.routes';
import { routePolicy, appRouteProjection } from './localization.routes';
import {
  entryRedirects,
  localeInPath,
  pagePath,
  pageUrl,
  unstatedAddress,
} from './addresses';

/**
 * The status of a redirect the runtime makes while a request is rendered on the server.
 *
 * `@angular/ssr` answers a render whose address moved with a redirect, and reads its status from
 * `RESPONSE_INIT`, which it provides only while it renders a request. Left alone that status is
 * 302. A redirect the runtime makes is a routing outcome, and section 5 of the routing
 * specification gives each one its status, so the runtime states it there. The token is provided
 * by hand here, as the engine provides it, and each case arrives the way a request does: at the
 * address, before the Router has read it.
 */

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

/** A policy that has retired the default locale's prefix, so the prefixed spelling is corrected. */
const OMITTING: LocaleUrlPolicy = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'en-Arab-XB': 'en-arab-xb' },
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/',
  omitDefaultPrefix: true,
});

afterEach(() => {
  history.replaceState(null, '', '/');
});

interface Rendered {
  /** What the render left for the engine to send, which is absent where it set nothing. */
  readonly status: number | undefined;
  /** Where the address ended, which is where the engine's redirect points. */
  readonly address: string;
  /** The headers the render left for the engine to send with it. */
  readonly headers: Headers;
}

async function rendered(
  address: string,
  policy: LocaleUrlPolicy,
): Promise<Rendered> {
  const url = new URL(address, 'https://site.example');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  const init: ResponseInit = {};

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: url.href },
      },
      { provide: RESPONSE_INIT, useValue: init },
      provideLocalizedRouter(routes, { origin: url.origin }),
      provideLocalizationTesting(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        withRouting({ policy, projection: appRouteProjection }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });

  await TestBed.inject(Localization).initialize();
  const router = TestBed.inject(Router);
  const fixture = TestBed.createComponent(RootHost);
  const settled = firstValueFrom(
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
  await settled;
  // The engine reads the status once the application is stable, which is after a page has loaded
  // its record and declared its spellings.
  await fixture.whenStable();
  TestBed.tick();

  const platform = TestBed.inject(PlatformLocation);
  return Object.freeze({
    status: init.status,
    address: platform.pathname + platform.search + platform.hash,
    headers: new Headers(init.headers),
  });
}

describe('a redirect the runtime makes during a server render', () => {
  it('states 308 for a replacement of a retired address', async () => {
    const answer = await rendered(pageUrl('legacy', 'en-US'), routePolicy);

    expect(answer.address).toBe(pagePath('second', 'en-US'));
    expect(answer.status).toBe(308);
  });

  it('states 308 for a canonical correction', async () => {
    const answer = await rendered('/en-us/second', OMITTING);

    expect(answer.address).toBe('/second');
    expect(answer.status).toBe(308);
  });

  // Where the path states the locale, which is what jsdom's own location can carry.
  it.runIf(localeInPath)(
    'states 308 where a page corrects its address to a spelling it declared',
    async () => {
      const answer = await rendered(pageUrl('dossier', 'ar-EG'), routePolicy);

      expect(decodeURIComponent(answer.address)).toBe(
        decodeURIComponent(pagePath('declared dossier', 'ar-EG')),
      );
      expect(answer.status).toBe(308);
    },
  );

  // The root states no locale, so the render spells it in the one it chose from the request. That is
  // locale entry, which the routing specification answers differently from a correction: 307, kept
  // by nobody but the browser, and never reused without asking.
  it.runIf(entryRedirects)(
    'states 307, private and revalidated, naming the language field, for locale entry',
    async () => {
      const answer = await rendered(unstatedAddress, routePolicy);

      expect(answer.address).not.toBe('/');
      expect(answer.status).toBe(307);
      expect(answer.headers.get('cache-control')).toBe('private, no-cache');
      expect(answer.headers.get('vary')).toBe('Accept-Language');
    },
  );

  it.runIf(routePolicy.kind === 'locale-neutral')(
    'names the language field on a page more than one locale spells',
    async () => {
      const answer = await rendered(unstatedAddress, routePolicy);

      expect(answer.status).toBeUndefined();
      expect(answer.headers.get('vary')).toBe('Accept-Language');
    },
  );

  it('states nothing where the address is already the page', async () => {
    // The control. A status set on every render would satisfy the cases above and send every page
    // as a redirect.
    const answer = await rendered(pageUrl('second', 'en-US'), routePolicy);

    expect(answer.address).toBe(pagePath('second', 'en-US'));
    expect(answer.status).toBeUndefined();
    expect(answer.headers.get('cache-control')).toBeNull();
  });
});
