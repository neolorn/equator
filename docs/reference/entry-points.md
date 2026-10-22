# Entry points

What each import specifier publishes, and what it is for. The lists are read out of the built
packages.

This page is generated from the packages and is not edited by hand.

## `@neolorn/equator`

Everything an application component and its bootstrap need.

Publishes 216 name(s).

Composable from here: `provideLocalizationSetup`, `withExtensions`, `withFormattingContext`, `withLocaleAnnouncement`, `withLocaleSources`, `withLocalizationClock`, `withObservability`, `withOverlayLocale`, `withPersistence`, `withRecoveryMessage`, `withRelativeTimePolicy`, `withRouting`, `withoutDocumentLocale`.

## `@neolorn/equator/core`

The contracts, the locale profiles and negotiation, and the route and address helpers, with no Angular in the graph. This is what a library or a test helper imports.

Publishes 237 name(s).

## `@neolorn/equator/forms`

Localized input parsing and the directive that binds it to a form control.

Publishes 3 name(s). Needs `@angular/forms`, which is an optional peer: install it when you import from here.

## `@neolorn/equator/http`

The locale request handler and its Node adapter: one request in, one response out, with no Angular in the graph.

Publishes 17 name(s).

## `@neolorn/equator/router`

Localized routing: the router setup, the link directive, and the address projection behind them.

Publishes 17 name(s). Needs `@angular/router`, which is an optional peer: install it when you import from here.

Composable from here: `provideLocalizedRouter`.

## `@neolorn/equator/ssr`

Server rendering: per-route render modes, and the locale the server renders in.

Publishes 2 name(s). Needs `@angular/ssr`, which is an optional peer: install it when you import from here.

Composable from here: `provideLocalizedServerRendering`.

## `@neolorn/equator/testing`

The test harness. It replaces the parts of the runtime a test cannot wait for, and nothing else. Everything in it but the server seat runs under `TestBed`, which needs a DOM and a test runner that installs one.

Publishes 17 name(s).

Composable from here: `provideLocalizationTesting`.

## `@neolorn/equator-toolkit`

The compiler behind the `equator` command, as a library. An application does not import this; a build script that needs the compiler without the command line does.

Publishes 180 name(s).

## Anything else

A path that is not listed here is not published. A deep import into a package resolves in some
setups and not in others, and what it reaches is free to change in a patch release, so nothing
on this page is reachable any other way.
