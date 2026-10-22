import { afterEach, describe, expect, it } from 'vitest';

import { LocationStrategy } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { Component, inject, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  ROUTES,
  Router,
  RouterOutlet,
  type CanActivateFn,
  type ResolveFn,
  type Routes,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import {
  Localization,
  withRouting,
  withFormattingContext,
} from '@neolorn/equator';
import {
  localizedRouteTable,
  provideLocalizedRouter,
} from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { runtimeExtensions } from './runtime-extensions';
import { routePolicy, appRouteProjection } from './localization.routes';
import {
  addressedLocales,
  localeInPath,
  localeOrigin,
  pagePath,
  pageUrl,
  type Page,
} from './addresses';

/**
 * One route, three ways in, and the requirement that they cannot be told apart.
 *
 * There are exactly three doors to a rendered page, and the third needs delocalizing of its own.
 *
 * 1. **Canonical.** `navigateByUrl('/second')`: a `routerLink`, an application's own call.
 * 2. **Browser-supplied.** The address bar says `/ar-eg/second`: a shared link, a bookmark, a
 *    search result, a reload. `LocalizedLocationStrategy.path()` delocalizes it, so the Router
 *    matches `/second`.
 * 3. **Programmatic and localized.** `navigateByUrl('/ar-eg/second')`, written by hand.
 *
 * Nothing in the Router delocalizes the third. `navigateByUrl` is `parseUrl`, then
 * `urlHandlingStrategy.merge`, then `scheduleNavigation`; it consults no `LocationStrategy` at any
 * point. So a prefixed address goes to the matcher prefixed, and what it finds is a *locale
 * branch*: an entry Equator derives from the route projection so that `@angular/ssr` has an address
 * to walk when it prerenders. A branch carries enough to look renderable. It does not carry the
 * route's `canActivate`, its `resolve`, its `data`, its `title`, or its `providers`, because none
 * of those are addresses.
 *
 * The consequence is the reason this file exists rather than a `toBe` somewhere: **an authorization
 * boundary that holds on two doors and not the third is not a boundary.** Without it, a guard that
 * refuses every visitor is one hand-written prefix away from not running, and nothing throws,
 * nothing warns, and the page renders, so no test that asserts "the page rendered" can catch it.
 *
 * `LocalizedUrlHandlingStrategy.extract` closes it, and closes it with the *same function* the
 * `LocationStrategy` calls rather than a second rule that has to agree with the first. Both doors
 * into the matcher hand it a canonical address.
 *
 * **Asserted as an equality, not as three expectations.** Three `expect` blocks that each assert
 * `'features'` are three chances to write the same wrong constant three times, and they stay green
 * if all three paths break together. `toEqual(canonical)` has no constant in it at all: it says the
 * door a caller used is not an input to anything, which is the actual claim. The concrete readings
 * are asserted once, against one of the three, so that the equality cannot be satisfied by three
 * identically empty observations.
 */

/**
 * A service the route provides for itself, distinguishable from the one the application provides.
 *
 * `providers` on a route is the sharpest of the five things a locale branch dropped, because it is
 * the one that fails *quietly*: the component still constructs, still renders, and silently holds
 * the application-wide instance instead of the one its route declared. `origin` is what makes that
 * substitution visible.
 */
class ActivationScope {
  constructor(readonly origin: 'root' | 'route') {}
}

/** The route's declared title, in English, and deliberately not a translated one. */
const DECLARED_TITLE = 'Second route, declared in English';

interface Observation {
  readonly section: unknown;
  readonly payload: unknown;
  readonly scope: ActivationScope;
}

let observed: Observation | undefined;
let resolverScope: ActivationScope | undefined;
let allowActivation = true;

/**
 * Read through functions, which is not ceremony.
 *
 * Both variables are cleared at the top of `arriveAtSecond` and written from a component
 * constructor and a resolver, neither of which TypeScript's control-flow analysis can see. Read
 * directly, they narrow to `never` after the clear and the file does not compile, so the reads go
 * through a call, which CFA does not follow.
 */
/**
 * The first entry of `Router.config`, recorded on every boot.
 *
 * Deliberately outside `Arrival`, because the ordering case has to compare it and the equality
 * cases have to not. It is what makes that case a detector rather than a description: without it, a
 * `branchesFirst()` that silently produced nothing would pass by testing the same configuration
 * twice.
 */
let configHead: string | undefined;

const observation = (): Observation | undefined => observed;
const resolverActivationScope = (): ActivationScope | undefined =>
  resolverScope;

const gate: CanActivateFn = () => allowActivation;

const resolvePayload: ResolveFn<string> = () => {
  resolverScope = inject(ActivationScope);
  return `payload:${resolverScope.origin}`;
};

// Distinct host attributes on all three, because Angular derives a component id from the
// selector and the class's own shape, and three `ng-component` probes in one file collide on it
// (NG0912). The warning is harmless here and the noise is not worth reading past every run.
@Component({
  standalone: true,
  host: { 'data-probe': 'second' },
  template: `second`,
})
class EqualityProbe {
  constructor() {
    const snapshot = inject(ActivatedRoute).snapshot;
    observed = {
      section: snapshot.data['section'],
      payload: snapshot.data['payload'],
      scope: inject(ActivationScope),
    };
  }
}

@Component({
  standalone: true,
  host: { 'data-probe': 'index' },
  template: `index`,
})
class IndexProbe {}

@Component({
  standalone: true,
  host: { 'data-probe': 'host' },
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

/**
 * The application's own routes, canonical, with everything a route can declare on the one under
 * test. `second` is `route:second` in the fixture's projection, so `/ar-eg/second` is a real
 * address rather than one invented for this file.
 */
const routes: Routes = [
  { path: '', component: IndexProbe },
  {
    path: 'second',
    component: EqualityProbe,
    title: DECLARED_TITLE,
    data: { section: 'features' },
    providers: [
      {
        provide: ActivationScope,
        useFactory: () => new ActivationScope('route'),
      },
    ],
    canActivate: [gate],
    resolve: { payload: resolvePayload },
  },
];

type Door = 'canonical' | 'browser-supplied' | 'programmatic-localized';

/**
 * Where the browser is pointed before anything runs.
 *
 * Every door starts in Arabic, and that is what makes the comparison mean anything: if two of the
 * three ran in English, the readings would differ for a reason that has nothing to do with the door
 * and the equality would be measuring the locale instead. ar-EG is committed before the Router
 * moves in all three cases, and the door is then the only variable left.
 *
 * **Stated twice, and the duplication is the test environment's rather than Equator's.** In a
 * browser there is one address and everything reads it. Under the unit-test builder there are two:
 * `PlatformLocation` is Angular's `FakeNavigationPlatformLocation`, whose start URL comes from
 * `MOCK_PLATFORM_LOCATION_CONFIG` and which knows nothing about jsdom's `history`, and that is what
 * the `LocationStrategy` reads. Equator's `url` locale source reads `document.location` instead,
 * because on the browser platform that is the address, and `PlatformLocation` is consulted only on
 * the server where no `document.location` exists. Set only one and the two halves of door 2
 * disagree: measured, `history` alone left the Router at `/` with the locale correct, and the mock
 * alone left the Router right with the locale en-US.
 */
const START: Readonly<Record<Door, Page>> = {
  canonical: 'home',
  'browser-supplied': 'second',
  'programmatic-localized': 'home',
};

afterEach(() => {
  history.replaceState(null, '', '/');
});

/**
 * The Router's initial navigation, awaited.
 *
 * `initialNavigation()` reads `Location.path()`, which is `LocationStrategy.path()`, which is
 * Equator's delocalizing one, so this is door 2 driven by the Router itself rather than by the test
 * handing it an address. It returns void and navigates asynchronously, so the outcome has to be
 * taken off the event stream.
 */
async function settleInitialNavigation(router: Router): Promise<boolean> {
  const arrival = firstValueFrom(
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
  return (await arrival) instanceof NavigationEnd;
}

interface Arrival {
  readonly routerUrl: string;
  readonly externalUrl: string;
  readonly locale: string | undefined;
  readonly title: string;
  readonly activated: boolean;
  readonly section: unknown;
  readonly payload: unknown;
  readonly componentScope: 'root' | 'route' | undefined;
  readonly resolverScope: 'root' | 'route' | undefined;
  readonly oneScopeInstance: boolean;
}

/**
 * The locale branches, registered ahead of the application's own routes.
 *
 * `Router.config` is `inject(ROUTES)?.flat()`, so a multi entry declared before
 * `provideLocalizedRouter` composes in front of everything that call registers. That puts the
 * branches first, which is the position from which a branch that still matched would win the
 * address before the canonical layer was consulted.
 *
 * Registering them twice is the point rather than a flaw. The branches Equator supplies are still
 * there, behind the canonical layer; these are the same entries in the position the ordering claim
 * says is safe. If a branch ever stops declining, this is the case that goes red first, and it goes
 * red for the reason the claim exists.
 */
function branchesFirst(): Provider {
  return {
    provide: ROUTES,
    multi: true,
    useValue: localizedRouteTable(routes, routePolicy, appRouteProjection)
      .branches,
  };
}

async function arriveAtSecond(
  door: Door,
  allow = true,
  ordering: 'canonical-first' | 'branches-first' = 'canonical-first',
): Promise<Arrival> {
  observed = undefined;
  resolverScope = undefined;
  allowActivation = allow;
  document.title = '';

  history.replaceState(null, '', pagePath(START[door], 'ar-EG'));

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      // The other half of the address. See START above.
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: pageUrl(START[door], 'ar-EG') },
      },
      // The application-wide instance the route's own `providers` must shadow.
      {
        provide: ActivationScope,
        useFactory: () => new ActivationScope('root'),
      },
      // Before `provideLocalizedRouter`, which is what makes it the other ordering.
      ...(ordering === 'branches-first' ? [branchesFirst()] : []),
      provideLocalizedRouter(routes, { origin: localeOrigin('ar-EG') }),
      provideLocalizationTesting(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        withRouting({ policy: routePolicy, projection: appRouteProjection }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });

  const localization = TestBed.inject(Localization);
  await localization.initialize();
  const router = TestBed.inject(Router);
  TestBed.createComponent(RootHost);

  let activated = await settleInitialNavigation(router);
  if (door === 'canonical') activated = await router.navigateByUrl('/second');
  if (door === 'programmatic-localized')
    activated = await router.navigateByUrl(pagePath('second', 'ar-EG'));
  TestBed.tick();

  configHead = router.config[0]?.path;
  const routerUrl = router.url;
  const seen = observation();
  const fromResolver = resolverActivationScope();
  return Object.freeze({
    routerUrl,
    externalUrl: TestBed.inject(LocationStrategy).prepareExternalUrl(routerUrl),
    locale: localization.snapshot()?.primaryLocale,
    title: document.title,
    activated,
    section: seen?.section,
    payload: seen?.payload,
    componentScope: seen?.scope.origin,
    resolverScope: fromResolver?.origin,
    oneScopeInstance: seen !== undefined && seen.scope === fromResolver,
  });
}

// The third door is an address whose path names its locale, and the other two start from one.
describe.runIf(localeInPath)(
  'one route reached through each of the three doors',
  () => {
    it('cannot be told apart by which door was used', async () => {
      const canonical = await arriveAtSecond('canonical');
      const browserSupplied = await arriveAtSecond('browser-supplied');
      const programmatic = await arriveAtSecond('programmatic-localized');

      // Read once, against one of the three, so that the equalities below cannot be satisfied by
      // three identically empty arrivals. Every one of these was absent on door 3 before shape 3.
      expect(canonical).toMatchObject({
        // Canonical inside, localized outside: 4.2's invariant, now true whatever the door.
        routerUrl: '/second',
        externalUrl: pagePath('second', 'ar-EG'),
        locale: 'ar-EG',
        // The route's own declarations, all five of them.
        title: DECLARED_TITLE,
        activated: true,
        section: 'features',
        payload: 'payload:route',
        componentScope: 'route',
        resolverScope: 'route',
        oneScopeInstance: true,
      });

      // The claim. No constants, so it holds nothing in place except the sameness itself.
      expect(browserSupplied).toEqual(canonical);
      expect(programmatic).toEqual(canonical);
    });

    /**
     * The ordering claim, asserted rather than asserted-to-be-asserted.
     *
     * `provide.ts` and `route-table.ts` both say ordering is a result rather than a constraint, and
     * a comment claiming the consumer suite proves it is worth nothing without the case: three
     * comments can point at a proof that exists in neither suite. It is written here because the
     * claim needs a Router
     * to mean anything: the table alone can only say the two halves are separable, which it does.
     */
    it('is unchanged by putting the locale branches first', async () => {
      const canonicalFirst = await arriveAtSecond('canonical');
      const canonicalHead = configHead;
      const branchesAhead = await arriveAtSecond(
        'canonical',
        true,
        'branches-first',
      );

      // The flip took effect. Equator's own composition puts the pathless canonical parent first, so
      // its head is `''`; with the branches ahead the head is a locale prefix. Asserted before the
      // equality, because an equality between two identical configurations is not the claim.
      expect(canonicalHead).toBe('');
      expect(configHead).toBe(
        addressedLocales('home')
          .map((locale) => pagePath('home', locale).split('/')[1])
          .find((segment) => segment !== ''),
      );

      expect(branchesAhead).toEqual(canonicalFirst);

      // The door the ordering could plausibly matter for, since it is the one whose address names a
      // locale. It reaches the matcher canonical either way, so the branch it would have matched is
      // never consulted, and would decline if it were.
      const programmaticAhead = await arriveAtSecond(
        'programmatic-localized',
        true,
        'branches-first',
      );
      expect(programmaticAhead).toEqual(canonicalFirst);
    });

    it('refuses all three the same way when the route says no', async () => {
      // The half that matters most, and the half a "the page rendered" test cannot see. A guard is
      // only a boundary if it is on every way in.
      const refusal = (arrival: Arrival) =>
        Object.freeze({
          activated: arrival.activated,
          routerUrl: arrival.routerUrl,
          constructed: arrival.componentScope !== undefined,
          resolverRan: arrival.resolverScope !== undefined,
        });

      const canonical = refusal(await arriveAtSecond('canonical', false));
      const browserSupplied = refusal(
        await arriveAtSecond('browser-supplied', false),
      );
      const programmatic = refusal(
        await arriveAtSecond('programmatic-localized', false),
      );

      // Not merely "did not activate": nothing was constructed and no resolver ran, which is what
      // distinguishes a refused navigation from one that rendered and then hid itself. `title` is
      // deliberately not compared: a refused navigation leaves the previous page's title, and the
      // three doors have different previous pages, which is a fact about the fixture rather than
      // about the refusal.
      expect(canonical).toEqual({
        activated: false,
        routerUrl: '/',
        constructed: false,
        resolverRan: false,
      });
      expect(browserSupplied).toEqual(canonical);
      expect(programmatic).toEqual(canonical);
    });
  },
);
