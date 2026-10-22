import { afterEach, describe, expect, it, vi } from 'vitest';

import { DOCUMENT, PlatformLocation } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  Router,
  RouterOutlet,
  type Routes,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import {
  Localization,
  createHostLocalePolicy,
  createPathPrefixLocalePolicy,
  withFormattingContext,
  withRouting,
  type LocaleUrlPolicy,
  type RouteParameterCodec,
  type RouteParameterContext,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { appRouteProjection, dossierSlugCodec } from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

/**
 * A locale change on a page whose parameter has no spelling in the locale it is changing to.
 *
 * Section 7 of `specs/07-routing-rendering-and-seo.spec.md` ends such a change as failed and
 * changes nothing, whether the target locale is served in this document or by another origin. The
 * dossier here is a record that exists in English only: its codec writes no Arabic spelling, and
 * the page declares none. Under a host policy the Arabic origin has no address for the page, and
 * the change does not send the document to that origin's root, which is another page.
 */

const PATH_PREFIX = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'en-Arab-XB': 'en-arab-xb' },
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/',
});

const HOST = createHostLocalePolicy({
  defaultLocale: 'en-US',
  origins: {
    'en-US': 'https://site.example',
    'ar-EG': 'https://ar.site.example',
    'en-Arab-XB': 'https://xb.site.example',
  },
});

const ORIGIN = 'https://site.example';
const ARRIVAL = '/en-us/dossiers/dossier';
/** The same page under a policy that states the locale in the origin. */
const HOST_ARRIVAL = '/dossiers/dossier';

/** The dossier's codec, writing no spelling for Arabic. */
const WITHOUT_ARABIC: RouteParameterCodec<string> = Object.freeze({
  parse: (slug: string) => dossierSlugCodec.parse(slug),
  serialize: (slug: string, context?: RouteParameterContext) =>
    context?.locale === 'ar-EG' ? undefined : slug,
});

const PROJECTION: typeof appRouteProjection = Object.freeze({
  ...appRouteProjection,
  parameters: Object.freeze({
    ...appRouteProjection.parameters,
    dossier: Object.freeze({ slug: WITHOUT_ARABIC }),
  }),
});

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

@Component({ standalone: true, template: '' })
class Blank {}

const ROUTES: Routes = [
  {
    path: 'dossiers/:slug',
    component: Blank,
    data: { equatorRouteId: 'dossier', equatorIndexing: 'indexable' },
  },
  { path: '**', component: Blank },
];

/**
 * A document whose `location.assign` is recorded and moves nothing.
 *
 * jsdom's own cannot be spied on, and a host policy's locale change calls it.
 */
function documentRecording(assigned: string[]): Document {
  const over =
    <Target extends object>(
      target: Target,
      overrides: Record<string, unknown>,
    ) =>
    (_target: Target, property: string | symbol): unknown => {
      if (typeof property === 'string' && property in overrides)
        return overrides[property];
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...values: unknown[]) => unknown).bind(target)
        : value;
    };
  const view = document.defaultView as Window;
  const location = new Proxy({} as Location, {
    get: over(view.location, {
      assign: (url: string) => {
        assigned.push(url);
      },
    }),
  });
  const proxiedWindow = new Proxy(view, { get: over(view, { location }) });
  return new Proxy(document, {
    get: over(document, { defaultView: proxiedWindow }),
    set: (target, key, value) => Reflect.set(target, key, value),
  });
}

interface Arrived {
  readonly localization: Localization;
  readonly platform: PlatformLocation;
  /** What `location.assign` was called with, oldest first. */
  readonly assigned: readonly string[];
  readonly settle: () => Promise<void>;
}

async function dossierUnder(policy: LocaleUrlPolicy): Promise<Arrived> {
  const arrival = policy === HOST ? HOST_ARRIVAL : ARRIVAL;
  const assigned: string[] = [];
  // The reduced table leaves projection routes unrendered, which the router reports.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  history.replaceState(null, '', arrival);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: `${ORIGIN}${arrival}` },
      },
      { provide: DOCUMENT, useFactory: () => documentRecording(assigned) },
      provideLocalizedRouter(ROUTES, { origin: ORIGIN }),
      provideLocalizationTesting(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        withRouting({ policy, projection: PROJECTION }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  const localization = TestBed.inject(Localization);
  await localization.initialize();
  const router = TestBed.inject(Router);
  TestBed.createComponent(RootHost);
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
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 3; round += 1) {
      TestBed.tick();
      for (let hop = 0; hop < 3; hop += 1) await Promise.resolve();
    }
    TestBed.tick();
  };
  await settle();
  return {
    localization,
    platform: TestBed.inject(PlatformLocation),
    assigned,
    settle,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
  history.replaceState(null, '', '/');
});

describe('a locale change to another origin, on a page with no spelling in that locale', () => {
  it('ends as failed with the refusal the address was built with, and sends the document nowhere', async () => {
    const { assigned, localization, platform, settle } =
      await dossierUnder(HOST);
    const before = localization.snapshot();

    const result = await localization.changeLocale('ar-EG');
    await settle();

    expect(result).toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: {
        code: 'route-unavailable',
        outcome: 'localized-representation-unavailable',
      },
    });
    expect(assigned).toEqual([]);
    expect(localization.lastResult()).toBe(result);
    expect(localization.snapshot()).toBe(before);
    expect(platform.pathname).toBe(HOST_ARRIVAL);
  });

  it('still moves the document to an origin the page does have an address at', async () => {
    const { assigned, localization, settle } = await dossierUnder(HOST);

    const result = await localization.changeLocale('en-Arab-XB');
    await settle();

    expect(result).toMatchObject({
      status: 'redirected',
      targetLocale: 'en-Arab-XB',
      address: 'https://xb.site.example/dossiers/dossier',
    });
    expect(assigned).toEqual(['https://xb.site.example/dossiers/dossier']);
  });
});

describe('a locale change in place, on a page with no spelling in that locale', () => {
  it('ends as failed with the same refusal, and leaves the locale and the address as they were', async () => {
    const { localization, platform, settle } = await dossierUnder(PATH_PREFIX);
    const before = localization.snapshot();

    const result = await localization.changeLocale('ar-EG');
    await settle();

    expect(result).toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: {
        code: 'route-unavailable',
        outcome: 'localized-representation-unavailable',
      },
    });
    expect(localization.snapshot()).toBe(before);
    expect(platform.pathname).toBe(ARRIVAL);
    expect(document.documentElement.lang).toBe('en-US');
  });
});
