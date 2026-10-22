import { describe, expect, it } from 'vitest';

import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import {
  LOCALE_URL_POLICY,
  Localization,
  LocalizationError,
  createHostLocalePolicy,
  createPathPrefixLocalePolicy,
  withFormattingContext,
  withRouting,
  type LocaleUrlPolicy,
} from '@neolorn/equator';
import {
  RouteLocalization,
  documentMessage,
  provideLocalizedRouter,
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
 * What `provideLocalizedRouter` and `RouteLocalization` refuse to start on, and how they say it.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md` asks for a refusal at configuration
 * rather than an application that half works. Each case here reads the error an application's
 * bootstrap is handed: a `LocalizationError` whose diagnostic carries `invalid-configuration`, so
 * a build script or an error boundary can tell a configuration mistake from a platform error
 * without reading a sentence.
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
  localeNeutralRoots: ['assets'],
  xDefaultUrl: 'https://site.example',
});

const ORIGIN = 'https://site.example';

const SETUP = {
  configuration,
  catalogSet,
  catalogLoaders,
  recoveryPayload,
  extensions: runtimeExtensions,
  routeProjection,
} as const;

@Component({ standalone: true, template: '' })
class Blank {}

/** What a call threw, or `undefined` where it returned. */
function thrownBy(act: () => unknown): unknown {
  try {
    act();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

function expectConfigurationRefusal(error: unknown): void {
  expect(error).toBeInstanceOf(LocalizationError);
  expect((error as LocalizationError).diagnostic).toMatchObject({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
  });
}

/** Starts the environment the way a bootstrap does, and hands back what that threw. */
async function started(
  router: ReturnType<typeof provideLocalizedRouter>,
  policy: LocaleUrlPolicy | undefined,
  extraProviders: unknown[] = [],
): Promise<unknown> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      router,
      provideLocalizationTesting(
        SETUP,
        ...(policy === undefined
          ? []
          : [withRouting({ policy, projection: appRouteProjection })]),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
      ...(extraProviders as never[]),
    ],
  });
  // Claiming anything from the environment injector runs its initializers, which is where the
  // router's refusals are made.
  const error = thrownBy(() => TestBed.inject(Localization));
  // A context that was built is started before it is torn down, as an application starts it.
  if (error === undefined) await TestBed.inject(Localization).initialize();
  TestBed.resetTestingModule();
  return error;
}

describe('a localized router that cannot be started', () => {
  it('starts on a served policy, which is what makes the refusals below mean something', async () => {
    expect(
      await started(
        provideLocalizedRouter(routes, { origin: ORIGIN }),
        PATH_PREFIX,
      ),
    ).toBeUndefined();
  });

  it('refuses routing declared with no locale URL policy', async () => {
    expectConfigurationRefusal(
      await started(
        provideLocalizedRouter(routes, { origin: ORIGIN }),
        undefined,
      ),
    );
  });

  it('refuses the Router integration built by hand with no locale URL policy', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideLocalizationTesting(
          SETUP,
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });

    expectConfigurationRefusal(
      thrownBy(() =>
        TestBed.runInInjectionContext(() => new RouteLocalization({})),
      ),
    );
    await TestBed.inject(Localization).initialize();
    TestBed.resetTestingModule();
  });

  it('refuses a mode that is neither coordinated nor progressive, where the router is provided', () => {
    for (const mode of ['eager', 'Coordinated', '', 0, null]) {
      expectConfigurationRefusal(
        thrownBy(() =>
          provideLocalizedRouter(routes, {
            origin: ORIGIN,
            mode: mode as never,
          }),
        ),
      );
    }
    expect(
      thrownBy(() =>
        provideLocalizedRouter(routes, { origin: ORIGIN, mode: 'progressive' }),
      ),
    ).toBeUndefined();
  });

  it('refuses the Router integration built by hand with such a mode', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideLocalizationTesting(
          SETUP,
          withRouting({ policy: PATH_PREFIX, projection: appRouteProjection }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });

    expectConfigurationRefusal(
      thrownBy(() =>
        TestBed.runInInjectionContext(
          () => new RouteLocalization({ mode: 'eager' as never }),
        ),
      ),
    );
    await TestBed.inject(Localization).initialize();
    TestBed.resetTestingModule();
  });

  it('refuses a host policy given an origin that is not a URL', async () => {
    expectConfigurationRefusal(
      await started(
        provideLocalizedRouter(routes, { origin: 'site.example' }),
        HOST,
      ),
    );
  });

  it('refuses a server render configured with no origin', async () => {
    expectConfigurationRefusal(
      await started(provideLocalizedRouter(routes, {}), PATH_PREFIX, [
        { provide: PLATFORM_ID, useValue: 'server' },
      ]),
    );
  });

  it('refuses a policy kind stated through the policy token that it does not serve', async () => {
    // The token is the public statement of the policy, so an application can provide it without
    // `withRouting()`, which is the one place a policy's kind is otherwise read before this.
    const unserved = {
      ...PATH_PREFIX,
      kind: 'locale-query',
    } as unknown as LocaleUrlPolicy;

    expectConfigurationRefusal(
      await started(
        provideLocalizedRouter(routes, { origin: ORIGIN }),
        PATH_PREFIX,
        [
          {
            provide: LOCALE_URL_POLICY,
            useValue: {
              policy: unserved,
              projection: appRouteProjection,
              configuration,
            },
          },
        ],
      ),
    );
  });

  it('refuses an authored route that nothing can render', async () => {
    // Angular checks this only in a development build, and after the localized table is built, so
    // the error an application reads is the one that names the localized table.
    const unrenderable: Routes = [
      { path: '', component: Blank },
      { path: 'second' },
    ];

    expectConfigurationRefusal(
      await started(
        provideLocalizedRouter(unrenderable, { origin: ORIGIN }),
        PATH_PREFIX,
      ),
    );
  });
});

describe('a document message bound by hand', () => {
  it('is accepted where every input the message takes is bound', () => {
    expect(
      thrownBy(() =>
        provideLocalizedRouter(routes, {
          origin: ORIGIN,
          documentMetadata: {
            'route:second': {
              title: { message: messages.welcome, inputs: { name: 'Equator' } },
              description: documentMessage(messages.welcome, {
                name: 'Equator',
              }),
            },
          },
        }),
      ),
    ).toBeUndefined();
  });

  it('is refused where an input the message takes is left out', () => {
    // Assembled from stored data rather than through `documentMessage()`, so the only check it
    // meets is the one made when the router is provided.
    expectConfigurationRefusal(
      thrownBy(() =>
        provideLocalizedRouter(routes, {
          origin: ORIGIN,
          outcomeDocuments: {
            'not-found': {
              title: { message: messages.welcome, inputs: {} },
            },
          },
        }),
      ),
    );
  });
});
