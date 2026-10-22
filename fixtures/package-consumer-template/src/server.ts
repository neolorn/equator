import { randomUUID } from 'node:crypto';

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
} from '@angular/ssr/node';
import {
  allowedLocaleHosts,
  builtLocalePolicy,
  pageGone,
  projectSitemap,
} from '@neolorn/equator';
import {
  createLocaleRequestHandler,
  declareOperationalFailure,
  declarePageOutcome,
  type LocaleRequestHandlerOptions,
  toWebRequest,
  writeNodeResponse,
} from '@neolorn/equator/http';
import { configuration } from '#i18n';

import { DossierStore, DossierStoreUnavailable } from './app/dossier-store';

import { localeCookie } from './app/locale-cookie';
import { publishedRoutes } from './app/published-routes';
import { responseCaching } from './app/response-caching';
import {
  routePolicy,
  appRouteProjection,
  SITE_ORIGIN,
} from './app/localization.routes';

/**
 * The policy this build can serve, which is not always the policy the application declared.
 *
 * A policy is a source file and may name a locale a build did not generate, such as a
 * pseudo-locale in a build made without `--pseudo`. Resolving against it in such a build answers
 * that locale's addresses with a 200 in markup labelled with it, and sends a visitor whose cookie
 * remembers that locale to it. This application's policy reads its locales from the generated
 * configuration, so here the narrowing changes nothing, and it stays because a consumer row may
 * replace the policy with one that does not.
 */
const servedPolicy = builtLocalePolicy(routePolicy, configuration);

/**
 * The one place a locale URL policy has to be registered twice, written so it is still one list.
 *
 * `@angular/ssr` answers `400` before the application runs for any `Host` header it does not
 * recognise, and by default it recognises loopback and nothing else. Under a `locale-host` policy
 * that is every one of the application's own domains, so the site would answer nothing anywhere.
 * Equator cannot check this, a build cannot reach the server configuration, so what it does
 * instead is derive the list, and this is the line a consumer writes.
 *
 * `servedPolicy` rather than `routePolicy`, for the same reason as everywhere else here: a build
 * that does not carry a locale must not advertise or admit its origin.
 *
 * Empty under this fixture's path-prefix policy, which serves one origin and needs no entry beyond
 * the loopback pair the harness reaches it at. That is the point of writing it anyway: the line
 * keeps saying the truth on the day the policy changes.
 */
const engine = new AngularNodeAppEngine({
  allowedHosts: ['127.0.0.1', 'localhost', ...allowedLocaleHosts(servedPolicy)],
});

/**
 * An address Equator declined to localize, handed back to the server that owns it.
 *
 * `passthrough` has to answer with a `Response` because the handler is written against Fetch and
 * knows nothing about Express. This deployment's answer is "not mine, keep going", which is
 * `next()`, so a sentinel comes back and is recognised below. A real consumer serving files from
 * a directory would return the file here instead and never need this.
 */
const PASS_THROUGH = 'x-consumer-passthrough';

/**
 * What this deployment owns, and nothing else: how long a response is kept, which
 * `app/response-caching.ts` states, and where it reads a preference.
 *
 * `cookie` names the cookie this deployment remembers a choice in. Naming it is what tells Equator
 * that answers here vary by something a shared cache must not key on, and that is a fact stated
 * once rather than a directive string retyped per classification. A chain of conditionals mapping
 * classifications to directive text by hand works, and goes on working, wrongly and silently, the
 * first time a classification changes meaning. A conditional chain always has a last branch, so it
 * never stops compiling and never stops answering.
 *
 * The cookie itself is `localeCookie`, declared in `app/locale-cookie.ts` and read here and in
 * `app.config.ts` both. It is one declaration because it was two: the name and the attributes were
 * written out separately on each side, they disagreed about `Secure`, and only WebKit ever said so.
 * That reasoning lives with the declaration rather than here, so there is one place to read it and
 * one place to change it.
 */
/**
 * The short document this deployment answers with where it renders no page of the application's:
 * a malformed address, and a dossier it settled before rendering.
 */
function shortDocument(locale: string, init?: ResponseInit): Response {
  const direction = locale === 'ar-EG' ? 'rtl' : 'ltr';
  const message = locale === 'ar-EG' ? 'الصفحة غير متاحة' : 'Page unavailable';
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(
    `<!doctype html><html lang="${locale}" dir="${direction}"><head><meta name="robots" content="noindex"></head><body><h1>${message}</h1></body></html>`,
    { ...init, headers },
  );
}

const dossiers = new DossierStore();

/**
 * Items this deployment answers for before any page is drawn: one withdrawn for good, and one whose
 * record the catalogue cannot reach.
 *
 * The item page is drawn in the browser, so nothing on the server renders it and nothing there can
 * declare what became of an item. The server knows before it answers, so it declares, and the
 * document it sends is the application shell the item page is always answered with.
 */
const WITHDRAWN_ITEMS: ReadonlySet<number> = new Set([410]);
const UNREACHABLE_ITEMS: ReadonlySet<number> = new Set([503]);

/**
 * Exported because the server seat takes the same options: a test that builds its seat from this
 * object asserts what this deployment answers rather than what a copy of its configuration would.
 */
export const localeRequestOptions: LocaleRequestHandlerOptions = {
  policy: servedPolicy,
  projection: appRouteProjection,
  cache: responseCaching,
  cookie: localeCookie,
  passthrough: () =>
    new Response(null, { status: 204, headers: { [PASS_THROUGH]: '1' } }),
  render: async ({ request, resolution }) => {
    // A dossier's standing is the store's to say, and this server asks before rendering. A
    // withdrawn dossier is gone, which the address alone cannot tell, and a store that cannot
    // answer is this application's failure rather than a fact about the address, so it states its
    // own status and asks to be tried again.
    if (resolution.status === 'success' && resolution.routeId === 'dossier') {
      const slug = resolution.parameters['slug'];
      try {
        if (typeof slug === 'string' && (await dossiers.withdrawn(slug))) {
          return declarePageOutcome(
            pageGone(),
            shortDocument(resolution.locale),
          );
        }
      } catch (error: unknown) {
        if (!(error instanceof DossierStoreUnavailable)) throw error;
        return declareOperationalFailure(
          shortDocument(resolution.locale, {
            status: 503,
            headers: { 'Retry-After': '120' },
          }),
        );
      }
    }
    // An item's standing is known before the shell is sent, and the shell is all this server has
    // for a page the browser draws. It is sent as the engine returns it: the status, the caching
    // and the indexing are the declaration's, and the head is the browser's to write.
    if (resolution.status === 'success' && resolution.routeId === 'item') {
      const id = resolution.parameters['id'];
      const withdrawn = typeof id === 'number' && WITHDRAWN_ITEMS.has(id);
      const unreachable = typeof id === 'number' && UNREACHABLE_ITEMS.has(id);
      if (withdrawn || unreachable) {
        const shell = await engine.handle(request, createProbeContext(request));
        if (shell !== null) {
          if (withdrawn) return declarePageOutcome(pageGone(), shell);
          const headers = new Headers(shell.headers);
          headers.set('Retry-After', '120');
          return declareOperationalFailure(
            new Response(shell.body, { status: 503, headers }),
          );
        }
      }
    }
    // Every answer the router writes a head for is rendered by the application: a page, and the
    // three outcomes `outcomeDocuments` declares, an address it does not serve, one retired for
    // good, and one naming a locale this deployment does not serve. In each the locale to answer in
    // is known and the application has a page written in it. A malformed address names neither,
    // so it gets the short document below.
    //
    // Rendered here rather than after the handler returns, so the handler composes the page with
    // the status, language and caching it resolved, which is its job and not this file's. Composing
    // by hand afterwards lost the status: Angular's writer sets its own, so a not-found answered
    // 200. The request is the handler's own, which is also what lets a page's declared outcome
    // reach it.
    if (
      resolution.status === 'success' ||
      resolution.status === 'not-found' ||
      resolution.status === 'gone' ||
      resolution.status === 'unsupported-locale'
    ) {
      return (
        (await engine.handle(request, createProbeContext(request))) ??
        new Response(null, { status: 204, headers: { [PASS_THROUGH]: '1' } })
      );
    }
    return shortDocument(resolution.presentationLocale);
  },
};

const localeRequests = createLocaleRequestHandler(localeRequestOptions);

function createProbeContext(request: Request) {
  const url = new URL(request.url);
  const requestedLabel = url.searchParams.get('label')?.trim();
  return {
    requestId: randomUUID(),
    url: `${url.pathname}${url.search}`,
    label:
      requestedLabel === undefined || requestedLabel.length === 0
        ? 'default'
        : requestedLabel.slice(0, 64),
  };
}

/**
 * The sitemap, which this deployment owns the delivery of.
 *
 * Equator produces the files: their names, their contents, the split when there is one. Where they
 * are served from, and the `Sitemap:` line in `robots.txt` beside them, are this application's,
 * under section 10 of the routing specification. Serving them from the same handler is what this
 * deployment does; writing them into the built output beside `index.html` would do as well.
 *
 * `publishedRoutes` is the render table's own list, so the pages here are the pages this build
 * renders and the article slug is written in one place. `route:_index` is added because the home
 * page is answered by the fallback rather than declared, and it is still a page.
 *
 * `SITE_ORIGIN` and not the request host, because it is the same constant the router builds every
 * canonical and alternate URL from. That is what makes the addresses in this file and the addresses
 * in the head of every page one set rather than two that happen to agree, and it is why the harness
 * reaching this on a loopback port still reads the site's own addresses out of it.
 *
 * Built once at module scope. The set does not vary by request: what it lists is what this build
 * generated, which is settled before the first request arrives.
 */
const sitemapFiles: ReadonlyMap<string, string> = new Map(
  projectSitemap({
    policy: servedPolicy,
    projection: appRouteProjection,
    configuration,
    origin: SITE_ORIGIN,
    routes: [...publishedRoutes, { routeId: 'route:_index' }],
  }).map((file) => [`/${file.name}`, file.contents]),
);

export const reqHandler = createNodeRequestHandler(
  async (request, response, next) => {
    try {
      const host = request.headers.host ?? 'localhost';
      const requested = new URL(request.url ?? '/', `http://${host}`).pathname;
      if (
        requested === '/sitemap.xml' ||
        /^\/sitemap-\d+\.xml$/u.test(requested)
      ) {
        const file = sitemapFiles.get(requested);
        if (file === undefined) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/xml; charset=utf-8');
        response.end(file);
        return;
      }
      const resolved = await localeRequests(
        toWebRequest(request, `http://${request.headers.host ?? 'localhost'}`),
      );

      if (resolved.headers.has(PASS_THROUGH)) {
        next();
        return;
      }

      await writeNodeResponse(resolved, response);
    } catch (error: unknown) {
      next(error);
    }
  },
);
