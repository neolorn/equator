import { describe, expect, it, afterEach, vi } from 'vitest';

import { PlatformLocation } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import {
  ApplicationInitStatus,
  Component,
  EnvironmentInjector,
  PLATFORM_ID,
  inject,
  provideEnvironmentInitializer,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { bootstrapApplication } from '@angular/platform-browser';
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
  LocalizationRecovery,
  provideLocalizationSetup,
  withLocaleSources,
  withPersistence,
  withRecoveryMessage,
  withRouting,
  withFormattingContext,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';
import { messages, providerId, scopeId } from '#i18n/shell';

import { runtimeExtensions } from './runtime-extensions';
import { routes as appRoutes } from './app.routes';
import { appRouteProjection, routePolicy } from './localization.routes';
import { localeOrigin, pagePath } from './addresses';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

/**
 * When a catalog failed to load at startup, the user saw nothing at all.
 *
 * `provideAppInitializer(() => localization.initialize())` rejected, Angular aborted bootstrap, and
 * the component tree was never created, including whatever hosts the recovery presentation. So
 * the recovery feature was unreachable on precisely the failure it exists for: a chunk that 404s,
 * a bad deploy, a catalog that will not load.
 *
 * An application that gates first paint on localization readiness, the ordinary way to avoid
 * showing untranslated text, has exactly this failure mode. It is the base case for that
 * design, not an edge case.
 *
 * These tests boot through the supported provider path with a real `bootstrapApplication`. The
 * existing runtime-failure spec builds a context with `createLocalizationContext` instead, which
 * proves recovery works on the object while saying nothing about whether it can ever be seen.
 */

const sourceIdentity = `${providerId}:${scopeId}:en-US` as const;

@Component({
  selector: 'recovery-host',
  imports: [LocalizationRecovery],
  template: `
    <main data-application-shell>
      <localization-recovery data-recovery retryLabel="String override" />
    </main>
  `,
})
class RecoveryHost {}

/** The same surface with nothing supplied, so only the payload can name the control. */
@Component({
  selector: 'payload-recovery-host',
  imports: [LocalizationRecovery],
  template: `
    <main data-application-shell>
      <localization-recovery data-recovery />
    </main>
  `,
})
class PayloadRecoveryHost {}

/** The recovery beside the page, as an application's shell holds the two. */
@Component({
  selector: 'routed-recovery-host',
  imports: [LocalizationRecovery, RouterOutlet],
  template: `
    <localization-recovery />
    <router-outlet />
  `,
})
class RoutedRecoveryHost {}

/** A store that remembers one locale, so the failure is resolved against `ar-EG`. */
const remembering = (locale: string) => () =>
  Object.freeze({
    id: 'remembered',
    read: () => locale,
    write: () => undefined,
  });

const hosts: HTMLElement[] = [];

function mountHost(tag = 'recovery-host'): HTMLElement {
  const host = document.createElement(tag);
  document.body.append(host);
  hosts.push(host);
  return host;
}

function failingLoaders() {
  return {
    ...catalogLoaders,
    [sourceIdentity]: () =>
      Promise.reject(
        new TypeError('Failed to fetch dynamically imported module'),
      ),
  };
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe('bootstrap when a catalog cannot load', () => {
  it('still renders, and shows recovery instead of an empty body', async () => {
    const host = mountHost();

    const application = await bootstrapApplication(RecoveryHost, {
      providers: [
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders: failingLoaders(),
            recoveryPayload,
            extensions: runtimeExtensions,
          },
          withRecoveryMessage({
            message: messages.recovery.unavailable,
            retryLabel: messages.control.retry,
          }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });

    // The application booted. Without recovery, bootstrapApplication rejects here and the host
    // element stays empty.
    expect(host.querySelector('[data-application-shell]')).not.toBeNull();

    const recovery = host.querySelector('[data-recovery]');
    expect(recovery).not.toBeNull();
    expect(recovery?.textContent ?? '').toContain(
      'Localization is temporarily unavailable.',
    );

    // An accessible alert, not silent text.
    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.getAttribute('aria-live')).toBe('assertive');

    // Read before the application is destroyed, when its injector still answers.
    const platform = application.injector.get(PLATFORM_ID) as string;
    application.destroy();
    claimCapability('feature:provideLocalizationSetup', { platform });
    claimCapability('feature:withRecoveryMessage', { platform });
    claimCapability('entry:@neolorn/equator', { platform });
  });

  it('publishes no partial runtime behind the recovery surface', async () => {
    mountHost();

    const application = await bootstrapApplication(RecoveryHost, {
      providers: [
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders: failingLoaders(),
            recoveryPayload,
            extensions: runtimeExtensions,
          },
          withRecoveryMessage({
            message: messages.recovery.unavailable,
            retryLabel: messages.control.retry,
          }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });

    const localization = application.injector.get(Localization);

    // Booting is not the same as working. The failure is still a failure, and nothing renders
    // half-localized: reading any message throws rather than returning a fallback.
    expect(localization.lifecycle()).toBe('failed');
    expect(localization.snapshot()).toBeUndefined();
    expect(() => localization.text(messages.appTitle)).toThrow();

    application.destroy();
    claimCapability('entry:@neolorn/equator');
  });

  it('prefers the selected retry label over a string on the element', async () => {
    const host = mountHost();

    const application = await bootstrapApplication(RecoveryHost, {
      providers: [
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders: failingLoaders(),
            recoveryPayload,
            extensions: runtimeExtensions,
          },
          withRecoveryMessage({
            message: messages.recovery.unavailable,
            retryLabel: messages.control.retry,
          }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });

    const button = host.querySelector('[data-recovery] button');
    expect(button?.textContent?.trim()).toBe('Retry');
    // The string input is an override for an application with no handle, and a handle outranks it.
    expect(button?.textContent ?? '').not.toContain('String override');

    application.destroy();
    claimCapability('feature:withRecoveryMessage');
    claimCapability('entry:@neolorn/equator');
  });

  it('renders the retry label in the locale the reader asked for', async () => {
    const host = mountHost('payload-recovery-host');

    const application = await bootstrapApplication(PayloadRecoveryHost, {
      providers: [
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders: failingLoaders(),
            recoveryPayload,
            extensions: runtimeExtensions,
          },
          withPersistence(remembering('ar-EG')),
          withLocaleSources('stored', 'default'),
          withRecoveryMessage({
            message: messages.recovery.unavailable,
            retryLabel: messages.control.retry,
          }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });

    // No catalog loaded, so both of these came from the recovery payload rather than from one.
    const alert = host.querySelector('[role="alert"]');
    expect(
      alert?.getAttribute('lang'),
      'the locale the LocalizationPersistenceStore remembered, read first by withLocaleSources',
    ).toBe('ar');
    expect(alert?.getAttribute('dir')).toBe('rtl');
    expect(alert?.textContent ?? '').toContain('الترجمة غير متاحة مؤقتًا.');

    const button = host.querySelector('[data-recovery] button');
    expect(button?.textContent?.trim()).toBe('إعادة المحاولة');
    // The control carries its own claim rather than inheriting one, which is what stops an English
    // button inside an Arabic region being read under Arabic pronunciation rules.
    expect(button?.getAttribute('lang')).toBe('ar');
    expect(button?.getAttribute('dir')).toBe('rtl');

    const platform = application.injector.get(PLATFORM_ID) as string;
    application.destroy();
    claimCapability('feature:withRecoveryMessage', { platform });
    claimCapability('feature:withPersistence', { platform });
    claimCapability('feature:withLocaleSources', { platform });
    claimCapability('extension:persistence-store', { platform });
    claimCapability('entry:@neolorn/equator', { platform });
  });

  it('rejects bootstrap when no recovery presentation is configured', async () => {
    const host = mountHost();
    // Angular keeps the injector of a rejected bootstrap until the platform is destroyed, and the
    // platform here is the one every spec file in this worker shares. Held so the application can
    // be released like the ones above, or what it wrote into the shared document outlives the file.
    let injector: EnvironmentInjector | undefined;

    // Without a recovery message there is nothing to show, and an application whose every message
    // throws is worse than a hard failure. That case keeps failing loudly.
    await expect(
      bootstrapApplication(RecoveryHost, {
        providers: [
          provideEnvironmentInitializer(() => {
            injector = inject(EnvironmentInjector);
          }),
          provideLocalizationSetup(
            {
              configuration,
              catalogSet,
              catalogLoaders: failingLoaders(),
              extensions: runtimeExtensions,
            },
            withFormattingContext({ timeZone: 'UTC' }),
          ),
        ],
      }),
    ).rejects.toBeDefined();

    expect(host.querySelector('[data-application-shell]')).toBeNull();
    expect(injector).toBeDefined();
    injector?.destroy();
    // Released, it leaves nothing behind in the document, the announcement region included.
    expect(document.querySelector('[data-equator-announcer]')).toBeNull();
    claimCapability('feature:provideLocalizationSetup');
    claimCapability('entry:@neolorn/equator');
  });
});

describe('a server render when a catalog cannot load', () => {
  it('fails, rather than answering with the recovery', async () => {
    // What a server bootstrap waits on before it renders anything. A retry in a server response is
    // a control nothing can act on, and the response would be cached, or written by a prerender,
    // as the address's own page.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders: failingLoaders(),
            recoveryPayload,
            extensions: runtimeExtensions,
          },
          withRecoveryMessage({
            message: messages.recovery.unavailable,
            retryLabel: messages.control.retry,
          }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });

    await expect(
      TestBed.inject(ApplicationInitStatus).donePromise,
      'a server bootstrap went on to draw the LocalizationRecovery withRecoveryMessage configures',
    ).rejects.toThrow('A generated local catalog module could not be loaded.');
    expect(TestBed.inject(Localization).lifecycle()).toBe('failed');
  });

  it('ends the first navigation in an error rather than holding it for a retry', async () => {
    // `specs/06-runtime-and-angular.spec.md` section 5: a server render has no retry to wait for.
    // The browser holds the navigation until one succeeds; on the server nothing will retry, so a
    // held navigation is a response that never finishes.
    const origin = localeOrigin('ar-EG');
    const address = pagePath('item', 'ar-EG');
    const shellLoaders = Object.fromEntries(
      Object.entries(catalogLoaders)
        .filter(([identity]) =>
          identity.startsWith(`${providerId}:${scopeId}:`),
        )
        .map(([identity]) => [
          identity,
          () =>
            Promise.reject(
              new TypeError('Failed to fetch dynamically imported module'),
            ),
        ]),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      // The router hands a failed initial navigation to the application's error handler as well as
      // ending it in NavigationError. TestBed rethrows what that handler receives, which would turn
      // the outcome this case expects into an unhandled rejection; an application only logs it.
      rethrowApplicationErrors: false,
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: MOCK_PLATFORM_LOCATION_CONFIG,
          useValue: { startUrl: `${origin}${address}` },
        },
        provideLocalizedRouter(appRoutes, { origin }),
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders: { ...catalogLoaders, ...shellLoaders },
            recoveryPayload,
            extensions: runtimeExtensions,
            routeProjection,
          },
          withRouting({ policy: routePolicy, projection: appRouteProjection }),
          withRecoveryMessage({
            message: messages.recovery.unavailable,
            retryLabel: messages.control.retry,
          }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });
    await expect(
      TestBed.inject(ApplicationInitStatus).donePromise,
    ).rejects.toBeDefined();
    const router = TestBed.inject(Router);
    let outcome: RouterEvent | undefined;
    void firstValueFrom(
      router.events.pipe(
        filter(
          (event) =>
            event instanceof NavigationEnd ||
            event instanceof NavigationCancel ||
            event instanceof NavigationError,
        ),
      ),
    ).then((event) => (outcome = event));
    router.initialNavigation();
    await vi.waitFor(
      () => {
        TestBed.tick();
        expect(outcome).toBeDefined();
      },
      { timeout: 2000 },
    );

    expect(outcome).toBeInstanceOf(NavigationError);
    TestBed.resetTestingModule();
  });
});

describe('the first navigation when a catalog cannot load', () => {
  it('keeps the address the reader asked for, and a retry arrives there', async () => {
    const origin = localeOrigin('ar-EG');
    const address = pagePath('item', 'ar-EG');
    let fail = true;
    // Every locale's shell, so no locale the start could fall back to lets it start.
    const shellLoaders = Object.fromEntries(
      Object.entries(catalogLoaders)
        .filter(([identity]) =>
          identity.startsWith(`${providerId}:${scopeId}:`),
        )
        .map(([identity, load]) => [
          identity,
          () =>
            fail
              ? Promise.reject(
                  new TypeError('Failed to fetch dynamically imported module'),
                )
              : load(),
        ]),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MOCK_PLATFORM_LOCATION_CONFIG,
          useValue: { startUrl: `${origin}${address}` },
        },
        provideLocalizedRouter(appRoutes, { origin }),
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders: { ...catalogLoaders, ...shellLoaders },
            recoveryPayload,
            extensions: runtimeExtensions,
            routeProjection,
          },
          withRouting({ policy: routePolicy, projection: appRouteProjection }),
          // The start reads the document this spec runs in, which is not at the address the Router
          // is given, so the locale that address states is what the store remembers.
          withPersistence(remembering('ar-EG')),
          withLocaleSources('stored', 'default'),
          withRecoveryMessage({
            message: messages.recovery.unavailable,
            retryLabel: messages.control.retry,
          }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });
    const localization = TestBed.inject(Localization);
    await expect(localization.initialize()).rejects.toBeDefined();
    const router = TestBed.inject(Router);
    const platform = TestBed.inject(PlatformLocation);
    const fixture = TestBed.createComponent(RoutedRecoveryHost);
    let outcome: RouterEvent | undefined;
    void firstValueFrom(
      router.events.pipe(
        filter(
          (event) =>
            event instanceof NavigationEnd ||
            event instanceof NavigationCancel ||
            event instanceof NavigationError,
        ),
      ),
    ).then((event) => (outcome = event));
    router.initialNavigation();
    await new Promise((done) => setTimeout(done, 50));
    TestBed.tick();

    // Where the reader is while the recovery is on screen, which is what a reload returns to.
    expect(outcome).toBeUndefined();
    expect(platform.pathname).toBe(address);
    expect(
      fixture.nativeElement.querySelector('[role="alert"]'),
    ).not.toBeNull();

    fail = false;
    await localization.retry();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(outcome).toBeDefined();
    });
    TestBed.tick();

    expect(outcome).toBeInstanceOf(NavigationEnd);
    expect(platform.pathname).toBe(address);
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    expect(
      fixture.nativeElement.querySelector('[data-route-view="item"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    const platformId = TestBed.inject(PLATFORM_ID) as string;
    fixture.destroy();
    TestBed.resetTestingModule();
    claimCapability('feature:withRecoveryMessage', { platform: platformId });
    claimCapability('feature:withRouting', { platform: platformId });
    claimCapability('entry:@neolorn/equator', { platform: platformId });
  });
});
