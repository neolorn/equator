/**
 * Which of a route's scopes a navigation waits for, and which arrive beside it.
 *
 * `specs/06-runtime-and-angular.spec.md` section 9. Kept apart from the Router integration so the
 * rule is one function of the mode, the route's scopes and whether a view is already on screen,
 * which a test can call without a Router.
 */

import {
  LocalizationError,
  type LocaleChangeMode,
  type LocaleChangeOptions,
  type LocaleChangeResult,
  type LocalizationScope,
  type LocalizationSnapshot,
  type RouteRuntimeProjection,
  ɵlistOption,
  ɵrecordOption,
} from '@neolorn/equator/core';

/**
 * Refuses a mode the Router integration is configured with that is neither declared value.
 *
 * Read as a value of no known type, because the declared type is the caller's claim and a
 * configuration written without type checking makes none. Refused where the configuration is
 * given: left to the first navigation, every navigation fails on it and nothing says why until a
 * page is opened.
 */
export function refuseUndeclaredMode(mode: unknown): void {
  if (mode === undefined || mode === 'coordinated' || mode === 'progressive') {
    return;
  }
  throw new LocalizationError({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
    message:
      'The mode of the localized Router integration is coordinated or progressive.',
  });
}

/** One list of scopes held to a list of objects. */
function refuseScopesOfAnotherKind(scopes: unknown, name: string): void {
  // A copy, so an empty slot is read as the scope it is not.
  for (const scope of Array.from(ɵlistOption(scopes, name) as unknown[])) {
    ɵrecordOption(scope, `A scope in ${name}`);
  }
}

/**
 * Refuses options of the Router integration that are not of the kind their declaration names.
 *
 * Read as values of no known type, for the reason `refuseUndeclaredMode` gives. The options are an
 * object, each scope option is a list of scopes or a table of such lists by route, and the two
 * document tables are tables of objects. Refused where the configuration is given: read on a
 * navigation, a value of another kind throws an error that names no option, on every navigation.
 */
export function refuseOptionsOfAnotherKind(options: unknown): void {
  const given = ɵrecordOption(
    options,
    'The options of the localized Router integration',
  ) as Readonly<Record<string, unknown>>;
  for (const name of ['requiredScopes', 'progressiveScopes'] as const) {
    const scopes = given[name];
    if (scopes === undefined) continue;
    if (Array.isArray(scopes)) {
      refuseScopesOfAnotherKind(scopes, name);
      continue;
    }
    for (const [routeId, listed] of Object.entries(
      ɵrecordOption(scopes, name) as Readonly<Record<string, unknown>>,
    )) {
      refuseScopesOfAnotherKind(listed, `${name} of route ${routeId}`);
    }
  }
  for (const name of ['documentMetadata', 'outcomeDocuments'] as const) {
    const table = given[name];
    if (table === undefined) continue;
    for (const [key, declared] of Object.entries(
      ɵrecordOption(table, name) as Readonly<Record<string, unknown>>,
    )) {
      ɵrecordOption(declared, `${name} of ${key}`);
    }
  }
}

const NONE: readonly LocalizationScope[] = Object.freeze([]);

/**
 * The scopes the generated route table says a route brings in.
 *
 * None for a route the table lists without any: generation leaves the field out where the first
 * render already carries everything the route reads.
 */
export function derivedScopes(
  projection: RouteRuntimeProjection,
  routeId: string,
): readonly LocalizationScope[] {
  const entry = projection.generated.routes.find(({ id }) => id === routeId);
  return entry?.scopes ?? NONE;
}

/** What a navigation is deciding from. */
export interface NavigationScopeInput {
  /** The mode the integration was configured with. */
  readonly mode: LocaleChangeMode;
  /** Whether a navigation has landed, so a view is on screen for this one to replace. */
  readonly landed: boolean;
  /** The scopes the generated route table lists for the route. */
  readonly derived: readonly LocalizationScope[];
  /** The scopes the application named for the route as required. */
  readonly required: readonly LocalizationScope[];
  /** The scopes the application named for the route as progressive. */
  readonly progressive: readonly LocalizationScope[];
}

/** A route's scopes, split by whether the navigation waits for them. */
export interface NavigationScopes {
  /** Loaded before the navigation completes. */
  readonly held: readonly LocalizationScope[];
  /** Loaded while the navigation completes, and published when they arrive. */
  readonly alongside: readonly LocalizationScope[];
}

function mergeScopes(
  ...groups: readonly (readonly LocalizationScope[])[]
): readonly LocalizationScope[] {
  const merged = new Map<string, LocalizationScope>();
  for (const group of groups) {
    for (const scope of group) {
      merged.set(`${scope.providerId}\u0000${scope.scopeId}`, scope);
    }
  }
  return Object.freeze([...merged.values()]);
}

export function navigationScopes(
  input: NavigationScopeInput,
): NavigationScopes {
  // A scope named as progressive arrives beside a navigation because the page before it stays on
  // screen meanwhile. Before the first navigation has landed there is no such page: a server
  // render or a prerender would end without the scope, and the first render in a browser would
  // draw without it. A coordinated change commits once everything the view renders is ready, so
  // there the navigation waits for the scope as well. Section 9 of
  // `specs/06-runtime-and-angular.spec.md` requires both.
  const alongside = input.landed && input.mode === 'progressive';
  return Object.freeze({
    held: mergeScopes(
      input.derived,
      input.required,
      alongside ? NONE : input.progressive,
    ),
    alongside: alongside ? input.progressive : NONE,
  });
}

/** What putting a page back reads and asks of the localization context. */
export interface PageLeftLocalization {
  snapshot(): LocalizationSnapshot | undefined;
  changeLocale(
    locale: string,
    options?: LocaleChangeOptions,
  ): Promise<LocaleChangeResult>;
  ensureScope(scope: LocalizationScope): Promise<void>;
}

/** A navigation that committed its locale and did not arrive, or arrived and could not be written. */
export interface NavigationLeft {
  /** The mode the integration was configured with. */
  readonly mode: LocaleChangeMode;
  /** The snapshot from before the navigation committed. Absent, there is no page to put back. */
  readonly previousSnapshot: LocalizationSnapshot | undefined;
  /** The locale the navigation committed. */
  readonly navigationLocale: string;
}

/**
 * Puts back the route and the scopes of the page a navigation left, and answers whether it did.
 *
 * The navigation's own commit is undone, so the locale is the one from before it. A change made in
 * place after that commit is another transaction: it committed, it told its caller so, and it was
 * answered for the page on screen because the navigation could still end without arriving. Section
 * 7 of `specs/07-routing-rendering-and-seo.spec.md` lets that locale stand, so the page is put
 * back in whatever locale is committed where that is not the navigation's.
 *
 * One function for every way a navigation ends without its page, so a navigation that is cancelled,
 * one that fails and one whose document cannot be written all leave the same locale. The route
 * record is the snapshot's, which names its address in the snapshot's locale. Put back in another
 * locale, the commit's own head step re-resolves the page for it and restates the record, as it
 * does for any change made in place.
 */
export async function putBackPageLeft(
  localization: PageLeftLocalization,
  left: NavigationLeft,
): Promise<boolean> {
  const snapshot = left.previousSnapshot;
  if (snapshot === undefined) return false;
  const committed = localization.snapshot()?.primaryLocale;
  const result = await localization.changeLocale(
    committed === undefined || committed === left.navigationLocale
      ? snapshot.primaryLocale
      : committed,
    {
      mode: left.mode,
      requiredScopes: snapshot.requiredScopes,
      route: snapshot.route ?? null,
    },
  );
  if (result.status !== 'committed') return false;
  const required = new Set(
    snapshot.requiredScopes.map(
      ({ providerId, scopeId }) => `${providerId}\u0000${scopeId}`,
    ),
  );
  try {
    for (const scope of snapshot.loadedScopes) {
      if (required.has(`${scope.providerId}\u0000${scope.scopeId}`)) continue;
      await localization.ensureScope(scope);
    }
    return true;
  } catch {
    return false;
  }
}
