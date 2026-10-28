# Changelog

All notable changes to Equator are recorded here, for `@neolorn/equator` and
`@neolorn/equator-toolkit`, which share a version.

`1.0.0-rc.1` is the first release under this name, and a release candidate for `1.0.0`. Everything
below it is how the library got there: the 0.x line, which was never published, and nine
milestones. Six were published under the project's earlier name, and each of those headings carries
the number it was published as and the date of that release. The two betas and the first release
candidate of that line were never published and carry no date. None of them is a version of the two
packages above.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The 0.x line is the alpha stage,
then the betas, then the release candidates and the milestones that followed them.

## [1.0.0-rc.1] - 2026-10-26

The first release candidate of Equator, a localization framework for Angular applications.

It installs on Node `^22.22.3 || ^24.15.0 || ^26.0.0`. The runtime takes `@angular/core` and
`@angular/common` at `>=22.0.0 <23.0.0` and `rxjs` at `>=7.4.0 <8.0.0` as peers, with
`@angular/router`, `@angular/forms` and `@angular/ssr` at `>=22.0.0 <23.0.0` as optional peers of
the entry points that use them. The toolkit takes `@angular/compiler` at `>=22.0.0 <23.0.0` and
`typescript` at `>=6.0.2 <6.1.0`.

The standards profile is `equator-1`: Unicode 17.0.0, CLDR and LDML 48.2, MessageFormat as LDML 48.2
defines it, the ECMA-402 13th edition for the options of a numeric function, XLIFF 2.2 Committee
Specification 01, the sitemaps.org 0.9 protocol, the IANA Language Subtag Registry dated 2026-09-17,
and the IANA Time Zone Database 2026e. The runtime depends on `tslib` and nothing else. The toolkit
depends on `yaml` 2.9.1, `ajv` 8.20.0, `jsonc-parser` 3.3.1, `messageformat` 4.0.0 and `tslib`.

It is built and run on Angular 22.2.1, 22.0.4 and 22.0.0, TypeScript 6.0.3 and 6.0.2, RxJS 7.8.2
and 7.4.0, Node 22.22.3, 24.15.0, 26.0.0 and 26.10.0, and Chromium, Firefox and WebKit through
Playwright 1.63.0. [Compatibility](docs/reference/compatibility.md) lists the combinations.

### Added

- `@neolorn/equator`, the runtime, with seven entry points: the primary, `/core`, `/http`,
  `/router`, `/forms`, `/ssr` and `/testing`. An entry point you do not import adds no code and no
  peer.
- `@neolorn/equator/core` and `@neolorn/equator/http` import no Angular, so a worker or a server
  that is not the Angular one can load them.
- `@neolorn/equator-toolkit`, the compiler and the `equator` command line, with the same operations
  as a library and the JSON Schemas of its file formats as exports.
- `equator init` writes `equator.config.json` from the source locale, the default locale and the
  locales the project supports. `aliases`, `parentLocales`, `formatting`, `inProgress`,
  `personNameLocales` and `pseudoLocales` are the optional fields.
- `equator generate` compiles the catalogs into typed modules under `#i18n`, with a
  `provideLocalization` that has the project's setup already bound.
- `createLocalizationContext` builds a localization context where there is no application to
  inject from: a server handler, a script or a test. `injectLocalization` reaches `Localization` in
  a component, a directive or a service.
- A failure is a `LocalizationError` whose diagnostic carries a code, an outcome and a reason.
- `provideLocalizationSetup` and the features it composes: `withRouting`, `withPersistence`,
  `withLocaleSources`, `withFormattingContext`, `withRelativeTimePolicy`, `withLocalizationClock`,
  `withLocaleAnnouncement`, `withOverlayLocale`, `withExtensions`, `withObservability`,
  `withRecoveryMessage` and `withoutDocumentLocale`.
- Catalogs are YAML, one file per scope and locale at `i18n/<scope>/<locale>.yaml`, with message
  bodies in MessageFormat 2.
- The MessageFormat functions `:string`, `:number`, `:integer`, `:offset`, `:currency`, `:percent`,
  `:unit`, `:datetime`, `:date` and `:time`, with plural, ordinal and select variants. The toolkit
  judges a numeric function's options and units by the rules of the ECMA-402 13th edition, so a
  message compiles to the same diagnostics on every machine.
- Each message is a typed handle. A missing, extra or mistyped input fails the build, in TypeScript
  and in a template.
- `inputs` and `slots` on a source message narrow what the toolkit inferred, and `description` and
  `context` carry guidance to the translator.
- Rich messages with the slot kinds `emphasis`, `strong`, `code`, `link` and `action`. The
  application binds a link's destination with `internalDestination` or `externalDestination`, and an
  action's handler.
- `families` in a source catalog, for a set of messages chosen by a value known only at run time.
- The `localize` pipe and the `localized-message` component put a message on the page.
- `[localizedLabel]` writes a message into `aria-label`, `aria-placeholder`,
  `aria-roledescription`, `aria-valuetext`, `alt`, `placeholder` or `title`.
- Scopes are derived from the templates and the route tree. A scope used only behind a lazy route
  loads with that route, and the rest load at startup.
- `requiredScopes` and `progressiveScopes` on `provideLocalizedRouter` name further scopes for a
  route. In `coordinated` mode, the default, a navigation and a locale change wait for both lists,
  and a first render waits for them on the server, in a prerender and in the browser.
- A missing translation falls back through the locales the target inherits from in the pinned CLDR
  release, then to the source locale, so `zh-TW` falls back through `zh-Hant` and never through
  `zh`. `parentLocales` replaces one step of that chain.
- `withRecoveryMessage` and the `localization-recovery` component, for the case where no catalog
  loads.
- A translation whose source wording changed since it was written is reported as stale, and one
  that omits a plural category its locale needs is reported with `EQ1308`.
- Locale identifiers are canonical BCP 47 tags, checked against the pinned CLDR release and
  language subtag registry. `canonicalizeLanguageTag` is the same check as a function.
- The locale is resolved from the address, a stored choice, the browser's languages, then the
  default. `withLocaleSources` changes the order.
- `negotiateLocale` and `parseAcceptLanguage` match a language preference list against the
  supported locales, by RFC 4647 lookup, then by script, then by a language written under another
  subtag.
- `withPersistence` with `cookieStore`, `localStorageStore`, `profileStore` and `memoryStore`. Only
  a locale the visitor chose is written.
- `Localization.forgetRememberedLocale` removes the stored choice, and
  `changeLocale(locale, { remember: false })` moves the page without storing one.
- `formatting` in `equator.config.json` declares the numbering system, calendar or hour cycle a
  locale is written with.
- `Localization.changeLocale` changes the locale as one transaction, in `coordinated` or
  `progressive` mode, and ends as committed, cancelled, superseded, failed or redirected. A change
  to a locale the current route has no address in ends as failed and changes nothing, and a change
  asked for while the application is starting waits for the start.
- `Localization.registerParticipant` joins application content to a locale change, as required or
  progressive. A participant is given the request context its localization context was built with,
  and a signal that is aborted when its change is abandoned or overtaken.
- `localeChoices` and the `[localeChoice]` directive build a switcher whose options point at the
  current page in each locale.
- The document's `lang` and `dir` follow the committed locale, and a locale change is announced to
  a screen reader. `withLocaleAnnouncement` replaces the wording.
- Focus, the caret and the scroll position are restored after a locale change, including one that
  changes the writing direction.
- `withOverlayLocale` renders one locale over the committed one, for reviewing a translation in
  place.
- `provideLocalizedRouter` and `withRouting` give every route an address in every locale, from a
  URL policy and the generated route projection.
- URL policies that carry the locale in a path prefix, in the origin, or outside the address:
  `createPathPrefixLocalePolicy`, `createDefaultLocalePrefixPolicy`, `createHostLocalePolicy` and
  `createLocaleNeutralPolicy`. Every policy takes `localeNeutralRoots`, the path roots that keep
  one address in every locale.
- A route and its parameters can be spelled per locale, and an earlier address of a route
  redirects permanently to the current one. `createIdentifierParameterCodec` and
  `createIntegerParameterCodec` read and write a parameter, and `LocalizedRouteParameters` reads
  them in a component.
- `defineRouteProjection`, `buildLocalizedRoute`, `localizedRouteAddresses` and
  `resolveLocalizedRoute` build and resolve addresses with the route identities and parameter names
  checked at build.
- An address with no locale redirects with 307, a noncanonical one with 308, an unsupported locale
  or a missing page answers 404, a removed page 410, and an unsafe request target 400. A spelling
  that is not in Unicode Normalization Form C is noncanonical. A slash and a question mark in a
  query or a fragment are data, so `?next=/account` resolves and survives a redirect.
- A page that is missing, gone or in an unsupported locale is rendered in the locale the
  response's `Content-Language` names.
- The canonical link, the `hreflang` alternates and `x-default` are written into the head from the
  route projection, only for locales the address serves.
- `LocalizedTitleStrategy`, the `document` callback and `documentMessage` write a localized title
  and description. `outcomeDocuments` titles the responses that have no route.
- An Open Graph block where the deployment supplies an image.
- `projectSitemap` returns the sitemap files with `hreflang` alternates, split into an index and
  numbered files past the protocol's limits.
- A route declares its indexing class and its caching through `withRouting`, and
  `routeHttpDescriptor` and `routeCacheHeaders` return the headers they produce.
- `LocalizedPageOutcome`, with `pageAbsent`, `pageGone` and `pageOperationalFailure`: a page states
  that its address is not there, is gone, or failed, and the response carries it.
- `declarePageOutcome` and `declareOperationalFailure` in `@neolorn/equator/http` state the same
  from a renderer. A document sent with a declaration is sent as given, with the declared status
  and the caching and indexing of the declared outcome.
- `provideLocalizedServerRendering` and `localizedServerRoutes` build the server route table from
  the routes and the locales, with a prerendered address for each locale.
- A server-rendered or prerendered page hydrates in the locale it was rendered in.
- `createLocaleRequestHandler` answers a request with the redirect, the status, the language and
  indexing headers, the cache directives and the preference cookie decided. A page's own
  `Cache-Control` is read directive by directive, so its `no-store` stands. `toNodeListener`,
  `toWebRequest` and `writeNodeResponse` adapt the handler to a Node server.
- Canonical value types and their factories: `decimal`, `money`, `measurement`, `percent`,
  `percentagePoints`, `instant`, `plainDate`, `plainTime`, `plainDateTime`, `zonedDateTime`,
  `duration`, `timeZone` and `personName`.
- `timeZone` returns the primary identifier the pinned time zone database gives a name, as ECMA-402
  section 6.5 defines it. A former name linked across a border resolves to a zone of its own
  country, and a name the database replaces resolves to the former one for two years.
- `formatNumber`, `formatNumberRange`, `formatMoney`, `formatMeasurement`, `formatPercent`,
  `formatPercentagePoints`, `formatInstant`, `formatInstantRange`, `formatPlainDate`,
  `formatPlainTime`, `formatPlainDateTime`, `formatZonedDateTime`, `formatDuration`, `formatList`
  and `formatDisplayName` format through the host's `Intl`.
- A pipe for each value kind: `localizedDecimal`, `localizedMoney`, `localizedMeasurement`,
  `localizedPercent`, `localizedPercentagePoints`, `localizedInstant`, `localizedPlainDate`,
  `localizedPlainTime`, `localizedPlainDateTime`, `localizedZonedDateTime` and `localizedDuration`.
- The zone of a value is checked against the pinned time zone database, and a calendar and a
  numbering system by the name syntax UTS #35 gives them, so a value is valid on every host or on
  none. Where the host cannot write one, the function that formats the value returns
  `unsupported-formatting-capability`, and a message that writes it raises it. Node 22.22.3 has no
  `Intl.DurationFormat`, so `formatDuration` and `localizedDuration` return it there.
- `withFormattingContext` sets the time zone, calendar, numbering system and hour cycle every
  formatter starts from. What a call names stands over the context.
- A locale the host has no data for is formatted in the first locale of its pinned CLDR parent
  chain that the host has, so it is written the same way on every host: `de-AQ` is written in `de`,
  and `ht` in `fr-HT`. Plural selection, ordering and segmentation walk the parent lists CLDR gives
  their own data, so `sr-Latn` takes the plural rules of `sr`. Where no locale of the chain is
  available, or the host drops a keyword of the locale tag that the operation reads, the operation
  returns `unsupported-formatting-capability`, so `ht` is refused for plural selection, ordering and
  segmentation, and `ru-Latn` for formatting.
- A pseudo-locale is formatted in its language, because its script subtag says only which way its
  text runs: `en-Arab-XB` is written as `en` writes, in the digits its declaration names, and is
  not a fallback. `pseudoLocale` on the formatting context marks a locale the build generated as a
  pseudo-locale, and is not carried in the state a server render transfers.
- A result names the locale that wrote it where that is not the context's own, as `language` on a
  formatted value and on a capability's answer, and as `valueLanguage` on a message's formatted
  part. `fallback` and `valueFallback` are set where that locale differs in language or in script
  after likely subtags: `fr-HT` writing for `ht` is a fallback, and `en` answering for `en-US` is
  not. The chains and the parent and likely-script tables they read add 4,851 bytes, gzip, to the
  primary entry point, 1,972 of them the tables, which the [cost reference](docs/reference/cost.md)
  measures.
- `formatRelativeTime` with `withRelativeTimePolicy` for the units and the range, and
  `withLocalizationClock`, `systemClock` and `fixedClock` for what now is.
- `formatPersonName` formats a structured name from the CLDR person-name patterns, for the
  project's locales and those in `personNameLocales`.
- `compareLocalized`, `segmentText`, `selectPlural` and `localeMetadata`, which gives a locale's
  direction and the first day and the weekend of its week.
- `parseLocalizedInput` and `formatLocalizedInput` read and write a typed value in a field. A parse
  is valid, incomplete, invalid, ambiguous, out of range, unsupported or rejected by policy. A
  money, measurement or percent field asks for its currency, unit or percent sign only where the
  profile requires it, a measurement field reads the unit in every plural spelling the locale
  writes, and a value is written with every fraction digit it has unless the profile sets a
  maximum.
- `[localizedInput]` in `@neolorn/equator/forms` binds that parsing to an `input` or a `textarea`
  in Angular Forms.
- `presentIssue`, `issueMessage` and `issueMessageId` pair a failure code from a validator or a
  backend to a message by name, with a generic presentation for a code nothing matches.
- `localizedAsset`, `neutralAsset`, `fixedLanguageAsset` and `resolveLocalizedAsset` select an
  asset per locale and direction.
- `contentPresentation` and `languagePresentation` give content the application supplies its own
  language and direction, including content whose language is unknown. They, `localeProfile` and
  `resolveTypography` refuse a tag the platform does not parse with `invalid-configuration`, with
  the platform's error as its cause.
- Translated content is data. A catalog cannot introduce markup, a script, a URL or a handler, and
  an interpolated value is isolated from the direction of the text around it.
- Authored catalogs refuse directional overrides and embeddings, unbalanced isolates, and the byte
  order mark.
- Compiled catalogs carry content digests and compatibility fingerprints and are checked before
  they are used. `RUNTIME_LIMITS` holds the ceilings on catalog size, nesting depth and evaluation
  steps.
- Five extension contracts: message functions, identifier segments, rich slot kinds, formatting
  adapters and parsing adapters. `defineExtensionRegistry` and `extensionDescriptor` declare them
  to the toolkit, and `defineRuntimeExtensions` and `withExtensions` bind the handlers.
- The `equator` commands `init`, `generate`, `check`, `format`, `clean`, `uninstall`, `watch` and
  `migrate`, with `--project`, `--json` and `--dry-run`. Exit codes are 0, 1 for diagnostics, 2 for
  the invocation or the configuration, 3 for the environment, and 130 when interrupted.
- `equator check` is read-only. `--fix` applies canonical formatting, `--require-complete` fails on
  a locale that omits a source message, and `--require-fresh` fails on generated output that is out
  of date.
- `inProgress` in `equator.config.json` names the locales still being translated, whose
  completeness findings do not block.
- `equator format` formats the configuration and the catalogs, and keeps the comments in a catalog.
- `equator clean` removes generated output. `equator uninstall` removes Equator from a project and
  keeps the authored catalogs unless `--catalogs` is given.
- `equator watch` regenerates in one foreground process as the inputs change, and starts no work
  for a cycle whose inputs did not change. A stopped watch delivers no further cycle and holds
  nothing that keeps the process alive.
- `initializeProject`, `generateProject`, `checkProject`, `formatProject`, `cleanProject`,
  `uninstallProject`, `watchProject`, `compileProject` and `compileProjectFromDisk` are the same
  operations for a build script. Importing the toolkit starts none of them.
- `exportXliff22` and `importXliff22` exchange translations as XLIFF 2.2, with notes, context and
  translation state kept across the round trip.
- `pseudoLocales` in `equator.config.json`, generated only by `--pseudo`, with length change and
  boundary markers set independently. `PSEUDO_LOCALE_ACCENTED` and `PSEUDO_LOCALE_BIDI`
  name the two tags UTS #35 defines.
- `diffCatalogSets` classifies what changed between two catalog sets, and `planMessageRefactor`
  plans a rename or a move of a message across its catalogs and usages.
- `equator migrate --plan` previews or applies one authored change plan. `createMigrationPlan` and
  `applyAuthoredChangePlan` are the same for a build script.
- `parseCatalog` and `parseConfiguration` read the authored files, `formatCatalogSource` rewrites
  a catalog and keeps its comments, and `formatCatalog` writes the text of a new one.
- Diagnostics carry stable `EQ` codes, listed in the
  [diagnostics reference](docs/reference/diagnostics.md) and in `DIAGNOSTICS.md` inside the
  toolkit. `EQ1806` reports an Angular or TypeScript version outside the supported range before the
  compiler runs.
- `withObservability` sends runtime outcomes to a sink the application supplies, including how a
  restore from the back-forward cache or from a server render ended. The event codes are
  `RUNTIME_EVENT_CODES` in the runtime and `TOOLKIT_EVENT_CODES` in the toolkit, and an event
  carries no message content.
- The [cost reference](docs/reference/cost.md) states what each entry point adds to a build, in
  bytes.
- `@neolorn/equator/testing`: `provideLocalizationTesting`, `LocalizationTestingController`,
  `ControllableLocalizationParticipant`, `createInMemoryCatalogLoaders`, `renderedText` and
  `resetLocalizationTestEnvironment`.
- `createLocalizedServerSeat` and `answeredHead` in `@neolorn/equator/testing` answer an address
  through the request handler and read back the status, the headers and the head, with no socket
  and no browser.

## Milestone 1.3.0-rc.1 - 2026-09-15

### Added

- `LocalizedPageOutcome` in `@neolorn/equator/router`, with `pageAbsent`, `pageGone` and
  `pageOperationalFailure` in `@neolorn/equator/core`. A page states that its address is not there, that it is gone, or that it
  failed, and the response carries what it said.
- `declarePageOutcome` in `@neolorn/equator/http`, which states the same three from a renderer.
- `RouteLocalizationContext.pageOutcome`, so the `document` callback writes a head for the state the
  page is in rather than for the route that matched.
- `outcomeDocuments` on `provideLocalizedRouter`, which titles the three responses that have no
  route identity: not found, gone, and an unsupported locale.
- `documentMessage(handle, inputs)`, so a document title or description carries the values its
  sentence takes. A handle that takes values with none bound is refused before any provider is built.
- `createLocalizedServerSeat` in `@neolorn/equator/testing`, which answers an address through the
  request handler and reads back the status, the headers, the resolution and the head, with no
  socket, no built bundle and no browser.
- `localizedInput` binds to `textarea` as well as to `input`.
- `LocalizedServerRouteDeclaration.prerender` and `SitemapRouteDeclaration.prerender` take a
  function as well as a list, so a route's prerendered parameter values can be read at build time.
- `Localization.forgetRememberedLocale`, which asks every configured store to drop the stored choice
  and reports the stores it did not reach. `forget` is optional on `LocalizationPersistenceStore`
  and on `LocalizationProfileTransport`.
- `changeLocale(locale, { remember: false })`, which moves the page without recording a choice.
- `withLocaleAnnouncement` accepts a format function that returns nothing, for an application whose
  own live region announces the change.

### Changed

- A declared absence or removal withdraws the canonical link and the `hreflang` cluster from the
  document, and is classified private and not stored. A declared operational failure leaves the
  address's indexing alone.
- A write to a localized field that arrives before its profile is held and rendered once the profile
  is bound, rather than throwing NG0950.
- `specs/07-routing-rendering-and-seo.spec.md` section 5 states the declaration, its carrier, and
  what it means where there is no response to reach; a new section 12 gives the document head an
  owner; sections 13 to 17 are the previous 12 to 16.

### Fixed

- The Open Graph block is written only where an image is supplied. A declaration carrying a site
  name and no image wrote `og:image` with no value and a card tag beside it.

## Milestone 1.2.0 - 2026-09-15

### Fixed

- The route table the analysis pass reads is a declaration rather than an empty table, so reading a
  route's own field is no longer reported against the application.
- The scope table the analysis pass reads states nothing about which scopes the first render needs,
  and still carries `startup` for an application that reads it.
- The generated scope table distinguishes a compilation whose analysis found nothing deferred from
  one that never analyzed anything.
- A generated scope module carries the message family runtime only where the scope declares a
  family, so `noUnusedLocals` no longer reports unread declarations in one that does not.
- A finding inside a generated module names the module it is in.

## Milestone 1.1.0 - 2026-09-13

### Added

- `declareOperationalFailure` in `@neolorn/equator/http`, with `DeclaredOperationalFailure` and
  `LocalizedRenderResult`. A renderer returns a `Response` as it always could, or a declaration
  wrapping one.
- A declared status travels at an address Equator serves. At an address Equator answered from its
  own status table that classification stands, and the declaration is reported once in development.
- A response carrying a declaration is classified private and not stored.

### Changed

- `specs/07-routing-rendering-and-seo.spec.md` section 5 states the declaration's shape, which side
  wins where the two disagree, the report a release owes a developer when a declaration did not
  travel, and the cache classification a carried declaration takes.

## Milestone 1.0.1 - 2026-09-13

### Fixed

- A structurally unsafe request target reaches the classifier as it arrived, so
  `/en/%2e%2e/%2e%2e/etc/passwd` is refused rather than served as `/etc/passwd`.
- A malformed target no longer reaches a renderer. `RenderableResolution` no longer includes that
  outcome.

### Changed

- `specs/07-routing-rendering-and-seo.spec.md` sections 4 and 5 state that a parsed URL is not the
  target that arrived, that a refused target never reaches the renderer, and that the status
  reporting an operational failure is the consumer application's to declare.

## Milestone 1.0.0 - 2026-09-12

The first stable release, at the surface 1.0.0-rc.2 settled.

## Milestone 1.0.0-rc.2 - 2026-09-12

### Added

- `init`, `uninstall`, `clean` and `format` on the programmatic surface, beside `generate`, `check`
  and `watch`, with their options and result types.

### Changed

- The published surface is what a call reaches. Declarations nothing arrives at from an entry point
  are no longer exported.

### Removed

- `EQUATOR_XLIFF_EXTENSION_NAMESPACE`.

## Milestone 1.0.0-rc.1

### Added

- A formatting pipe for each canonical value kind: `localizedDecimal`, `localizedMoney`,
  `localizedMeasurement`, `localizedPercent`, `localizedPercentagePoints`, `localizedInstant`,
  `localizedPlainDate`, `localizedPlainTime`, `localizedPlainDateTime`, `localizedZonedDateTime`
  and `localizedDuration`. Each takes only the options its own value leaves open.

### Changed

- Every template selector drops the product prefix. `equator-localized-message` is
  `localized-message`, `[equatorLabel]` is `[localizedLabel]`, `[equatorLocaleChoice]` is
  `[localeChoice]`, `equator-localization-recovery` is `localization-recovery`, and
  `input[equatorLocalizedInput]` is `input[localizedInput]`.
- `withRecoveryMessage` takes an options object rather than a bare message.

### Fixed

- The retry control in the recovery surface takes a message, and renders in the page's own language
  rather than in English.

## Milestone 1.0.0-beta.2

### Added

- The MIT license, with the notice inside both packages.

### Changed

- Both packages publish to the public registry.

## Milestone 1.0.0-beta.1

### Added

- A locale falls back to the locale it inherits from before falling back to the source, walked to
  the end of the chain. `parentLocales` in `equator.config.json` replaces one hop, and `und` as the
  value says a locale has no parent.
- `projectSitemap` returns the sitemap files, built from the page projection the head is built
  from. Past the protocol's limits the set splits into an index and numbered siblings, and the name
  given stays the address a crawler was given.
- A route states its own `changefreq`, `priority` and `lastmod` through `withRouting`, read from a
  field on the route's own data. `EQ1412` refuses a value the protocol would reject.
- `resetLocalizationTestEnvironment` puts the shared test environment back between spec files.

### Changed

- `equator check --require-complete` counts a locale complete once its whole inheritance chain is
  counted.
- Angular tooling 22.1.7 is supported.
- A route projection is checked and arranged once when Equator is handed it, rather than validated
  and walked again for every address built or resolved.

## [0.23.0]

### Added

- `formatting` in `equator.config.json`: each locale declares the numbering system, calendar or hour
  cycle it is written with.
- `DIAGNOSTICS.md` inside the toolkit, derived from the codes the toolkit can report.

### Changed

- `equator check --require-complete` blocks on every finding that says a locale is unfinished,
  including `EQ1306`, a scope with no catalog for that locale at all.
- A stricter run reports every finding it can still observe.
- The switcher label for a locale is decided in the build, and reads the same on every browser.
- Message codes are divided by what a message is wrong about rather than by which stage refused it.
- `planMessageRefactor` takes the message usages rather than a whole analysis.

## [0.22.2]

### Changed

- The steps of a locale change run in one stated order: the document language and direction, the
  address bar, the head, the captured interaction, then the announcement.

### Fixed

- A locale is advertised in the head, and offered by the switcher, only at an address that serves
  it.
- An application served under a sub-path reads the locale from its own address.
- An application served under a sub-path publishes its canonical and alternate URLs at the sub-path
  it is served from.
- A switcher option points inside the deployment it is rendered in.
- The address bar spells the current route in the committed locale after a history move, not only
  after a locale change.
- Adding a scope to a working project no longer fails the next `equator generate`.
- `equator init` run below a configured project no longer initializes the parent. Discovery stops at
  the package it is standing in.
- A browser asking for a language written under another subtag is matched, so `no` reaches `nb-NO`
  without an alias written by hand.

## [0.22.1]

### Changed

- A locale URL policy whose kind the router cannot express is refused, rather than warned about and
  served in part.
- A host policy whose origins do not name the origin the build answers at is refused.

### Fixed

- A redirect the resolver answers is followed when a visitor arrives from inside the application.
- Switching to a locale carried by another origin goes to that origin, rather than committing the
  locale and leaving the reader on the old page.

## [0.22.0]

### Added

- `EQ1411` refuses a `routerLink` whose leading segment the project claims for a locale, at build
  rather than as a console warning after the click.

## [0.21.1]

### Changed

- A refused message says what is wrong with it rather than repeating the parser's own label.

### Fixed

- Options written on `:string`, `:datetime`, `:date` and `:time` are read rather than accepted and
  ignored.
- `und` carries the language subtag both standards give it.

## [0.21.0]

### Added

- A registered message function can say what MessageFormat lets a selector say: its own option
  names, which keys it matches, which of two matching keys it prefers, and the options it inherits
  from its operand.

## [0.20.1]

### Changed

- A diagnostic written for a person is one line.
- A rejected message key, a parse failure and a project with no catalogs each say what to do next.

### Fixed

- `equator generate` succeeds on a project with no messages yet.
- A `.match` over a function that formats but does not select is refused.

## [0.20.0]

### Added

- `localeChoices`: the configured locales as switchable options in one signal, each choice carrying
  the address of the current route in that locale.
- `equator init` sets every field the configuration accepts, including `personNameLocales` and
  `pseudoLocales`.

### Removed

- `localeSelector()`. `localeChoices` and `changeLocale` replace it.

### Fixed

- A diagnostic reporting something absent points at the nearest thing that is in the file.

## [0.19.2]

### Fixed

- A scope finishing its load publishes through the same door as a locale change.
- A scope load belongs to the snapshot it was requested against.
- A snapshot no longer reports a route address belonging to a locale it is not in.

## [0.19.1]

### Changed

- A numeric option this runtime cannot honor is refused, rather than parsed, shipped and ignored.

### Fixed

- A literal number operand formats instead of throwing while rendering.
- A reference to a declaration renders the value that declaration produced, with the options it was
  given.
- `:integer` discards the operand options it cannot honor instead of throwing.

## [0.19.0]

### Added

- Variants that collide when a catch-all is written as `other` are detected before an export loses
  one of them.

### Removed

- The cache argument on the standalone formatting functions, which now share one cache.

## [0.18.1]

### Fixed

- An address handed to the router directly reaches the same route as one the browser supplies.
- The reader's inline position is restored to where they were rather than to its mirror image when
  the writing direction changes.
- The restored position holds when the engine reveals a focused element after a direction change.
- A prerendered address written in a non-Latin script is served.
- An address the route projection has no route for commits the locale its own prefix states.

## [0.18.0]

### Added

- A flat translation that drops a value the source renders is refused on import.
- `EQ1409` reports a route whose leading segment the project has already claimed for a locale.

## [0.17.0]

### Added

- `@neolorn/equator/core`: the classification, the vocabulary and the locale profiles, importing no
  Angular.
- `@neolorn/equator/http`: a handler that takes a request and returns a response with the redirect,
  the status, the language header, the indexing header, the cacheability and the preference cookie
  already decided.
- A route publishes its own metadata: an Open Graph block when the deployment supplies an image, a
  localized title that survives the navigation that sets it, and its address in every locale.

## [0.16.1]

### Fixed

- Focus returns to where the visitor was, not to whatever they moved to while the locale was
  committing.
- A response whose body varies by locale says so.

## [0.16.0]

### Added

- Equator emits the cache directives its own routing determines, and takes from the application only
  the lifetime it has no basis to guess.

### Changed

- An address that carries a different answer per preference is private.

### Fixed

- The caret after a locale change is restored by one owner, counting characters as a reader sees
  them rather than as code units.

## [0.15.0]

### Added

- A participant can answer that it has no content of its own in a locale, rather than failing the
  transition.

### Changed

- A locale URL policy is narrowed to the locales the build has, once.

## [0.14.1]

### Fixed

- `equator generate --pseudo` works for an application that registers a message extension.
- An address is published only for a locale the build actually has.
- A page renders in a locale the application has no content of its own in.

## [0.14.0]

### Added

- `pseudoLocales` in `equator.config.json`, with `equator generate --pseudo` deciding whether a
  build contains them.

### Changed

- A pseudo-locale's behaviors combine freely. Length change, accents, boundary markers and
  direction are independent settings rather than two fixed combinations.

## [0.13.0]

### Added

- `provideLocalizedRouter` replaces the four routing calls with one. It wraps `provideRouter`,
  derives the locale branches from the route projection, installs the localized location strategy
  and keeps the address in step.
- `provideLocalizedServerRendering`, on `@neolorn/equator/ssr`, installs server rendering from the
  projection the client already has.
- Each locale's spelling of an address appears in the route table, and a localized address can be
  prerendered.
- `EQ1405` reports a route that renders nothing, carrying none of `component`, `loadComponent`,
  `redirectTo`, `children` or `loadChildren`.
- `EQ1406` reports a route that hides addresses from the projection, by computing its own path or
  by loading its children from a file it only references.
- A warning when the application replaces the router configuration or the location strategy that
  the localized router provides.

### Changed

- A route parameter codec is required to read back the spelling it writes.
- The address that carries no locale is suppressed by Equator rather than by a fallback route in the
  application.
- An application no longer restates Equator's own defaults in its composition. The default order of
  locale sources is the default.

### Fixed

- A captured interaction is released on a locale change that no navigation follows.

## [0.12.0]

### Added

- `personNameLocales` in `equator.config.json`: an application declares the languages the names it
  renders are written in.

### Changed

- `formatPersonName` formats from published patterns rather than from a field order. Sorted order,
  monograms and formal address follow the locale.

## [0.11.1]

### Fixed

- A plural rule keyed by more than one subtag is matched.
- The quality parameter in a browser's language header is read whatever its case, and language
  range lookup follows its specification.
- A cookie configuration the browser would discard is refused rather than written.

## [0.11.0]

### Added

- Exported XLIFF is validated against the schema it claims, and the identifiers Equator writes into
  it are legal for that schema.

### Changed

- Variant selection and value isolation follow what MessageFormat says. A function answers whether
  it matches and which key it prefers as separate questions, and a resolved value carries its own
  direction.
- The strong right-to-left class is derived from the Unicode bidirectional property rather than
  from a hand-written block list.

## [0.10.1]

### Removed

- Four exports that nothing outside the packages could usefully call.

### Fixed

- A message handle that declares no inputs can be called without an inputs argument.
- A numbering system is requested through the locale rather than through an option.
- A declared numbering system reaches every numeric placeholder in a message.

## [0.10.0]

### Added

- `equator check --require-fresh` fails on generated output that is out of date.

## [0.9.3]

### Changed

- Angular 22.1.3 is supported, with the framework and the tooling declared as separate version
  ranges.

### Removed

- `@angular/compiler-cli` as a required peer of the toolkit.
- The deferred-content directive.
- The pseudo-localization helper for asserting against pseudo-localized output.

### Fixed

- The completeness gate reads whether a message selects cardinally or ordinally, instead of
  demanding cardinal categories from an ordinal message.
- The formatting mark a locale writes beside a sign is read back, and a negative number in those
  locales parses.
- A command's exit code follows the severity of what it found.

## [0.9.2]

### Removed

- The compatibility arguments on the feature functions. `withDocumentLocale()` is now
  `withoutDocumentLocale()`, which takes none.

### Fixed

- The locale announcement reaches a screen reader without the application rendering anything for
  it.
- An address with no locale is sent to one even where no page exists there, rather than a blank
  page answered as success.
- The reader's place is restored after the router has finished moving the page.

## [0.9.1]

### Fixed

- A scope used only from component templates is deferred with the route that defers it.
- A deferred scope is loaded when its route activates.
- Setting localization up no longer reports a false error in the application's providers array.
- An address the route projection cannot name is answered by the application's own routing rather
  than as a localization failure.
- A route projection with no parameterized routes is accepted.

## [0.9.0]

### Added

- `withRouting`: routing declared in one place. Routes default to indexable, and the application
  names the route-data field that marks the exceptions.
- `[equatorLabel]`: a message in attribute position, for `aria-label`, `title`, `placeholder` and
  `alt`.
- `presentIssue` pairs a backend failure code to a message by name.
- `localizedServerRoutes` derives the prerender table from the routes and the locales.
- `equator uninstall` removes Equator from a project. `clean` keeps its usual meaning of removing
  build output, and authored catalogs survive both.

### Changed

- Published names say what a thing does rather than carrying the product name.
- A route identity survives edits that keep the address. Renaming a parameter no longer orphans the
  messages keyed on that route.
- `equator.config.json` carries one version marker.

### Removed

- `withBootstrapScopes` and `withInitialLocale`. The first is derived from the route tree, the
  second is the default order of locale sources.

### Fixed

- `equator format` keeps the comments in an authored catalog.
- A block deferred until interaction hydrates in the locale that is committed.

## [0.8.0]

### Added

- `provideLocalization` is generated into the application's own `#i18n` with the configuration,
  catalog set, loaders, recovery payload and startup scopes already closed over. Setting Equator up
  is one import and one call.
- A report when an application runtime selects no recovery message.
- An advisory listing source messages nothing in the application uses.

### Changed

- Only the messages the first render needs are downloaded. The rest arrive with the route that uses
  them.

## [0.7.0]

### Added

- A message keeps its input contract when it crosses into a template. A misspelled key, a missing
  value, or a value of the wrong type fails at build.
- `defineRouteProjection` keeps the route identities and parameter names the generated projection
  knows. An unknown identity, a missing parameter or a misspelled parameter name fails at build.
- `equator init` creates a package manifest for an application that has none. A workspace with more
  than one application is a supported layout.

### Changed

- A formatting or parsing adapter is addressed by the adapter rather than by a name the compiler
  cannot check.

### Fixed

- An instant finer than a millisecond formats, rather than being refused outright.

## [0.6.1]

### Fixed

- Navigating to a locale builds the destination page in that locale, rather than painting it in the
  previous one and correcting it a moment later.
- A value that is not text is refused where a locale alias or a provider identity is expected.

### Security

- The overlay adapter is created once per request rather than once per process. One request's
  overlays cannot take another request's language, and disposing one context cannot dispose them
  for every request still in flight.

## [0.6.0]

### Added

- The locale is decided once, from one ordered chain: the address, a stored choice, the browser,
  then the default. `withLocaleSources` reorders it.
- A remembered choice is written only after a change that succeeded.

## [0.5.1]

### Fixed

- An address with no locale redirects into the locale that was resolved, spelled in that locale.

## [0.5.0]

### Added

- `EQ1307` reports a target locale that omits a message, and names the locale that stands in for
  it.
- `EQ1308` reports the plural categories a target locale leaves out, and says those counts fall
  through to the catch-all.
- A translation whose source has changed since it was written is reported, and stays reported until
  the translation is updated.
- Content with no known direction has an explicit unknown state.
- Notes and context written beside a message reach the translator as notes in the exported
  document, and survive the round trip back.

### Changed

- Relative time picks the largest unit the span reaches, truncated toward zero. Outside the range
  the application declares, the answer is an explicit decision not to be relative, carrying the
  elapsed span.

### Security

- Authored catalogs refuse directional overrides and embeddings, unbalanced isolates, and the byte
  order mark. Balanced isolates and directional marks are kept.

## [0.4.1]

### Fixed

- A finding in a catalog reports the line and column it sits on.
- A date formatted with a textual month renders the month.
- A project carrying more of its own type errors than Equator reports at once can still generate.
- A catalog is admitted once per process rather than once per server request.
- A catalog that fails at startup shows the recovery surface instead of an empty page.

### Security

- A component template path pointing outside the selected project is reported rather than opened.

## [0.4.0]

### Added

- A localization failure carries the original error as its cause, a closed reason naming what kind
  of thing failed underneath, and the identity of the message that broke.

## [0.3.2]

### Fixed

- Analysis runs under the application's own compiler configuration. A workspace with path aliases
  or its own strictness can generate. Findings in the application's own source are advisories, and
  findings inside a generated module still fail.

## [0.3.1]

### Fixed

- The toolkit's published surfaces refuse input they cannot honor.

### Security

- Hardening across the runtime and the toolkit, with failures reported rather than swallowed.

## [0.3.0]

### Added

- Translations leave and return as XLIFF.
- A pseudo-locale, to find text that never reached a catalog.
- Catalog lifecycle operations for a message across its whole locale set.
- Locale URL policies: a path prefix, an alias, a locale-neutral root, or a host.
- Application-local extensions, for an application's own formatting and parsing.
- Localized assets, for an asset that differs by locale.

## [0.2.0]

### Added

- Numbers, dates, times, durations and the other canonical value kinds format from the locale
  rather than from the call site.
- Compiled catalogs are loaded and evaluated, in the browser and on the server.
- The locale changes while the application is running, and the lifecycle, the document and the
  loaded scopes follow it.
- The Angular surface: a pipe and a component for putting a message on the page, with testing
  helpers beside them.
- A recovery surface for when catalogs cannot be loaded.
- Optional adapters for forms and for the router.
- A generated route projection the runtime reads.
- Participants, which join a locale change and are waited for before it commits.
- A hydrated page and a localized entity route agree on the locale they are in.

## [0.1.0]

### Added

- Messages are authored in one catalog format per locale, carrying MessageFormat semantics.
- The toolkit reads the application's own source and generates typed contracts for the messages it
  uses.
- Catalogs compile to artifacts that are identical for identical input.
- The `equator` command line drives a project.

[1.0.0-rc.1]: https://github.com/neolorn/equator/releases/tag/v1.0.0-rc.1
