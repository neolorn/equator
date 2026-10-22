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
  type Event as RouterEvent,
  type Routes,
} from '@angular/router';
import { ReplaySubject, filter, firstValueFrom } from 'rxjs';
import {
  Localization,
  createPathPrefixLocalePolicy,
  withFormattingContext,
  withRouting,
  type RouteParameterCodec,
  type RouteParameterContext,
} from '@neolorn/equator';
import {
  RouteLocalization,
  provideLocalizedRouter,
} from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { appRouteProjection, dossierSlugCodec } from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

/**
 * A locale change made in place while a navigation to another page is still in flight.
 *
 * Section 7 of `specs/07-routing-rendering-and-seo.spec.md` answers such a change for the page on
 * screen, because the navigation may yet be cancelled and the page it left would then stand in a
 * locale it has no address in. The navigation here is held at a guard, which is where a slow
 * permission check or a confirmation prompt holds one, and the dossier on screen is a record that
 * exists in English only.
 *
 * A navigation commits its locale before its destination is on screen, so there is a second
 * stretch: after that commit and before the arrival, which a resolver of the application's own
 * holds open here. A change made in place then is answered for the destination as well, and where
 * it commits, the page that arrives is written in the locale that is committed. Where the
 * navigation is cancelled instead, the change still committed and told its caller so, and the page
 * the navigation left is put back in that locale. A navigation that lands and whose document
 * cannot be written ends the same way, and the application's `document` callback throwing for the
 * destination is what makes one here.
 */

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'en-Arab-XB': 'en-arab-xb' },
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/',
});

const ORIGIN = 'https://site.example';
const ARRIVAL = '/en-us/dossiers/dossier';
const DESTINATION = '/en-us/dossiers/other';

/** The dossiers that have no Arabic spelling. Absent, none has one. */
let withoutArabic: ((slug: string) => boolean) | undefined;

/** The dossier's codec, writing no spelling for Arabic for the dossiers above. */
const WITHOUT_ARABIC: RouteParameterCodec<string> = Object.freeze({
  parse: (slug: string) => dossierSlugCodec.parse(slug),
  serialize: (slug: string, context?: RouteParameterContext) =>
    context?.locale === 'ar-EG' && (withoutArabic?.(slug) ?? true)
      ? undefined
      : slug,
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

/** What the guard waits on. Absent, the guard passes at once. */
let held: Promise<boolean> | undefined;
/** Called when a navigation reaches the guard while it is held. */
let reached: (() => void) | undefined;
/**
 * What the application's own resolver waits on. Absent, it answers at once. Completed without an
 * answer, it cancels the navigation, as a resolver that finds nothing to show does.
 */
let loading: ReplaySubject<true> | undefined;
/** Whether the application's `document` callback throws for the destination. */
let unwritable = false;

const ROUTES: Routes = [
  {
    path: 'dossiers/:slug',
    component: Blank,
    data: { equatorRouteId: 'dossier', equatorIndexing: 'indexable' },
    canActivate: [
      () => {
        if (held === undefined) return true;
        reached?.();
        return held;
      },
    ],
    resolve: { loaded: () => loading ?? true },
  },
  { path: '**', component: Blank },
];

function landing(router: Router): Promise<RouterEvent> {
  return firstValueFrom(
    router.events.pipe(
      filter(
        (event) =>
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError,
      ),
    ),
  );
}

interface InFlight {
  readonly localization: Localization;
  readonly platform: PlatformLocation;
  /** How the held navigation ends, once the guard has answered. */
  readonly landed: Promise<RouterEvent>;
  /** Answer the guard the navigation is held at. */
  readonly answer: (pass: boolean) => void;
  readonly settle: () => Promise<void>;
}

/** The dossier on screen in English, and a navigation to another dossier held at its guard. */
async function navigationHeld(): Promise<InFlight> {
  // The reduced table leaves projection routes unrendered, which the router reports.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  history.replaceState(null, '', ARRIVAL);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: `${ORIGIN}${ARRIVAL}` },
      },
      provideLocalizedRouter(ROUTES, {
        origin: ORIGIN,
        document: (context) => {
          if (
            unwritable &&
            context.resolution.canonicalPath.endsWith('/dossiers/other')
          ) {
            throw new Error('The destination has no document to write.');
          }
          return {};
        },
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
        withRouting({ policy: POLICY, projection: PROJECTION }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  const localization = TestBed.inject(Localization);
  await localization.initialize();
  const router = TestBed.inject(Router);
  TestBed.createComponent(RootHost);
  const arrived = landing(router);
  router.initialNavigation();
  expect(await arrived).toBeInstanceOf(NavigationEnd);
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 3; round += 1) {
      TestBed.tick();
      for (let hop = 0; hop < 3; hop += 1) await Promise.resolve();
    }
    TestBed.tick();
  };
  await settle();

  let answer: (pass: boolean) => void = () => undefined;
  held = new Promise<boolean>((resolve) => {
    answer = resolve;
  });
  const atGuard = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const landed = landing(router);
  void router.navigateByUrl(DESTINATION);
  await atGuard;
  expect(router.getCurrentNavigation()).not.toBeNull();
  return {
    localization,
    platform: TestBed.inject(PlatformLocation),
    landed,
    answer,
    settle,
  };
}

interface Committed {
  readonly localization: Localization;
  readonly platform: PlatformLocation;
  /** How the navigation ends, once the resolver has answered. */
  readonly landed: Promise<RouterEvent>;
  /** Let the application's resolver answer. */
  readonly load: () => void;
  /** End the application's resolver without an answer, which cancels the navigation. */
  readonly drop: () => void;
  readonly settle: () => Promise<void>;
}

/**
 * The dossier on screen in English, and a navigation to another dossier that has committed its
 * locale and is held at the application's own resolver.
 */
async function navigationCommitted(): Promise<Committed> {
  const { answer, landed, localization, platform, settle } =
    await navigationHeld();
  // Replayed, so an answer given before the Router asks is the answer it reads.
  const waited = new ReplaySubject<true>(1);
  loading = waited;
  const load = (): void => {
    waited.next(true);
    waited.complete();
  };
  const drop = (): void => waited.complete();
  answer(true);
  // The navigation's own commit is the one that carries the destination's record.
  for (let round = 0; round < 20; round += 1) {
    if (localization.snapshot()?.route?.canonicalPath === DESTINATION) break;
    await settle();
  }
  expect(localization.snapshot()?.route?.canonicalPath).toBe(DESTINATION);
  expect(TestBed.inject(Router).getCurrentNavigation()).not.toBeNull();
  expect(platform.pathname).toBe(ARRIVAL);
  return { localization, platform, landed, load, drop, settle };
}

afterEach(() => {
  held = undefined;
  reached = undefined;
  loading = undefined;
  unwritable = false;
  withoutArabic = undefined;
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
  history.replaceState(null, '', '/');
});

describe('a locale change in place while a navigation to another page is in flight', () => {
  it('ends as failed where the page on screen has no address in the target locale, and a cancelled navigation leaves that page as it was', async () => {
    const { answer, landed, localization, platform, settle } =
      await navigationHeld();
    const before = localization.snapshot();

    const result = await localization.changeLocale('ar-EG');

    expect(result).toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: {
        code: 'route-unavailable',
        outcome: 'localized-representation-unavailable',
      },
    });
    expect(localization.snapshot()).toBe(before);

    answer(false);
    expect(await landed).toBeInstanceOf(NavigationCancel);
    await settle();

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(platform.pathname).toBe(ARRIVAL);
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('leaves the navigation to finish at its own destination after the refusal', async () => {
    const { answer, landed, localization, platform, settle } =
      await navigationHeld();

    const result = await localization.changeLocale('ar-EG');
    expect(result.status).toBe('failed');

    answer(true);
    expect(await landed).toBeInstanceOf(NavigationEnd);
    await settle();

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(platform.pathname).toBe(DESTINATION);
  });

  it('commits where the page on screen does have an address in the target locale', async () => {
    const { answer, landed, localization, settle } = await navigationHeld();

    const result = await localization.changeLocale('en-Arab-XB');

    expect(result).toMatchObject({
      status: 'committed',
      targetLocale: 'en-Arab-XB',
    });
    expect(localization.snapshot()?.primaryLocale).toBe('en-Arab-XB');

    answer(false);
    await landed;
    await settle();
  });
});

describe('a locale change in place after a navigation has committed its locale and before it lands', () => {
  it('ends as failed where the destination has no address in the target locale, and the navigation lands as it was going to', async () => {
    const { landed, load, localization, platform, settle } =
      await navigationCommitted();
    const before = localization.snapshot();

    const result = await localization.changeLocale('ar-EG');

    expect(result).toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: {
        code: 'route-unavailable',
        outcome: 'localized-representation-unavailable',
      },
    });
    expect(localization.snapshot()).toBe(before);

    load();
    expect(await landed).toBeInstanceOf(NavigationEnd);
    await settle();

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(platform.pathname).toBe(DESTINATION);
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('ends as failed where the page on screen has an address in the target locale and the destination has none', async () => {
    // Only the destination is without an Arabic spelling, so the refusal can come from nothing
    // but the question asked about the destination.
    withoutArabic = (slug) => slug === 'other';
    const { landed, load, localization, platform, settle } =
      await navigationCommitted();
    const before = localization.snapshot();

    const result = await localization.changeLocale('ar-EG');

    expect(result).toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: {
        code: 'route-unavailable',
        outcome: 'localized-representation-unavailable',
      },
    });
    expect(localization.snapshot()).toBe(before);

    load();
    expect(await landed).toBeInstanceOf(NavigationEnd);
    await settle();

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(platform.pathname).toBe(DESTINATION);
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('commits where both pages have an address in the target locale, and the page that lands is written in it', async () => {
    const { landed, load, localization, platform, settle } =
      await navigationCommitted();

    const result = await localization.changeLocale('en-Arab-XB');

    expect(result).toMatchObject({
      status: 'committed',
      targetLocale: 'en-Arab-XB',
    });

    load();
    expect(await landed).toBeInstanceOf(NavigationEnd);
    await settle();

    const snapshot = localization.snapshot();
    expect(snapshot?.primaryLocale).toBe('en-Arab-XB');
    expect(snapshot?.route?.canonicalPath).toBe('/en-arab-xb/dossiers/other');
    expect(platform.pathname).toBe('/en-arab-xb/dossiers/other');
    expect(document.documentElement.lang).toBe('en-Arab-XB');
  });

  it('keeps the locale the change committed when the navigation is then cancelled, at the page it left', async () => {
    const { drop, landed, localization, platform, settle } =
      await navigationCommitted();

    const result = await localization.changeLocale('en-Arab-XB');

    expect(result).toMatchObject({
      status: 'committed',
      targetLocale: 'en-Arab-XB',
    });

    drop();
    expect(await landed).toBeInstanceOf(NavigationCancel);
    const left = '/en-arab-xb/dossiers/dossier';
    for (let round = 0; round < 20; round += 1) {
      if (localization.snapshot()?.route?.canonicalPath === left) break;
      await settle();
    }

    // What the caller was told and what the state is are one locale.
    const snapshot = localization.snapshot();
    expect(snapshot?.primaryLocale).toBe('en-Arab-XB');
    expect(snapshot?.route?.canonicalPath).toBe(left);
    expect(platform.pathname).toBe(left);
    expect(document.documentElement.lang).toBe('en-Arab-XB');
  });

  it('keeps the locale the change committed when the navigation lands and its document cannot be written, at the page it left', async () => {
    const { landed, load, localization, platform, settle } =
      await navigationCommitted();

    const result = await localization.changeLocale('en-Arab-XB');

    expect(result).toMatchObject({
      status: 'committed',
      targetLocale: 'en-Arab-XB',
    });

    unwritable = true;
    load();
    expect(await landed).toBeInstanceOf(NavigationEnd);
    const left = '/en-arab-xb/dossiers/dossier';
    for (let round = 0; round < 20; round += 1) {
      if (
        localization.snapshot()?.route?.canonicalPath === left &&
        platform.pathname === left
      ) {
        break;
      }
      await settle();
    }

    // The navigation reports that its document failed, and the change made in place stands.
    expect(await TestBed.inject(RouteLocalization).settled()).toMatchObject({
      status: 'failed',
      targetLocale: 'en-US',
    });
    const snapshot = localization.snapshot();
    expect(snapshot?.primaryLocale).toBe('en-Arab-XB');
    expect(snapshot?.route?.canonicalPath).toBe(left);
    expect(platform.pathname).toBe(left);
    expect(document.documentElement.lang).toBe('en-Arab-XB');
  });

  it('puts back the snapshot from before the navigation when it lands and its document cannot be written, and no change was made in place', async () => {
    const { landed, load, localization, platform, settle } =
      await navigationCommitted();

    unwritable = true;
    load();
    expect(await landed).toBeInstanceOf(NavigationEnd);
    for (let round = 0; round < 20; round += 1) {
      if (
        localization.snapshot()?.route?.canonicalPath === ARRIVAL &&
        platform.pathname === ARRIVAL
      ) {
        break;
      }
      await settle();
    }

    const snapshot = localization.snapshot();
    expect(snapshot?.primaryLocale).toBe('en-US');
    expect(snapshot?.route?.canonicalPath).toBe(ARRIVAL);
    expect(platform.pathname).toBe(ARRIVAL);
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('puts back the snapshot from before the navigation when it is cancelled and no change was made in place', async () => {
    const { drop, landed, localization, platform, settle } =
      await navigationCommitted();

    drop();
    expect(await landed).toBeInstanceOf(NavigationCancel);
    for (let round = 0; round < 20; round += 1) {
      if (localization.snapshot()?.route?.canonicalPath === ARRIVAL) break;
      await settle();
    }

    const snapshot = localization.snapshot();
    expect(snapshot?.primaryLocale).toBe('en-US');
    expect(snapshot?.route?.canonicalPath).toBe(ARRIVAL);
    expect(platform.pathname).toBe(ARRIVAL);
    expect(document.documentElement.lang).toBe('en-US');
  });
});
