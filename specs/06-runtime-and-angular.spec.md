# Runtime and Angular

What a running application gets from `@neolorn/equator`: how a message is evaluated, what the
localization state holds, how a locale change is prepared and committed, and how all of it behaves
under the rendering modes Angular supports.

Compiled catalogs arrive and are admitted under `05-compiled-artifacts-and-trust.spec.md`. Routing
is `07-routing-rendering-and-seo.spec.md`, formatting and localized input are
`08-formatting-parsing-and-domain.spec.md`, and what a runtime reports about itself is
`11-diagnostics-and-observability.spec.md`.

## 1. Composition

An application composes the runtime once, at its own root, by calling the generated
`provideLocalization` from its generated namespace. That function already closes over the
configuration, the local catalog set, the catalog loaders, the recovery message, and the route
projection, so a consumer application assembles none of them by hand. `provideLocalizationSetup`
takes the same setup explicitly, for an application with a reason to compose it itself. A release
MUST accept feature providers as the only other argument to either.

A feature provider exists for a decision the runtime cannot determine. The features are the locale
sources and their order, persistence stores, routing, the recovery message, the formatting context,
extension bindings, withdrawal of the document effects, the locale announcement, the clock, the
relative-time policy, the overlay adapter, and the observability sink.

Behavior no application would decline is on without being asked. A release MUST apply the
document language and direction, restore focus, selection, and scroll position across a locale
change, and announce the change to assistive technology, all without a provider, and MUST offer a
withdrawal of the document effects for an application rendering inside a host page that owns the
document itself. The announcement provider replaces the wording of an announcement that already
happens.

Import-time and injection-time behavior is `02-packages-and-platform.spec.md` section 8. A feature
acts only where its provider is installed.

## 2. Handles and evaluation

Every ordinary translation surface takes a generated handle rather than a free-form key. The handle
carries the provider, the scope, the message identity, the input contract, the slot names, the
result kind, and the generated ABI, as `04-message-authoring-and-catalogs.spec.md` section 9
projects them.

A release MUST evaluate a handle synchronously once the scope holding it is ready, and MUST
NOT start a catalog load, a network request, or any other deferred work from an evaluation call.

Plain evaluation returns text. Structured evaluation returns immutable parts and requires a binding
for every slot the handle declares. A release MUST NOT convert a structured result into
trusted markup on its own; `09-safe-content-and-ux.spec.md` owns what may be trusted.

Every result carries the locale that was asked for, the locales that were attempted, the locale that
actually supplied it, the language and direction of that locale, whether the answer is a fallback,
and any diagnostics. A release MUST report the supplying locale on the result rather than
assume it is the committed primary locale.

Synchronous evaluation against a runtime that is not ready, or against a scope that is not loaded,
is a programmer error. A release MUST raise a typed error naming the scope, and MUST NOT load
the scope implicitly or return the identifier as text.

## 3. Angular reactivity and templates

A release MUST work in a zoneless, OnPush application through Angular's documented signal and
scheduling contracts, and MUST NOT depend on `zone.js`, a manual change-detection sweep, or an
undocumented lifecycle order.

Reactive evaluation returns memoized readonly signals whose dependencies include the snapshot
identity and the reactive inputs. A component inside an already ready snapshot may use the
synchronous methods instead.

The template surfaces are the generated component fields, the message pipe, the formatting pipes
(eleven, one for each canonical value kind), the standalone structured-message component, the label
directive for a message in attribute position, the locale-choice directive, the recovery component,
and the localized-input directive in the forms entry point. The structured-message component takes a
handle with its exact typed inputs and trusted slot bindings and performs no loading.

Every pipe reads the ambient snapshot, so a release MUST declare each one impure. A pipe that
resolves an ambient locale cannot also be pure. The message pipe is plain-text only. A formatting
pipe is typed to one canonical value kind and to the options that kind leaves open, MUST render an
empty string when its formatter reports, and MUST report that diagnostic through the observability
sink.

## 4. The snapshot and the three locale roles

The committed snapshot is immutable and holds an identity, the primary locale, the document
direction, the required scopes, the loaded scopes, whether the state is degraded, the generated ABI,
the standards profile, the catalog-set identity of each provider, the complete formatting context,
and the route projection when routing is installed. A release MUST NOT admit a consumer
record, a participant payload, an acquisition result, or a credential into a snapshot.

Three locales are distinct and a release MUST keep them so.

| Role             | Is                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Primary locale   | The committed locale of the document, the root message context, and the default formatting context.      |
| Target locale    | The locale a transition is preparing. It is pending state and is never inferred from the primary locale. |
| Supplying locale | The locale a single result, part, or region actually came from.                                          |

Required scopes and loaded scopes are also distinct. A scope may be loaded without being required by
the current view, and a release MUST NOT commit a snapshot whose required scopes are not all
ready in the primary locale.

Readonly signals expose the lifecycle, readiness, the committed snapshot, the pending target, per
scope and per participant state, degradation, and the last transition result. A release MUST
NOT let a consumer application mutate that state or construct a snapshot it will accept.

## 5. Lifecycle

A runtime is uninitialized, initializing, ready, transitioning, or failed. Fallback or stale content
is a flag on a valid ready snapshot rather than a state of its own, and a recoverable transition
failure returns to the previous ready snapshot.

Initialization resolves the authoritative locale, loads every startup scope, builds one complete
snapshot, and publishes it once. A release MUST coalesce equivalent concurrent
initialization, and MUST NOT publish a partial runtime.

When no initial snapshot can be built, a release MUST expose a typed failure and the
generated recovery payload. An attempt stopped by an error that carries no diagnostic, such as one
a coherence-critical effect of the consumer application throws, ends with the typed internal
failure, and that error is kept as its cause. Section 11 of
`03-locale-identity-and-resolution.spec.md` owns the renderer for that payload. An explicit retry
starts a new attempt. A retry asked for while an attempt that followed a failure is in flight is
that attempt, and a retry asked for when no attempt has failed is refused with the typed
configuration failure. A recovery message that cannot be evaluated MUST NOT replace that failure:
the initialization still ends with the reason no snapshot could be built, the message is left out,
and its own failure is reported to the observability sink.

A failed initialization MUST NOT move the address the reader asked for. In a browser a release
MUST hold the navigation to that address until a retry succeeds and then complete it, so a retry
brings the reader to the page they asked for, in the locale its address states. A server render has
no retry to wait for, and a release MUST NOT hold one.

A server render or prerender whose initial snapshot cannot be built MUST fail rather than render
the recovery payload, so the deployment answers with its own error and a build stops. The recovery
offers a retry that no response can act on, and a response carrying it would be cached, or written
by the build, and served afterwards as the address's own representation.

## 6. Contexts and request isolation

One context per application root, or per server request, is the ordinary case. A child context may
be created for a route or a component subtree; it inherits what it does not state, owns its own
lifetime, and a release MUST NOT let it mutate or leak into its parent, a sibling, or another
request.

The target and primary locale, persistence state, participant registrations, transition state, and
installed effect adapters are context-local. A release MUST create an adapter that holds
request state in the context that owns it rather than in the application configuration, because one
configuration object serves every concurrent server-rendered request and the first context destroyed
would dispose the adapter for all of them. A release MUST share nothing else between contexts except
validated immutable catalog artifacts whose identity proves them interchangeable.

## 7. Locale transitions

A locale change is one transaction. Its mode is coordinated or progressive, and coordinated where
the request names none. A release MUST refuse a request that names any other mode with the
`invalid-configuration` diagnostic, and MUST NOT start a transition for it. The Router integration
is configured with the mode its navigations change locale in, and a release MUST refuse a mode
that is neither with the same diagnostic where that configuration is given, and MUST NOT leave it
to the first navigation.

In coordinated mode a release MUST validate the request, resolve the route and formatting
context, load and admit every required scope, wait for every required participant, build one
candidate snapshot, and keep the current view rendered and usable until that candidate commits. A
scope a coordinated change names as progressive is required by that change, and a release MUST load
and admit it before the candidate commits.

A change that names no required scope, by leaving the list out or by giving an empty one, requires
the scopes already required: those of the committed snapshot, or the startup scopes when nothing is
committed yet.

A release MUST refuse a change that names one scope as both required and progressive with the
`invalid-configuration` diagnostic, and MUST NOT start a transition for it. A scope the committed
snapshot requires is not thereby named as required, and a release MUST NOT refuse a change that
names such a scope as progressive. A progressive change that names no required scope MUST leave
that scope out of the scopes it waits for and load it alongside, unless a scope request is still
waiting for it. A coordinated change waits for it, as for any scope it names as progressive.

In progressive mode a release MAY commit the primary locale and the ready scopes while
registered regions finish independently, and MUST expose each region's transition identity,
readiness, outcome, supplying locale, and direction. A release MUST NOT decide whether such a
region shows a placeholder, keeps its old content, hides itself, retries, or substitutes something
else.

A transition ends in exactly one outcome: committed, cancelled, superseded, failed, or redirected. A
redirect is the answer when the target locale is served by another origin, and it carries the
address rather than a diagnostic, because nothing failed.

A release MUST coalesce equivalent in-flight requests, MUST let the latest distinct intent
win, and MUST NOT let a superseded transition commit, persist, or overwrite the diagnostics of the
current one. Superseded work is cancelled where cancellation is possible and invalidated by
transition identity in every case.

A release MUST NOT let a locale change requested while the context is initializing end that
initialization, or be ended by it: the change waits for the initialization to settle, the
initialization commits what it was preparing, and the change then runs from that snapshot. A change
that waited for an initialization that failed ends as failed with that failure. A change that is
cancelled, overtaken, or left without a context while it waits starts nothing.

In coordinated mode a release MUST leave the prior address, view, snapshot, document state,
focus, and persistence unchanged when a transition is cancelled, a guard rejects it, or its
preparation fails. In progressive mode a release MUST confine a region's failure to that
region and MUST NOT roll back an already valid commit.

## 8. Participants

A region whose content belongs to the application rather than to a catalog takes part in the
transaction by registering a participant. A release MUST hand a participant the target
locale, the effective formatting context, the transition identity, and a cancellation signal, and
nothing else about the transition. A release MUST abort that signal when the change is abandoned or
overtaken at any moment before the participant commits or is discarded, including after it has
reported, and MUST NOT ask a participant whose signal is aborted to commit. A participant's state
records how its latest attempt ended: with its report once it commits, and as cancelled or
superseded when the change it prepared for is abandoned or overtaken, whether or not the participant
had already reported.

A context built outside the injector MAY be given a request context, a value of the consumer
application's own. A release MUST hand that value, unread and unchanged, to every participant of
that context and of a child context made from it, and MUST NOT hand a participant a request
context the consumer application did not give. A participant receives it beside what the
transition hands it: the value describes the request the context serves and says nothing about the
transition, so it is the same value for every transition of that context.

A participant keeps its payload in the consumer application's own services, stores, signals, and
components. It reports readiness, the representation it actually supplies, and bounded safe
identity. A release MUST NOT read, copy, cache, or transfer that payload.

A report is one of four kinds: ready, with the representation supplied; unavailable, meaning the
content exists in no locale; a consumer-domain outcome the application classifies; or an operational
failure. A release MUST preserve the last two without reinterpreting either, and MUST NOT
turn a missing translation into a domain outcome or a domain outcome into a localization failure.

A representation states whether it is locale-bound, language-independent, user-authored,
multilingual, of a fixed language, or of unknown language, and carries the language and direction
that go with it. A consumer application that serves content from a locale other than the target one
MUST report ready with that locale as the supplying locale rather than report unavailable, so the
region can declare the language it is really in.

A participant is required or progressive. A required participant reporting unavailable or failed
fails the transition. A consumer application MAY set a cancellable deadline on a participant; expiry
is an operational failure and MUST NOT authorize an incomplete coordinated commit. Catalog loading
itself has no elapsed-time limit.

Commit, rollback, discard, and disposal are synchronous, because every participant of a change is
told in one pass and nothing waits for work a hook left running. A release MUST refuse a commit that
answers with a promise as a participant contract rejection, and that refusal fails the transition. A
rollback, a discard, and a disposal are told of an outcome that is already decided, so a release
MUST report one that answers with a promise as the same rejection, naming the participant, and MUST
NOT let it replace that outcome.

## 9. Scope readiness

Which scopes the first render loads is derived from the route tree the toolkit already analyzes. A
scope every use of which sits behind a lazy boundary loads with the route that needs it; a scope
used anywhere eager, or used nowhere the toolkit can see, is a startup scope. A release MUST NOT
require a consumer application to list startup scopes or per-route scopes.

Startup means loaded for the locale the page started in, so a release MUST have every scope
the current view renders ready in the target locale before a coordinated commit, startup scopes
included.

Each scope reports its readiness: the scope, the target locale, whether it is idle, loading, ready,
or failed, which locales supplied it, and the transition it belongs to. A release MUST hold a
newly activated scope behind its readiness boundary or keep its previous compatible content, MUST
NOT publish a partial scope, and MUST NOT present a catalog from an unrelated locale as the
committed target.

A consumer application may name further scopes for a route, as required or as progressive. A
required scope holds the navigation as a derived one does. A progressive scope arrives alongside a
navigation made in progressive mode, while the view before it stays on screen. A coordinated change
commits only once everything the view renders is ready, so in coordinated mode a release MUST load a
scope a route names as progressive before the navigation completes, as it loads a required one. A
render with no earlier view has nothing to keep on screen: a server render, a prerender, and the
first render in a browser. In such a render a release MUST load a scope a route names as progressive
before the render completes, as it loads a required one. A progressive scope differs from a required
one only on a later navigation made in progressive mode.

## 10. Server rendering, transfer, and hydration

Server rendering and prerendering use a request-local context. A release MUST NOT emit a
meaningful localized representation before the primary locale and the startup scopes of that request
are ready.

The server transfers the primary locale, the formatting context, the admitted catalogs, the
participant records, and the route projection when routing is installed. The rules that bound and
revalidate that transfer are `05-compiled-artifacts-and-trust.spec.md` section 2. A release
MUST adopt the transferred primary locale, catalog set, route projection, direction, and formatting
context before any later transition, MUST NOT renegotiate the locale during hydration, and MUST NOT
reload a catalog the transfer already carried.

The locale the server rendered in is reported separately from the committed one, and is absent when
the browser rendered the document.

Content behind a deferred hydration boundary is rendered on the server and adopted when its trigger
fires, which may be after a locale has committed. Angular's ordinary update pass then finds the
stored binding value no longer matching the committed locale and writes the current value over the
claimed DOM, so a release MUST NOT ship a repair for a deferred block. What has to hold is
stated here as a rule so that a framework change leaving a claimed boundary stale would be caught:
a release MUST keep localized content inside a hydration boundary part of the committed
representation, and a consumer application MUST NOT place localized content behind a boundary that
public Angular APIs cannot hydrate or replace coherently.

## 11. Effects, persistence, and disposal

The route, the root language and direction, the core messages, the formatting context, and the
overlay language are coherence-critical and stage with the snapshot they belong to. Title and
metadata join the commit where document coherence requires it.

A release MUST run persistence, the announcement, and comparable non-visual effects after the
commit they belong to, MUST carry the transition identity into each, and MUST NOT let an older
completion overwrite a newer selection. A release MUST report a persistence failure and MUST
NOT roll back an otherwise valid commit for one.

An optional effect's failure is contained to that effect. When a coherence-critical effect fails, a
release MUST either prevent the commit or trigger complete recovery, and MUST NOT leave false
document state behind either.

Destroying a context cancels its pending work and releases its effects, listeners, subscriptions,
loader references, pinned cache entries, and participant registrations. A release MUST NOT
let that disposal reach another context or a consumer application's own store.

Work that is waiting when its context is destroyed ends with the typed disposed failure: an
initialization, a scope request, including one waiting for a change that overtook it, and a
participant retry. A locale change in flight ends as cancelled. An application's start waits on
its context's initialization through a promise the framework holds and no code of the application's
can. Where the injector that owns the context is destroyed during that wait, a release MUST NOT
reject that promise with the disposal, because no start is left for it to stop and nothing would
handle it.

A destroyed context holds no catalog, so no scope in it is ready. A release MUST report every
scope of a destroyed context as failed with the typed disposed failure, one that was ready when the
context was destroyed included, and MUST NOT go on reporting the readiness the scope had.

A context may be destroyed from a hook or a participant that is being told of a commit. That commit
stands: the change it belongs to ends as committed with the snapshot the hooks were told of, and its
choice is remembered as for any committed change. A release MUST NOT start further work in a context
that was destroyed by a hook or a participant it told of a commit: no progressive scope load, no
participant preparation, and no return to the ready state.

A context destroyed while a commit is still being applied, before its snapshot is current, has no
commit to stand. The change ends as one in flight does: a locale change as cancelled and an
initialization with the typed disposed failure, and no snapshot is published to the destroyed
context. A hook or a participant that destroys the context and then throws changes none of that:
the change ends the same way, and an initialization keeps what was thrown as the cause of its
disposed failure.

## 12. The testing surface

`@neolorn/equator/testing` exports seven things: the testing providers, an in-memory catalog loader
factory, a controllable participant, a controller over deferred catalog loads and participant
attempts, a rendered-text helper, an environment reset, and a server seat. A release MUST
provide deterministic control over deferred loading and participant outcomes through them, without a
network call and without shared global state.

The server seat answers an address the way a deployment would and hands back what was answered. What
a consumer application has to be able to assert about its own use of the runtime is the response:
the status, the headers, and the head. None of the three is reachable from a component seat, because
each is decided by the request handler rather than by the page, so a consumer application with only
a component seat writes a server of its own, builds it, starts it on a port, and reads its answers
back over a socket. A release MUST supply the seat, MUST answer through the same request handler a
deployment uses rather than through a second implementation of the same rules, and MUST NOT require
a listening socket, a built bundle, or a browser to use it.

An address is asked as a path or as an absolute `http:` or `https:` address. The authority of an
absolute address ends at the next slash, question mark, or number sign, as RFC 3986 section 3.2 ends
it, and what follows travels to the handler as written. An address of any other scheme names no
origin a deployment answers at, and a release MUST hand it to the handler as written, where it is
refused as a structurally unsafe target, rather than answer it on another origin.

The head of the answered document is read as text. Comments, script content, and style content are
left out wherever they stand, including inside a title or an attribute value, and a character
reference is read as the character it names. A release MUST leave a numeric reference that names no
character, which is code point zero, a surrogate, or a value past the last code point, as it was
written.

A release MUST make a declared page outcome observable through that seat. Section 5 of
`07-routing-rendering-and-seo.spec.md` requires the declaration to travel over a channel no response
exposes and no client can write, so nothing outside the release can otherwise observe whether it was
carried.

The environment reset is there because an Angular test host reuses one DOM across spec files, which
gives every file in a worker the same address bar, cookie jar, and web storage, and the runtime
resolves the locale from the address when routing is installed and from a store when persistence is.
A release MUST export that reset and MUST use it in its own documented testing recipe.

Pseudo-locales are not part of this surface. A test that wants one loads a generated pseudo-locale
catalog like any other catalog, because the transform runs at build time under
`10-compiler-and-tooling.spec.md`. The runtime renders a pseudo-locale as it renders a translation.
The one fact it holds about a pseudo-locale is that the build generated it, which the generated
configuration states. A render table reads it to apply section 9 of
`07-routing-rendering-and-seo.spec.md`, and a release MUST mark with it the formatting context it
builds for that locale, so the locale formats in its language with what its formatting declares, as
section 4 of `08-formatting-parsing-and-domain.spec.md` states. A release MUST NOT carry the mark in
the state a server render transfers: the browser's own generated configuration says it again.

## 13. Primary references

- Angular 22, Zoneless: `https://angular.dev/guide/zoneless`
- Angular 22, Signals: `https://angular.dev/guide/signals`
- Angular 22, Hydration: `https://angular.dev/guide/hydration`
- Angular 22, Incremental hydration: `https://angular.dev/guide/incremental-hydration`
