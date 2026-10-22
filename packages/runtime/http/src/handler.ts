// Equator builds the response and the application supplies the body, which is
// `specs/07-routing-rendering-and-seo.spec.md` section 5. A handler that only set headers could
// not answer a redirect, an unsupported locale or a malformed target, and those are the outcomes
// that must never reach a renderer; a handler that produced the body would have to know what a
// page looks like. So the status is Equator's, the body is the renderer's, and section 15 of
// `specs/07-routing-rendering-and-seo.spec.md` is what keeps a 404 in the requested locale at
// the requested address rather than redirecting it somewhere that renders.

// Relative, not `@neolorn/equator`.
//
// A secondary entry point that imports the primary keeps that import in its own bundle, and the
// primary is the thing that throws on import in plain Node. So the classification lives inside this
// entry point's graph rather than beside it, and the primary re-exports it from here. That is the
// layering the right way up: the base does not depend on the integration.
import {
  LocalizationError,
  allowedLocaleHosts,
  builtLocalePolicy,
  canonicalizeLanguageTag,
  negotiateLocale,
  pageOutcomeHttpDescriptor,
  parseAcceptLanguage,
  resolveLocalizedRoute,
  routeCacheHeaders,
  routeHttpDescriptor,
  validateRouteProjection,
  ɵassertStorableCookie,
  type ɵCookieAttributes,
  ɵopenPageOutcomeChannel,
  ɵnamedOption,
  ɵrecordOption,
  ɵtakePageOutcome,
  type DeclaredPageOutcomeDescriptor,
  type GeneratedConfiguration,
  type LocalePreferenceSource,
  type LocaleUrlPolicy,
  type PageOutcomeDeclaration,
  type PageOutcomeOperationalFailure,
  type RouteCacheDurations,
  type RouteCacheHeaders,
  type RouteHttpDescriptor,
  type RouteResolution,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

import { rawTargetOf } from './raw-target';

/**
 * How this deployment remembers a visitor's choice, or that it does not.
 *
 * `false` is a real answer rather than an omission: a deployment that negotiates from
 * `Accept-Language` alone is shared-cacheable per language, and one that reads a cookie is not.
 * Which of those it is decides what a CDN may do with every page of the site, so it is stated.
 */
export type LocaleCookiePolicy =
  | false
  | {
      readonly name?: string;
      readonly path?: string;
      readonly maxAgeSeconds?: number;
      readonly sameSite?: 'Lax' | 'Strict' | 'None';
      readonly secure?: boolean;
      readonly domain?: string;
    };

/**
 * The outcomes that have a body, which are the only ones a renderer is asked about.
 *
 * Narrowed rather than left as the full union, because the handler already guarantees it: `render`
 * is called only behind `hasBody`. A renderer typed against every resolution has to re-check what
 * the handler has already decided, and the check it writes is the one that goes stale: a redirect
 * has no `presentationLocale`, and nothing but the type stops a consumer reaching for it.
 *
 * A redirect and a malformed target are both excluded, and from the renderer's side for the same
 * reason: neither is an outcome with a presentation. A redirect's answer is its location, and a
 * malformed target has been refused, so asking an application to draw a page for either is asking
 * it to draw something that does not exist.
 *
 * *Stated as an exclusion, not as a list of the statuses that have bodies.* The obvious
 * spelling (`Extract<RouteResolution, { status: 'success' | 'not-found' | 'gone' }>`) silently
 * drops `not-found`, because one member of the union carries
 * `status: 'unsupported-locale' | 'not-found'` and a member whose discriminant is itself a union is
 * not assignable to a narrower one. It compiles, it looks exhaustive, and the resulting guard claims
 * a type the runtime does not honour. A redirect is the thing that genuinely has no body, so that is
 * what the type says.
 */
export type RenderableResolution = Exclude<
  RouteResolution,
  { readonly status: 'redirect' | 'malformed' }
>;

/** What the handler resolved, handed to the renderer when there is something to render. */
export interface LocaleRequestOutcome {
  /** The request as it arrived, so a renderer can read a header Equator had no reason to. */
  readonly request: Request;
  /**
   * What the address resolved to: the route, its parameters, and the status the response carries.
   *
   * A redirect is excluded by the type, because the handler answers those itself.
   */
  readonly resolution: RenderableResolution;
  /**
   * The locale this response is in, which is what the document should be rendered in.
   *
   * It is the locale `Content-Language` names on the response. At a missing or removed page under a
   * prefix or an origin the policy serves it is that locale. For an address that names no locale
   * the policy serves and no preference that could be honoured, it is the policy's default rather
   * than nothing, so a renderer always has a language to write in.
   */
  readonly locale: string;
}

/**
 * A renderer's answer that states the outcome as well as producing the document.
 *
 * Section 5 of `specs/07-routing-rendering-and-seo.spec.md` keeps three outcome classes apart, and
 * two of them depend on facts an address cannot supply: whether the entity is absent, whether it
 * was permanently removed, and whether the render failed. A renderer states any of the three here,
 * and a page states the same three from inside the render through `LocalizedPageOutcome` in
 * `@neolorn/equator/router`. One type carries both, because they differ only in where the
 * declaration is made.
 *
 * *The wrapper is the declaration.* A renderer's plain `Response` also carries a status, and
 * reading that as a statement would make an accidental 500 and a deliberate one the same signal,
 * which section 5 forbids for exactly that reason. Wrapping is the act that separates them.
 */
export interface DeclaredPageOutcome {
  /** What is being stated about this render: an absence, a removal, or a failure. */
  readonly pageOutcome: PageOutcomeDeclaration;
  /**
   * The document to send with it, when the renderer produced one.
   *
   * Omitted for a declaration with nothing to draw, which answers the status and the headers and
   * no body.
   */
  readonly response?: Response;
}

/**
 * A response whose status the application is stating for itself.
 *
 * The operational arm of `DeclaredPageOutcome`, kept as its own type and its own function because
 * it is what a renderer declaring maintenance or a failed load already writes. The response's own
 * status is the one declared.
 */
export interface DeclaredOperationalFailure extends DeclaredPageOutcome {
  /** The response to send, whose own status is the one being declared. */
  readonly operationalFailure: Response;
  /** Narrowed: this arm always states a failure rather than an absence or a removal. */
  readonly pageOutcome: PageOutcomeOperationalFailure;
  /** Always present here, and the same object as `operationalFailure`. */
  readonly response: Response;
}

/**
 * States an outcome the address could not have supplied, with or without a document for it.
 *
 * ```ts
 * render: async (outcome) => {
 *   const article = await articles.load(outcome.resolution.parameters['slug']);
 *   if (article === undefined) return declarePageOutcome(pageAbsent(), notFoundDocument());
 *   return render(article);
 * };
 * ```
 *
 * The declaration is honoured at an address Equator serves. At one it refuses, the refusal stands
 * and the declaration is reported where a developer will see it.
 */
export function declarePageOutcome(
  pageOutcome: PageOutcomeDeclaration,
  response?: Response,
): DeclaredPageOutcome {
  return Object.freeze(
    response === undefined ? { pageOutcome } : { pageOutcome, response },
  );
}

/**
 * Declares the response's own status rather than letting the address's status stand.
 *
 * ```ts
 * render: () =>
 *   declareOperationalFailure(
 *     new Response(maintenanceDocument, {
 *       status: 503,
 *       headers: { 'retry-after': '600', 'content-type': 'text/html' },
 *     }),
 *   );
 * ```
 *
 * The declaration is honoured at an address Equator serves. At one it refuses, the refusal stands
 * and the declaration is reported where a developer will see it, because an application declaring
 * maintenance does not know which addresses Equator refused and cannot be asked to.
 */
export function declareOperationalFailure(
  response: Response,
): DeclaredOperationalFailure {
  return Object.freeze({
    operationalFailure: response,
    response,
    pageOutcome: Object.freeze({
      outcome: 'operational-failure',
      // Read off the response rather than taken as a second argument, because the response already
      // carries the status being declared and a second place to state it is a second answer.
      status: response.status,
    }),
  });
}

/**
 * What a renderer may return: the document, or the document with an outcome declared for it.
 *
 * A union rather than a replacement for `Response`. A renderer that returns one keeps working
 * exactly as it did, and it is also the honest shape: declaring an outcome is the uncommon case
 * and it should look like one at the call site.
 */
export type LocalizedRenderResult = Response | DeclaredPageOutcome;

/**
 * Produces the document. Called only for outcomes that have a body.
 *
 * A 304 or a redirect it returns keeps its status and is sent without content, because neither is an
 * answer about the address.
 */
export type LocaleRenderer = (
  outcome: LocaleRequestOutcome,
) => LocalizedRenderResult | Promise<LocalizedRenderResult>;

/**
 * What the handler decided for one request, for the seat that answers through it.
 *
 * Internal. Section 12 of `specs/06-runtime-and-angular.spec.md` requires the server seat in
 * `@neolorn/equator/testing` to answer through this handler rather than through a second
 * implementation of its rules, and two of the things a test needs to know are not in the response:
 * whether a 404 came from the table or from a page declaring an absence, and whether a declaration
 * was carried at all. The handler reports what it decided instead of the seat deriving it again.
 */
export interface ɵAnsweredRequest {
  /** The request the handler answered, which is the key the declaration channel is held under. */
  readonly request: Request;
  /** What the address resolved to, including the outcomes that never reach a renderer. */
  readonly resolution: RouteResolution;
  /** The locale the renderer was told to draw in, absent where no renderer was called. */
  readonly locale: string | undefined;
  /** What the page or the renderer stated, absent where neither did. */
  readonly declared: PageOutcomeDeclaration | undefined;
  /** Whether that declaration decided the response, which section 5's narrow rule settles. */
  readonly carried: boolean;
  /**
   * Whether Equator declined the address, which sends it to `passthrough` rather than to a route.
   */
  readonly declined: boolean;
}

/**
 * What a locale request handler needs to answer a request.
 *
 * The first four are required because a wrong default in any of them is a wrong response rather
 * than a missing feature: a handler that guessed the address shape, the route set or the cache
 * lifetimes would be serving something, and what it served would be plausible.
 */
export interface LocaleRequestHandlerOptions {
  /** How locale appears in an address, and which locale an address that names none is in. */
  readonly policy: LocaleUrlPolicy;
  /** The routes this deployment serves, which decides whether an address exists at all. */
  readonly projection: RouteRuntimeProjection;
  /**
   * The build's own locale set, so a policy naming a locale this build did not generate publishes
   * no address for it. Optional only because a consumer may not have one to hand; supplying it is
   * the correct thing to do and the fixture does.
   */
  readonly configuration?: GeneratedConfiguration;
  /**
   * How long each class of response may be held, and by whom.
   *
   * Read together with the cookie policy, which decides whether a shared cache may keep any of it
   * at all, so a deployment that remembers a choice is not served another visitor's language. A
   * `pageCaching` that is neither of its two classes is refused where the handler is made.
   */
  readonly cache: RouteCacheDurations;
  /**
   * How a visitor's choice is remembered, or `false` for a deployment that does not remember one.
   *
   * Omitting it takes the defaults, which do remember. It is the setting with the widest reach
   * here: it decides what every response at every address may be cached as.
   */
  readonly cookie?: LocaleCookiePolicy;
  /**
   * Produces the document. Without it the handler answers the status and the headers and no body,
   * which is the right shape for a deployment that puts Equator in front of something else that
   * renders.
   */
  readonly render?: LocaleRenderer;
  /**
   * What serves an address Equator declined to localize.
   *
   * Static assets and the policy's own locale-neutral roots reach here. Without it they answer 404,
   * which is honest, Equator will not invent a response for something it has decided is not its
   * business, but a real deployment hands them to whatever serves files.
   */
  readonly passthrough?: (request: Request) => Response | Promise<Response>;
  /**
   * Internal. Called once per request with what the handler decided, for the testing server seat.
   *
   * Not a hook for a deployment to write against: it reports rather than decides, it is called
   * after the answer is settled, and what it carries is the handler's own working.
   */
  readonly ɵobserve?: (answered: ɵAnsweredRequest) => void;
}

/**
 * Answers one request: takes a Fetch `Request` and gives back the response to send.
 *
 * It never throws for an address it does not recognize. An address outside the policy goes to
 * `passthrough` or answers 404, and an unsupported locale answers at the address it was asked for
 * rather than being moved somewhere that renders.
 */
export type LocaleRequestHandler = (request: Request) => Promise<Response>;

const ONE_YEAR_SECONDS = 31_536_000;

/**
 * Builds the handler that decides a response's status, language, caching and redirect.
 *
 * Takes the policy, the routes, the cache lifetimes and the cookie policy, and returns a function
 * from a request to a response. The status is Equator's and the body is the renderer's, so a
 * redirect, an unsupported locale and a malformed address are all answered without a renderer
 * being asked anything.
 *
 * Call it once at start-up. It reads the options then, and the cookie policy in particular decides
 * how every response may be cached, so a per-request handler would be deciding that per request.
 */
export function createLocaleRequestHandler(
  options: LocaleRequestHandlerOptions,
): LocaleRequestHandler {
  ɵrecordOption(options, 'The options of createLocaleRequestHandler');
  ɵrecordOption(options.cache, 'cache');
  // Held to its two classes here, so a floor nobody declared is refused where the handler is made
  // and not by each request that reaches a page.
  if (options.cache.pageCaching !== undefined) {
    ɵnamedOption(
      options.cache.pageCaching,
      ['per-visitor', 'not-stored'],
      'pageCaching',
    );
  }
  // Checked where the handler is made, and not by the first request that reads a route.
  validateRouteProjection(options.projection);
  const policy =
    options.configuration === undefined
      ? options.policy
      : builtLocalePolicy(options.policy, options.configuration);
  // Read once here, so a policy written out with tables no constructor writes is refused where the
  // handler is made, and no request reads a table before the policy has been held to them.
  allowedLocaleHosts(policy);
  const cookie =
    options.cookie === false
      ? false
      : options.cookie === undefined
        ? {}
        : ɵrecordOption(options.cookie, 'cookie');
  // The attributes are settled once, so the cookie that is checked is the cookie that is written.
  const stored =
    cookie === false
      ? undefined
      : Object.freeze({
          name: cookie.name ?? 'equator-locale',
          path: cookie.path ?? '/',
          domain: cookie.domain,
          maxAgeSeconds: cookie.maxAgeSeconds ?? ONE_YEAR_SECONDS,
          sameSite: cookie.sameSite ?? 'Lax',
          secure: cookie.secure ?? true,
        });
  if (stored !== undefined) {
    ɵassertStorableCookie('createLocaleRequestHandler', stored);
  }

  // Derived from what this deployment reads, never from what this request happened to carry.
  //
  // This is 6.1's defect one level up, and it is easy to write by accident: a request arriving
  // without a cookie was negotiated from `Accept-Language`, so deriving the source per request
  // would mark that response shared-cacheable per language, and it shares an address with the
  // responses that were decided by a cookie. A deployment that reads cookies at all has cookie-
  // varying responses at every address that varies, whoever happens to be asking.
  const localePreference: LocalePreferenceSource =
    stored === undefined ? 'accept-language' : 'cookie';

  // Per handler rather than per module, so one deployment's warnings cannot silence another's,
  // and per process rather than per request, because a declaration at a refused address is a
  // defect in how the renderer was written and repeating it once a request reports nothing new.
  const reported = new Set<string>();

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const carried =
      stored === undefined
        ? undefined
        : readCookie(request.headers.get('cookie'), stored.name);
    // A signal that names a locale this build does not serve says nothing, so negotiation carries
    // on to the next one: a remembered choice of a removed locale must not turn an address that
    // exists into a 404, and a visitor whose first language is not served still has a second.
    const preferred =
      servedLocale(policy, carried) ??
      negotiateLocale(
        parseAcceptLanguage(request.headers.get('accept-language') ?? ''),
        Object.keys(policy.locales),
        canonicalTag,
      );

    // The target as it arrived, when this entry point's own adapter built the request. A `Request`
    // carries a parsed URL, and parsing one resolves dot segments and rewrites a backslash, so the
    // path on it is not always what was asked for. The origin is the one the adapter put on the
    // request, which under a host policy is what names the locale.
    const resolution = resolvedOrCodecFailure(() =>
      resolveLocalizedRoute(
        rawTargetOf(request) ?? `${url.pathname}${url.search}`,
        policy,
        options.projection,
        {
          origin: url.origin,
          ...(preferred === undefined ? {} : { locale: preferred }),
        },
      ),
    );
    if (resolution instanceof LocalizationError) {
      // The address was never read, so it is neither a page nor a missing one. What failed is the
      // consumer application's own code, as a render that drew nothing is, and it is answered as
      // that render is: the same status, kept out of every cache.
      reportCodecFailure(reported, resolution.diagnostic.message);
      const failed = pageOutcomeHttpDescriptor(RENDER_FAILED, UNRESOLVED);
      return new Response(null, {
        status: failed.status,
        headers: {
          ...routeCacheHeaders(
            { ...UNRESOLVED, cache: failed.cache },
            { ...options.cache, localePreference },
          ),
        },
      });
    }

    // Classified before anything dispatches on it, which is the order
    // `specs/07-routing-rendering-and-seo.spec.md` section 4 states: the target is validated, then
    // a locale-neutral root reaches its owner, then presentation routing. A bypassed address is
    // not exempt from the first step, because `/assets/%2e%2e/%2e%2e/etc/passwd` is not an asset
    // request, and handing it to whatever serves files is the one thing that must not happen.
    if (resolution.status !== 'malformed' && bypasses(url, policy)) {
      // Declined, not rendered. A bypassed address is one Equator has decided is not about locale
      // (a static asset, a health check, an upload root) and rendering the application's page for
      // `/main-A1B2C3.js` would be worse than answering nothing. The consumer's own handling is
      // what should serve it, so `passthrough` is where it goes and a 404 is what happens when
      // there is none.
      options.ɵobserve?.({
        request,
        resolution,
        locale: undefined,
        declared: undefined,
        carried: false,
        declined: true,
      });
      return (
        options.passthrough?.(request) ?? new Response(null, { status: 404 })
      );
    }
    const descriptor = routeHttpDescriptor(resolution);
    const settled = settledLocale(resolution);

    // Taken as an argument rather than read from the outer descriptor, because a declared outcome
    // changes the status, the caching and the indexing of the response and nothing else about it,
    // and which of those apply is known only after the renderer has answered.
    const cacheHeaders = (
      effective: DeclaredPageOutcomeDescriptor,
      page?: Headers,
    ): Headers => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(
        routeCacheHeaders(
          { ...descriptor, cache: effective.cache },
          { ...options.cache, localePreference },
          page === undefined ? undefined : pageCacheHeaders(page),
        ),
      )) {
        headers.set(name, value);
      }
      return headers;
    };
    const responseHeaders = (
      effective: DeclaredPageOutcomeDescriptor,
      page?: Headers,
    ): Headers => {
      const headers = cacheHeaders(effective, page);
      if (effective.contentLanguage !== undefined) {
        headers.set('content-language', effective.contentLanguage);
      }
      if (effective.robots !== undefined) {
        headers.set('x-robots-tag', effective.robots);
      }
      if (effective.location !== undefined) {
        headers.set('location', effective.location);
      }
      // Only when there is something new to remember, and only when a person asked for it.
      if (
        stored !== undefined &&
        settled !== undefined &&
        settled !== carried &&
        !isBackgroundRequest(request)
      ) {
        headers.append('set-cookie', serializeCookie(stored, settled));
      }
      return headers;
    };

    if (!hasBody(resolution) || options.render === undefined) {
      options.ɵobserve?.({
        request,
        resolution,
        locale: settled,
        declared: undefined,
        carried: false,
        declined: false,
      });
      return new Response(null, {
        status: descriptor.status,
        headers: responseHeaders(descriptor),
      });
    }
    // A server evaluates a precondition only where its answer without one would have succeeded
    // (RFC 9110 section 13.2.1), and here the renderer is what would evaluate it. Handed one at a
    // missing page, it answers the page it does not have as unchanged.
    const handed =
      resolution.status === 'success' ? request : withoutPreconditions(request);
    // The locale the response says it is in, so the body and `Content-Language` name one locale: a
    // missing or removed page under a prefix or an origin the policy serves is drawn in that
    // locale, and an address that states no served locale in the default.
    const drawnIn =
      resolution.status === 'success'
        ? resolution.locale
        : resolution.presentationLocale;
    // Opened before the render and closed by the take below, so the render has a channel to
    // declare into and nothing else does. A declaration against a request this never opened is a
    // request that was replaced between here and the render, which the declaring side reports.
    ɵopenPageOutcomeChannel(handed);
    const result = await options.render({
      request: handed,
      resolution,
      locale: drawnIn,
    });
    // Taken whether or not the renderer wrapped its answer, because the page declares from inside
    // the render and the renderer's own return says nothing about that.
    const fromRender = ɵtakePageOutcome(handed);

    let rendered: Response;
    let declared: PageOutcomeDeclaration | undefined = fromRender;
    if (isDeclaration(result)) {
      // The renderer's own statement replaces the page's. It is the outer frame: it saw the render
      // finish and decided what the whole of it was worth, which a component in the middle of it
      // could not.
      declared = result.pageOutcome;
      rendered = result.response ?? new Response(null);
    } else {
      rendered = result;
    }

    // Section 5's narrow rule: Equator's classification wins for an address it refused, and the
    // declared outcome wins for one it serves. An application declaring maintenance does not know
    // which addresses Equator refused, so a rule written the other way round would be one the
    // application could not reason about.
    const carriesDeclaration =
      declared !== undefined && resolution.status === 'success';
    if (declared !== undefined && !carriesDeclaration) {
      reportOverriddenDeclaration(
        reported,
        url.pathname,
        resolution.status,
        declared,
        descriptor.status,
      );
    }
    // Two answers a renderer gives are not routing outcomes, so the status the address resolved to
    // does not replace theirs: a 304 says the client already holds this page, and a redirect is
    // the application's router sending the reader elsewhere. Neither carries content, and sent
    // as the address's 200 either is an empty page a cache keeps for the address.
    const answeredWithoutContent =
      !carriesDeclaration &&
      (rendered.status === 304 || REDIRECT_STATUSES.has(rendered.status));
    // A render asked for a page that returned no content failed to draw it, and a failed render is
    // not the address's representation.
    const drewNothing =
      !carriesDeclaration &&
      !answeredWithoutContent &&
      descriptor.status === 200 &&
      rendered.body === null;
    if (drewNothing) reportEmptyRender(reported, url.pathname);
    // A render asked for a page that answered with an error status did not produce the page, and
    // did not say so either. Sent as the address's 200 it is an error page a shared cache keeps for
    // the address and a crawler indexes as the address's content. It is not read as a declaration:
    // nothing the page would have declared, its outcome document included, applies to it.
    const failedUndeclared =
      !carriesDeclaration &&
      !answeredWithoutContent &&
      !drewNothing &&
      descriptor.status === 200 &&
      rendered.status >= 400;
    const effective: DeclaredPageOutcomeDescriptor =
      carriesDeclaration && declared !== undefined
        ? pageOutcomeHttpDescriptor(declared, descriptor)
        : drewNothing
          ? pageOutcomeHttpDescriptor(RENDER_FAILED, descriptor)
          : failedUndeclared
            ? undeclaredFailureDescriptor(rendered.status, descriptor)
            : descriptor;

    options.ɵobserve?.({
      request,
      resolution,
      locale: drawnIn,
      declared,
      carried: carriesDeclaration,
      declined: false,
    });

    const merged = new Headers(rendered.headers);
    // The combined values already carry what the page set, so the page's own copies go, including
    // a `Vary` the combination dropped.
    merged.delete('cache-control');
    merged.delete('vary');
    // A 304 repeats the cache directives and the varying fields of the 200 it stands for, and
    // describes no representation of its own (RFC 9110 section 15.4.5).
    const own =
      answeredWithoutContent && rendered.status === 304
        ? cacheHeaders(effective, rendered.headers)
        : responseHeaders(effective, rendered.headers);
    for (const [name, value] of own) {
      if (name === 'set-cookie') merged.append(name, value);
      else merged.set(name, value);
    }
    if (answeredWithoutContent) {
      void rendered.body?.cancel();
      return new Response(null, { status: rendered.status, headers: merged });
    }
    return new Response(rendered.body, {
      status: effective.status,
      headers: merged,
    });
  };
}

/** The redirect statuses a router can answer with, which are the ones that carry a location. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

/** The request fields RFC 9110 section 13.1 defines as preconditions. */
const PRECONDITIONS = [
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'if-range',
] as const;

/** What a render that drew nothing is taken to have stated. */
const RENDER_FAILED: PageOutcomeOperationalFailure = Object.freeze({
  outcome: 'operational-failure',
  status: 500,
});

/**
 * What an address stands for before anything has resolved it: no language, no indexing class, and
 * nothing a cache may keep. A failure answered from here states only itself.
 */
const UNRESOLVED: RouteHttpDescriptor = Object.freeze({
  status: 200,
  cache: 'private-no-store',
});

/**
 * The resolution, or the failure of a route parameter codec that threw while the address was read.
 *
 * Only that failure is handed back. Every other throw is about the configuration the handler was
 * made with, which no request can answer for.
 */
function resolvedOrCodecFailure(
  resolve: () => RouteResolution,
): RouteResolution | LocalizationError {
  try {
    return resolve();
  } catch (error: unknown) {
    if (
      error instanceof LocalizationError &&
      error.diagnostic.reason === 'consumer-code-threw'
    ) {
      return error;
    }
    throw error;
  }
}

/**
 * Says once, where a developer will see it, that a route parameter codec threw.
 *
 * Once per handler, for the reason `reportEmptyRender` gives: the cause is how the codec was
 * written, and the addresses that reach it are unbounded and supplied by the request.
 */
function reportCodecFailure(reported: Set<string>, message: string): void {
  if (!inDevelopment()) return;
  if (reported.has('codec-threw')) return;
  reported.add('codec-threw');
  console.warn(`[Equator] ${message} The response is 500.`);
}

/**
 * What an error status a renderer sent without declaring it is answered with: that status, kept
 * out of every cache, and not indexed. Unlike a declared operational failure it does not keep the
 * address's indexing, because nothing was declared that could say the address is still what it was.
 */
function undeclaredFailureDescriptor(
  status: number,
  resolved: RouteHttpDescriptor,
): DeclaredPageOutcomeDescriptor {
  return Object.freeze({
    status,
    ...(resolved.contentLanguage === undefined
      ? {}
      : { contentLanguage: resolved.contentLanguage }),
    robots: 'noindex',
    cache: 'private-no-store',
  });
}

function withoutPreconditions(request: Request): Request {
  if (!PRECONDITIONS.some((name) => request.headers.has(name))) return request;
  const headers = new Headers(request.headers);
  for (const name of PRECONDITIONS) headers.delete(name);
  return new Request(request, { headers });
}

/**
 * Says once, where a developer will see it, that a render drew nothing.
 *
 * Once per handler, because the cause is how the renderer was written rather than the address, and
 * the addresses are unbounded and supplied by the request.
 */
function reportEmptyRender(reported: Set<string>, pathname: string): void {
  if (!inDevelopment()) return;
  if (reported.has('empty-render')) return;
  reported.add('empty-render');
  console.warn(
    `[Equator] The render of ${JSON.stringify(pathname)} returned no content where a page was asked for, and the response is 500. A render answers a page with its document, or states what happened with declarePageOutcome or declareOperationalFailure.`,
  );
}

function pageCacheHeaders(page: Headers): Partial<RouteCacheHeaders> {
  const cacheControl = page.get('cache-control');
  const vary = page.get('vary');
  return {
    ...(cacheControl === null ? {} : { 'cache-control': cacheControl }),
    ...(vary === null ? {} : { vary }),
  };
}

function isDeclaration(
  result: LocalizedRenderResult,
): result is DeclaredPageOutcome {
  return 'pageOutcome' in result;
}

/**
 * Whether a warning meant for a developer should be written.
 *
 * `NODE_ENV` rather than an option on the handler, because an option has to be set and a
 * deployment that needed this warning is one that did not think to set it. Anything but
 * `production` counts, which is the convention a Node process without the variable set already
 * relies on, and it is the safe direction here: this fires only where a declaration has already
 * failed to travel, so a line in a log nobody expected names a defect rather than noise.
 *
 * Read through `globalThis` because this entry point builds without Node's types and runs in
 * places that have no `process` at all.
 */
function inDevelopment(): boolean {
  const environment = globalThis as unknown as {
    readonly process?: { readonly env?: Record<string, string | undefined> };
  };
  return environment.process?.env?.['NODE_ENV'] !== 'production';
}

/** What a declaration states, in the words a warning should use for it. */
function describeDeclaration(declaration: PageOutcomeDeclaration): string {
  switch (declaration.outcome) {
    case 'absent':
      return 'an absent entity';
    case 'gone':
      return 'a permanent removal';
    case 'operational-failure':
      return `an operational failure with status ${declaration.status}`;
  }
}

/**
 * Says once, where a developer will see it, that a declared outcome did not travel.
 *
 * Once per pair of resolution and declaration rather than once per address: the addresses are
 * unbounded and attacker-supplied, so keying the record on one would let a request decide how much
 * this process remembers. The address is in the text of the first report, where naming it helps,
 * quoted so that a target carrying control characters cannot forge a line in a log.
 */
function reportOverriddenDeclaration(
  reported: Set<string>,
  pathname: string,
  resolved: RenderableResolution['status'],
  declaration: PageOutcomeDeclaration,
  servedStatus: number,
): void {
  if (!inDevelopment()) return;
  const identity = `${resolved}:${declaration.outcome}:${
    declaration.outcome === 'operational-failure' ? declaration.status : ''
  }`;
  if (reported.has(identity)) return;
  reported.add(identity);
  console.warn(
    `[Equator] The render declared ${describeDeclaration(declaration)} at ${JSON.stringify(pathname)} and the response is ${servedStatus}. Equator resolved that address as ${JSON.stringify(resolved)}, and a declared outcome travels only at an address Equator serves, so the declaration was not applied. Declare one from a render of a resolved address, or answer the refusal that address already carries.`,
  );
}

/**
 * A speculative load is not a choice.
 *
 * A browser prefetching a link in another language must not change what the visitor gets next time;
 * they did not click anything. `Sec-Purpose` names a speculative load directly and `Sec-Fetch-Dest`
 * distinguishes a navigation from a subresource. `Purpose: prefetch` is deliberately not consulted:
 * it is the older Chrome convention, a guard written against it passes a test written against it,
 * and it does nothing in a browser today.
 *
 * A request with no `Sec-Fetch-*` at all is treated as a real navigation: those headers are not
 * universal, and refusing to remember anything without them would break the ordinary case to guard
 * the rare one.
 */
function isBackgroundRequest(request: Request): boolean {
  const purpose = request.headers.get('sec-purpose') ?? '';
  if (/prefetch|prerender/iu.test(purpose)) return true;
  const destination = request.headers.get('sec-fetch-dest');
  return destination !== null && destination !== 'document';
}

/**
 * Addresses this policy says carry no locale, read from the policy rather than hardcoded.
 *
 * The dotted-file check is a heuristic and is named as one. It is what next-intl's documented
 * default matcher does, and the alternative, a consumer listing every asset path, is a list that
 * goes stale the first time somebody adds a font.
 */
function bypasses(url: URL, policy: LocaleUrlPolicy): boolean {
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  const first = segments[0];
  if (first !== undefined && policy.localeNeutralRoots.includes(first)) {
    return true;
  }
  const last = segments[segments.length - 1];
  return last !== undefined && last.includes('.');
}

function settledLocale(resolution: RouteResolution): string | undefined {
  if (resolution.status === 'success' || resolution.status === 'redirect') {
    return resolution.locale;
  }
  return undefined;
}

/**
 * Whether this outcome has a presentation for an application to produce.
 *
 * Two outcomes do not, and reading this as "not a redirect" let one of them through. A redirect
 * answers with its location. A malformed target has been refused before presentation routing, by
 * `specs/07-routing-rendering-and-seo.spec.md` section 5, and a refusal is not a page: the
 * resolution carries a diagnostic rather than a route, and an application asked to render one has
 * nothing to draw and an address it must not reflect.
 */
function hasBody(
  resolution: RouteResolution,
): resolution is RenderableResolution {
  return resolution.status !== 'redirect' && resolution.status !== 'malformed';
}

function readCookie(header: string | null, name: string): string | undefined {
  for (const entry of header?.split(';') ?? []) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() !== name) continue;
    let value: string;
    try {
      value = decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      // A request header is anyone's to write, and a value this library never wrote is no
      // preference at all rather than a reason to fail the response.
      return undefined;
    }
    return value.length === 0 ? undefined : value;
  }
  return undefined;
}

/** A tag in canonical form, or `undefined` for one that is not well formed. */
function canonicalTag(tag: string): string | undefined {
  return canonicalizeLanguageTag(tag);
}

/** The locale a signal names, where this build serves it. */
function servedLocale(
  policy: LocaleUrlPolicy,
  tag: string | undefined,
): string | undefined {
  if (tag === undefined) return undefined;
  const locale = canonicalTag(tag);
  return locale !== undefined && policy.locales[locale] !== undefined
    ? locale
    : undefined;
}

function serializeCookie(cookie: ɵCookieAttributes, value: string): string {
  return [
    `${cookie.name}=${encodeURIComponent(value)}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAgeSeconds}`,
    `SameSite=${cookie.sameSite}`,
    ...(cookie.domain === undefined ? [] : [`Domain=${cookie.domain}`]),
    ...(cookie.secure ? ['Secure'] : []),
  ].join('; ');
}
