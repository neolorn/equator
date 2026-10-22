import {
  APP_BASE_HREF,
  PathLocationStrategy,
  PlatformLocation,
} from '@angular/common';
import { Injector, RESPONSE_INIT, inject } from '@angular/core';
import { UrlSerializer } from '@angular/router';
import {
  Localization,
  resolveLocalizedRoute,
  toExternalPath,
  toInternalPath,
  withBasePath,
  withoutBasePath,
  type LocalizedAddressContext,
} from '@neolorn/equator';

import {
  LANGUAGE_FIELD,
  addVaryField,
  restoreHeader,
  setHeader,
} from './response-headers.js';
import { LocalizedRouteParameters } from './route-parameters.js';

/**
 * One strategy over a constant base href, implementing both halves of the translation.
 *
 * The base href stays constant, and that is settled rather than deferred. `Location` computes
 * `_basePath` once in its constructor and `path()` strips that frozen value, so a base href that
 * varied per locale would be read once and then be wrong. Angular's own i18n answer is a
 * build-time base href per locale; Equator's is one build whose locale lives in the path.
 *
 * `RouterLink` never calls `prepareExternalUrl` (its click navigates the raw, unprepared tree)
 * and the design does not need it to. The click hands the Router a canonical address, which is a
 * real authored route, so it matches directly, and the history write that follows goes through
 * `pushState` and comes out localized.
 */
/** The statuses `@angular/ssr` sends a redirect with. */
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export class LocalizedLocationStrategy extends PathLocationStrategy {
  private readonly localization = inject(Localization);
  /**
   * Resolved on first use, and that is forced rather than chosen.
   *
   * This strategy is constructed from inside the Router's own dependency graph (`Router` needs
   * `Location`, which needs `LocationStrategy`) so naming anything here that needs the `Router`
   * closes the cycle, and Angular reports `NG0200` at bootstrap. Measured, not predicted: adding
   * `inject(LocalizedRouteParameters)` as a field failed six spec files that way.
   *
   * Deferring is sound rather than a way around the message. Nothing asks this strategy to prepare
   * an address until the Router is navigating, and by then the Router exists.
   */
  private readonly injector = inject(Injector);
  private parametersRef: LocalizedRouteParameters | undefined;
  private serializerRef: UrlSerializer | undefined;
  private readonly context: LocalizedAddressContext;
  private readonly platform = inject(PlatformLocation);
  // Present only while a request is rendered on the server, where the engine answers an address
  // that moved during the render with a redirect whose status it reads from here.
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });
  /**
   * The address the request named, as shown and as routing reads it, and the page it names, while
   * a request is rendered.
   */
  private readonly arrival:
    | {
        readonly shown: string;
        readonly external: string;
        readonly page: string;
      }
    | undefined;
  /** What the render held before this strategy stated a redirect, while one is stated. */
  private stated:
    | {
        readonly previous: number | undefined;
        readonly headers: readonly (readonly [string, string | null])[];
      }
    | undefined;

  constructor(context: LocalizedAddressContext) {
    super(
      inject(PlatformLocation),
      inject(APP_BASE_HREF, { optional: true }) ?? undefined,
    );
    this.context = context;
    this.arrival =
      this.responseInit === null
        ? undefined
        : {
            shown: this.shown(),
            external: this.externalPath(true),
            page: toInternalPath(this.externalPath(true), context),
          };
  }

  override pushState(
    state: unknown,
    title: string,
    url: string,
    queryParams: string,
  ): void {
    super.pushState(state, title, url, queryParams);
    this.stateCorrection(url, queryParams);
  }

  override replaceState(
    state: unknown,
    title: string,
    url: string,
    queryParams: string,
  ): void {
    super.replaceState(state, title, url, queryParams);
    this.stateCorrection(url, queryParams);
  }

  override path(includeHash = false): string {
    return this.withBase(
      toInternalPath(this.externalPath(includeHash), this.context),
    );
  }

  /**
   * The address as it arrived, in the form `resolveLocalizedRoute` reads.
   *
   * Read from here rather than rebuilt from `PlatformLocation`, because the base href this strips
   * is the one Angular settled for this strategy, and the Router's first navigation starts from the
   * same reading.
   */
  externalPath(includeHash = false): string {
    return this.withoutBase(super.path(includeHash));
  }

  /**
   * The declared spellings are read here as well as in the head, and for the same page.
   *
   * A route whose parameter is a loaded slug has no derivable spelling, so without the declaration
   * this writes the address the codec can produce, which after a locale switch is the previous
   * language's. The head would then carry one address for the page and the address bar another.
   */
  override prepareExternalUrl(internal: string): string {
    return super.prepareExternalUrl(
      toExternalPath(
        internal,
        this.activeLocale(),
        this.context,
        this.declaredSpellings(),
      ),
    );
  }

  /**
   * States the status of the redirect a render is about to become, when this strategy moved it.
   *
   * `@angular/ssr` answers a render whose address moved with a redirect, and a move that keeps the
   * page is this strategy's own: the Router writing the canonical spelling of an address it was
   * handed another way, or a page's declared spelling replacing the codec's. That is a canonical
   * correction or a declared replacement, which section 5 of
   * `specs/07-routing-rendering-and-seo.spec.md` answers with 308, unless the address the request
   * named states no locale. Then the move is locale entry, spelled in the locale the render chose
   * from the request, and the same section answers it with 307, private and revalidated before
   * every reuse, naming the language field in `Vary`. That is classified by routing rather than
   * here, so a render and the request handler cannot disagree about which move is which.
   *
   * A move to another page is the application's router redirecting, and its status stays the
   * application's. The addresses are compared the way the engine compares them, so no status is
   * stated for a move it does not count, which would go out on the page itself.
   */
  private stateCorrection(url: string, queryParams: string): void {
    const init = this.responseInit;
    const arrival = this.arrival;
    if (init === null || arrival === undefined) return;
    const query =
      queryParams.length > 0 && !queryParams.startsWith('?')
        ? `?${queryParams}`
        : queryParams;
    const samePage = this.read(`${url}${query}`) === this.read(arrival.page);
    const moved = this.read(this.shown()) !== this.read(arrival.shown);
    if (samePage && moved) {
      if (this.stated === undefined && !REDIRECTS.has(init.status ?? 0)) {
        const previous = init.status;
        const entry = this.isLocaleEntry(arrival.external);
        init.status = entry ? 307 : 308;
        // The lifetime of a correction is the deployment's, which section 16 of the routing
        // specification leaves to the host. Entry has none: it is private and revalidated whatever
        // the deployment chose. Every server render reads the language field, and RFC 9110 section
        // 12.5.5 has `Vary` name each field that might have chosen the answer.
        const headers: (readonly [string, string | null])[] = entry
          ? [
              [
                'cache-control',
                setHeader(init, 'cache-control', 'private, no-cache'),
              ],
              ['vary', addVaryField(init, LANGUAGE_FIELD)],
            ]
          : [];
        this.stated = { previous, headers };
      }
    } else if (!moved && this.stated !== undefined) {
      const { previous, headers } = this.stated;
      if (previous === undefined) delete init.status;
      else init.status = previous;
      for (const [name, value] of headers) restoreHeader(init, name, value);
      this.stated = undefined;
    }
  }

  /** Whether routing reads the address the request named as locale entry. */
  private isLocaleEntry(external: string): boolean {
    const resolution = resolveLocalizedRoute(
      external,
      this.context.policy,
      this.context.projection,
      this.context.origin === undefined ? {} : { origin: this.context.origin },
    );
    return (
      resolution.status === 'redirect' && resolution.reason === 'locale-entry'
    );
  }

  /** The address shown, without a trailing slash, as `@angular/ssr` compares one. */
  private shown(): string {
    const { pathname, search, hash } = this.platform;
    const path =
      pathname.length > 1 && pathname.endsWith('/')
        ? pathname.slice(0, -1)
        : pathname;
    return `${path}${search}${hash}`;
  }

  /** An address as the Router reads it, so two spellings of one address compare equal. */
  private read(address: string): string {
    this.serializerRef ??= this.injector.get(UrlSerializer);
    return this.serializerRef.serialize(this.serializerRef.parse(address));
  }

  private declaredSpellings(): ReturnType<LocalizedRouteParameters['current']> {
    this.parametersRef ??= this.injector.get(LocalizedRouteParameters);
    return this.parametersRef.current();
  }

  /** Read live on every call: the address bar has to speak whatever locale is committed now. */
  private activeLocale(): string {
    return (
      this.localization.snapshot()?.primaryLocale ??
      this.context.policy.defaultLocale
    );
  }

  private withoutBase(url: string): string {
    return withoutBasePath(url, this.getBaseHref());
  }

  private withBase(url: string): string {
    return withBasePath(url, this.getBaseHref());
  }
}
