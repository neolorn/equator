import { LocationStrategy, isPlatformServer } from '@angular/common';
import {
  APP_BOOTSTRAP_LISTENER,
  InjectionToken,
  Injector,
  PLATFORM_ID,
  REQUEST,
  effect,
  inject,
  isDevMode,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import {
  ROUTES,
  RedirectCommand,
  Router,
  TitleStrategy,
  UrlHandlingStrategy,
  provideRouter,
  withRouterConfig,
  type ResolveFn,
  type Route,
  type RouterFeatures,
  type Routes,
} from '@angular/router';
import {
  LOCALE_URL_POLICY,
  Localization,
  LocalizationError,
  resolveLocalizedRoute,
  toExternalPath,
  toInternalPath,
  type LocaleUrlPolicy,
  type LocalizedAddressContext,
} from '@neolorn/equator';
import { ɵlistOption } from '@neolorn/equator/core';

import { LocalizedAddressSync } from './address-sync.js';
import {
  isBoundDocumentMessage,
  refuseUnboundDocumentMessage,
  type RouteDocumentField,
} from './document-messages.js';
import { LocalizedLocationStrategy } from './location-strategy.js';
import {
  refuseOptionsOfAnotherKind,
  refuseUndeclaredMode,
} from './navigation-scopes.js';
import { LocalizedUrlHandlingStrategy } from './url-handling-strategy.js';
import { LocalizedTitleStrategy } from './title-strategy.js';
import {
  localizedRouteTable,
  type LocalizedRouteTable,
  type LocalizedRouteTableProblem,
} from './route-table.js';
import {
  RouteLocalization,
  type RouteLocalizationContext,
  type RouteLocalizationOptions,
} from './route-localization.js';

/**
 * What `provideLocalizedRouter` accepts, which is what the Router integration itself accepts.
 *
 * Named separately so the provider function reads in its own terms; the two are the same shape and
 * will stay so.
 */
export type LocalizedRouterOptions = RouteLocalizationOptions;

/**
 * The locale URL policy, or a message that says which line is missing.
 *
 * Injected optionally and rejected explicitly rather than left to fail as an unhelpful NullInjector
 * error, because the failure is always the same one omission: `provideLocalization()` without
 * `withRouting()`.
 */
function declaredAddressContext(): LocalizedAddressContext {
  const declared = inject(LOCALE_URL_POLICY, { optional: true });
  if (declared === null) {
    throw new LocalizationError({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message:
        'Localized routing requires a locale URL policy. Declare one with withRouting() inside provideLocalization().',
    });
  }
  return declared;
}

/**
 * The same, read at the origin this build answers at.
 *
 * Given to the two strategies and the resolver, because they read and write the addresses a
 * document holds, and under a host policy a path names a locale only together with its origin.
 */
function servedAddressContext(
  options: LocalizedRouterOptions,
): LocalizedAddressContext {
  const declared = declaredAddressContext();
  return options.origin === undefined
    ? declared
    : { ...declared, origin: options.origin };
}

/** Computed once and read by both the route factory and the startup diagnostics. */
const LOCALIZED_ROUTE_TABLE = new InjectionToken<LocalizedRouteTable>(
  'LOCALIZED_ROUTE_TABLE',
);

/**
 * Settles once the runtime has a snapshot to read an address in.
 *
 * A start that failed leaves none, and a navigation that fails over it makes the Router put back the
 * address it last settled on, which for the first navigation is the root. The reader's address was
 * gone before the recovery was on screen, a reload landed on another page, and a retry that
 * succeeded had no page to return to. In a browser the navigation is held instead, and completes
 * when a retry succeeds. A server render has no retry to wait for, and holding it would hold the
 * response, so there the failure stands.
 *
 * A runtime that has failed is not asked to start again here. Starting it is the retry's to do, and
 * an attempt made by every navigation would be a retry nobody asked for.
 */
async function startedRuntime(
  localization: Localization,
  injector: Injector,
  server: boolean,
): Promise<void> {
  if (localization.snapshot() !== undefined) return;
  if (server || localization.lifecycle() !== 'failed') {
    try {
      await localization.initialize();
      return;
    } catch (error: unknown) {
      if (server) throw error;
    }
  }
  await new Promise<void>((settle) => {
    const watch = effect(
      () => {
        if (localization.snapshot() === undefined) return;
        watch.destroy();
        settle();
      },
      { injector },
    );
  });
}

/**
 * The resolver, reading a canonical address.
 *
 * It does not decide which locale the address states: the strategy settles that before the Router
 * runs. What it does is the reason it exists: it awaits the scopes a route needs *before* that
 * route activates, and it builds the document projection. Nothing else in Equator does either, so
 * removing the resolver outright would take deferred-scope preloading with it, silently.
 *
 * The address is re-localized before it is resolved, and that is not a nicety. `state.url` is
 * canonical here, because the strategy delocalized it on the way in, and a canonical address does
 * not resolve: `resolveLocalizedRoute('/second', …)` answers
 * `{status: 'redirect', reason: 'locale-entry', location: '/en-us/second'}`. Handing that to
 * `prepare` unchanged redirects to the prefixed form, which the strategy delocalizes straight back,
 * which resolves again. Measured, not predicted: it is why the strategy and the resolver cannot be
 * split across two steps.
 *
 * Re-localized in the context the strategies read, the origin this build answers at included, so
 * the address it resolves is one this document can hold.
 */
function resolveCanonicalRouteLocalization(
  options: LocalizedRouterOptions,
): ResolveFn<RouteLocalizationContext | RedirectCommand | undefined> {
  return async (_route, state) => {
    const context = servedAddressContext(options);
    const localization = inject(Localization);
    const routeLocalization = inject(RouteLocalization);
    const router = inject(Router);
    await startedRuntime(
      localization,
      inject(Injector),
      isPlatformServer(inject(PLATFORM_ID)),
    );
    // Read after the start, because the locale that reads the address is the one the start
    // committed. Read before it, a held navigation completed in the default locale.
    const active =
      localization.snapshot()?.primaryLocale ?? context.policy.defaultLocale;
    const external = toExternalPath(state.url, active, context);
    // An internal address spelled with another locale's parameter names this route, and the page
    // would read that spelling where a document request for the same address reads the canonical
    // one. The navigation moves to the canonical address in place, as the server's correction does.
    const canonical = router.parseUrl(toInternalPath(external, context));
    if (router.serializeUrl(canonical) !== state.url) {
      return new RedirectCommand(canonical, { replaceUrl: true });
    }
    return routeLocalization.prepare(external);
  };
}

/**
 * Equator's own router configuration, named once so the diagnostic can report what was replaced.
 *
 * `deferred` is the Router's default and is stated anyway, because `RouteLocalization` refuses
 * `eager` outright: the adapter commits the locale before activation, so an eager URL update would
 * publish the new locale's address over the old locale's page for the whole of guards and
 * resolution.
 */
const ROUTER_CONFIGURATION = Object.freeze({
  urlUpdateStrategy: 'deferred' as const,
});

/**
 * The two problems that produce a wrong page, as against the two that produce a missing one.
 *
 * `parameter-mismatch` is the worst shape Equator can emit: a localized spelling that renames or
 * drops a parameter builds an address the codec cannot round-trip, and the failure surfaces as a
 * page rendered in the wrong language rather than as an error. `unrenderable-branch-entry` names
 * an authored route with no target at all: Angular would throw on it, but only behind
 * `ngDevMode`, so it ships. Both are refused where a developer will see it.
 *
 * The other two describe an address that is *missing* from the localized layer and served at its
 * canonical spelling: an authored route the projection does not cover, and a projection entry
 * nothing renders. Each is worth saying and neither is worth refusing to start over, because the
 * application still serves every route it actually has, and a throw would make a reduced route
 * table, which is what a focused test provides, impossible to boot.
 */
const STRUCTURAL_PROBLEMS: ReadonlySet<LocalizedRouteTableProblem['kind']> =
  new Set(['unrenderable-branch-entry', 'parameter-mismatch']);

/**
 * One call in place of four.
 *
 * Wraps `provideRouter`, derives the locale branches from the route projection, installs the
 * localized `LocationStrategy` and the address sync, and absorbs `provideRouteLocalization`.
 *
 * **It provides `LocationStrategy` from inside, and that is Angular's own precedent rather than a
 * liberty.** `withHashLocation()` is `{provide: LocationStrategy, useClass: HashLocationStrategy}`
 * returned as a router feature, so Angular already claims this exact token from inside
 * `provideRouter`, silently, with no consumer line and no diagnostic. The token's default is itself
 * a root factory, which is what both that feature and a hand-written provider override. A
 * localization library that hands the consumer the class and makes them wire it does less than
 * Angular does two functions away.
 *
 * The escape hatch needs no design because it already exists: Equator's provider is registered
 * *before* `provideRouter`, so both a `withHashLocation()` passed here and a consumer's own
 * `{provide: LocationStrategy, …}` written after this call win on ordinary last-one-wins ordering.
 * Equator overrides nothing the consumer asked for. Visibility comes from a dev-mode assertion that
 * reads the actual DI outcome rather than from a line the consumer has to type and read.
 */
export function provideLocalizedRouter(
  routes: Routes,
  options: LocalizedRouterOptions = {},
  ...features: RouterFeatures[]
): EnvironmentProviders {
  // First, before any provider is built. Section 12 of
  // `specs/07-routing-rendering-and-seo.spec.md` requires a message whose inputs are not bound to be
  // refused where the declaration is built rather than where the page is visited, and this call is
  // where an application builds it. Deferred to a navigation, the failure is a title with its
  // placeholders showing, on one route, in whichever locale that route was first opened in.
  ɵlistOption(routes, 'The routes of provideLocalizedRouter');
  refuseOptionsOfAnotherKind(options);
  refuseUnboundDocumentMessages(options);
  // Here as well as where the integration is constructed, so the refusal is in the stack of the
  // call that wrote the option.
  refuseUndeclaredMode(options.mode);

  // `withRouterConfig` provides ROUTER_CONFIGURATION non-multi and `provideRouter` simply
  // concatenates every feature's providers, so a consumer passing their own replaces Equator's
  // entire config object: last one wins, no warning. Equator applies its own first and the
  // consumer's after, which is `provideRouter`'s own rule, and reports the replacement.
  //
  // The kind is read off a feature Equator constructs rather than written down. `RouterFeatureKind`
  // is a private const enum, and `ɵkind` is not unique per feature in Angular itself,
  // `withViewTransitions({})` and `ɵwithRouterResources()` both answer 9 on 22.1.3, so a scan for
  // repeated kinds would warn on a consumer passing those two, where nothing of Equator's is
  // replaced. This compares against one kind: the one Equator provides.
  const configuration = withRouterConfig(ROUTER_CONFIGURATION);
  const configurationReplaced = features.some(
    (feature) => feature.ɵkind === configuration.ɵkind,
  );

  return makeEnvironmentProviders([
    // Before `provideRouter`, deliberately. See the escape hatch above.
    {
      provide: LocationStrategy,
      useFactory: () =>
        new LocalizedLocationStrategy(servedAddressContext(options)),
    },
    // The second door into the matcher, and the reason the branches are back to being unmatched.
    //
    // `LocationStrategy` covers every address a browser supplies. It does not cover
    // `navigateByUrl`, which parses and matches directly, and that gap is what let a programmatic
    // localized navigation reach a locale branch: an entry built to name an address for the
    // prerender walk, carrying none of the route's guards, resolvers, data or title. This applies
    // the same delocalization there, so every address the matcher sees is canonical again whatever
    // its source.
    //
    // Before `provideRouter` for the same reason as the strategy above: Angular provides this
    // token from a root factory, so a consumer's own declared after this call still wins.
    {
      provide: UrlHandlingStrategy,
      useFactory: () =>
        new LocalizedUrlHandlingStrategy(servedAddressContext(options)),
    },
    provideRouter(canonicalBranch(routes, options), configuration, ...features),
    // A second `ROUTES` entry rather than a second argument, because the branches need the
    // projection and the projection only exists in DI. `Router.config` is
    // `inject(ROUTES)?.flat()`, so multi entries compose in provider order.
    //
    // **Canonical first, branches last, and ordering is a result rather than a constraint.**
    // Ordering becomes load-bearing in one direction, the one a wildcard makes visible: an
    // application with a `**` route has that wildcard inside the canonical branch, so
    // canonical-first lets the wildcard swallow a programmatic localized address before a branch
    // can match it. That needs such an address to reach the matcher at all, and none does:
    // `LocalizedUrlHandlingStrategy` delocalizes it and the branches decline anyway. So the
    // ordering is the one that reads correctly, the application's own routes first, and
    // `three-path-equality.spec.ts` boots a Router
    // with the branches registered ahead of these routes and asserts every arrival is identical,
    // which is what turns a future Angular that makes ordering matter into a visible failure
    // rather than a silent one.
    //
    // The branches are supplied exactly as the table built them. A resolver on a branch nothing
    // reaches cannot run, and a resolver that cannot run is a claim about behaviour nothing
    // exercises.
    //
    // `@angular/ssr` discovers prerenderable addresses by reading `Router.config` off a
    // bootstrapped injector, so a branch supplied this way is walked exactly as a static one is.
    {
      provide: ROUTES,
      multi: true,
      useFactory: () => [...inject(LOCALIZED_ROUTE_TABLE).branches],
    },
    {
      provide: LOCALIZED_ROUTE_TABLE,
      useFactory: () => {
        const { policy, projection } = declaredAddressContext();
        return localizedRouteTable(routes, policy, projection);
      },
    },
    {
      provide: RouteLocalization,
      useFactory: () => new RouteLocalization(options),
    },
    // While the root component bootstraps rather than in the resolver, because a navigation that
    // fails is a render that answers nothing, and `@angular/build` before 22.1.7 drops such a page
    // and reports success. A bootstrap that throws fails the build on every supported version.
    // Route discovery bootstraps no root component, so it never meets this.
    {
      provide: APP_BOOTSTRAP_LISTENER,
      multi: true,
      useFactory: () => refuseSharedFile(options),
    },
    provideEnvironmentInitializer(() => {
      // First, and unconditionally. Everything below reports; this one decides.
      refusePolicyAtConfiguration(declaredAddressContext(), options);
      refuseServerWithoutOrigin(options);
      reportTableProblems(inject(LOCALIZED_ROUTE_TABLE));

      // Reported, not prevented. A consumer who wants their own ROUTER_CONFIGURATION is making a
      // legitimate choice and nothing of Equator's breaks when they do: the one mode Equator
      // refuses, `urlUpdateStrategy: 'eager'`, is refused by `RouteLocalization` itself and throws.
      // What is not acceptable is that the replacement happens in silence.
      if (configurationReplaced && isDevMode()) {
        console.warn(
          `[Equator] provideLocalizedRouter() set ${JSON.stringify(ROUTER_CONFIGURATION)} and a router feature passed to it provides ROUTER_CONFIGURATION as well. Angular provides that token non-multi, so the feature you passed replaces Equator's configuration entirely.`,
        );
      }

      // The DI outcome, read rather than assumed, and read in the direction that actually breaks
      // localization: something else winning this token leaves every localized address unresolved.
      const installed = inject(LocationStrategy);
      if (isDevMode() && !(installed instanceof LocalizedLocationStrategy)) {
        console.warn(
          `[Equator] LocationStrategy is ${installed.constructor.name} rather than Equator's own, so localized addresses will not be translated and every one of them will resolve to nothing. A LocationStrategy provider declared after provideLocalizedRouter(), or a withHashLocation() passed to it, wins on ordinary provider ordering.`,
        );
      }

      // The same read for the other door, and it fails differently, which is why it gets its own
      // sentence rather than being folded into the one above. A foreign `LocationStrategy` breaks
      // every localized address at once and is impossible to miss. A foreign `UrlHandlingStrategy`
      // breaks nothing a browser does: the application looks correct, and only a programmatic
      // navigation to a prefixed address is affected. It reaches a locale branch that declines,
      // falls through to the application's own wildcard, and renders the not-found page. Naming
      // the class that won is the whole value of reading DI rather than trusting the wiring.
      const handling = inject(UrlHandlingStrategy);
      if (isDevMode() && !(handling instanceof LocalizedUrlHandlingStrategy)) {
        console.warn(
          `[Equator] UrlHandlingStrategy is ${handling.constructor.name} rather than Equator's own, so a programmatic navigation to a localized address is not delocalized. It will not reach the route it names: the locale branches decline, and the address falls through to whatever your route table answers last. A UrlHandlingStrategy provider declared after provideLocalizedRouter() wins on ordinary provider ordering.`,
        );
      }

      // The same read, for the token that decides who writes the title last. Unlike
      // `LocationStrategy`, a foreign strategy here is only a defect when the routes give it
      // something to write: `DefaultTitleStrategy` writes only when `buildTitle` finds a declared
      // title, so an application that declares none is unharmed and is not warned. That is why the
      // route tree is consulted rather than just the token: a warning that fires for every
      // application teaches people to ignore it.
      if (isDevMode() && declaresTitle(routes)) {
        const strategy = inject(TitleStrategy);
        if (!(strategy instanceof LocalizedTitleStrategy)) {
          console.warn(
            `[Equator] TitleStrategy is ${strategy.constructor.name} and your routes declare a title, so Angular writes that title after every navigation and replaces the localized one Equator wrote. Add {provide: TitleStrategy, useClass: LocalizedTitleStrategy} to your application providers. Equator does not claim this token itself, because Angular offers no router feature for it and an application may have set it deliberately.`,
          );
        }
      }

      // A `documentMetadata` key naming no route, read against the projection Equator generated.
      //
      // Silent otherwise, and silent in the worst way: the entry is simply never looked up, so the
      // route it was meant for falls through to whatever the dynamic callback says, or to nothing.
      // Renaming a route is what produces it, and a rename is exactly when nobody re-reads this map.
      if (isDevMode() && options.documentMetadata !== undefined) {
        const known = new Set(
          declaredAddressContext().projection.generated.routes.map(
            ({ id }) => id,
          ),
        );
        const unknown = Object.keys(options.documentMetadata).filter(
          (id) => !known.has(id),
        );
        if (unknown.length > 0) {
          console.warn(
            `[Equator] documentMetadata names ${unknown.map((id) => JSON.stringify(id)).join(', ')}, which no route in the projection declares, so ${unknown.length === 1 ? 'that entry describes' : 'those entries describe'} nothing. Known route ids: ${[...known].map((id) => JSON.stringify(id)).join(', ')}.`,
          );
        }
      }

      // Constructed eagerly, and it has to be. It subscribes to the Router's events in its
      // constructor, so a service first injected by something the first navigation builds has
      // already missed the navigation that built it. On a locale commit it is called rather than
      // observed, `RouteLocalization` hands it to the runtime's commit list, and that call
      // reaches this instance.
      inject(LocalizedAddressSync);
    }),
  ]);
}

/**
 * The authored routes under one pathless parent carrying the resolver.
 *
 * Pathless, so no authored address changes: a `{path: ''}` parent contributes no segment. It is
 * one attachment point rather than one per top-level route, and it keeps the `ActivatedRoute` depth
 * the removed `localizedRoutes()` already produced, so a component reading `route.parent` sees what
 * it saw before.
 *
 * `runGuardsAndResolvers: 'always'`, because the parent's own segments never change and the default
 * would run the resolver once and then never again.
 */
function canonicalBranch(
  routes: Routes,
  options: LocalizedRouterOptions,
): Routes {
  const parent: Route = {
    path: '',
    runGuardsAndResolvers: 'always',
    resolve: {
      equatorLocalization: resolveCanonicalRouteLocalization(options),
    },
    children: routes,
  };
  return [parent];
}

/**
 * Whether anything in the declared tree gives a `TitleStrategy` something to write.
 *
 * `title` may be a string or a `ResolveFn`; either way its presence is what makes `buildTitle`
 * return a value, so presence is all this asks about.
 *
 * Lazy children are not walked, and cannot be: `loadChildren` is a function whose routes do not
 * exist until it runs. So this under-reports: an application whose titles all live behind
 * `loadChildren` declares none here and is not warned. It is not the wrong answer to give at
 * startup, because the alternative is loading every lazy chunk to produce a warning. The
 * configuration that matters most is the one this does see: a title on an eager route.
 */
function declaresTitle(routes: Routes): boolean {
  return routes.some(
    (route) =>
      route.title !== undefined ||
      (route.children !== undefined && declaresTitle(route.children)),
  );
}

/**
 * Under a host policy, the origin this application answers at must be one the policy names.
 *
 * A host policy carries the locale in the origin, and the origin Equator resolves at is
 * `origin`: one value, fixed at configuration. Measured on both paths: making the policy name it
 * turns a failing prerender into a working one, and changing only its scheme turns a working one
 * back into two `malformed` resolutions and no output. So the two have to agree, and
 * when they do not, nothing about this application resolves: every address is answered at an origin
 * the policy does not know.
 *
 * **The shape that made this worth refusing was a build that looked fine.** The mismatch produced
 * two resolution errors, no per-route HTML, `Prerendered 2 static routes` on the console, a
 * `prerendered-routes.json` naming both routes, and exit `0`. Angular's half of that, exiting `0`
 * on a prerender that wrote no files, is angular/angular-cli#33965, fixed by `f1fd823` and released
 * in 22.1.7, where the same failure exits non-zero and counts only what it wrote. Equator's half is
 * this, and it holds whatever the builder does: the cause is not configurable.
 *
 * **What is not refused is the limit itself.** One build resolves at one origin, so one build
 * prerenders one origin's locale, and the head still advertises the addresses of the others:
 * addresses this build does not produce. That is a fact about serving many origins from a single
 * build, stated in the specification rather than thrown at a consumer who has done nothing wrong.
 */
function refuseHostOriginMismatch(
  policy: Extract<LocaleUrlPolicy, { kind: 'locale-host' }>,
  declared: string | undefined,
): void {
  const named = Object.keys(policy.origins);
  const list = named.map((origin) => JSON.stringify(origin)).join(', ');
  if (declared === undefined) {
    throw new LocalizationError({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: `A "locale-host" policy carries the locale in the origin, so provideLocalizedRouter() needs to be told which origin this build answers at: pass {origin: ...} naming one of ${list}. Without it every address resolves at the default locale's origin whatever host served the request, and a prerender writes nothing while the build still succeeds.`,
    });
  }
  // Compared as origins rather than as strings, so a trailing slash or a default port is not a
  // mismatch. The scheme is part of an origin and stays part of the comparison: it is the half a
  // reader skims past, and the half a comparison written by hand drops.
  let normalized: string | undefined;
  try {
    normalized = new URL(declared).origin;
  } catch {
    normalized = undefined;
  }
  if (normalized !== undefined && policy.origins[normalized] !== undefined)
    return;
  throw new LocalizationError({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
    message: `provideLocalizedRouter() was given {origin: ${JSON.stringify(declared)}}, which the "locale-host" policy does not name. Its origins are ${list}. Equator resolves every address at the configured origin, so an origin the policy does not know means no address resolves at all: at runtime every request answers 400, and a prerender writes no files while the build still reports success. The scheme is part of an origin: "https://example.com" and "http://example.com" are two different ones.`,
  });
}

/**
 * A page rendered on the server is published at an origin, and Equator must be told which.
 *
 * Every published URL is composed from the configured origin, which section 10 of
 * `specs/07-routing-rendering-and-seo.spec.md` takes from configuration and section 16 forbids
 * reading from the request. With none, a server render writes the page with no canonical link and
 * no `hreflang` alternates, and a prerender writes that page to disk while the build succeeds.
 * The page is what a crawler reads, and nothing on it says anything is missing. In the browser the
 * same application still has a switcher, which needs no origin, so only a server render refuses.
 * A host policy is refused for a missing origin before this, under every platform.
 */
function refuseServerWithoutOrigin(options: RouteLocalizationOptions): void {
  if (options.origin !== undefined || !isPlatformServer(inject(PLATFORM_ID))) {
    return;
  }
  throw new LocalizationError({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
    message:
      'provideLocalizedRouter() is rendering on the server with no {origin}, so every page it writes has no canonical link and no hreflang alternates, and a prerender writes those pages while the build succeeds. Pass {origin: "https://example.com"}, the origin this build is served at, with no path.',
  });
}

/**
 * Served, or refused by name. There is no third answer.
 *
 * `provideLocalizedRouter` accepted a policy without ever reading its `kind`, and a kind whose
 * addresses the adapter could not express produced an `unlocalizable-policy` problem on the
 * console: an application that half works, behind a warning nobody reads in production. What
 * "half works" means under each kind is worse than the warning says. So the
 * decision is made here, once, by name: every kind Equator serves is named, anything else is
 * refused with the reason, and a kind added to `LocaleUrlPolicy` later lands in this switch as a
 * type error rather than as a silent fourth outcome.
 *
 * All three kinds are served. The switch is not a filter, it is the statement that Equator has
 * decided about each of them, in a place a reader can check against the list.
 *
 * **It throws in production as well as development**, unlike the table problems below, and the
 * difference is deliberate. The case it exists for is a build: a prerender resolves every address
 * before any visitor does, and a refusal that only fires under `isDevMode()` would let exactly the
 * misconfiguration it names ship.
 */
function refusePolicyAtConfiguration(
  context: LocalizedAddressContext,
  options: RouteLocalizationOptions,
): void {
  const { policy } = context;
  switch (policy.kind) {
    case 'path-prefix':
    case 'locale-neutral':
      // Served, with nothing further to require: the strategies translate every spelling a
      // route has under either kind.
      return;
    case 'locale-host':
      refuseHostOriginMismatch(policy, options.origin);
      return;
  }
  // Exhaustive by construction. A member added to `LocaleUrlPolicy` fails to assign here, which is
  // the point: the next kind is decided rather than defaulted into being half served.
  //
  // A policy declared through `withRouting()` does not reach the throw below, because
  // `builtLocalePolicy` refuses an unknown `kind` before any router provider runs. A value provided
  // for `LOCALE_URL_POLICY` directly is read here as it stands, so for that one this is the
  // refusal.
  const unserved: never = policy;
  throw new LocalizationError({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
    message: `provideLocalizedRouter() does not serve a ${JSON.stringify((unserved as LocaleUrlPolicy).kind)} locale URL policy. Equator serves "path-prefix", "locale-neutral" and "locale-host".`,
  });
}

/**
 * Refuse a page a build would write once and serve to every visitor when its route says it must not.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 9. Decided from the route's classes and the
 * missing request, the same two facts `LocalizedPageOutcome.declare` refuses on, and never from a
 * render mode, which the section relays without interpreting. Every render ahead of a request
 * bootstraps once for its own address, so an entry of its own, a fallback and an application shell
 * all meet it.
 */
function refuseSharedFile(options: RouteLocalizationOptions): () => void {
  if (
    !isPlatformServer(inject(PLATFORM_ID)) ||
    inject(REQUEST, { optional: true }) !== null
  ) {
    return () => undefined;
  }
  // A strategy of the application's own leaves no localized address resolvable, and the startup
  // diagnostics report it.
  const strategy = inject(LocationStrategy);
  if (!(strategy instanceof LocalizedLocationStrategy)) return () => undefined;
  const { policy, projection } = declaredAddressContext();
  return () => {
    const address = strategy.externalPath(true);
    const resolution = resolveLocalizedRoute(address, policy, projection, {
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    });
    if (resolution.status !== 'success') return;
    const level =
      resolution.indexing === 'private' ? 'private' : resolution.caching;
    if (level !== undefined) {
      throw new LocalizationError({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: `Route ${resolution.routeId} at ${JSON.stringify(address)} is ${level}, and it is being rendered ahead of a request, which writes one file that is served to every visitor. Render this route on demand instead of prerendering it.`,
      });
    }
    // An address more than one locale spells has no locale until a request states a preference,
    // so it is per visitor whatever its route declares.
    if (resolution.variesBy === 'locale-preference') {
      throw new LocalizationError({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: `Route ${resolution.routeId} at ${JSON.stringify(address)} is spelled alike in more than one locale, so which locale it is in depends on the visitor, and it is being rendered ahead of a request, which writes one file that is served to every visitor. Render this route on demand instead of prerendering it, or give it a path of its own in each locale.`,
      });
    }
  };
}

/**
 * Every document message this application declared, checked against what each one takes.
 *
 * Both maps and every field of each, because the rule is about the declaration rather than about
 * where it was keyed: an outcome document with an unbound message writes the same unfilled title as
 * a route document with one.
 */
function refuseUnboundDocumentMessages(options: LocalizedRouterOptions): void {
  const declarations = [
    ...Object.values(options.documentMetadata ?? {}),
    ...Object.values(options.outcomeDocuments ?? {}),
  ];
  for (const declared of declarations) {
    for (const field of [
      declared.title,
      declared.description,
      declared.imageAlt,
      declared.siteName,
    ] as readonly (RouteDocumentField | undefined)[]) {
      if (field === undefined) continue;
      if (isBoundDocumentMessage(field)) {
        refuseUnboundDocumentMessage(field.message, field.inputs);
      } else {
        refuseUnboundDocumentMessage(field, undefined);
      }
    }
  }
}

function reportTableProblems(table: LocalizedRouteTable): void {
  if (table.problems.length === 0) return;
  const structural = table.problems.filter(({ kind }) =>
    STRUCTURAL_PROBLEMS.has(kind),
  );
  const summary = (problems: readonly LocalizedRouteTableProblem[]): string =>
    problems.map(({ message }) => `- ${message}`).join('\n');
  if (structural.length > 0 && isDevMode()) {
    throw new LocalizationError({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: `The localized route table cannot render what it declares:\n${summary(structural)}`,
    });
  }
  // Equator's first console write, and it is deliberate. There is no diagnostic sink for a
  // configuration fact discovered at startup: `LocalizationDiagnostic` describes a localization
  // failing for a visitor mid-navigation, and nothing observes one raised before the first. A
  // deployed application is not taken down over a table problem, so the alternative to the console
  // is silence.
  console.warn(
    `[Equator] The localized route table has problems:\n${summary(table.problems)}`,
  );
}
