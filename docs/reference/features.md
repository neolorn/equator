# Features

Every export that can be passed to `provideLocalization`. Leaving one out selects its default;
`withRecoveryMessage` is the one with no default. The list is read out of the built
declarations.

This page is generated from the packages and is not edited by hand.

| Feature                           | Entry point                | Selects                                                                                                                                                         |
| --------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provideLocalizationSetup`        | `@neolorn/equator`         | The runtime, taking the generated setup and the features this application selected. The generated `provideLocalization` calls it with your setup already bound. |
| `provideLocalizationTesting`      | `@neolorn/equator/testing` | The runtime for a test, replacing the parts a test cannot wait for and nothing else.                                                                            |
| `provideLocalizedRouter`          | `@neolorn/equator/router`  | Replaces `provideRouter`. Resolves a localized address to the route behind it.                                                                                  |
| `provideLocalizedServerRendering` | `@neolorn/equator/ssr`     | Negotiates the locale for each request and prepares the scopes that request needs, before the render.                                                           |
| `withExtensions`                  | `@neolorn/equator`         | Registers formatting and parsing adapters for a value type your domain has and `Intl` does not.                                                                 |
| `withFormattingContext`           | `@neolorn/equator`         | Sets what every formatter starts from: the time zone, the calendar, the numbering system, and the hour cycle.                                                   |
| `withLocaleAnnouncement`          | `@neolorn/equator`         | Replaces the wording of the locale-change announcement Equator already makes. Returning nothing leaves the announcing to a live region of your own.             |
| `withLocaleSources`               | `@neolorn/equator`         | Names the sources Equator asks for the locale, and their order: `url`, `stored`, `browser` and `default`.                                                       |
| `withLocalizationClock`           | `@neolorn/equator`         | Decides what `now` is for relative time. `fixedClock` makes a test reproducible.                                                                                |
| `withObservability`               | `@neolorn/equator`         | Sends runtime outcomes to a sink you supply.                                                                                                                    |
| `withOverlayLocale`               | `@neolorn/equator`         | Renders one locale on top of the committed one without changing it, for reviewing a translation in place.                                                       |
| `withPersistence`                 | `@neolorn/equator`         | Stores a visitor's chosen locale in a cookie, in browser storage, or in your own profile record.                                                                |
| `withRecoveryMessage`             | `@neolorn/equator`         | The sentence a visitor reads when no catalog loads at all. The one feature with no default.                                                                     |
| `withRelativeTimePolicy`          | `@neolorn/equator`         | Sets the thresholds that decide which unit a relative time is said in.                                                                                          |
| `withRouting`                     | `@neolorn/equator`         | Gives every page an address in every locale, from a URL policy and a route projection.                                                                          |
| `withoutDocumentLocale`           | `@neolorn/equator`         | Leaves the document's `lang` and `dir` alone, for a widget rendered inside a host page that owns them.                                                          |
