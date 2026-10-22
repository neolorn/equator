import { describe, expect, it } from 'vitest';

import { LocationStrategy, PathLocationStrategy } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import {
  ApplicationInitStatus,
  ApplicationRef,
  Component,
  PLATFORM_ID,
  REQUEST,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet } from '@angular/router';
import {
  Localization,
  LocalizationError,
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  defineRouteProjection,
  withFormattingContext,
  withRouting,
  type LocaleUrlPolicy,
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
 * A page rendered ahead of a request, which is one file served to every visitor.
 *
 * Section 9 of `specs/07-routing-rendering-and-seo.spec.md` refuses to write that file for a route
 * that is private or kept per visitor, and for an address whose locale depends on who asks. The
 * refusal is made while the root component bootstraps, on a server platform that was given no
 * request, which is what a prerender, a fallback and an application shell all are. Each case here
 * bootstraps a root component at an address the way such a render does and reads what the
 * bootstrap threw.
 */

const PATH_PREFIX = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'en-Arab-XB': 'en-arab-xb' },
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/',
});

const NEUTRAL = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG', 'en-Arab-XB'],
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/',
});

const ORIGIN = 'https://site.example';
const ARABIC_ORIGIN = 'https://ar.site.example';

const HOST = createHostLocalePolicy({
  defaultLocale: 'en-US',
  origins: {
    'en-US': ORIGIN,
    'ar-EG': ARABIC_ORIGIN,
    'en-Arab-XB': 'https://xb.site.example',
  },
});

/**
 * The application's own projection with one route declared private, which none of its routes is.
 *
 * The generated half keeps its identity, because a projection is accepted only for the catalogs it
 * was generated with.
 */
const PRIVATE_SECOND = defineRouteProjection({
  ...appRouteProjection,
  generated: Object.freeze({
    ...routeProjection,
    routes: Object.freeze(
      routeProjection.routes.map((route) =>
        route.id === 'route:second'
          ? Object.freeze({ ...route, indexing: 'private' as const })
          : route,
      ),
    ),
  }),
} as unknown as typeof appRouteProjection);

/** The same, for the one route here whose path is spelled apart in Arabic. */
const PRIVATE_ITEM = defineRouteProjection({
  ...appRouteProjection,
  generated: Object.freeze({
    ...routeProjection,
    routes: Object.freeze(
      routeProjection.routes.map((route) =>
        route.id === 'item'
          ? Object.freeze({ ...route, indexing: 'private' as const })
          : route,
      ),
    ),
  }),
} as unknown as typeof appRouteProjection);

@Component({
  selector: 'render-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

interface Render {
  readonly policy?: LocaleUrlPolicy;
  /** The origin the build answers at, which under a host policy is its locale. */
  readonly origin?: string;
  readonly platform?: 'server' | 'browser';
  /** The request the render answers, where it answers one. */
  readonly request?: Request;
  readonly projection?: typeof appRouteProjection;
  readonly providers?: readonly unknown[];
}

/** Bootstraps the root component at an address, and hands back what the bootstrap threw. */
async function bootstrappedAt(
  path: string,
  render: Render = {},
): Promise<unknown> {
  const origin = render.origin ?? ORIGIN;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: `${origin}${path}` },
      },
      { provide: PLATFORM_ID, useValue: render.platform ?? 'server' },
      ...(render.request === undefined
        ? []
        : [{ provide: REQUEST, useValue: render.request }]),
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
        withRouting({
          policy: render.policy ?? PATH_PREFIX,
          projection: render.projection ?? appRouteProjection,
        }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
      ...((render.providers ?? []) as never[]),
    ],
  });
  await TestBed.inject(Localization).initialize();
  // A root component bootstraps once the application's initializers have finished.
  await TestBed.inject(ApplicationInitStatus).donePromise;

  const application = TestBed.inject(ApplicationRef);
  const host = document.createElement('render-root');
  document.body.append(host);
  let thrown: unknown;
  try {
    application.bootstrap(RootHost, host);
  } catch (error: unknown) {
    thrown = error;
  }
  // The Router starts its first navigation from the same bootstrap, and it is left to finish so
  // the next case starts from nothing in flight.
  await application.whenStable();
  host.remove();
  TestBed.resetTestingModule();
  return thrown;
}

function expectRefusedAsSharedFile(error: unknown): void {
  expect(error).toBeInstanceOf(LocalizationError);
  expect((error as LocalizationError).diagnostic).toMatchObject({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
  });
}

describe('a page rendered ahead of a request', () => {
  it('is written for a route every visitor may be given', async () => {
    expect(await bootstrappedAt('/en-us/second')).toBeUndefined();
  });

  it('is refused for a route kept per visitor', async () => {
    expectRefusedAsSharedFile(await bootstrappedAt('/en-us/lazy'));
  });

  it('is refused for a private route', async () => {
    expectRefusedAsSharedFile(
      await bootstrappedAt('/en-us/second', { projection: PRIVATE_SECOND }),
    );
  });

  it('is refused at an address more than one locale spells', async () => {
    expectRefusedAsSharedFile(
      await bootstrappedAt('/second', { policy: NEUTRAL }),
    );
  });

  it('is written at an address one locale alone spells', async () => {
    // The control for the case above: under the same policy, the Arabic spelling of a route names
    // its locale, so the file is the same for every visitor.
    expect(
      await bootstrappedAt(`/${encodeURIComponent('عناصر')}/42`, {
        policy: NEUTRAL,
      }),
    ).toBeUndefined();
  });

  it('is refused for a private route at an address read at the origin the build answers at', async () => {
    // The Arabic spelling of the route matches nothing at the default locale's origin, so the
    // route's class is found only by reading the address where this build serves it.
    expectRefusedAsSharedFile(
      await bootstrappedAt(`/${encodeURIComponent('عناصر')}/42`, {
        policy: HOST,
        origin: ARABIC_ORIGIN,
        projection: PRIVATE_ITEM,
      }),
    );
  });

  it('is left to the application where the address reached no route', async () => {
    expect(await bootstrappedAt('/en-us/missing')).toBeUndefined();
  });
});

describe('a page kept per visitor that is not rendered ahead of a request', () => {
  it('is rendered on the server for the request it answers', async () => {
    expect(
      await bootstrappedAt('/en-us/lazy', {
        request: new Request(`${ORIGIN}/en-us/lazy`),
      }),
    ).toBeUndefined();
  });

  it('is rendered in the browser', async () => {
    expect(
      await bootstrappedAt('/en-us/lazy', { platform: 'browser' }),
    ).toBeUndefined();
  });

  it('is not judged under a location strategy of the application’s own', async () => {
    // No localized address resolves under it, which the startup diagnostics report, so there is no
    // route here to read a class from.
    expect(
      await bootstrappedAt('/en-us/lazy', {
        providers: [
          { provide: LocationStrategy, useClass: PathLocationStrategy },
        ],
      }),
    ).toBeUndefined();
  });
});
