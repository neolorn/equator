# How to localize your routes

Give every page an address in every locale you serve, and make that address resolve back to the same
route. Your Angular routes are unchanged.

## Before you begin

Run `equator generate` at least once, so `#i18n/routes` exists.

## Declare a policy and a projection

Create `src/app/localization.routes.ts` with two exports:

```ts excerpt src/app/localization.routes.ts
export const routePolicy = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

export const appRouteProjection = defineRouteProjection({
  generated: routeProjection,
});
```

The policy states how a locale appears in a URL. The projection states which routes have localized
addresses, and it starts from the generated one, so a route you add later is covered without a second
list.

Write the creator's options as literals, as above. `generate` compares the policy with
`equator.config.json` and with your route paths only where it reads an option from the call itself,
and reports `EQ1417` naming each option it did not read.

## Compose them

Pass both to `withRouting` among the features `provideLocalization` receives:

```ts excerpt src/app/app.config.ts
export const localizationFeatures = [
  withRouting({ policy: routePolicy, projection: appRouteProjection }),
```

Replace `provideRouter` with `provideLocalizedRouter`:

```ts excerpt src/app/app.config.ts
    provideLocalizedRouter(routes),
```

## Write links as routes

Write the route. The locale is resolved:

```ts excerpt src/app/app.routes.ts
    <a routerLink="second">{{ messages.openSecond | localize }}</a>
```

A link spelled `/ar-eg/second` stops being true the moment the visitor switches, and the Router
receives the address as written: the prefix is resolved away before anything matches, so the page
renders in whichever locale is committed rather than the one the link named.

## Choose a policy

Four creators, all exported from `@neolorn/equator`:

| Creator                           | Puts the locale                   | Fits a deployment where                     |
| --------------------------------- | --------------------------------- | ------------------------------------------- |
| `createPathPrefixLocalePolicy`    | In the first path segment         | one origin serves every locale              |
| `createDefaultLocalePrefixPolicy` | In the first path segment, always | every locale is prefixed, the default too   |
| `createHostLocalePolicy`          | In the origin                     | one host per language, one build per origin |
| `createLocaleNeutralPolicy`       | Only in a path spelled per locale | pages sit behind a sign-in, never indexed   |

`createPathPrefixLocalePolicy` is the default choice. It takes `omitDefaultPrefix` to serve the
default locale without its prefix. `createDefaultLocalePrefixPolicy` takes the same options without
that one, because it always writes the prefix.

Build the policy with a creator. A policy object written out by hand is accepted only where it holds
what a creator writes for its kind, and is refused with `invalid-configuration` wherever it is read
otherwise.

Each policy costs something different, and a host policy changes what a locale switch is, which is
[About how routing derives addresses](../explanation/about-addresses.md).

## Keep a section out of the locale prefix

Every policy takes `localeNeutralRoots`, a list of path roots that keep one address in every locale.
Use it for a sign-in callback, a webhook receiver, or anything a third party has already recorded the
address of.

## Name further scopes for a route

A navigation waits for the scopes the route's code uses, which `generate` derives from the route
tree, so most applications name none. To hold a navigation for a further scope, name it in the
second argument of `provideLocalizedRouter`:

```text
import { providerId, scopeId } from '#i18n/comments';

const comments = { providerId, scopeId } as const;

provideLocalizedRouter(routes, {
  requiredScopes: { 'route:articles._': [comments] },
});
```

A key is a `routeId`, the identity `generate` gave the route. A list in place of the record names
the scopes for every route.

To let a navigation complete before a scope arrives, name the scope in `progressiveScopes` and set
`mode` to `progressive`:

```text
provideLocalizedRouter(routes, {
  mode: 'progressive',
  progressiveScopes: { 'route:articles._': [comments] },
});
```

The page renders without the scope, and `scopeReadiness(comments)` on `Localization` reports
`loading`, then `ready` or `failed`. What the region shows until then is yours to write. Under
`coordinated`, which is the mode where you name none, and in a server render, a prerender and the
first render in a browser under either mode, a progressive scope is loaded before the page renders,
as a required one is. A `mode` that is neither word fails with `invalid-configuration` where the
option is given. Why a change waits at all is
[About how a locale switch is a transaction](../explanation/about-locale-switching.md).

## Serve a prefixed address from a static host

Under a path policy the first segment of every address is a locale, so a host that serves files by
path has no file at `/ar-eg` and answers 404. Point the host's fallback at `index.html`, the same
setting any router-driven Angular application needs, and the application reads the locale out of the
address it was opened at. `ng serve` does this already, so the first place the setting is missing is
usually a deployment of the build.

A server-rendered application answers the address itself and needs no fallback; [How to render on
the server](render-on-the-server.md) covers that path.

## Related

- [About how routing derives addresses](../explanation/about-addresses.md)
- [About how a locale is resolved](../explanation/about-locale-resolution.md)
- [How to tell crawlers your pages are translations](control-indexing.md)
- [How to render on the server](render-on-the-server.md)
