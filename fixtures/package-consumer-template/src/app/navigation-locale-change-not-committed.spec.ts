import { afterEach, describe, expect, it, vi } from 'vitest';

import { DOCUMENT } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  Router,
  RouterOutlet,
  provideRouter,
  type Event as RouterEvent,
  type Routes,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import {
  Localization,
  LocalizationError,
  createHostLocalePolicy,
  createPathPrefixLocalePolicy,
  withFormattingContext,
  withRouting,
  type LocaleUrlPolicy,
  type LocalizationParticipantReport,
} from '@neolorn/equator';
import {
  RouteLocalization,
  RouteLocalizationError,
  type RouteLocalizationOptions,
} from '@neolorn/equator/router';
import {
  ControllableLocalizationParticipant,
  provideLocalizationTesting,
} from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { appRouteProjection } from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

/**
 * A navigation whose locale change does not commit, met by an application that calls
 * `RouteLocalization.prepare` from a resolver of its own.
 *
 * `prepare` commits the locale an address is in before the destination is built. Where that change
 * ends any other way, the resolver fails with a `RouteLocalizationError`, so the Router abandons
 * the navigation with the address untouched, and the error carries the diagnostic the change ended
 * with. A change that ends as redirected carries none, and the error then carries one of the
 * navigation's own: under a host policy that is an absolute address at another of the policy's
 * origins, which only an application's own call can hand in.
 *
 * `RouteLocalization` is constructed here the way an application that does not use
 * `provideLocalizedRouter` constructs it, which is also the one way it is handed a host policy with
 * no origin, with an origin that is not one, or with one the policy does not name. Each is refused
 * where the adapter is constructed.
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

const READY: LocalizationParticipantReport = Object.freeze({
  status: 'ready',
  representation: Object.freeze({ kind: 'language-independent' }),
});

const UNAVAILABLE: LocalizationParticipantReport = Object.freeze({
  status: 'unavailable',
  outcome: 'localized-representation-unavailable',
  identity: Object.freeze({ resourceId: 'record:1' }),
});

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

@Component({ standalone: true, template: '' })
class Blank {}

/** The address the application's resolver hands to `prepare` for the page it is loading. */
let prepared = '/en-us/second';
/** Whether the application's `document` callback throws. */
let unwritable = false;
/** Whether the root refuses to be entered, by a guard that throws. */
let closed = false;

/** The dynamic half of a page's document, from an application whose callback can fail. */
const DOCUMENT_CALLBACK: NonNullable<
  RouteLocalizationOptions['document']
> = () => {
  if (unwritable) throw new Error('The page has no document to write.');
  return {};
};

const ROUTES: Routes = [
  {
    path: '',
    component: Blank,
    canActivate: [
      () => {
        if (closed) throw new Error('The root is closed.');
        return true;
      },
    ],
  },
  {
    path: 'second',
    component: Blank,
    // Asked again on a reload of the same address, as a page that refetches its record is.
    runGuardsAndResolvers: 'always',
    resolve: {
      localized: () => inject(RouteLocalization).prepare(prepared),
    },
  },
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

interface Configured {
  readonly router: Router;
  readonly localization: Localization;
  readonly routeLocalization: RouteLocalization;
  /** What `location.assign` was called with, oldest first. */
  readonly assigned: readonly string[];
  /** Starts the runtime and runs the Router's first navigation, which lands on the root. */
  readonly arrive: () => Promise<void>;
  /** The event the next navigation ends on. */
  readonly ended: () => Promise<RouterEvent>;
}

function configured(
  policy: LocaleUrlPolicy,
  options: RouteLocalizationOptions,
): Configured {
  const assigned: string[] = [];
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    // A failed navigation also reaches the application's error handler, which TestBed rethrows;
    // these cases read the navigation's own ending instead.
    rethrowApplicationErrors: false,
    providers: [
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: `${ORIGIN}/` },
      },
      { provide: DOCUMENT, useFactory: () => documentRecording(assigned) },
      provideRouter(ROUTES),
      {
        provide: RouteLocalization,
        useFactory: () => new RouteLocalization(options),
      },
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
  return {
    router,
    localization,
    routeLocalization: TestBed.inject(RouteLocalization),
    assigned,
    ended,
    arrive: async () => {
      await localization.initialize();
      TestBed.createComponent(RootHost);
      const end = ended();
      router.initialNavigation();
      expect(await end).toBeInstanceOf(NavigationEnd);
    },
  };
}

/** The resolution a failed navigation's `RouteLocalizationError` carries. */
function refusal(event: RouterEvent): RouteLocalizationError['resolution'] {
  expect(event).toBeInstanceOf(NavigationError);
  const { error } = event as NavigationError;
  expect(error).toBeInstanceOf(RouteLocalizationError);
  return (error as RouteLocalizationError).resolution;
}

afterEach(() => {
  prepared = '/en-us/second';
  unwritable = false;
  closed = false;
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
  history.replaceState(null, '', '/');
});

describe('a navigation whose locale change fails', () => {
  it('fails the navigation with the diagnostic the change failed with, and leaves the page it was on', async () => {
    const { arrive, ended, localization, routeLocalization, router } =
      configured(PATH_PREFIX, { origin: ORIGIN });
    let report: LocalizationParticipantReport = READY;
    localization.registerParticipant(
      { id: 'record', prepare: () => report },
      { coordination: 'required' },
    );
    await arrive();
    const before = localization.snapshot();

    // The record the page shows has no Arabic representation, and the page is asked for in Arabic.
    report = UNAVAILABLE;
    prepared = '/ar-eg/second';
    const end = ended();
    void router.navigateByUrl('/second').catch(() => undefined);

    expect(refusal(await end)).toMatchObject({
      status: 'malformed',
      httpStatus: 400,
      presentationLocale: 'ar-EG',
      diagnostic: {
        code: 'participant-unavailable',
        outcome: 'localized-representation-unavailable',
      },
    });
    expect(await routeLocalization.settled()).toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: { code: 'participant-unavailable' },
    });
    expect(localization.snapshot()).toBe(before);
    expect(router.url).toBe('/');
  });
});

describe('a navigation that lands and whose document cannot be written', () => {
  it('reports that the page it left was put back where the Router is still at that page', async () => {
    const { arrive, ended, localization, routeLocalization, router } =
      configured(PATH_PREFIX, { origin: ORIGIN, document: DOCUMENT_CALLBACK });
    await arrive();
    expect(await router.navigateByUrl('/second')).toBe(true);
    const before = localization.snapshot();

    // The same address again, so the address to put back is the one the Router already holds, and
    // a navigation to it would be skipped and answer that it did not happen.
    unwritable = true;
    const end = ended();
    void router.navigateByUrl('/second', { onSameUrlNavigation: 'reload' });

    expect(await end).toBeInstanceOf(NavigationEnd);
    expect(await routeLocalization.settled()).toMatchObject({
      status: 'failed',
      targetLocale: 'en-US',
      diagnostic: {
        code: 'effect-failed',
        message:
          'Localized route document effects failed and the prior representation was restored.',
      },
    });
    expect(router.url).toBe('/second');
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(localization.snapshot()?.route).toEqual(before?.route);
  });

  it('reports that the page it left was put back where the Router returns to it', async () => {
    const { arrive, ended, routeLocalization, router } = configured(
      PATH_PREFIX,
      { origin: ORIGIN, document: DOCUMENT_CALLBACK },
    );
    await arrive();

    unwritable = true;
    const end = ended();
    void router.navigateByUrl('/second');

    expect(await end).toBeInstanceOf(NavigationEnd);
    expect(await routeLocalization.settled()).toMatchObject({
      status: 'failed',
      diagnostic: {
        code: 'effect-failed',
        message:
          'Localized route document effects failed and the prior representation was restored.',
      },
    });
    expect(router.url).toBe('/');
  });

  it('reports that the page it left was not fully put back where the Router cannot return to it', async () => {
    const { arrive, ended, routeLocalization, router } = configured(
      PATH_PREFIX,
      { origin: ORIGIN, document: DOCUMENT_CALLBACK },
    );
    await arrive();

    // The way back is refused by a guard that throws, which rejects the navigation that would
    // have put the address back.
    unwritable = true;
    closed = true;
    const end = ended();
    void router.navigateByUrl('/second');

    expect(await end).toBeInstanceOf(NavigationEnd);
    expect(await routeLocalization.settled()).toMatchObject({
      status: 'failed',
      targetLocale: 'en-US',
      diagnostic: {
        code: 'effect-failed',
        message:
          'Localized route document effects failed and the prior representation could not be fully restored.',
      },
    });
    expect(router.url).toBe('/second');
  });
});

describe('a navigation whose locale change is overtaken', () => {
  it('fails the navigation as superseded, and the newer change commits', async () => {
    const { arrive, ended, localization, router } = configured(PATH_PREFIX, {
      origin: ORIGIN,
    });
    const participant = new ControllableLocalizationParticipant(
      'record',
      READY,
    );
    localization.registerParticipant(participant, { coordination: 'required' });
    await arrive();

    prepared = '/ar-eg/second';
    const held = participant.deferNext();
    const end = ended();
    void router.navigateByUrl('/second').catch(() => undefined);
    await held.started;
    const newer = localization.changeLocale('en-Arab-XB');
    held.complete(READY);

    expect(refusal(await end)).toMatchObject({
      status: 'malformed',
      presentationLocale: 'ar-EG',
      diagnostic: { code: 'superseded', outcome: 'operational-failure' },
    });
    expect((await newer).status).toBe('committed');
    expect(localization.snapshot()?.primaryLocale).toBe('en-Arab-XB');
    expect(router.url).toBe('/');
  });
});

describe('a navigation under a host policy, at the origin the build answers at', () => {
  it('lands in the locale that origin serves and sends the document nowhere', async () => {
    const { arrive, assigned, ended, localization, routeLocalization, router } =
      configured(HOST, { origin: ORIGIN });
    await arrive();

    prepared = '/second';
    const end = ended();
    void router.navigateByUrl('/second').catch(() => undefined);

    expect(await end).toBeInstanceOf(NavigationEnd);
    expect((await routeLocalization.settled()).status).not.toBe('redirected');
    expect(assigned).toEqual([]);
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(router.url).toBe('/second');
  });
});

describe('a navigation under a host policy, handed an address at another of its origins', () => {
  it('fails the navigation, reports the change as redirected, and sends the document to that origin', async () => {
    const { arrive, assigned, ended, localization, routeLocalization, router } =
      configured(HOST, { origin: ORIGIN });
    await arrive();
    const before = localization.snapshot();

    // An absolute address names its own origin, and that origin serves Arabic.
    prepared = 'https://ar.site.example/second';
    const end = ended();
    void router.navigateByUrl('/second').catch(() => undefined);

    // A redirect carries an address and no diagnostic, so the navigation fails with its own.
    expect(refusal(await end)).toMatchObject({
      status: 'malformed',
      httpStatus: 400,
      presentationLocale: 'ar-EG',
      diagnostic: {
        code: 'route-unavailable',
        outcome: 'operational-failure',
        message: 'The localized route transaction did not commit.',
      },
    });
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.startsWith('https://ar.site.example')).toBe(true);
    expect(await routeLocalization.settled()).toMatchObject({
      status: 'redirected',
      targetLocale: 'ar-EG',
      address: assigned[0],
    });
    expect(localization.snapshot()).toBe(before);
    expect(router.url).toBe('/');
  });
});

describe('a host policy and no origin', () => {
  it('refuses the adapter where it is constructed, as a configuration fault', () => {
    let thrown: unknown;
    try {
      configured(HOST, {});
      TestBed.inject(RouteLocalization);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LocalizationError);
    expect((thrown as LocalizationError).diagnostic).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
  });

  it('refuses an origin the policy does not name the same way', () => {
    let thrown: unknown;
    try {
      configured(HOST, { origin: 'https://other.example' });
      TestBed.inject(RouteLocalization);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LocalizationError);
    expect((thrown as LocalizationError).diagnostic).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
  });
});

describe('a host policy and an origin that is not one', () => {
  it('refuses the adapter where it is constructed, as a configuration fault', () => {
    let thrown: unknown;
    try {
      configured(HOST, { origin: 'not an origin' });
      TestBed.inject(RouteLocalization);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LocalizationError);
    expect((thrown as LocalizationError).diagnostic).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      reason: 'malformed-input',
    });
  });

  it('constructs the adapter with an origin written with a trailing slash, and is at home there', async () => {
    const { assigned, localization } = configured(HOST, {
      origin: `${ORIGIN}/`,
    });
    TestBed.inject(RouteLocalization);
    await localization.initialize();

    expect((await localization.changeLocale('en-US')).status).not.toBe(
      'redirected',
    );
    expect(assigned).toEqual([]);
    expect(await localization.changeLocale('ar-EG')).toMatchObject({
      status: 'redirected',
      address: 'https://ar.site.example',
    });
    expect(assigned).toEqual(['https://ar.site.example']);
  });
});
