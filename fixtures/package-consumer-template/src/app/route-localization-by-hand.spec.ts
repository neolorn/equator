import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { Component, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  RedirectCommand,
  Router,
  RouterOutlet,
  type Event as RouterEvent,
  type Routes,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import {
  DocumentLocalization,
  Localization,
  createPathPrefixLocalePolicy,
  withFormattingContext,
  withRouting,
} from '@neolorn/equator';
import {
  RouteLocalization,
  RouteLocalizationError,
  provideLocalizedRouter,
  type LocalizedRouterOptions,
} from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { messages } from '#i18n/shell';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { routes } from './app.routes';
import { appRouteProjection } from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

/**
 * `RouteLocalization` asked directly, as an application's own resolver or status line asks it.
 *
 * `provideLocalizedRouter` calls `prepare` with an address it has already made canonical, so the
 * answers `prepare` gives for an address that is not canonical, and for a call made outside a
 * navigation, are met only by an application calling it itself. `settled` is the same: the Router
 * integration never waits on it, a caller does. Section 5 of
 * `specs/07-routing-rendering-and-seo.spec.md` gives each redirect its status and locale entry its
 * directives, and those are what `prepare` leaves for a server render to send.
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

@Component({ standalone: true, template: '' })
class Blank {}

interface Configured {
  readonly router: Router;
  readonly localization: Localization;
  readonly routeLocalization: RouteLocalization;
  /** Starts the runtime and runs the Router's first navigation. */
  readonly arrive: () => Promise<RouterEvent>;
  /** Navigates, and hands back the event the navigation ended on. */
  readonly navigate: (address: string) => Promise<RouterEvent>;
}

function configured(
  path: string,
  setup: {
    readonly options?: LocalizedRouterOptions;
    readonly routes?: Routes;
    readonly providers?: readonly unknown[];
  } = {},
): Configured {
  // The runtime reads the locale it starts in from the document's own address.
  history.replaceState(null, '', path);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    // A failed navigation also reaches the application's error handler, which TestBed rethrows;
    // these cases read the navigation's own ending instead.
    rethrowApplicationErrors: false,
    providers: [
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: `${ORIGIN}${path}` },
      },
      provideLocalizedRouter(setup.routes ?? routes, {
        origin: ORIGIN,
        ...setup.options,
      }),
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
      ...((setup.providers ?? []) as never[]),
    ],
  });
  const localization = TestBed.inject(Localization);
  const router = TestBed.inject(Router);
  const ended = (): Promise<RouterEvent> =>
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
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 3; round += 1) {
      TestBed.tick();
      for (let hop = 0; hop < 3; hop += 1) await Promise.resolve();
    }
    TestBed.tick();
  };
  return {
    router,
    localization,
    routeLocalization: TestBed.inject(RouteLocalization),
    arrive: async () => {
      await localization.initialize();
      TestBed.createComponent(RootHost);
      const end = ended();
      router.initialNavigation();
      const event = await end;
      await settle();
      return event;
    },
    navigate: async (address) => {
      const end = ended();
      void router.navigateByUrl(address).catch(() => undefined);
      const event = await end;
      await settle();
      return event;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
  history.replaceState(null, '', '/');
});

describe('RouteLocalization.settled()', () => {
  it('answers a failed result where no locale change has completed', async () => {
    const { localization, routeLocalization } = configured('/ar-eg/second');
    await localization.initialize();

    const result = await routeLocalization.settled();

    expect(result.status).toBe('failed');
    expect(result).toMatchObject({
      transitionId: 0,
      mode: 'coordinated',
      // The locale the runtime started in, which is the one the address states.
      targetLocale: 'ar-EG',
      diagnostic: { code: 'route-unavailable', outcome: 'operational-failure' },
    });
  });

  it('names the mode the router was configured with in that result', async () => {
    const { localization, routeLocalization } = configured('/en-us/second', {
      options: { mode: 'progressive' },
    });
    await localization.initialize();

    expect(await routeLocalization.settled()).toMatchObject({
      status: 'failed',
      mode: 'progressive',
      targetLocale: 'en-US',
    });
  });

  it('answers the commit of the navigation that landed', async () => {
    const { arrive, routeLocalization } = configured('/en-us/second');
    expect(await arrive()).toBeInstanceOf(NavigationEnd);

    expect(await routeLocalization.settled()).toMatchObject({
      status: 'committed',
      targetLocale: 'en-US',
    });
  });
});

describe('RouteLocalization.prepare() called outside a navigation', () => {
  it('rejects with a malformed resolution for an address it would otherwise commit', async () => {
    const { arrive, routeLocalization } = configured('/en-us');
    await arrive();

    const error: unknown = await routeLocalization
      .prepare('/en-us/second')
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(RouteLocalizationError);
    expect((error as RouteLocalizationError).name).toBe(
      'RouteLocalizationError',
    );
    expect((error as RouteLocalizationError).resolution).toMatchObject({
      status: 'malformed',
      httpStatus: 400,
      presentationLocale: 'en-US',
      diagnostic: { code: 'route-unavailable', outcome: 'operational-failure' },
    });
  });
});

describe('RouteLocalization.prepare() given an address that is not canonical', () => {
  async function prepared(
    target: string,
    init?: ResponseInit,
  ): Promise<{ readonly command: RedirectCommand; readonly router: Router }> {
    const { arrive, routeLocalization, router } = configured('/en-us', {
      providers:
        init === undefined ? [] : [{ provide: RESPONSE_INIT, useValue: init }],
    });
    await arrive();
    const command = await routeLocalization.prepare(target);
    expect(command).toBeInstanceOf(RedirectCommand);
    return { command: command as RedirectCommand, router };
  }

  it('redirects an address that states no locale to the committed one, keeping the entry', async () => {
    const { command, router } = await prepared('/second');

    expect(
      router.serializeUrl(router.parseUrl(String(command.redirectTo))),
    ).toBe('/en-us/second');
    expect(command.navigationBehaviorOptions?.replaceUrl).toBe(false);
  });

  it('states 307, private and revalidated, naming the language field, for that entry on a server render', async () => {
    const init: ResponseInit = {};

    await prepared('/second', init);

    expect(init.status).toBe(307);
    const headers = new Headers(init.headers);
    expect(headers.get('cache-control')).toBe('private, no-cache');
    expect(headers.get('vary')).toBe('Accept-Language');
  });

  it('redirects a spelling the address is corrected from, replacing the entry', async () => {
    const init: ResponseInit = {};

    const { command, router } = await prepared('/EN-US/second', init);

    expect(
      router.serializeUrl(router.parseUrl(String(command.redirectTo))),
    ).toBe('/en-us/second');
    expect(command.navigationBehaviorOptions?.replaceUrl).toBe(true);
    // A correction's lifetime is the deployment's, so only its status is stated.
    expect(init.status).toBe(308);
    const headers = new Headers(init.headers);
    expect(headers.get('cache-control')).toBeNull();
    expect(headers.get('vary')).toBeNull();
  });
});

describe('a navigation that fails after its locale transaction committed', () => {
  it('puts back the route the snapshot named', async () => {
    let failing = false;
    const guarded: Routes = [
      { path: '', component: Blank },
      {
        path: 'second',
        component: Blank,
        resolve: {
          record: () => {
            if (failing) throw new Error('The record did not load.');
            return true;
          },
        },
      },
      { path: '**', component: Blank },
    ];
    // The reduced table leaves projection routes unrendered, which the router reports.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { arrive, navigate, localization } = configured('/en-us', {
      routes: guarded,
    });
    await arrive();
    const home = localization.snapshot()?.route;
    expect(home?.canonicalPath).toBe('/en-us');

    failing = true;
    expect(await navigate('/second')).toBeInstanceOf(NavigationError);

    expect(localization.snapshot()?.route).toEqual(home);
  });
});

describe('a navigation whose document projection fails after it landed', () => {
  it('answers a failed result and returns to the address it left', async () => {
    const { arrive, navigate, routeLocalization, router, localization } =
      configured('/en-us/second', {
        options: {
          document: (context) => {
            if (context.resolution.routeId === 'item') {
              throw new Error('The item has no title to give.');
            }
            return {};
          },
        },
      });
    await arrive();

    expect(await navigate('/items/42')).toBeInstanceOf(NavigationEnd);
    const result = await routeLocalization.settled();
    for (let hop = 0; hop < 5; hop += 1) await Promise.resolve();

    expect(result).toMatchObject({
      status: 'failed',
      targetLocale: 'en-US',
      diagnostic: { code: 'effect-failed', outcome: 'operational-failure' },
    });
    expect(router.url).toBe('/second');
    expect(localization.snapshot()?.route?.routeId).toBe('route:second');
  });
});

describe('a response that reached no route, with a document that declares no title', () => {
  it('is reported once, by its outcome class', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { arrive, navigate } = configured('/en-us/missing', {
      options: {
        outcomeDocuments: {
          'not-found': {
            description: messages.document.notFound.description,
          },
        },
      },
    });
    await arrive();
    await navigate('/another-missing');

    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).startsWith('[Equator] A response classed "not-found"'),
      ),
    ).toHaveLength(1);
  });

  it('is not reported where the document declares one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { arrive } = configured('/ar-eg/missing', {
      options: {
        outcomeDocuments: {
          'not-found': {
            title: messages.document.notFound.title,
            description: messages.document.notFound.description,
          },
        },
      },
    });
    await arrive();

    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).startsWith('[Equator] A response classed'),
      ),
    ).toHaveLength(0);
    // Written in the locale the address states, which is the one that was committed for it.
    expect(document.documentElement.lang).toBe('ar-EG');
    expect(TestBed.inject(DocumentLocalization).current()?.locale).toBe(
      'ar-EG',
    );
    expect(document.title).toBe(
      TestBed.inject(Localization).text(messages.document.notFound.title),
    );
    expect(document.title).not.toBe('Page not found');
  });
});
