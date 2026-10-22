import { afterEach, describe, expect, it } from 'vitest';

import { Location, PlatformLocation } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { Component, RESPONSE_INIT } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
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
 * What a server render leaves for the engine when the address it moved comes back.
 *
 * `@angular/ssr` answers a render whose address moved with a redirect and reads its status from
 * `RESPONSE_INIT`. The runtime states that status, and for locale entry the directives section 5 of
 * `specs/07-routing-rendering-and-seo.spec.md` gives it, at the moment the address moves. A render
 * can move the address again before it ends, and where it ends at the address the request named
 * there is no redirect: whatever the runtime stated would go out on the page itself. So it is
 * withdrawn, and what the application had put there is put back.
 *
 * The token is provided by hand, as the engine provides it, and each case arrives the way a
 * request does: at the address, before the Router has read it.
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

afterEach(() => {
  TestBed.resetTestingModule();
  history.replaceState(null, '', '/');
});

interface Render {
  readonly init: ResponseInit;
  readonly localization: Localization;
  /** Runs the Router's first navigation and waits for the page to settle, as the engine does. */
  readonly arrive: () => Promise<void>;
  readonly settle: () => Promise<void>;
  /** The address the engine would compare with the one the request named. */
  readonly address: () => string;
}

async function rendering(path: string, init: ResponseInit): Promise<Render> {
  history.replaceState(null, '', path);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: `${ORIGIN}${path}` },
      },
      { provide: RESPONSE_INIT, useValue: init },
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
    ],
  });
  const localization = TestBed.inject(Localization);
  await localization.initialize();
  const router = TestBed.inject(Router);
  const platform = TestBed.inject(PlatformLocation);
  let fixture: ComponentFixture<RootHost> | undefined;
  const settle = async (): Promise<void> => {
    await fixture?.whenStable();
    TestBed.tick();
  };
  return {
    init,
    localization,
    settle,
    arrive: async () => {
      fixture = TestBed.createComponent(RootHost);
      const ended = firstValueFrom(
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
      await ended;
      await settle();
    },
    address: () => platform.pathname + platform.search + platform.hash,
  };
}

describe('a server render whose address moved and came back', () => {
  it('withdraws the redirect status it stated', async () => {
    const render = await rendering('/en-us/second', {});
    await render.arrive();
    expect(render.init.status).toBeUndefined();

    await render.localization.changeLocale('ar-EG');
    await render.settle();
    expect(render.address()).toBe('/ar-eg/second');
    expect(render.init.status).toBe(308);

    await render.localization.changeLocale('en-US');
    await render.settle();
    expect(render.address()).toBe('/en-us/second');
    // Absent rather than present and empty: the engine is handed the object the application made.
    expect('status' in render.init).toBe(false);
  });

  it('puts back the status the application had set', async () => {
    const render = await rendering('/en-us/second', { status: 404 });
    await render.arrive();

    await render.localization.changeLocale('ar-EG');
    await render.settle();
    expect(render.init.status).toBe(308);

    await render.localization.changeLocale('en-US');
    await render.settle();
    expect(render.init.status).toBe(404);
  });

  /**
   * Locale entry, and an address that comes back from it.
   *
   * The request names a page with no locale, so the render spells it in the locale it chose and
   * that is entry. The application then writes an address the route table does not place, which is
   * written as it was given, and the platform reads it as the address the request named.
   */
  async function enteredAndReturned(init: ResponseInit): Promise<Render> {
    const render = await rendering('/second', init);
    await render.arrive();
    expect(render.address()).toBe('/en-us/second');
    expect(render.init.status).toBe(307);
    const stated = new Headers(render.init.headers);
    expect(stated.get('cache-control')).toBe('private, no-cache');
    expect(stated.get('vary')?.toLowerCase()).toContain('accept-language');

    TestBed.inject(Location).replaceState('/./second');
    expect(render.address()).toBe('/second');
    return render;
  }

  it('withdraws the directives it stated for locale entry', async () => {
    const render = await enteredAndReturned({});

    expect('status' in render.init).toBe(false);
    const headers = new Headers(render.init.headers);
    expect(headers.get('cache-control')).toBeNull();
    expect(headers.get('vary')).toBeNull();
  });

  it('puts back the headers the application had set', async () => {
    const render = await enteredAndReturned({
      headers: {
        'cache-control': 'public, max-age=60',
        vary: 'Accept-Encoding',
      },
    });

    const headers = new Headers(render.init.headers);
    expect(headers.get('cache-control')).toBe('public, max-age=60');
    expect(headers.get('vary')).toBe('Accept-Encoding');
  });
});

describe('the address a server render compares with the one the request named', () => {
  it('is read without a trailing slash, so writing it without one is not a move', async () => {
    const render = await rendering('/en-us/second/', {});
    await render.arrive();

    expect(render.address()).toBe('/en-us/second');
    expect(render.init.status).toBeUndefined();
  });

  it('includes a query handed to the location apart from the path', async () => {
    const render = await rendering('/en-us/second?page=2', {});
    // Before the Router has navigated, so the write below is the only one this render makes.
    await render.localization.changeLocale('ar-EG');
    expect(render.init.status).toBeUndefined();

    TestBed.inject(Location).go('/second', 'page=2');

    // The same page at its Arabic address, which is a move the runtime made and states.
    expect(render.address()).toBe('/ar-eg/second?page=2');
    expect(render.init.status).toBe(308);
  });
});
