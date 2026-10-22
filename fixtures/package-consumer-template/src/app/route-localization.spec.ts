import { onTestFinished, vi } from 'vitest';

import { LocationStrategy } from '@angular/common';
import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, type Routes } from '@angular/router';
import {
  Localization,
  withRouting,
  withFormattingContext,
} from '@neolorn/equator';
import {
  RouteLocalization,
  provideLocalizedRouter,
  type RouteLocalizationContext,
  type RouteLocalizationOptions,
} from '@neolorn/equator/router';
import {
  LocalizationTestingController,
  provideLocalizationTesting,
} from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';
import {
  providerId as lazyProviderId,
  scopeId as lazyScopeId,
} from '#i18n/lazy';

import { routePolicy, appRouteProjection } from './localization.routes';
import {
  localeInPath,
  localeOrigin,
  pagePath,
  switchInDocument,
} from './addresses';
import { runtimeExtensions } from './runtime-extensions';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

@Component({
  standalone: true,
  template: `route`,
})
class RouteProbe {}

/**
 * The application's own routes, canonical, and every address this file navigates to.
 *
 * Every address this file reaches is declared, the lazy page included. Equator appends no
 * catch-all, so an application without a not-found page does not silently acquire one, and an
 * address this list omits renders nothing rather than falling into an appended `**` with the
 * resolver on it and leaving the assertions below about the adapter alone. The `**` here is this
 * fixture's, written where a consumer writes it.
 */
const routes: Routes = [
  { path: '', component: RouteProbe },
  { path: 'second', component: RouteProbe },
  { path: 'lazy', component: RouteProbe },
  { path: '**', component: RouteProbe },
];

/**
 * What this application decides, and nothing more.
 *
 * No `requiredScopes`. The generated route table names what each route must have ready and the
 * adapter loads it, so declaring the shell scope here restated a fact Equator already holds, and
 * while it was declared, this file passed whether or not the derivation worked at all.
 */
const ROUTING_OPTIONS = {
  origin: localeOrigin('en-US'),
  document: ({ resolution }: RouteLocalizationContext) => ({
    title:
      resolution.locale === 'ar-EG'
        ? 'مختبر ميزات Equator'
        : 'Equator feature lab',
  }),
} as const;

describe('Equator Router transaction integration', () => {
  /**
   * The integration as an application configures it, with nothing added for the test's benefit
   * beyond the options a case is about.
   */
  const configureRouterIntegration = async (
    options: RouteLocalizationOptions = {},
  ) => {
    await TestBed.configureTestingModule({
      providers: [
        provideLocalizedRouter(routes, { ...ROUTING_OPTIONS, ...options }),
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
            policy: routePolicy,
            projection: appRouteProjection,
          }),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    }).compileComponents();
  };

  /**
   * What a failed post-navigation effect puts back, and where the failure is driven from.
   *
   * Not from `navigateByUrl('/ar-eg')`. `LocalizedUrlHandlingStrategy.extract` delocalizes the
   * address before the Router matches it, so no navigation reaches a locale branch and no
   * navigation changes locale. `Localization.changeLocale` does, and it is not a navigation.
   *
   * So the restore is driven across *routes* instead, from a locale that was switched into
   * beforehand. Three of the four dimensions are unchanged by that: route state, URL and document
   * state all genuinely move and genuinely come back. The fourth is weaker and is worth saying
   * plainly: with no navigation able to change locale, "restores the locale" means "stays in the
   * locale it was in". That is still a claim worth holding. Restore code that reaches for the
   * default locale rather than the outgoing snapshot fails this one, which is why the assertion is
   * `ar-EG` and not the policy's default.
   */
  // Where a switch moves the address bar in this document, which needs the path to carry the locale.
  it.runIf(localeInPath)(
    'restores locale, route state, URL, and document state after a post-navigation effect failure',
    async () => {
      let failDocument = false;
      await TestBed.configureTestingModule({
        providers: [
          provideLocalizedRouter(routes, {
            origin: localeOrigin('en-US'),
            document: ({ resolution }) => {
              // Keyed on the route rather than the locale, because the locale no longer changes
              // across the navigation under test and keying on it would never fire.
              if (failDocument && resolution.routeId === 'route:second') {
                throw new Error('intentional document failure');
              }
              return {
                title:
                  resolution.locale === 'ar-EG'
                    ? 'مختبر ميزات Equator'
                    : 'Equator feature lab',
              };
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
            withRouting({
              policy: routePolicy,
              projection: appRouteProjection,
            }),
            withFormattingContext({ timeZone: 'UTC' }),
          ),
        ],
      }).compileComponents();

      const localization = TestBed.inject(Localization);
      const router = TestBed.inject(Router);
      const routeLocalization = TestBed.inject(RouteLocalization);
      await localization.initialize();
      await router.navigateByUrl('/');
      await expect(routeLocalization.settled()).resolves.toMatchObject({
        status: 'committed',
      });
      expect(localization.snapshot()).toMatchObject({
        primaryLocale: 'en-US',
        route: {
          routeId: 'route:_index',
          canonicalPath: pagePath('home', 'en-US'),
        },
      });
      expect(document.title).toBe('Equator feature lab');

      // The switch, which is the operation that changes locale. The address bar follows it, so the
      // state this navigation has to be restored to is an Arabic one throughout.
      //
      // The two addresses are read separately, and under shape 3 they differ. `router.url` is the
      // Router's own tree, and it is canonical now in every case: `extract` delocalizes on the way
      // in, so nothing prefixed ever reaches the matcher and nothing prefixed is ever what the
      // Router holds. What the visitor sees is that tree put back through `prepareExternalUrl`,
      // which is the call `Location.replaceState` funnels through and the one `LocalizedAddressSync`
      // makes on a switch. That a single `expect(router.url).toBe('/en-us')` cannot state this is
      // the invariant rather than a casualty of it.
      await localization.changeLocale('ar-EG');
      // The head is re-projected by an effect, which a running application flushes on its own and a
      // zoneless test has to ask for. `lang` and `dir` do not need this, they are written by a
      // commit hook inside the transaction, but the title, description and alternates do.
      TestBed.tick();
      const externalUrl = () =>
        TestBed.inject(LocationStrategy).prepareExternalUrl(router.url);
      expect(router.url).toBe('/');
      expect(externalUrl()).toBe(pagePath('home', 'ar-EG'));
      expect(document.title).toBe('مختبر ميزات Equator');

      failDocument = true;
      await router.navigateByUrl('/second');
      await expect(routeLocalization.settled()).resolves.toMatchObject({
        status: 'failed',
        diagnostic: { code: 'effect-failed' },
      });
      // Back at the index, in both forms. Without the restore this is `/second`.
      expect(router.url).toBe('/');
      expect(externalUrl()).toBe(pagePath('home', 'ar-EG'));
      // `canonicalPath` is the whole point of the line. `changeLocale` carries the active route
      // record forward when the caller names none, so a switch that does not restate it leaves the
      // record saying the English address while `primaryLocale` says `ar-EG`. The adapter derives the
      // replacement where the spellings live and restates it through the same publisher, so a
      // snapshot never carries a record from a locale it is not in.
      expect(localization.snapshot()).toMatchObject({
        primaryLocale: 'ar-EG',
        route: {
          routeId: 'route:_index',
          canonicalPath: pagePath('home', 'ar-EG'),
        },
      });
      expect(routeLocalization.context()?.resolution).toMatchObject({
        locale: 'ar-EG',
        routeId: 'route:_index',
      });
      expect(document.documentElement.lang).toBe('ar-EG');
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.title).toBe('مختبر ميزات Equator');
      claimCapability('feature:provideLocalizedRouter', {
        policy: routePolicy,
      });
      claimCapability('entry:@neolorn/equator/router', { policy: routePolicy });
      claimCapability('entry:@neolorn/equator', { policy: routePolicy });
    },
  );

  /**
   * Scope loading on activation, asserted against the thing that performs it.
   *
   * The scope behind the lazy route is not a startup scope, so nothing has loaded it when this
   * navigation begins and nothing here loads it by hand. The generated route table names it and
   * the adapter loads it on activation, or it stays unavailable. `requiredScopes` is deliberately
   * absent from the configuration above: while it was declared, this file passed whether or not
   * any of that worked, which is how the derivation reached a release guarded by nothing.
   */
  it('loads the scopes a route declares no list for', async () => {
    await configureRouterIntegration();
    const localization = TestBed.inject(Localization);
    const router = TestBed.inject(Router);
    await localization.initialize();

    const lazyScope = { providerId: lazyProviderId, scopeId: lazyScopeId };
    expect(localization.scopeReadiness(lazyScope)().status).not.toBe('ready');

    await router.navigateByUrl(pagePath('lazy', 'en-US'));

    expect(
      localization.scopeReadiness(lazyScope)().status,
      'the scope the generated route table lists in the lazy route’s scopes',
    ).toBe('ready');
    const platform = TestBed.inject(PLATFORM_ID) as string;
    claimCapability('entry:@neolorn/equator', {
      policy: routePolicy,
      platform,
    });
    claimCapability('declaration:GeneratedRouteProjectionEntry.scopes', {
      policy: routePolicy,
      platform,
    });
  });

  /**
   * A scope the application names for a route holds the navigation until it has loaded.
   *
   * The lazy scope is named for the second page, whose generated entry does not list it, so only the
   * option can be what asks for it. Its load is held open, and the navigation must still be waiting
   * while it is.
   */
  it('holds a navigation for the scope requiredScopes names for its route', async () => {
    const lazyScope = { providerId: lazyProviderId, scopeId: lazyScopeId };
    await configureRouterIntegration({
      requiredScopes: { 'route:second': [lazyScope] },
    });
    const localization = TestBed.inject(Localization);
    const router = TestBed.inject(Router);
    const controller = TestBed.inject(LocalizationTestingController);
    let completed = 0;
    const counting = router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) completed += 1;
    });
    onTestFinished(() => counting.unsubscribe());
    await localization.initialize();
    await router.navigateByUrl(pagePath('home', 'en-US'));
    expect(localization.scopeReadiness(lazyScope)().status).not.toBe('ready');

    const held = controller.deferNext(lazyScope, 'en-US');
    let landed = false;
    const navigation = router
      .navigateByUrl(pagePath('second', 'en-US'))
      .then((arrived) => {
        landed = true;
        return arrived;
      });
    await held.started;
    for (let hop = 0; hop < 10; hop += 1) await Promise.resolve();
    expect(landed, 'the navigation finished before its scope loaded').toBe(
      false,
    );
    expect(router.url).not.toBe('/second');

    held.release();
    await expect(navigation).resolves.toBe(true);
    expect(router.url).toBe('/second');
    expect(localization.scopeReadiness(lazyScope)().status).toBe('ready');
    // The navigation held is the one after the first, so it is a client navigation.
    claimCapability('declaration:RouteLocalizationOptions.requiredScopes', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
      clientNavigations: completed - 1,
    });
  });

  /**
   * In progressive mode a scope named as progressive arrives after the page, not before it.
   *
   * The same held load as above, named as progressive instead: the navigation finishes while the
   * load is still open, and the scope becomes ready once it is released. Section 7 of
   * `specs/06-runtime-and-angular.spec.md` lets a progressive commit land with the scopes that are
   * ready while the rest finish on their own.
   */
  it('lands a navigation before the scope progressiveScopes names, in progressive mode', async () => {
    const lazyScope = { providerId: lazyProviderId, scopeId: lazyScopeId };
    await configureRouterIntegration({
      mode: 'progressive',
      progressiveScopes: { 'route:second': [lazyScope] },
    });
    const localization = TestBed.inject(Localization);
    const router = TestBed.inject(Router);
    const controller = TestBed.inject(LocalizationTestingController);
    let completed = 0;
    const counting = router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) completed += 1;
    });
    onTestFinished(() => counting.unsubscribe());
    await localization.initialize();
    await router.navigateByUrl(pagePath('home', 'en-US'));

    const held = controller.deferNext(lazyScope, 'en-US');
    await expect(
      router.navigateByUrl(pagePath('second', 'en-US')),
    ).resolves.toBe(true);
    await held.started;
    expect(router.url).toBe('/second');
    expect(
      localization.scopeReadiness(lazyScope)().status,
      'the progressive scope, still loading after the navigation landed',
    ).not.toBe('ready');

    held.release();
    await vi.waitFor(() => {
      expect(localization.scopeReadiness(lazyScope)().status).toBe('ready');
    });
    const platform = TestBed.inject(PLATFORM_ID) as string;
    // The navigation that landed early is the one after the first, so it is a client navigation.
    const observed = {
      policy: routePolicy,
      platform,
      clientNavigations: completed - 1,
    };
    claimCapability(
      'declaration:RouteLocalizationOptions.progressiveScopes',
      observed,
    );
    claimCapability('declaration:RouteLocalizationOptions.mode', observed);
  });

  /**
   * In coordinated mode a scope named as progressive holds a later navigation, as a required one
   * does.
   *
   * The same held load again, with the mode left at its default. Section 9 of
   * `specs/06-runtime-and-angular.spec.md` has a coordinated navigation wait for the scope, so the
   * page it lands on can read the scope's messages.
   */
  it('holds a later navigation for the scope progressiveScopes names, in coordinated mode', async () => {
    const lazyScope = { providerId: lazyProviderId, scopeId: lazyScopeId };
    await configureRouterIntegration({
      mode: 'coordinated',
      progressiveScopes: { 'route:second': [lazyScope] },
    });
    const localization = TestBed.inject(Localization);
    const router = TestBed.inject(Router);
    const controller = TestBed.inject(LocalizationTestingController);
    let completed = 0;
    const counting = router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) completed += 1;
    });
    onTestFinished(() => counting.unsubscribe());
    await localization.initialize();
    await router.navigateByUrl(pagePath('home', 'en-US'));
    expect(localization.scopeReadiness(lazyScope)().status).not.toBe('ready');

    const held = controller.deferNext(lazyScope, 'en-US');
    let landed = false;
    const navigation = router
      .navigateByUrl(pagePath('second', 'en-US'))
      .then((arrived) => {
        landed = true;
        return arrived;
      });
    // Whichever happens first. A navigation that lands without asking for the scope never starts
    // the load, and waiting on the load alone would report that as a timeout.
    expect(
      await Promise.race([
        held.started.then(() => 'the scope was asked for'),
        navigation.then(() => 'the navigation landed'),
      ]),
      'a later navigation in coordinated mode, to a route that names a progressive scope',
    ).toBe('the scope was asked for');
    for (let hop = 0; hop < 10; hop += 1) await Promise.resolve();
    expect(
      landed,
      'the navigation finished before the scope progressiveScopes names had loaded',
    ).toBe(false);
    expect(router.url).not.toBe('/second');

    held.release();
    await expect(navigation).resolves.toBe(true);
    expect(router.url).toBe('/second');
    expect(localization.scopeReadiness(lazyScope)().status).toBe('ready');
    // The navigation held is the one after the first, so it is a client navigation.
    const observed = {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
      clientNavigations: completed - 1,
    };
    claimCapability(
      'declaration:RouteLocalizationOptions.progressiveScopes',
      observed,
    );
    claimCapability('declaration:RouteLocalizationOptions.mode', observed);
  });

  /**
   * Before any navigation has landed there is no page to keep on screen, so a scope named as
   * progressive is loaded ahead of the first one, as a required scope is.
   *
   * Section 9 of `specs/06-runtime-and-angular.spec.md` requires it of a server render, a prerender
   * and the first render in a browser, which are all a first navigation. The mode is progressive,
   * where a later navigation lands first, so what holds this one is that it is the first.
   */
  it('holds the first navigation for the scope progressiveScopes names', async () => {
    const lazyScope = { providerId: lazyProviderId, scopeId: lazyScopeId };
    await configureRouterIntegration({
      mode: 'progressive',
      progressiveScopes: { 'route:second': [lazyScope] },
    });
    const localization = TestBed.inject(Localization);
    const router = TestBed.inject(Router);
    const controller = TestBed.inject(LocalizationTestingController);
    let completed = 0;
    const counting = router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) completed += 1;
    });
    onTestFinished(() => counting.unsubscribe());
    await localization.initialize();

    const held = controller.deferNext(lazyScope, 'en-US');
    let landed = false;
    const navigation = router
      .navigateByUrl(pagePath('second', 'en-US'))
      .then((arrived) => {
        landed = true;
        return arrived;
      });
    // Whichever happens first. A navigation that lands without asking for the scope never starts
    // the load, and waiting on the load alone would report that as a timeout.
    expect(
      await Promise.race([
        held.started.then(() => 'the scope was asked for'),
        navigation.then(() => 'the navigation landed'),
      ]),
      'the first navigation, with no page before it to keep on screen',
    ).toBe('the scope was asked for');
    for (let hop = 0; hop < 10; hop += 1) await Promise.resolve();
    expect(
      landed,
      'the first navigation finished before the scope progressiveScopes names had loaded',
    ).toBe(false);

    held.release();
    await expect(navigation).resolves.toBe(true);
    expect(router.url).toBe('/second');
    expect(localization.scopeReadiness(lazyScope)().status).toBe('ready');
    // The navigation held is the first, so nothing was reached by a client navigation.
    claimCapability('declaration:RouteLocalizationOptions.progressiveScopes', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
      clientNavigations: completed - 1,
    });
  });

  /**
   * An address the projection does not contain is not a localization failure: the
   * locale resolved and only the page is unknown, so the navigation completes and the application
   * answers. Throwing here abandoned it, and no application's not-found page ever rendered.
   */
  // Only a path can name the locale of an address with no page behind it.
  it.runIf(localeInPath)(
    'completes a navigation to an address it cannot name',
    async () => {
      await configureRouterIntegration();
      const localization = TestBed.inject(Localization);
      const router = TestBed.inject(Router);
      await localization.initialize();
      await router.navigateByUrl(pagePath('home', 'en-US'));

      await expect(
        router.navigateByUrl(pagePath('missing', 'ar-EG')),
      ).resolves.not.toThrow();
      // The locale committed, which is the whole of the decision: the address is unknown, the
      // language is not. What the adapter keeps in `context()` afterwards is a separate question and
      // is deliberately not asserted here.
      expect(localization.snapshot()).toMatchObject({ primaryLocale: 'ar-EG' });
      claimCapability('entry:@neolorn/equator', { policy: routePolicy });
    },
  );

  /**
   * The regression that removing `RouteLocalization.navigate()` would otherwise have introduced.
   *
   * A locale change is not a navigation, so nothing fires `NavigationEnd` and nothing re-runs the
   * document projection as a side effect: the internal address is `/` before the switch and `/`
   * after it, and only the address bar moves. Without the adapter re-projecting on a locale
   * commit, the title keeps the previous language on every switch, on the very control that does
   * the switching, which is the one place a visitor is certain to be looking.
   *
   * `lang` and `dir` are asserted alongside it because they follow a different mechanism, a
   * commit hook inside the locale transaction, and this is what says the two agree.
   */
  // Where a switch stays in this document. Under locale-host it loads the other origin instead.
  it.runIf(switchInDocument)(
    're-projects the document when the locale changes without a navigation',
    async () => {
      await configureRouterIntegration();
      const localization = TestBed.inject(Localization);
      const router = TestBed.inject(Router);
      await localization.initialize();
      await router.navigateByUrl(pagePath('home', 'en-US'));
      expect(document.title).toBe('Equator feature lab');

      await localization.changeLocale('ar-EG');
      // The re-projection runs in an effect, as the address sync's does, so it lands on the next
      // change detection rather than inside `changeLocale`. A zoneless application schedules that
      // itself; a zoneless TestBed has to be told.
      TestBed.tick();

      expect(document.title).toBe('مختبر ميزات Equator');
      expect(document.documentElement.lang).toBe('ar-EG');
      expect(document.documentElement.dir).toBe('rtl');
      claimCapability('entry:@neolorn/equator', { policy: routePolicy });
    },
  );

  /**
   * The same hazard as the title, in the other direction.
   *
   * The adapter claims the interaction coordinator at construction, so from then on every commit's
   * focus, caret and scroll restore is parked and only `NavigationEnd` releases it. A locale switch
   * is not a navigation, so without a release of its own the restore would stay parked and fire on
   * the next real navigation, putting the previous page's scroll position on the page the reader
   * just opened.
   *
   * Asserted on `scrollTo`, which is the last thing the restore does, because a restore that never
   * runs and a restore that runs onto an unmoved page look identical from the DOM afterwards.
   */
  it.runIf(switchInDocument)(
    'puts the reader back on a locale change no navigation follows',
    async () => {
      const scrollTo = vi
        .spyOn(window, 'scrollTo')
        .mockImplementation(() => undefined);
      try {
        await configureRouterIntegration();
        const localization = TestBed.inject(Localization);
        const router = TestBed.inject(Router);
        await localization.initialize();
        await router.navigateByUrl(pagePath('home', 'en-US'));
        scrollTo.mockClear();

        await localization.changeLocale('ar-EG');
        TestBed.tick();
        // The restore is scheduled through `requestAnimationFrame` behind a microtask, so it has not
        // run at the end of the flush that released it.
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        );
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        );

        expect(scrollTo).toHaveBeenCalled();
        claimCapability('entry:@neolorn/equator', { policy: routePolicy });
      } finally {
        scrollTo.mockRestore();
      }
    },
  );
});
