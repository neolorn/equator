# Routing, rendering, and SEO

Where a page localized with Equator lives, what identifies it across locales, what a request to it
receives, and what the document then says about itself to a crawler.

Locale identity and the resolution order behind a first request are
`03-locale-identity-and-resolution.spec.md`. The transaction a locale switch runs is
`06-runtime-and-angular.spec.md` section 7. The analysis that produces the route projection is
`10-compiler-and-tooling.spec.md`.

## 1. Ownership and the route projection

A release owns route-locale policy, route identity, the projection built from it, the outcome
contracts, and the metadata channels that have to agree. An application owns its route
declarations, its paths, its hosts, its edge and cache infrastructure, its content, and what its
pages mean.

Angular route declarations are the authored source. A release MUST derive one deterministic
localized route and metadata projection from them, and MUST NOT require a consumer application to
maintain a second route manifest beside them.

An analysis sees only the declarations written where it can read them. A route assembled at run
time, spread in from elsewhere, or returned by a helper is invisible to it. A release MUST
report which declarations hide addresses from the projection and MUST NOT fail the build for it,
because hiding routes from static analysis is a legitimate shape for an application to have.

## 2. Route identity and parameters

Every localized route has an identity independent of its visible path text. A release MUST
derive that identity from the route's full path, keeping literal segments as their text and
collapsing every parameter segment to one mark, so renaming a parameter changes no identity. A
release MUST NOT machine-translate route text.

Two addresses that would resolve to one identity are a collision. A release MUST report both
and project neither, and MUST report an address it cannot name within the identity grammar the same
way. A consumer application answers either by declaring an identity explicitly, which stays
available where a path and its identity genuinely diverge.

A dynamic path value is typed domain data with a declared codec. For every locale the policy names,
a release MUST check that serializing a value and parsing the result back succeeds and serializes to
the same text, MUST run that check on every build, and MUST refuse where the address is built,
naming the route, the parameter, and the locale. The comparison is over text, because a codec may
parse to a value the runtime has no equality for, and because a codec that reads its own output back
as a different value passes a check that only asks whether parsing succeeded.

The reciprocal case is not a failure. An inbound address whose parameter the codec declines to
parse means the route does not match, and a release MUST hand that address back unchanged
for the application to answer.

Declining is an answer and a throw is not. A codec that throws is a defect in the consumer
application wherever it is asked: while an address is read, while one is built, while a prerender
value is spelled, and while a replacement's parameters are checked. A release MUST fail the call
with a typed failure that names the route, the parameter, and the locale where one is asked for,
and keeps the thrown error as its cause. The request handler MUST answer that failure as it answers
a render that failed, and MUST NOT answer the address as not found. The codecs a release ships are
codecs under the same contract: each MUST decline a value it refuses by writing nothing, so an
address built from that value is refused as a route with no address there, and a release MUST NOT
report that refusal as a codec that threw.

A spelling that is a function of the value comes from the codec. A spelling stored beside the
record cannot, because producing it is a fetch, so a consumer application declares it: per
parameter, the spelling in each locale the record has one for. A release MUST fall back to
the codec for a locale the declaration omits, and MUST drop a locale with no spelling from the
alternate cluster rather than guess one.

A declaration belongs to one navigation. A release MUST stamp it with the navigation that
made it, MUST replace the standing declaration outright when a navigation commits, including when
the arriving page declares nothing, and MUST answer a reader that names a navigation rather than a
reader that asks for whichever declaration is current. Both halves are load-bearing: the first
alone still answers a stale value to a reader asking the wrong question, and the second alone still
holds a value no page on screen has.

A declaration usually arrives after the page does, because the fetch that produces the spellings
finishes after the navigation. A release MUST project the document again when a declaration
arrives, not only when a navigation commits.

A declared spelling is application data. A release MUST require it to be a safe path segment
that parses under the route's own codec, and MUST NOT impose the codec's round-trip check on it,
because in another locale the parameter's value is that locale's spelling and requiring the two to
match would reject every correct declaration.

Route identity is a closed set in the typed surface. A release MUST fail compilation for a
URL built against an identity that does not exist or a parameter contract that is unsatisfied,
rather than throw from a function whose declared result is a string, and MUST require a projection
containing a parameterized route to supply that route's codecs.

A projection is checked once, when a release is first handed it, and the result is kept for as
long as the object exists. A projection changed after that check is read as it then stands. A
release MUST NOT guess a spelling for a route whose codec has been removed since: the route matches
no address, and building or prerendering its address is refused as a configuration error.

## 3. Locale URL policies

A release publishes three policy kinds: a locale path prefix, locale-specific origins, and
locale-neutral addresses. A consumer application declares the policy exactly once, and a release
MUST NOT accept it from a second provider, because the URL locale source, the canonical URLs, the
reciprocal alternates, the redirects, and the Router adapter all read that one declaration.

Under the path-prefix preset a release derives the defaults from the declared locales and
the route graph: one canonical prefix per locale, the canonical locale tag lowercased as the
segment, ASCII-case variants recognized only for canonical correction, lowercase static segments,
and no trailing slash except at the origin root. A consumer application declares only genuine
deviations, such as a shorter public segment, an alias, an omitted default prefix, a
locale-specific path, or a locale-neutral namespace.

A release MUST refuse a policy kind it does not serve at configuration time, naming the
kinds it does serve, and MUST NOT warn and continue, because a diagnostic that starts anyway is
silent in production and leaves the application in a state no rule describes.

A policy is a plain value, and a consumer application may write one out instead of calling a
constructor. A release MUST hold a policy to the tables a constructor writes wherever it reads one,
and MUST refuse one that departs from them as a configuration error: a locale that is not a
canonical tag, a default locale the policy does not name, a prefix, alias, or locale-neutral root
that is not a path segment or repeats another, an origin that is not a normalized HTTP origin, a
prefix or origin table that does not read each address back to the locale it was written for, or a
member that belongs to another kind of policy. A table that disagrees with its inverse reads a
prefix as a locale it has no address for, or sends an address to itself, and a member of another
kind decides nothing where the application that wrote it expects it to. A prefix, an alias, and a
locale-neutral root are each one to 63 lowercase ASCII letters, digits, and hyphens that begin and
end with a letter or a digit, and any such text is accepted, a word such as `undefined` included.
An empty slot in a list of roots is not text, so a constructor and a reading of a written-out
policy both refuse it as a root that is not a path segment. A constructor refuses an empty slot in
a list of locales, and a locale that is not text, the same way, as a locale that is not a tag.

An option a constructor, a provider or a feature declares as an object, as a list, as a function, as
text or as one of a set of named values is of that kind, the options themselves and each feature
handed to a provider included. A release MUST refuse a value of another kind, `null` included, with
the `invalid-configuration` diagnostic where the configuration is given, and MUST NOT read text as a
table of its characters, a number as an empty table, or an object as a list.

The policy states intent and the build decides which locales exist. A release MUST intersect
the declared policy with the generated configuration once, into a narrowed policy, and MUST resolve,
publish, and provide from that value alone, so a site added later inherits the intersection rather
than repeating it. A locale the policy names and the build did not generate gets no prerendered
file, no server route, no alternate claim, and no client route branch, and a release MUST
treat its prefix as unsupported locale intent and ignore a remembered preference naming it. A
release MUST refuse outright a configuration that omits the policy's own default locale,
because filtering that one leaves an application with no addresses at all.

Both directions of disagreement are errors: a configured locale with no address has translations
nothing can reach, and an addressed locale the build never generated is one the application says it
serves and does not. A generated nonproduction locale is the one exemption in both directions,
because its existence is decided by the build while the policy is a source file that is the same in
every build.

A build compares the two from the policy as its source declares it, and only where the whole locale
table is written there with nothing after it that can replace it. A release MUST NOT compare a
locale table it read in part, because the locales it could not read would be reported as configured
and unaddressed in an application that addresses them. A release MUST name, in an advisory that blocks no build, each option of the policy it did not read, and MUST say there that neither comparison was made for what those options hold, because a build that stays silent about a policy it could not read is read as a build that found the policy right.

Under a locale-specific origin policy the locale is carried by the origin, and three things follow.
A release MUST be told which origin this build answers at, MUST require it to be one of the
policy's own including its scheme, and MUST refuse a missing or unnamed origin at configuration,
because otherwise every request answers 400, a prerender writes no files, and the build still
succeeds. One build then prerenders one origin's locale while the document advertises addresses
that build does not produce, which is where those locales live. A locale switch is a document
navigation, because no application state crosses an origin.

A request context states its origin as text. A release MUST refuse a context whose origin is
anything else, under every policy kind, and MUST NOT read the address at the default locale's origin
instead, because that answers in a locale the request did not ask for.

A release MUST advertise or link a locale only where arriving at the address with nothing said about
preference yields that locale. That is one observation rather than a property of the policy kind, it
is the only kind of visitor a crawler is, and it is also what a reader gets from a link opened in a
new tab, copied, or returned to tomorrow. Under a prefix or origin policy every address passes by
construction. Under a locale-neutral policy the answer depends on how many locales spell the
address. An address one locale alone spells, through a localized path or a parameter its codec
spells per locale, states that locale as a prefix would: arriving there commits it, it is
advertised, and a build may prerender it in that locale. An address more than one locale spells
states none. It is negotiated among the locales that spell it, the first of them in the policy's
order where nothing chooses one, and only the locale it negotiates to is served and advertised
there. The policy's order is its default locale first, then its other locales in the order the
policy lists them. A generated nonproduction locale counts among the locales that spell an address,
so a switch to it works wherever it shares one.

## 4. Dispatch and path safety

After the host has validated the request target, locale-neutral protocol namespaces dispatch to
their owners before presentation routing. Presentation routing then evaluates canonical locale
input, recognized noncanonical locale input, reserved unsupported locale intent, and unprefixed
route candidates in the configured order.

A consumer application's host MUST reject a structurally unsafe target, meaning invalid encoding, an
encoded separator, a control character, a duplicate separator, a backslash, a dot segment, or
another ambiguous form, at its earliest boundary, before Angular routing, server rendering, locale
resolution, catalog loading, or a domain lookup. A release MUST NOT repair or reflect one. A release
supplies validators for safely parsed values; raw request-target rejection stays the host's.

Where a release is itself that boundary, in its own request handler and the adapter that
feeds it, the rejection is the release's own and it MUST classify the target as it arrived. A
parsed URL is not that target. Parsing resolves dot segments and rewrites a backslash, so a release
that carries only a parsed URL from the boundary to the classifier has repaired the target before
anything classified it, and what it then refuses or serves is the address the unsafe one was aiming
at rather than the one that arrived. The classification runs before dispatch, so an address a
locale-neutral root would have claimed is validated rather than handed to its owner unread.

Presentation routing has two entrances and a release MUST delocalize at both, through one
function: the localized location strategy for an address the browser supplies, and the localized
URL handling strategy for an address the application hands the router. Every address the route
matcher sees is therefore canonical whatever its source, so a route's guards, resolvers, data,
title, and route-scoped providers are reached by every navigation that reaches the route.

## 5. Navigation and HTTP outcomes

Three outcome classes stay distinct, as they do in
`11-diagnostics-and-observability.spec.md` section 3: an
operational failure, a requested localized representation that is unavailable, and a valid
consumer-domain outcome. A release MUST preserve a consumer-domain outcome without
reinterpreting it, and MUST NOT turn a missing translation into a missing entity.

A release builds the response and a consumer application supplies the body. The request handler
answers every outcome without a body of its own, and for an outcome with a body it calls the
application's renderer and composes the two: the status is the one the runtime resolved for the
address, the cache directives and the varying fields are combined with the renderer's under
section 16, any other header the runtime derived replaces a header of the same name the renderer
set, and a set-cookie header is appended rather than replaced, because both sides may have a reason
to write one. A renderer is optional. A release MUST NOT let an address the locale policy declines reach that
composition, because it is not an outcome; it goes to the deployment's own handling. A refused
target MUST NOT reach it either: a structurally unsafe target has no presentation, it carries a
diagnostic rather than a route, and asking an application to draw a page for one asks it to draw an
address the release has just refused.

Two answers a renderer can give are not routing outcomes, and a release MUST keep the renderer's
status for both. A 304 is the conditional-request mechanism of RFC 9110 section 13 answering that
the client already holds the representation the address resolved to, and a redirect is the
application's router sending the reader to another address. A release MUST send either with no
content and MUST compose its own fields onto it as it does onto a page. On a 304 those are the
fields RFC 9110 section 15.4.5 requires a 304 to repeat from the 200 it stands for, the cache
directives and the varying fields, and a release MUST NOT add other representation metadata to it. A
release MUST NOT answer 200 for a render that carried no content, because a cache that stores that
answer holds an empty page for the address, and one classified as shared gives that page to every
later reader.

A render asked for a page at an address that resolved to a route it serves, which answers with a
status of 400 or above and declares nothing, did not produce the page either. A release MUST send
that status, MUST classify the response as private and not stored, and MUST mark it not to be
indexed, whatever the address's own classification and indexing class are, because sent as the
address's 200 an error page is one a shared cache keeps for the address and a crawler indexes as its
content. That status is still not a declaration, and a release MUST NOT treat it as one.

A server evaluates a precondition only where its answer without it would have been successful
(RFC 9110 section 13.2.1), so a release MUST NOT hand a renderer the request's preconditions where
the address resolved to any other outcome. A redirect the runtime issues during a render, such as
the correction to a parameter spelling a page declared, is a routing outcome, and a release MUST
give it the status the table below gives it, through the response channel the render shares with the
handler.

The status table is fixed. A release MUST answer preference-dependent locale entry with 307
for safe methods, deterministic canonical correction or declared replacement with 308, unsupported
explicit locale intent with 404 at the requested URL, a missing route or an absent entity with the
localized 404 at the requested URL, a declared permanent removal with no replacement with 410, and
a structurally unsafe target with 400 before presentation routing. A release MUST NOT render
another language as the locale that was asked for.

That table governs routing outcomes and nothing else. An operational failure is not one: it is the
consumer application's own, as section 3 of `11-diagnostics-and-observability.spec.md` classes it,
and serving maintenance or reporting a render that failed is ordinary rather than exceptional. The
status that reports one is therefore the consumer application's to declare.

Two of the three outcome classes depend on facts an address cannot supply. A routing outcome from
the table above depends partly on what the address states and partly on what only the page knows:
whether the entity the address names is absent, and whether it has been permanently removed. An
operational failure depends on nothing the address states. A release MUST supply a
declaration that carries both, and a release that supplies none leaves a consumer application with
no way to state either at an address that resolved.

One declaration, made in either of two places. A page states what it discovered while rendering,
and a renderer states what it decided with no page rendered at all, which is what serving
maintenance and reporting a failed render both are. A release MUST accept the declaration
from both and MUST give them one type, because the two differ only in where the declaration is
made. A release that gave them separate shapes would require an application moving a check from a
renderer into a page to rewrite what the check declares.

The two arms are not spelled the same way. An operational failure carries its own status, because
the release has no table for it. A release MUST refuse a status that is not a whole number from 200
to 599 at the call that declares it, with `invalid-configuration`. A routing outcome carries the
fact and not the status: a release MUST take the absence of an entity and its permanent removal as
facts and MUST derive the status from the table above, because the table above is the release's and
an application writing a status into a declaration would be restating a rule the release already
applies.

A release MUST accept a declaration as a result distinct from the response a renderer
otherwise returns, so a renderer that returns an ordinary response is unaffected and no status
arrives as a declaration by accident. A release MUST NOT read a status a renderer did not
declare as a declaration, because an accidental failure and a deliberate one arriving as the same
value cannot be told apart.

A renderer that declares may send a document with the declaration, and which document is the
consumer application's choice. For a route the render table leaves to the browser it is ordinarily
the application shell, the one the route is answered with when nothing is declared, because no page
is drawn on the server that could declare for itself. A release MUST send the document a declaration
carries as the renderer gave it, with the status, the classification, and the indexing of the
declared outcome on the response, and MUST NOT write into that document. The head of a shell is
written by the browser that draws the page, under section 12.

A declaration is also made from inside a render, which is where the fact is discovered. A release
MUST carry it from the render to the response over a channel the two already share, MUST NOT carry
it in a header or anywhere else a client can write or a response can expose, and MUST treat a render
that declared nothing as the address's own outcome rather than as a declaration of success. Where
the render and the handler do not share that channel there is no declaration to read, and a release
MUST report that during development rather than answer from the table as though the page had said
nothing, because the two produce the same response and only the first is a wiring fault.

A declaration governs the render that made it and nothing else. A release MUST NOT let a
declaration reach a second render at the same address, a second navigation, or a second request,
which is the rule section 2 already states for a parameter-spelling declaration and holds here for
the same reason.

Where the two can disagree the narrower rule holds: a release MUST carry a declaration where
the address resolved to a route it serves, and MUST send the status the table above gives wherever
the address resolved to anything else, because a consumer application declaring an outcome cannot
know which addresses the release answered from the table, and a rule it cannot reason about is not
one it can apply. A release MUST report a declaration it did not carry where a developer
will see it during development, naming the address, what was declared, and what was sent, and MUST
NOT report it more than once for one such pair, because the addresses it can arrive at are
unbounded and supplied by the request.

A carried operational failure is not the address's representation, so a release MUST
classify the response carrying it as private and not stored, whatever the address's own
classification is. A carried routing outcome is the address's representation and keeps the
classification the table gives that outcome.

A declaration has no response to reach on a client navigation, and a release MUST NOT
synthesize one. What it governs there is the document and the route context, under section 12.

A declaration made during prerendering has no request to answer. Both arms describe a page the
build cannot write: an absence states that a page the build was told to render does not exist, and
an operational failure states that the render meant to produce it did not succeed. A release
MUST fail the build for either and MUST NOT write the page. Section 9 already forbids prerendering
a route whose existence cannot be proven at build time, and a file written from a failed render is
served afterwards as a successful one, with no status left to say otherwise. A page declares once
its own work settles, after the application has started, so a release MUST end that render as one
that failed rather than only refuse the call that declared: the render otherwise goes on to write
whatever is on screen. A build tool that finishes a build in which a route failed to render still
writes no page for it, and the build's status is then that tool's.

A release MUST build a locale-entry redirect's destination in the locale it resolved to, so the
redirect lands on a canonical URL in one hop. An address that already states its locale is
authoritative, and a release MUST NOT let a resolved preference override it.

Entry-redirect cacheability is a property of the address. A cache key is the target URI unless a
stored response names a varying header, and an entry address states no locale, so both of its
answers share one key. A release MUST classify an entry redirect as private and revalidated before
every reuse whether or not a preference was consulted, because marking either answer publicly
cacheable lets a shared cache hand one visitor's language to the next, and marking the other
private prevents nothing once the first is held under the same key. It is revalidated rather than
not stored because its answer depends on request state and is not sensitive: a browser may keep
it, and asks the server again before using it, so a visitor whose preference has changed is sent
where the new one points.

Under a locale-neutral policy an address more than one locale spells states no locale, so a release
MUST classify a successful response there as varying by locale preference, including a response that
consulted nothing, because it shares a key with one that did. An address one locale alone spells
states its locale and is classified as it would be under a prefix policy. A release MUST NOT
classify a redirect produced under that policy as varying, because what a redirect returns is its
location and that is the same for every locale.

Whether a shared cache may hold a varying response depends on where the deployment reads the
preference, which is the one fact here a release cannot observe. A consumer application MUST
declare that source. A preference read from a request language header is content negotiation and
takes a varying header; a preference read from a cookie is not, and takes a private directive,
because a cache keyed on a whole cookie stores a variant per visitor. A release MUST classify that
response as private and revalidated before every reuse, for the reason an entry redirect is: a
browser may keep it, and asks the server again before using it, so a visitor who has chosen another
language since is answered in it.

A page a browser restores from its back-forward cache is the one reuse that does not ask the server,
so a release that classifies a cookie-derived response as revalidated MUST check a restored page on
the client: where the persisted locale differs from the locale on screen, and the configured sources
would choose it at the address the page is at, the page changes to it. The change persists nothing, because the locale was resolved rather than chosen, and
`03-locale-identity-and-resolution.spec.md` section 8 writes only a deliberate change.

Which request field chose an answer and who may keep it are separate facts, and raising the second
leaves the first alone. A release MUST name the request language header in `Vary` on every response
whose locale a preference read from that header chose, including a locale-entry redirect, a private
response, and a declared outcome at such an address, because the field also tells a browser the
answer was negotiated. A release MUST NOT name a cookie in `Vary`.

A locale named in a programmatic navigation is an address rather than an instruction. A release MUST
resolve it to the canonical route and render it in the committed locale, and MUST report the call in
development, naming the address as written, the canonical address, and the operation that does
change locale.

An address the projection does not contain resolves to no route identity. A release MUST commit the
locale, yield no route context, and supply no body of its own, because which page answers a missing
address belongs to the application. The head is not part of that body. A release MUST write the head
of a response at such an address under section 12: a response whose title is empty and whose
description belongs to whichever page was on screen before it fails the coherence requirement of
section 15.

## 6. Canonicalization, query, and fragment

A release MUST answer with 308 only where strict parsing proves the request is a
user-independent one-to-one variant of one final canonical URL, and MUST combine compatible host,
locale, static-segment, slash, alias, and query corrections into a single hop. A release MUST
NOT case-fold a dynamic identity, and MUST NOT rewrite one except through its codec, a declared
mapping, or the normalization to Form C stated below, which a parameter is given before its codec
reads it.

A correction names a locale and a route beside its location. A release MUST report the locale and
the route that the location resolves to for the same request, including under a locale-neutral
policy where two locales read the corrected spelling as two different routes.

An address a release writes, for a link or for the address bar, is the canonical one. Where the
internal address it is handed is such a variant, a parameter spelled as another locale spells it
among them, a release MUST write the canonical address the correction names rather than the
variant, because the variant is an address the release then answers with a correction or, where the
locale is in the host, with a not-found. A client navigation to such a variant MUST arrive at the
canonical address in place of the variant's history entry, so the page reads the parameters a
document request for the same address reads.

An address whose locale is stated, by its prefix or its origin, and whose path is spelled the way
another locale spells a route is such a variant where it matches nothing in its own locale and every
locale that reads it names the same address in the stated one. A release MUST answer it with a 308
to that address, keeping the query, and MUST answer it as not found where two locales' spellings
name two different addresses.

A same-route locale switch preserves safely parsed bounded query parameters and the fragment by
default. A release MUST NOT copy raw URL text, and MUST NOT let a query or fragment value
choose an origin, an executable destination, a catalog identity, or a trust decision.

A slash and a question mark are data in a query and in a fragment, as RFC 3986 sections 3.4 and 3.5
have them. A release MUST read either one there, written as itself or escaped, and MUST write both as
themselves in the canonical address, so a return address such as `?next=/account` is the same text
after a canonical correction or a redirect as before it. An escaped slash in a path segment stays a
structurally unsafe target under section 4, because decoded it would turn one segment into two.

A canonical address is written in Unicode Normalization Form C: a declared path and a parameter a
codec writes are both held to it. A release MUST read each decoded path segment, query name, query
value, and fragment in that form, a parameter before its codec reads it, and MUST answer a spelling
that is not in it as a variant of the one that is. A letter followed by a combining mark that the
form writes as one character is such a spelling, and so is U+212A, the Kelvin sign, which the form
writes as the ASCII capital `K`, so in a prefix or a static segment it is then an ASCII-case variant.

Canonical, alternate, and sitemap URLs omit the fragment and omit query parameters by default. A
bounded typed query value joins canonical identity only where a route declares a stable indexable
representation, and a release MUST NOT promote accepted transient query state into cache,
telemetry, or indexing identity on its own.

## 7. Locale switching

Switching is not a navigation. A release MUST commit a locale transaction and let the
address bar follow it, leaving the route, its parameters, and its history entry unchanged by the
switch itself, and a consumer application MUST change locale through the localization API rather
than by navigating to a localized address.

The address a change moves to is built before anything changes: the address the bar follows to where
the target locale is served in this document, and the address the document is sent to where another
origin serves it. Where the route on screen has no address in the target locale, because a parameter
has no spelling there or because a declared spelling is one the route's codec refuses, a release
MUST end the change as failed with the diagnostic the address was refused with, MUST NOT commit a
locale the address bar cannot follow, and MUST NOT send the document to another origin. A locale
change a navigation makes is answered for the navigation's destination instead. Where that change
does not commit, a release MUST fail the navigation with the diagnostic the change ended with, or
with `route-unavailable` where the change ended as redirected and carries none, and MUST leave the
snapshot and the Router's address as they were. A release MUST answer a change made in place while a
navigation is in flight for the route on screen, as it answers any other, because that navigation
can still be cancelled. Where that navigation has already committed its locale and has not landed, a
release MUST answer the change for the navigation's destination as well, and MUST write the page
that lands in the locale that is committed. Where that navigation is cancelled or fails instead, or
lands and the writing of its document throws, a release MUST put back the page it left in the locale
the change committed, and MUST NOT put back the locale from before the navigation, because the
change committed and its caller was told so.

A release MUST publish a snapshot only through a transaction, including when a single scope
finishes loading, so every commit observer sees the same kind of event.

Switching has one surface. A release MUST publish the configured locales as options carrying
the tag, the bare language subtag, the writing direction, the locale's own name in its own
language, and whether it is current or arriving, MUST write the option's language, direction, and
current state onto the control the application binds, and MUST render no markup of its own. A
consumer application writes the loop and the markup, and MUST NOT spell a locale out in a template.

That name comes from the toolkit's pinned locale data and travels in the generated configuration,
one string per configured locale. An Equator release MUST NOT read it from the host's own
display-name implementation where the pinned release has one, because the engines disagree: over
sixteen locales on the four engines a release gates on, three differed, and a server-rendered label
then changed under the visitor on hydration. A locale the pinned release has no name for carries
none, and the engine answers for that one.

Where the current route lives in another locale is one fact. A release MUST derive the
per-locale path of the resolved route once per navigation and publish it, and MUST form the head's
alternate cluster and a switcher option's address from that one value. The head resolves the path
against the configured origin and keeps only what section 10 lets it claim; a switcher option
applies none of that, because it is a control a visitor operates rather than a claim about what
exists, so it has an address on a route that is not indexable and in an application that has
configured no origin. A release MUST write that address to the link's own address attribute
and to nothing else.

An explicit successful selection creates one history entry. A release MUST replace the
current entry for a canonical correction, MUST NOT change the address or persistence on a failed or
superseded commit, and MUST confine a progressive region's failure to that region.

## 8. Scroll and focus across a direction change

A locale switch that changes the document's reading direction MUST preserve the visitor's logical
scroll position on both axes, and a release is what preserves it.

Every engine drops the inline position, because changing the root direction reverses the inline
axis. A release MUST capture the logical distance from the inline start before the commit
and restore it re-signed for the direction the document is in afterwards, in the same frame that
restores focus and selection. A release MUST NOT read the document's scroll range at capture
or at restore, because a scroll call clamps to the range on its own and a document that has not
finished growing then costs the visitor accuracy rather than correctness.

One engine also moves the block position, and only under one condition. In the engines Playwright
1.63.0 supplies, Chromium 153 and Firefox 155 leave it untouched across a direction change and
WebKit 26.6 does not: with an element focused as the direction changes it scrolls to reveal that
element, which moves both axes. A bisect isolates the trigger exactly, a focused element together
with a direction change being sufficient and nothing else necessary, and a focus call that asks the
engine not to scroll is honored on all three, so the focus call is not what moves the page.

Writing the position once is therefore not enough, so a release MUST hold it: for a bounded window
after the restore, a viewport movement the runtime did not request and the visitor did not make is
undone by re-applying the captured position. Six bounds close that window, and a release MUST apply
all six.

| Bound                                                                             | Value                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------- |
| Armed only when the commit changes the writing direction and an element has focus | the condition the bisect isolated              |
| Closes when the commit has settled                                                | two consecutive frames with nothing to correct |
| Frame budget                                                                      | six frames                                     |
| Elapsed ceiling                                                                   | 150 milliseconds                               |
| The visitor takes over                                                            | a wheel, touch, pointer, or key event          |
| A later commit supersedes this one                                                | the commit sequence                            |

The window has to close before anything else is scrolling. From inside the restore a deliberate
scroll by the application is indistinguishable from the engine's movement, so a window still open
when the application scrolls would undo the application's scrolling, and a bound expressed only in
frames does not achieve that on a page producing frames slowly or not at all.

A release MUST NOT restore a position an application sets for itself afterwards, and a
consumer application setting one should expect to be working against scroll anchoring on a document
just relaid out in the opposite direction.

## 9. Rendering modes and prerendering

A release supports client rendering, server rendering, prerendering, and hybrid
applications, and each requirement here applies only where the consumer application selects that
mode. Render mode stays the application's declaration, because it is a decision about freshness and
authorization, and a release MUST relay the framework's own render mode values without
interpreting them.

A prerendered route has no request, so no locale can be negotiated for it and every locale's copy
is a separate address that has to exist in the build. A release MUST derive that expansion
from the route projection and the narrowed policy, so a consumer application states a route's
render mode once rather than once per locale.

Server rendering is installed with one call taking the locale URL policy, the route projection, the
generated configuration the client was configured with, and the per-route render mode declarations.
A release MUST check the route identities in those declarations against the projection
rather than accept free strings, and MUST NOT reach for a non-public framework token to read the
policy and the projection from injection, because the server table is built at module scope before
any injector exists and the framework's installer takes a concrete table at call time.

Parameter values to render ahead of time are written once as domain values and serialized per
locale through the route's codecs. A release MUST fail the build for a value with no
representation in some locale rather than omit it, because omitting it ships a page that exists in
one language and is missing in another. A release MUST fail the build the same way for a value
whose spelling in some locale is not one safe path segment, because the build writes a file at the
address that spelling completes. The address is a built one, so the check of section 2 applies to
it: a spelling the codec does not read back as itself fails the build as well.

A set of values that has to be fetched cannot be written where the render table is declared, and a
release that took only values written in place would limit prerendering to sets small enough to
write out. A release MUST accept the values from a function the build calls as well as from
a set written in place, and MUST serialize both the same way. Serializing both the same way is the
requirement rather than a convenience: an emitted address states its path and its render mode and
not the locale it belongs to, so an application left to complete the expansion itself would have to
recover the locale from the path text before it could choose a codec, which is the serialization
the release already performs.

A localized address is frequently non-ASCII. The build writes a prerendered page at the decoded
spelling of its address while a browser requests it percent-encoded, so a host that compares the
two as text finds nothing. A consumer application's host MUST resolve a request for a directory to
the index document inside it, matching on the decoded path. Where a release is itself the
host, it MUST decode before lookup. The requirement is on the host because a static file server, a
content network, or any deployment that answers before a rendering engine sees the request still
has to map the decoded path itself.

A public indexable page should produce meaningful localized server HTML through server rendering or
eligible prerendering. A private client-rendered application still requires locale and startup
readiness before visible UI. A release MUST NOT force prerendering onto a route whose
existence, authorization, or freshness cannot be proven at build time.

A prerendered page is one file served for every request to its address, so it can only be a page
every visitor may be given. A release MUST fail the build when it renders a route whose level under
section 16 is per visitor or not stored, or whose indexing class is private, and MUST NOT write the
page, whichever declaration led the build to render it: an entry of its own, a fallback, or an
application shell. It MUST decide this from the route's classification and from the render having no
request, and MUST NOT read a render mode value to decide it, because this section relays those
values without interpreting them. The least level a host declares under section 16 is declared where
requests are answered and is not known to the build, so this refusal covers what the routes declare.
Under a locale-neutral policy an address more than one locale spells has no locale until a request
states a preference, so it is per visitor whatever its route declares, and a release MUST refuse to
prerender it the same way. Where the only other locales that spell it are generated nonproduction
ones, a build that generates them renders the address on request instead of failing, because one
configuration serves the development and the production build (`10-compiler-and-tooling.spec.md`
section 16), and the build without them prerenders it.

## 10. Canonical, alternate, and x-default

Each successful indexable locale representation has exactly one self-canonical URL.

A published URL is three things composed: the origin this build answers at, which comes from
configuration and carries no path; the mount point the application is served from, which the
deployment already declares to its platform and a release reads rather than asks for again;
and the address the locale URL policy spells for the route. A release MUST compose every URL
it publishes or writes into a document from those three and nothing else, so the address a crawler
is given and the address this build resolves are two readings of one fact. An address that is
already absolute keeps its own origin and is mounted on its own path.

A page rendered on the server is the one a crawler reads, and without an origin it carries no
canonical and no alternate while its build succeeds. A release MUST therefore refuse at
configuration a server render that has not been told its origin, under every policy. An application
rendered only in the browser has a switcher without one, and publishes no canonical or alternate
until it names one.

Eligible locale variants of one route identity form a reciprocal complete alternate cluster with
canonical language tags. A variant is eligible when three things hold: the policy addresses it, the
build generated it, and the address serves it. A release MUST require all three, because
none implies another and an alternate link is a public claim that the same page exists in another
language.

A release MAY advertise a locale-neutral entry resolver as the unmatched-visitor default
only where it deterministically resolves visitors into the localized cluster without serving a
competing localized representation. A release MUST NOT emit a canonical or alternate cluster for an
unsupported-locale, malformed, missing, gone, private, or otherwise non-indexable response.

## 11. Sitemaps

A sitemap contains only canonical production representations and agrees with the route projection,
the indexing class, the alternates, and the deployment's origin.

Delivery is the consumer application's, because an address is not knowable before the deployment
is: a published URL is composed from the policy, the projection, the codecs, the parameter values
that turn a pattern into pages, the origin, and the mount point, and all six are values the
application holds when it runs. A release MUST produce the complete file set with each
file's name, contents, kind, URL count, and size, and a consumer application writes or serves it
and states the sitemap line in its robots file.

A release MUST split a set on both of the protocol's limits, fifty thousand URLs and fifty
megabytes uncompressed measured in the bytes served, because with a reciprocal alternate cluster in
every entry the size limit is reached before the count. When a split happens the file the
application published becomes the index and the pages move into numbered files beside it, so the
address a crawler was given does not change.

A release MUST emit a last-modified value only from a value a route declares, and MUST NOT
derive one from a build time or a file time, because it is the one optional element a search engine
reads and it reads it only where it can be verified. Change frequency and priority are emitted
because the format defines them and are advisory.

A release MUST validate the files against the published schemas, pinned alongside the other
normative data. Both sitemap schemas close their content model with a strict wildcard, which
demands a global element declaration for a foreign element, so a release keeps one schema of
its own whose entire content is the two imports that put both namespaces into a single compiled
set. An index file is validated against the index schema directly, because the two sitemap schemas
share a target namespace.

## 12. The document head

A release owns the head of every response it answers, and what goes in it comes from three
places. A route declares its own title and description once, against the route identity. A consumer
application supplies what a catalog cannot hold, per navigation, from what the resolution says. A
page declares what neither could know, during the render that discovered it. A release MUST
read all three, MUST apply them in that order with a later field replacing an earlier one, and MUST
NOT require a consumer application to supply a field at more than one of them.

The title and the description are sentences a visitor reads, so they are authored as messages
rather than in a metadata format of their own. A release MUST resolve a declared message
with the inputs declared beside it, MUST refuse a declaration naming a message that takes inputs
with none bound to it, and MUST refuse it where the declaration is built rather than where the page
is visited. A release that accepted one and resolved it with no inputs would write the message with
its placeholders unfilled, and nothing would report it.

A page's declaration arrives after the navigation that carries it has committed, because the fetch
that produces it finishes after activation. A release MUST re-project the document when one
arrives rather than leave the head as it was built, MUST stamp it with the navigation that made it,
MUST replace a committed declaration outright when a navigation commits, including when the
arriving page declares nothing, and MUST discard the declaration of a navigation that was
cancelled. These are the rules section 2 states for a parameter-spelling declaration, and they hold
here because the hazard is the same: a head describing the previous page.

The head is written whole. A release MUST remove everything it wrote for the previous
document before writing the next, so no head carries a mixture of two pages, and MUST NOT require a
consumer application to clear a field by declaring it empty.

What the address implies is derived rather than merged. The canonical URL and the alternate cluster
of section 10, the social block of section 13, and the robots metadata of section 14 are read from
the outcome in force for this render rather than carried over from the projection, so a declared
absence or removal withdraws what the projection would have claimed. A release MUST
recompute them after a declaration and MUST NOT leave a canonical or an alternate standing on a
response the page has declared absent or removed, because an alternate link is a public claim that
the same page exists in another language and section 10 already forbids one on a missing or gone
response.

An indexing class may be narrowed by a declaration and MUST NOT be widened by one. A page may
declare that it is not to be indexed today; it MUST NOT declare itself indexable where the route's
own class under section 14 says otherwise, because that class is a property of the address and a
page that could raise it could publish an address the application withheld.

A response with no route identity has no route-keyed declaration to read, and that does not make
its head the application's to write by hand. A consumer application declares one document per
outcome class instead of per route: for an address that named no route, for one whose entity was
declared removed, and for a locale the deployment does not serve. A release MUST read those
declarations for a response of the matching class, MUST author them as messages so that catalog
completeness answers for them under the same diagnostic as every other message rather than under a
second mechanism, and MUST report a class with no declaration when a response of that class is
answered, because the response is otherwise served with no title.

## 13. Social metadata

Social preview metadata is completed jointly. A consumer application supplies what only it knows,
the preview image, its alternative text, the site name, and the card format. A release
supplies the localized title and description, the canonical URL, and the locale identity with its
eligible alternates, and MUST emit no social block until the application has supplied an image,
because the format requires one.

A release MUST write the social locale in the underscore form that format specifies rather
than the language tag used elsewhere in the document, MUST resolve the territory from the maximized
locale profile where the format is silent, MUST omit a script subtag the format has nowhere to put,
and MUST emit no locale value at all when no territory can be determined, because a consumer of the
markup cannot distinguish a malformed value from an unrecognized territory.

A release MUST NOT list a page's own locale among its social alternates. This is the
opposite of the alternate cluster in section 10: there the set answers which addresses serve this
page, and here it answers which other languages this page is also available in. Both come from the
same eligible-variant set, so the divergence belongs to the two formats rather than to the data.

Open Graph properties are addressed by property and card metadata by name. A release MUST
emit a card tag only where the card format has no Open Graph equivalent, because the card processor
falls back to Open Graph.

## 14. Indexing classes

A release models three indexing classes, indexable, non-indexable, and private, and they
drive the robots metadata, the robots header, canonical and alternate eligibility, and sitemap
inclusion. Routes are indexable by default and a consumer application marks only the exceptions.

A consumer application names the route-data field carrying that classification, together with the
values in it that mean each class, so a project that already classifies its routes points a release
at the field it has. A release MUST read a field name it was given rather than one of its own
invention, MUST treat a value the declaration does not list as indexable, and MUST supply a
documented default field for a project that declares none.

A release MUST read that declaration from the provider file's source text when the owner is
compiled, and MUST NOT execute consumer code to obtain it, which is why the declaration is a field
name and a table of literals rather than a predicate. A literal MAY be written in place or through a
`const` binding to one, in the same file or imported, and a release MUST follow the binding without
evaluating anything, as section 5 of `10-compiler-and-tooling.spec.md` follows a constant alias. The
same holds for a route's data: a field MAY arrive through such a binding or a spread of one, and a
later key overrides an earlier one as it does when the application runs.

A value the release read and the declaration does not list is indexable. A value it could not read,
because it is computed, a parameter, supplied by a resolver, or behind a binding it cannot follow,
is not an unlisted value, and a release MUST answer the route as private and report it when the
owner is compiled. Reading it as indexable would publish a page whose author may have meant the
opposite, and private is the one reading that cannot expose a page that was meant to stay out.

The data a route has when the application runs is its own over what it inherits from its parents,
and a release MUST read declarations the same way, so a class declared on a parent reaches every
child the framework gives it to. A release MUST apply the framework's rule: a child inherits when
the router inherits always, when the child's own path is empty, or when its parent renders no
component, and a key of the child's own wins. A release MUST read the router's inheritance
strategy from the application's router configuration and use the framework's default, which is to
inherit always, where none is declared. Where the strategy cannot be read, or is declared more than
once, a release MUST report it and inherit always, because for the indexing and caching classes
inheriting can only give a child that states nothing its parent's class, which never makes a page
more shareable or more indexable than its routes say. A route's identity is not inherited, because
it names the route rather than describing the page.

The page at an address is the route the framework renders there. Where the framework decides it at
run time, through a matcher or a guard, a release MUST answer the address as private and not-stored
and report it, as it does a value it cannot read.

Sitemap claims are declared the same way and read at the same moment: a named field whose values map
to what the class claims, with a second named field carrying the last-modified date. A release MUST
refuse a value the protocol would reject when the owner is compiled rather than drop it, because a
silently omitted claim turns a mistyped one into a page that says nothing. There is no default class
here: a value the table does not list claims nothing.

A release MUST emit a non-indexable directive through both the server-rendered metadata and
the HTTP header where the host integration supports both. A robots directive is defense in depth
and MUST NOT be relied on by a consumer application as authentication or confidentiality, and a
robots file does not replace it, canonicalization, or authorization.

## 15. Error presentation and coherence

A release MAY render an unsupported-locale response in a last known supported presentation locale
while stating that the requested locale was not activated. A release MUST NOT mutate locale
persistence, advertise the unsupported locale, or reflect arbitrary path values into links on one.

An ordinary missing route under a supported locale uses that locale for the root language and
direction, the accessible content, the title, and any trusted recovery destination, and a release
MUST keep it a 404 rather than redirect to a homepage or a guessed route. An unknown unprefixed
route is a direct 404 rather than a locale negotiation, and a release MUST emit no canonical or
alternate relationship for it.

The body a renderer draws and the content language of the response name one locale. A release MUST
hand a renderer the locale the response's content language names: the resolved locale at a page,
the locale a prefix or an origin states at a missing or removed page under it, the negotiated
locale at a missing locale-neutral address, and the default locale at an address under a prefix
policy that states no locale the policy serves.

A completed coordinated representation tells one story. The canonical route locale, the content
language, the root language and direction, the visible messages, the title and description, the
social metadata, the localized structured-data fields, the route projection, the catalog snapshot,
and the hydration state identify the same representation. The root language and direction come from
the document effects of `06-runtime-and-angular.spec.md` section 1, and a consumer application that
withdraws them owns this claim itself.

A progressive transition may contain independently delayed regions, language-independent values,
user-authored content, or intentionally multilingual content. A release MUST preserve each
region's actual language, direction, readiness, and outcome rather than relabel it as the primary
locale.

Machine identifiers, URLs, schema names, enum values, currencies, instants, and numeric values stay
machine data. A human-language field uses its message result or its participant result, and a
release MUST NOT admit a consumer payload into the localization snapshot.

## 16. Security and cache boundaries

A release MUST take canonical origins and redirect targets from trusted configuration rather
than from a request-controlled host or header, and MUST NOT let a locale switch create an open
redirect, host injection, cache poisoning, provider crossover, or leakage between request contexts.

A release MUST emit the cache directives it fully determines and MUST take the durations it cannot
choose as arguments, because whether a shared cache may hold a response is a conclusion about a
release's own routing while how long to hold it is a number a release has no basis to pick. The
classification stays available on its own for an application composing the header itself, and
setting the header stays the host's.

A release MUST express what it emits as a set of headers by name rather than one header's
text, so an application writes the set with one loop and gains a header a later release adds
without changing a line. Where a classification's correctness would depend on the duration supplied
with it, the classification is wrong.

Who may keep a response has three levels. Shared is public, held for the deployment's lifetime. Per
visitor is private and revalidated before every reuse. Not stored is private and kept by nobody. A
release computes a level for each response from its routing classification, and MUST let each
declaration below raise that level and none lower it, because a declaration that could lower it
could publish a page that its route or its host said must not be shared.

A consumer application declares a route's level in its route data: a named field and a table of
literals, read from the provider file's source text when the owner is compiled, as section 14 reads
indexing, including what a route inherits, with a documented default field. The declaration is on
the route rather than made by a page while it renders, because a cache reuses a stored response for
any request to its address, including a request where the page decided nothing. A release MUST
answer a value it cannot read, or reads and cannot use, as not stored, and MUST report it when the
owner is compiled, because every value the declaration can name keeps the page out of a shared
cache, and reading an unusable one as absent is the one reading that cannot be what was meant. Under
the default field every value is meant for the release; under a consumer's own field an unlisted
value declares nothing, as it does for indexing. A private indexing class is not stored whatever the
route declares about caching.

A host declares the least level of every page it serves, for a fact that holds on every page, such
as a cookie every page reads or a nonce every response carries, so a route added later cannot
forget it. A release MUST apply it to every response that carries a page, and MUST NOT apply it to
a redirect, which carries none.

A page's own cache directives are the third declaration, and a release MUST combine them with its
own rather than replace them, narrowing only: a page knows what it put in itself and cannot know
which other responses share its address. Not stored raises the level to not stored, private or
revalidation before reuse raises it to per visitor, a shorter lifetime shortens the shared one, and
a directive forbidding transformation is kept. A release MUST NOT carry a directive that lengthens
or widens reuse, and MUST read a lifetime given twice or not as a whole number as stale, as RFC 9111
section 4.2.1 offers. A release MUST read every directive the page's value spells, including one that
follows another with no comma between them, so a value written `max-age=60 no-store` is not stored,
because RFC 9111 section 5.2.2.5 has that directive forbid storing any part of the response. A
release MUST add the page's varying fields to its own, except a cookie, which
raises the page to per visitor instead, and a wildcard, which stands alone.

## 17. Primary references

- RFC 3986, Uniform Resource Identifier (URI): Generic Syntax:
  `https://www.rfc-editor.org/rfc/rfc3986`
- RFC 9110, HTTP Semantics: `https://www.rfc-editor.org/rfc/rfc9110`
- RFC 9111, HTTP Caching: `https://www.rfc-editor.org/rfc/rfc9111`
- Sitemaps XML format 0.90: `https://www.sitemaps.org/protocol.html`
- Google Search Central, Localized versions of your pages:
  `https://developers.google.com/search/docs/specialty/international/localized-versions`
- The Open Graph protocol: `https://ogp.me/`
