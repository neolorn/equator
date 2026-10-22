# How to control how your pages are cached

Every response the handler in `@neolorn/equator/http` returns carries a `Cache-Control` that Equator
derived from the address. Where you know more than the address does, you raise it: on a route, for
every page, or from the page itself. Nothing you declare lowers it.

## Before you begin

Serve through the handler, which is
[How to negotiate a locale on your own server](negotiate-on-your-own-server.md).

## What Equator decides

There are three levels, from least to most restrictive:

- Shared: `public, max-age=N, must-revalidate`. A shared cache may hold it.
- Per visitor: `private, no-cache`. A browser may keep it, and asks the server again before reusing
  it.
- Not stored: `private, no-store`.

An answer chosen for one visitor is per visitor: the redirect from an entry address, and a page whose
language came from a cookie. A 400, a 404, a 410, a page that declared an outcome, and a route
classified `private` for indexing are not stored. Every other localized page is shared.

`Vary: Accept-Language` goes on every answer Equator chose from that header, whatever its level. A
cookie is never named in `Vary`.

## Declare a route's caching

Classify the route in its own `data`:

```text
export const routes: Routes = [
  { path: '', pathMatch: 'full', component: Home },
  { path: 'account', component: Account, data: { equatorCaching: 'per-visitor' } },
];
```

`per-visitor` is for a page that differs by visitor and holds nothing sensitive, such as a greeting
or a theme. `not-stored` is for one that does. A route that declares nothing keeps what routing
concluded, and there is no value for shared, because a declaration only raises.

A class on a parent route reaches its children the way Angular passes route data down: every child
under the router's default, and under `paramsInheritanceStrategy: 'emptyOnly'` only a child with an
empty path or one whose parent renders no component. A class the child states itself wins.
`generate` reads the strategy from your router configuration, and where it cannot, reports `EQ1416`
and passes the class to every child.

Where a parent and its children share an address, the class that counts is the one on the route
Angular renders there. Where a `matcher` or a `canMatch` guard picks that route when the page is
visited, `generate` cannot tell which one it is, so it answers the address as `not-stored` and reports
`EQ1413`.

A project that already classifies its routes names the field it has and maps its values:

```text
withRouting({
  policy: routePolicy,
  projection: appRouteProjection,
  caching: {
    field: 'area',
    values: { themed: 'per-visitor', account: 'not-stored' },
  },
}),
```

`DEFAULT_ROUTE_CACHING_FIELD` is `equatorCaching`. Under a field of your own, a value the table does
not list says nothing about caching.

Both are read from your source text at generate time, the same way as the indexing field, so they are
string literals, written in place or through a `const`. A value `generate` cannot read or use is
reported as `EQ1413`, and until you correct it the route is not stored: every class it could have
named keeps the page out of a shared cache.

## Declare a floor for every page

A fact that holds on every page belongs in the handler's cache options rather than on each route,
because a route added later would have to remember it. A cookie every page reads, or a nonce every
response carries, is that kind of fact:

```text
cache: { successMaxAge: 300, permanentRedirectMaxAge: 86_400, pageCaching: 'per-visitor' },
```

Every page is raised to at least that level. A route can raise its own pages further. A redirect
carries no page, so it keeps the level routing gave it. The value is `per-visitor` or `not-stored`, and
`createLocaleRequestHandler` refuses any other when the handler is created.

## Let a page narrow its own caching

The `Cache-Control` and `Vary` your render returns are combined with Equator's rather than replaced by
them. A page can make itself more private and shorten how long it is kept, and nothing it says makes
it more shared or kept longer:

```ts src/app/page-caching.spec.ts
import { describe, expect, it } from 'vitest';

import { createLocaleRequestHandler } from '@neolorn/equator/http';
import { localizationSetup } from '#i18n';

import { appRouteProjection, routePolicy } from './localization.routes';

const rendering = (headers: Record<string, string>) =>
  createLocaleRequestHandler({
    policy: routePolicy,
    projection: appRouteProjection,
    configuration: localizationSetup.configuration,
    cache: { successMaxAge: 300, permanentRedirectMaxAge: 86_400 },
    cookie: false,
    render: ({ locale }) =>
      new Response(`<!doctype html><html lang="${locale}"></html>`, {
        headers: { 'content-type': 'text/html', ...headers },
      }),
  })(new Request('https://example.com/en-us/second'));

describe('what a page says about its own caching', () => {
  it('can keep itself out of every cache', async () => {
    const response = await rendering({ 'cache-control': 'no-store' });

    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('can shorten how long it is kept, and not lengthen it', async () => {
    const shorter = await rendering({ 'cache-control': 'max-age=60' });
    const longer = await rendering({
      'cache-control': 'public, max-age=31536000, immutable',
    });

    expect(shorter.headers.get('cache-control')).toBe(
      'public, max-age=60, must-revalidate',
    );
    expect(longer.headers.get('cache-control')).toBe(
      'public, max-age=300, must-revalidate',
    );
  });

  it('adds its varying fields, and a cookie makes it private instead', async () => {
    const encoded = await rendering({ vary: 'Accept-Encoding' });
    const byCookie = await rendering({ vary: 'Cookie' });

    expect(encoded.headers.get('vary')).toBe('Accept-Encoding');
    expect(byCookie.headers.get('cache-control')).toBe('private, no-cache');
    expect(byCookie.headers.get('vary')).toBeNull();
  });
});
```

`no-store` makes a page not stored, and `private` or `no-cache` makes it per visitor. A shorter
`max-age` shortens the shared lifetime, and `no-transform` is kept at every level. `public`,
`immutable`, `stale-while-revalidate` and a longer `max-age` are left out, because each would let a
cache keep the page longer or share it wider than its address allows.

## Keep a page with a nonce free of validators

A page that carries a nonce must not carry a validator, neither `ETag` nor `Last-Modified`.

With a validator, a browser revalidating the page can get a `304 Not Modified`. The browser then
keeps the body it stored and takes the new response's headers in place of the stored ones, which
[RFC 9111](https://www.rfc-editor.org/rfc/rfc9111) requires in sections 3.2 and 4.3.4. The page ends
up with the old nonces in its markup and a `Content-Security-Policy` naming the new one, so its
scripts and styles are blocked.

Without a validator, every revalidation is answered with the whole page, and its nonces and its
policy arrive together. If your server adds an `ETag` on its own, turn that off for rendered pages.

## A language chosen since the page was left

A page whose language came from a cookie is per visitor, so a browser asks the server again before
reusing it and a visitor who has chosen another language since gets that one. The exception is a page
the browser restores from its back-forward cache, which comes back from memory without a request.

Equator checks a restored page in the browser. Where the locale your persistence stores remember
differs from the one on screen, and the locale sources you configured would choose it at that
address, the page changes to it. You write nothing for this, and the change is not remembered as a
new choice, because the visitor made none. The sink you pass to `withObservability` is told how each
check ended.

## Compute the headers without the handler

Outside the handler, `routeCacheHeaders` takes the classification Equator derived for a resolved route
and the freshness numbers this deployment chose, and returns the headers to write:

```ts src/app/caching.spec.ts
import { describe, expect, it } from 'vitest';

import { routeCacheHeaders } from '@neolorn/equator';
import type {
  RouteCacheFreshness,
  RouteHttpDescriptor,
} from '@neolorn/equator';

// How long this deployment's shared caches hold a response Equator has said may be shared, and
// where this deployment reads a visitor's language preference.
const freshness: RouteCacheFreshness = {
  successMaxAge: 300,
  permanentRedirectMaxAge: 86_400,
  localePreference: 'accept-language',
};

function headersFor(descriptor: RouteHttpDescriptor): Record<string, string> {
  const written: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    routeCacheHeaders(descriptor, freshness),
  )) {
    if (value !== undefined) written[name] = value;
  }
  return written;
}

describe('the headers a route class implies', () => {
  it('lets a shared cache hold one variant per language', () => {
    const headers = headersFor({
      status: 200,
      cache: 'varies-by-locale-preference',
    });

    expect(headers['cache-control']).toBe(
      'public, max-age=300, must-revalidate',
    );
    expect(headers['vary']).toBe('Accept-Language');
  });

  it('keeps a private response out of a shared cache', () => {
    const headers = headersFor({ status: 200, cache: 'private-no-store' });

    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['vary']).toBeUndefined();
  });

  it('holds a permanent correction for as long as this deployment said', () => {
    const headers = headersFor({
      status: 308,
      location: '/en-us/second',
      cache: 'consumer-defined-permanent',
    });

    expect(headers['cache-control']).toBe('public, max-age=86400');
  });
});
```

`routeHttpDescriptor` produces the descriptor from a resolved route, and the handler calls both for
you. It passes the page's own headers as the third argument, which is how the combining above works.

`localePreference` is the one fact Equator cannot derive, because it never sees the request. Reading
the preference from `Accept-Language` leaves a successful response shared-cacheable per language, and
`Vary: Accept-Language` says so. Reading it from a cookie does not, and the answer is
`private, no-cache`.

The result is a map by header name rather than one string, so a consumer writes the set with one loop
and gains a header a later release adds without changing a line.

## Related

- [How to negotiate a locale on your own server](negotiate-on-your-own-server.md)
- [How to tell crawlers your pages are translations](control-indexing.md)
- [How to render on the server](render-on-the-server.md)
