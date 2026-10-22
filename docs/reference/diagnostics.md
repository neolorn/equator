# Diagnostics

Every code Equator reports, and what it means: the diagnostics of `@neolorn/equator-toolkit`, the
event codes both packages send to an observability sink, and the failure codes a runtime
diagnostic carries. A diagnostic carries its own summary describing what happened where it
happened; this page describes the code.

This page is generated from the declarations of the codes and is not edited by hand. The toolkit
diagnostics also ship inside that package as `DIAGNOSTICS.md`, readable from an install with no
network.

Severity is not listed. Several codes carry the severity the run decides: the completeness family
and `EQ1704` are advisory or blocking depending on the command's switches and the project's own
declarations. A finding states the severity it carries, and a run acts on that.

What a diagnostic contains, and what it never contains, is
[About diagnostics and runtime outcomes](../explanation/about-diagnostics.md).

## The project configuration

### EQ1001

`equator.config.json` is not one readable JSON value: a syntax error, a repeated key, more than one value, text that is not UTF-8, or the configuration byte ceiling.

### EQ1002

`equator.config.json` is readable JSON, and one of its values is not what the configuration schema allows.

### EQ1003

A locale identifier is malformed. Every place a locale is written is canonicalized first (`locales`, `personNameLocales`, a pseudo-locale tag, a `formatting` or `inProgress` key, an alias target, a catalog's own locale) and a tag the platform would accept can still be refused, including one carrying extensions or private-use subtags.

### EQ1004

A locale identifier is well formed and declared where it cannot be used: it duplicates another after canonicalization, or it names a locale this project does not serve.

### EQ1005

A locale alias is malformed. An alias is a lowercase ASCII identifier of letters, digits and hyphens: a name for a URL rather than a locale tag.

### EQ1006

A locale alias points somewhere it must not: it shadows a supported locale, or it targets a locale the project does not serve.

### EQ1007

A declared parent locale cannot be inherited from: it is the locale itself, or the chain it starts comes back to a locale already in that chain.

### EQ1008

A pseudo-locale tag is well formed and cannot identify a pseudo-locale: it names no script, its language is not the source locale's, or its region claims what the locale is not. XA is English lengthened left to right, as `PSEUDO_LOCALE_ACCENTED` is, XB is English right to left, as `PSEUDO_LOCALE_BIDI` is, and any other pseudo-locale takes one of XC to XJ or XL to XZ, which UTS #35 leaves free.

## The catalog file

### EQ1101

A catalog file is not the YAML Equator accepts: invalid, oversized, or more than one document; anchors, aliases, merge keys, directives, non-string keys or non-Core scalars; a root that is not a mapping; malformed Unicode or unauthorized invisible and bidi controls; or the node, depth and message ceilings.

### EQ1102

A catalog is well-formed YAML, and one of its entries is not what the catalog schema allows.

### EQ1103

A catalog repeats a key, or its text, or a translation an XLIFF import would write into it, carries a bidi construction Equator refuses.

### EQ1104

A provider, scope or message identity written in a catalog is malformed, or the provider identity of the owner a compilation was handed is.

### EQ1105

A target catalog declares `inputs` or `slots`. Those belong to the source catalog, and a target inherits them.

## The message

### EQ1201

A message is not valid MessageFormat 2 syntax, or exceeds the message byte ceiling.

### EQ1202

A message parses and its data model is invalid: a duplicate declaration, variant or option name, a variant key mismatch, a missing fallback variant, or a selector that reaches no annotation. Which of the two stages found it does not decide the code: the specification's division does.

### EQ1203

A message calls a function outside the Equator 1 profile, which is the UTS #35 default registry.

### EQ1204

A message writes a function option outside the profile, or gives an option a value the profile does not allow.

### EQ1205

A message gives a function an operand it cannot take. Its own code rather than `EQ1204`'s, because a wrong option and a wrong operand have different fixes.

### EQ1206

A `.match` selects on a function that formats but does not select.

## The catalog set

### EQ1301

The catalogs of one scope do not form a set: a locale the project does not declare, a duplicate catalog, no source catalog, an empty scope, or a catalog whose role does not match its locale.

### EQ1302

A message's inputs are not usable: an unknown or unrefinable portable type, incompatible operand uses, an enum value the type cannot hold, a refinement matching no inferred input, an explicitly empty message declaring inputs, or the per-message input ceiling.

### EQ1303

A message's rich slots do not form a valid structure: unclosed or mismatched, nested where nesting is refused, used both paired and standalone, of an unregistered or undeterminable kind, refined past what the source supports, or the per-message slot ceiling.

### EQ1304

A translation does not honour the source message's contract: it invents a message, changes or invents an input, or omits a required rich slot.

### EQ1305

Generated names collide, or an open family is not well formed: two identities projecting to one generated path, a repeated placeholder, a template with no fixed part, members whose contracts differ, or a message two families both match.

### EQ1306

A scope has no catalog at all for a locale the project serves; the source locale is used in its place. One of the four completeness findings: advisory unless the run requires complete targets and the project has not declared that locale still in progress.

### EQ1307

A target catalog omits a message the source has; the source locale is used in its place. Escalates with the rest of the completeness family.

### EQ1308

A translation omits a plural or ordinal category its locale's grammar has, so those counts fall through to the catch-all. Escalates with the rest of the completeness family.

### EQ1309

A translation was written against an older source message and may no longer match it. Raised against the translation record rather than the catalogs, and escalates with the rest of the completeness family.

### EQ1310

This owner composes the Equator application runtime and selects no recovery message, so a failed bootstrap has nothing to say.

### EQ1311

A scope defines source messages that nothing in the application reaches.

## The application

### EQ1401

TypeScript refused the application or its configuration while Equator was analyzing it.

### EQ1402

An Angular component template could not be read or was refused: a symbolic link, a path resolving outside the selected owner, or a template Angular's own parser rejected.

### EQ1403

The analysis exceeded its source-file or byte ceiling, or was asked to resolve something outside the generated `#i18n` namespace.

### EQ1404

A route's identity cannot be used: declared in a form the localization runtime refuses, declared in a way the build cannot read, not derivable from what the route declares, colliding with another route's, or the owner declaring two route-indexing fields.

### EQ1405

A route renders nothing: it carries none of `component`, `loadComponent`, `redirectTo`, `children` or `loadChildren`, or it has an empty path and a wildcard written before it takes its address.

### EQ1406

A route hides addresses from the projection: its address comes from a computed `path`, a `matcher`, or a spread or computed key that may set either, or its children load from a file it only references, or a route table takes routes from a binding, a spread or an expression Equator does not follow. Those addresses stay outside the localized route table and are served at their canonical form in every locale. Also raised for a route that renders in a named outlet, or names its outlet in a way the build cannot read, which is never a page and is left out of the projection.

### EQ1407

A route loads a file through a lazy boundary that something in the initial bundle also imports statically, so the split does not happen.

### EQ1408

The configuration and the locale URL policy disagree: a configured locale with no address, an address with no catalogs, two different default locales, or more than one policy for Equator to read. The policy is read from the options written as literals in the call that builds it. The locale table is compared only when every entry in it is written out, so a table taken from a constant or a function, or one with an entry that is spread in or has a computed key, is not compared, and neither is a default locale that is not a literal. An option with a spread written after it in that call is not read, because the spread can replace it. The running application then drops a policy locale that has no catalogs and refuses a policy whose default locale the configuration lacks; a configured locale with no address and a different default locale go unreported. EQ1417 names the options that were not read.

### EQ1409

A route's leading segment is one this owner has already claimed for a locale, so the route and the locale compete for the same address. The claimed segments are the prefixes, aliases and locale-neutral roots written as literals in the call that builds the policy; one taken from a constant, a spread or a function is not read, no prefix is read from a locale table that is not written out whole, and nothing is read from an option with a spread written after it in that call. The running application refuses such an address when it builds one that carries no locale prefix. EQ1417 names the options that were not read.

### EQ1410

A component template spells out something about a locale that Equator already knows and can hand it: the language subtag, the direction, or the locale's name in its own language.

### EQ1411

A component template writes a `routerLink` whose leading segment is one this owner claims for a locale.

### EQ1412

A sitemap declaration cannot be used as written: a changefreq outside the seven the protocol lists, a priority that is not a number literal between 0 and 1, a lastmod that is not a W3C date, a field, table or route value the build cannot read, or the owner declaring two route sitemap fields.

### EQ1413

A caching declaration cannot be used as written: a value that names neither `per-visitor` nor `not-stored`, a table or a route value the build cannot read as a string literal or a `const` bound to one, or the owner declaring two route caching fields. A route whose value cannot be used is answered as not stored until it is corrected. Also raised where a `matcher`, a `canMatch` guard or a value the build cannot read decides which route renders an address, which is then answered as not stored.

### EQ1414

An indexing declaration cannot be used as written: a route value the build cannot read, because it is computed, a parameter, supplied by a resolver or behind a binding it cannot follow, or a field or table it cannot read. A route whose value cannot be read is answered as private until it is corrected. Also raised where a `matcher`, a `canMatch` guard or a value the build cannot read decides which route renders an address, which is then answered as private.

### EQ1415

A route names its addresses in a way Angular refuses: neither a `path` nor a `matcher`, or a `matcher` beside a non-empty `path`.

### EQ1416

The router's inheritance strategy cannot be read: a `paramsInheritanceStrategy` the build cannot read as a string literal or a `const` bound to one, or more than one router configuration where one sets it. Every child route is read as inheriting its parent's data, which is Angular's default.

### EQ1417

The locale URL policy is not written out whole, so EQ1408 and EQ1409 were not checked for part of it. The advisory names each option of the call that builds the policy that the build did not read: the locale table, `defaultLocale`, `aliases` or `localeNeutralRoots`, where it or an entry in it comes from a constant, a function, a spread or a key that is not a literal, or has a spread written after it. It does not block a build. Write the named options as literals in the call to have them compared.

## The compiled artifacts

### EQ1501

A compiled artifact cannot be produced from the accepted graph: a recovery identity that does not resolve to one existing plain message without inputs or slots, or a catalog absent from the graph.

### EQ1502

A compiled catalog exceeds the IR node or depth ceiling.

### EQ1503

The output plan or the completion manifest is invalid: a malformed or colliding output path, an attempt to replace the reserved completion marker, or a manifest whose header, entries or plan digest do not hold.

## The generated output

### EQ1601

The generated root is not Equator's to write: no completion and ownership manifest, an unowned file inside it, an owner identity that is not this one, or a root inside a dependency directory or the build output.

### EQ1602

An output or authoring transaction did not complete. The message says whether the prior state was restored, because a failure that rolled back and one that could not are different situations.

### EQ1603

Generated output does not match its completion manifest: a file missing, a file changed, or the manifest itself moving while the output was being inspected.

## The command

### EQ1701

The command cannot act on how it was invoked: an unknown or malformed argument, or a noninteractive `equator init` with a required option missing.

### EQ1702

The project could not be selected or read: no Equator configuration inside the package boundary, a selection that is a symbolic link or not a directory, an owner `package.json` that is missing, unreadable or not an object, an owner `angular.json` that is unreadable, a TypeScript source behind a link, or a translation-state record that is present and cannot be read.

### EQ1703

An environment operation failed, or a disposable one was skipped: a corrupt, incompatible, oversized or linked incremental cache, a cache that could not be persisted, a formatting refused because semantic equality was not proven, or a watcher that could not start or reconcile.

### EQ1704

Generated output is stale against the compilation that would produce it. Advisory unless the run requires fresh output.

### EQ1705

`package.json` does not carry what Equator needs, or carries something that conflicts with it: the `#i18n` import mappings, the scripts `equator init` writes, or init arguments that contradict the existing `equator.config.json`.

### EQ1706

`equator init` finished, and is naming the two things that are now the owner's to write: the first catalog, and a recovery message.

## Interchange, authoring, and the host

### EQ1801

An XLIFF document is not readable XML, or exceeds the Equator byte ceiling.

### EQ1802

An XLIFF export or import cannot be performed at all: catalogs that are not the source and target of one scope, a file or unit id that is not an `xs:NMTOKEN`, a document that is not the Equator 2.2 profile, or a source message whose markup has no XLIFF inline representation.

### EQ1803

An XLIFF unit cannot be imported as a translation: placeholders the source does not have or that the translation never renders, a segment state Equator does not accept, notes it does not store, a unit outside the authoritative source catalog or stale against it, or an attempt to change what the authoring catalog owns.

### EQ1804

A pseudo-localization request is invalid: a length factor outside its range, a message that does not parse, or a catalog that is not a source catalog.

### EQ1805

An authored change plan, an application-local extension registry, or a semantic refactor was refused: invalid or oversized input, an invalid or duplicate operation, an undeclared or nonportable option, or a refactor whose source is unavailable and whose destination already exists.

### EQ1806

The host is outside Equator's supported range: Node.js, TypeScript, or the Angular compiler.

## Toolkit events

An operation given a `ToolkitObservabilitySink` reports `started` and then `succeeded`,
`unchanged` or `failed` under one of these codes. A failure carries the code of the first
diagnostic as `diagnosticCode`, unless the operation threw.

### EQ-E1001

Declared as `TOOLKIT_EVENT_CODES.compilation`.

Compiling a project. `compileProject` reports it under phase `compilation`, `compileProjectFromDisk` and `checkProject` under phase `integration`, and `generateProject` under phase `generation` around the compilation it runs. On success, `count` is the number of files in the output plan, or for `generateProject` the number of files written and removed, and `unchanged` means `generateProject` wrote nothing.

### EQ-E1002

Declared as `TOOLKIT_EVENT_CODES.interchange`.

Exchanging translations in XLIFF with `exportXliff22` and `importXliff22`, under phase `interchange`. The event names the provider and scope, and on success carries the number of messages as `count` and, where the exchange has one, the target locale.

### EQ-E1003

Declared as `TOOLKIT_EVENT_CODES.migration`.

The migration area, phase `migration`: applying an authored change plan, the work `equator migrate` does.

## Runtime events

The sink you pass to `withObservability` receives one of these as `code`, with the same area in
words as `phase`. An event that did not succeed carries its reason, one of the runtime failure
codes below, where there is one.

### EQ-E2001

Declared as `RUNTIME_EVENT_CODES.initialization`.

Initializing the localization context: `started`, then `succeeded` with the committed locale and snapshot, or `failed` with the reason. `cancelled` means the context was disposed while it was initializing. `unavailable`, with the reason, is reported beside `failed` when the recovery message for the failure could not be evaluated.

### EQ-E2002

Declared as `RUNTIME_EVENT_CODES.catalog`.

Loading the catalogs of one scope for a locale, with the provider, scope and transition. `succeeded` carries the locale that supplied them. `unavailable` means there is no catalog to serve, reason `scope-unavailable`. A load cut short by a newer change or by disposal is `superseded` or `cancelled`, and any other failure is `failed`, including a missing source catalog, reason `invalid-configuration`.

### EQ-E2003

Declared as `RUNTIME_EVENT_CODES.transition`.

A locale change: `started`, then `succeeded` with the committed snapshot, or `failed`, `cancelled` or `superseded` with the reason. A locale that is malformed or not served fails at once, with no `started` before it. `redirected` means a locale-specific origin claimed the change, so it continues as a document navigation and no transition runs.

### EQ-E2004

Declared as `RUNTIME_EVENT_CODES.formatting`.

A formatting pipe could not format its value. The pipe renders an empty string, and the event carries the reason and the snapshot that was current. Formatting through the facade returns the diagnostic to the caller and emits no event.

### EQ-E2005

Declared as `RUNTIME_EVENT_CODES.cache`.

The catalog cache that `maximumCachedCatalogs` bounds, under phase `cache`: `succeeded` for each entry it evicts, with the entry's provider, scope and locale and `count` the entries it still holds; `unavailable` with `count` when every entry over the bound is held; `failed` with `catalog-admission-failed` when a catalog transferred from the server is not admitted.

### EQ-E2006

Declared as `RUNTIME_EVENT_CODES.ssrHydration`.

Carrying the committed localization from a server render to the browser, under phase `ssr-hydration`. On the server, after a commit: `started`, then `succeeded` when the snapshot was written to the transfer state, or `failed` with `internal-invariant` when there was none to write. In the browser, when a transferred snapshot is present: `started`, then `succeeded` with its locale, or `failed` with `invalid-configuration` when the snapshot was not accepted. Also in the browser, when the application starts, for the restore a page the server drew is owed once it is adopted: `unavailable` when no snapshot was transferred, so the browser drew the page from the stores itself and none is read again, and `cancelled` with `disposed` when the application was destroyed before hydration ended. Where neither is reported the stores are read, and `EQ-E2008` says how that ended.

### EQ-E2007

Declared as `RUNTIME_EVENT_CODES.integration`.

An integration failed, with the reason and, where one is responsible, the participant: preparing the required participants for a change, applying the commit hooks and committing the participants, a commit hook's `committed` callback, a commit hook's `dispose` when the context is disposed, or a participant's `commit`, `discard`, `rollback` or `dispose` that answered with a promise. The status is always `failed`.

### EQ-E2008

Declared as `RUNTIME_EVENT_CODES.persistence`.

Reading, writing or removing the remembered locale, with the store's id as `correlationId`. Reading reports `failed` when a store throws, and `unavailable` with `unsupported-locale` when a store holds a locale that is malformed or no longer served; the next store is read instead. Writing happens after a commit that changed the locale and reports `succeeded`, `failed`, or `superseded` when a newer choice arrived first. Removing reports `succeeded`, `failed`, or `unavailable` for a store with no way to remove. A restore, which reads the stores again for a page returned from the back-forward cache or adopted from a server render, reports with no `correlationId`, and no two ways it ends report the same event. Before the stores are read: `unavailable` with no `snapshotId` when no locale is committed yet, `cancelled` with `disposed` and no `snapshotId` when the context is disposed, and `cancelled` with `superseded` and the locale being moved to when a change is in flight. Otherwise `started`, then one of: `succeeded` with the stored locale, after which the change it asks for reports under `EQ-E2003`; `unavailable` when the stores hold nothing that moves the page; `superseded` when a change or a removal was asked for while the stores were read; `cancelled` with `disposed` when the context was disposed while they were read.

## Runtime failures

A runtime diagnostic's `code`, and a runtime event's `reason`, is one of these. The diagnostic's
`outcome` says what kind of thing happened. It is `operational-failure` unless the entry names
another outcome.

### cancelled

A pending locale change was cancelled with `cancelTransition()` or ended by disposal, or participant work was cancelled with it or prepared for a change that did not commit. A catalog load or participant attempt stopped by disposal reports `cancelled` as its status and `disposed` as its reason.

### catalog-admission-failed

A generated catalog loaded and was refused: its resource summary does not match its measured content, its content digest does not match the one recorded for it, or it failed the identity or compatibility checks.

### catalog-load-failed

A generated catalog module could not be loaded. The error the load raised is the `cause` of the `LocalizationError`. The testing entry point raises it when a test fails a controlled catalog load.

### disposed

The localization context was disposed before or during the work, or a participant was unregistered while it had work in progress or before a commit that required it.

### effect-failed

A document effect of a locale change was refused or failed: a localized title, description or announcement is out of bounds or contains control characters, an address in the document metadata is not a valid URL or not a safe one, or the router's document effects failed after the locale changed.

### internal-invariant

A failure with no more specific code. An error that is not a `LocalizationError`, such as one thrown by a persistence store or a commit hook, is reported under this code. The runtime also raises it when a server render has no committed snapshot to transfer.

### invalid-configuration

The configuration, the generated artifacts, or the call do not fit together. Among the cases: the generated configuration and catalog set disagree, a generated scope, catalog descriptor or loader map is malformed or over its ceiling, a scope's source catalog is missing, `maximumCachedCatalogs` is out of range, required and progressive scopes overlap, the generated message handles were built for another runtime, a route declaration or parameter codec cannot be used, a parameter codec throws, where the reason is `consumer-code-threw`, a locale URL policy written out as an object is not what a policy constructor writes, a `localeNeutralRoots` list has an empty slot, a locale handed to a policy constructor or an address builder is not text, a tag handed to `localeProfile`, `contentPresentation`, `languagePresentation` or `resolveTypography` is not text, does not parse, where the cause is the platform error, or names no script and has none likely, a host policy is given no origin or one it does not name, the `mode` handed to `changeLocale`, `provideLocalizedRouter` or `RouteLocalization` is neither `coordinated` nor `progressive`, the `numberingSystem` handed to `parseLocalizedInput` or `formatLocalizedInput` is not a well-formed identifier, an option is given a value of another kind than the one it takes, a cookie's name or attributes cannot be stored, the status handed to `pageOperationalFailure` is outside 200 to 599, or `retry()` is called when initialization has not failed. In the browser, a transferred server snapshot that is not accepted is reported under this code.

### invalid-localized-input

Text could not be read as a value of the requested kind, by `parseLocalizedInput` or by a parsing adapter.

### invalid-message-input

A message was evaluated with an input it cannot use: a declared input is missing, a function's operand or option is not what the function requires, such as a number, a currency code, a unit or a date-time, or a canonical value such as a decimal, a date, a time or a time zone is malformed or does not exist.

### invalid-rich-message

A message cannot be evaluated as asked: a structured message was asked for with `text()` or a plain one with `parts()`, a value reference or option is outside the Equator profile, evaluation exceeded its step, output or literal ceiling, the trusted binding for a semantic slot is missing or of the wrong kind, or a destination is refused.

### message-unavailable

The message has no representation in the requested locale, outcome `localized-representation-unavailable`. Under the default fallback policy the source message supplies the result and this code travels with it as metadata; under the strict policy the evaluation is refused. Also raised when no generated representation compatible with this runtime exists.

### participant-contract-rejected

A participant returned no report, or metadata that is invalid or outside its bounds, or answered `commit`, `discard`, `rollback` or `dispose` with a promise, where the answer has to be synchronous.

### participant-failed

A participant reported a failure, threw, or failed while committing, in which case the committed participants are rolled back. The testing entry point raises it when a test fails a controlled participant.

### participant-timeout

A participant did not finish before its configured deadline, and its work was aborted.

### participant-unavailable

A required participant has no representation for the locale, outcome `localized-representation-unavailable`, or a coordinated set of participants did not commit because one of them was unavailable.

### route-unavailable

A route cannot be produced in the locale. A route parameter with no spelling in the locale has outcome `localized-representation-unavailable` and keeps that address from being prerendered. `changeLocale` ends as `failed` with it, and changes nothing, where the page on screen, or the destination of a navigation that has committed and not yet landed, has no address in the target locale. Under a host policy the document is then sent nowhere. The router raises it when a navigation did not commit a localized route transaction, and when a page declares an outcome such as not found while it is being prerendered, where no response exists to carry it.

### scope-unavailable

A scope's catalogs are not there to use: no generated catalog exists for the scope in the locale, the scope is not generated for this context, the strict fallback policy requires the scope in a locale that does not have it, or a message or value was evaluated synchronously before initialization or before its scope was ready. A missing catalog has outcome `localized-representation-unavailable`. The testing entry point raises it for a scope a test gave no catalog.

### superseded

A newer locale change replaced the work before it finished: a pending transition, a progressive scope load, participant work, or a wait for a scope that the new transaction did not carry.

### unknown-presentation-code

`presentIssue` or `presentExternalValue` received a code with no message paired to it and rendered the configured generic message, outcome `consumer-domain-outcome`.

### unsafe-route

A request address was refused before routing: the target is structurally unsafe or outside bounds, the URL is malformed, or the origin is not one of the configured locale-specific origins. The resolution carries HTTP status 400.

### unsupported-formatting-capability

A value could not be formatted with what the host or the application provides: the host's `Intl` refuses the value or the options, a calendar or a numbering system named by the call, the value or the context is not a well-formed name or is one the host answers with another, a collation is one the host answers with another, the host does not know the time zone a zoned date-time names, a plain date is counted in a calendar other than `iso8601` and `gregory`, or a formatting adapter is not registered, threw, or returned an invalid result or invalid parts.

### unsupported-input-capability

`parseLocalizedInput` or a parsing adapter cannot read the requested kind of value in the locale.

### unsupported-locale

A locale was refused: the tag is empty, too long or malformed, or the application does not serve it. On a persistence event, a store held such a locale and it was skipped.
