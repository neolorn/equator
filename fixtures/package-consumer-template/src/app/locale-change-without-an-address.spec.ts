import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlatformLocation } from '@angular/common';
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
  type LocaleChangeMode,
  type LocaleUrlPolicy,
} from '@neolorn/equator';
import {
  LocalizedRouteParameters,
  RouteLocalization,
  provideLocalizedRouter,
} from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { appRouteProjection } from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

/**
 * A locale change on a page that has no address in the locale it is changing to.
 *
 * Section 7 of `specs/07-routing-rendering-and-seo.spec.md` has the address bar follow a locale
 * commit, so a commit the address cannot follow would leave a page in one language at the address
 * of another. The page here is a dossier whose slug is declared, and the Arabic spelling it
 * declares is one the route's codec refuses, so the Arabic address cannot be built. The change is
 * refused before it commits, and the locale, the address, the document and the route record all
 * stay as they were. Under a host policy the same change would move the document to another
 * origin, and it is refused the same way before anything moves.
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

/** Refused by the dossier's codec, which reads no slug that starts with a dot. */
const UNREADABLE = '.unreadable';
const READABLE = 'ملف';

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

interface Arrived {
  readonly localization: Localization;
  readonly platform: PlatformLocation;
  readonly router: Router;
  readonly routeLocalization: RouteLocalization;
  readonly settle: () => Promise<void>;
}

async function dossierDeclaring(
  arabicSlug: string,
  mode: LocaleChangeMode = 'coordinated',
  policy: LocaleUrlPolicy = PATH_PREFIX,
): Promise<Arrived> {
  const arrival = policy === HOST ? HOST_ARRIVAL : ARRIVAL;
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
      provideLocalizedRouter(ROUTES, { origin: ORIGIN, mode }),
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
  // Declared once the page is on screen, as a page that loads its record declares it.
  TestBed.inject(LocalizedRouteParameters).declare({
    slug: { 'ar-EG': arabicSlug },
  });
  await settle();
  return {
    localization,
    platform: TestBed.inject(PlatformLocation),
    router,
    routeLocalization: TestBed.inject(RouteLocalization),
    settle,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
  history.replaceState(null, '', '/');
});

describe('a locale change on a page whose address in that locale cannot be built', () => {
  it('ends as failed with the refusal the address was built with', async () => {
    const { localization, settle } = await dossierDeclaring(UNREADABLE);

    const result = await localization.changeLocale('ar-EG');
    await settle();

    expect(result).toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: {
        code: 'invalid-configuration',
        outcome: 'operational-failure',
      },
    });
    expect(localization.lastResult()).toBe(result);
  });

  it('leaves the locale, the address, the document and the route record as they were', async () => {
    const { localization, platform, router, routeLocalization, settle } =
      await dossierDeclaring(UNREADABLE);
    const before = localization.snapshot();
    expect(before?.primaryLocale).toBe('en-US');
    expect(platform.pathname).toBe(ARRIVAL);

    await localization.changeLocale('ar-EG');
    await settle();

    expect(localization.snapshot()).toBe(before);
    expect(platform.pathname).toBe(ARRIVAL);
    expect(router.url).toBe('/dossiers/dossier');
    expect(document.documentElement.lang).toBe('en-US');
    expect(document.documentElement.dir).toBe('ltr');
    expect(routeLocalization.context()?.resolution.locale).toBe('en-US');
  });

  it('is refused in progressive mode as it is in coordinated mode', async () => {
    const { localization, platform, settle } = await dossierDeclaring(
      UNREADABLE,
      'progressive',
    );

    const result = await localization.changeLocale('ar-EG', {
      mode: 'progressive',
    });
    await settle();

    expect(result.status).toBe('failed');
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(platform.pathname).toBe(ARRIVAL);
  });

  it('still changes to a locale the page does have an address in', async () => {
    const { localization, platform, settle } =
      await dossierDeclaring(UNREADABLE);

    // The pseudo-locale has no declared spelling, so the codec writes the slug as it stands.
    const result = await localization.changeLocale('en-Arab-XB');
    await settle();

    expect(result.status).toBe('committed');
    expect(platform.pathname).toBe('/en-arab-xb/dossiers/dossier');
  });
});

describe('a locale change to another origin, on a page whose address there cannot be built', () => {
  it('ends as failed with the refusal the address was built with, and moves nothing', async () => {
    const { localization, platform, settle } = await dossierDeclaring(
      UNREADABLE,
      'coordinated',
      HOST,
    );
    const before = localization.snapshot();

    const result = await localization.changeLocale('ar-EG');
    await settle();

    expect(result).toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: {
        code: 'invalid-configuration',
        outcome: 'operational-failure',
      },
    });
    expect(localization.lastResult()).toBe(result);
    expect(localization.snapshot()).toBe(before);
    expect(platform.pathname).toBe(HOST_ARRIVAL);
  });
});

describe('a locale change on a page whose declared spelling the codec reads', () => {
  it('commits and moves the address to that spelling', async () => {
    const { localization, platform, routeLocalization, settle } =
      await dossierDeclaring(READABLE);

    const result = await localization.changeLocale('ar-EG');
    await settle();

    expect(result.status).toBe('committed');
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    expect(decodeURIComponent(platform.pathname)).toBe(
      `/ar-eg/dossiers/${READABLE}`,
    );
    expect(document.documentElement.lang).toBe('ar-EG');
    expect(routeLocalization.context()?.resolution.locale).toBe('ar-EG');
  });
});
