# Locale identity and resolution

What a locale is in Equator, how one is declared, how the runtime decides which one a visitor gets,
where that decision is remembered, and what happens when a translation for it is missing.

The standards editions behind identity and matching are in `01-standards-profile.spec.md` section 3.
What a running application does with a resolved locale, and the snapshot that carries it, are in
`06-runtime-and-angular.spec.md`.

## 1. Ownership

A release owns the mechanism: identity, canonicalization, inheritance, matching, resolution order,
persistence contracts, fallback, and recovery. A consumer owns which locales exist, what they are
called in its product, which sources it consults and in what order, where a preference is stored,
and how complete a release has to be.

## 2. Locale declaration

A consumer declares its source locale, its default locale, its supported locales, and any aliases
once. The toolkit derives the typed locale table, the canonical alias map, the availability lookup,
and the runtime defaults from that declaration.

A release MUST derive every locale-dependent table from the one declaration.

## 3. Canonical identity

A locale identity is a well-formed Unicode BCP 47 identifier, canonicalized under RFC 5646, the
pinned LDML release, and the pinned ECMA-402 behavior. Canonicalization:

- normalizes casing;
- applies the registered deprecated aliases of the pinned data;
- rejects a malformed form such as `en_US` at a trusted configuration or authoring boundary.

A generated configuration states each locale it serves in canonical form. The runtime refuses a
configuration whose locale list holds a malformed tag or a tag in any other form, because no request
could ever resolve to such a locale.

Canonicalization MUST be deterministic across the toolkit, the server, and the browser. A difference
between runtimes MUST NOT change an identity anything compares, stores, or exchanges.

Likely-subtag maximization MAY inform matching and direction analysis. It MUST NOT rewrite a declared
identity, a catalog key, a URL value, a cache key, or a persisted preference. A function that
describes a tag it is handed, rather than a configured locale, refuses a tag it cannot describe
with the typed `invalid-configuration` failure and the reason `malformed-input`, as an address
builder refuses a locale that is not a tag. A release MUST refuse that way a value that is not text,
a tag the platform does not parse, with the platform's error as the cause, and a tag that names no
script and has none in the likely subtags data, so one function refuses in one class.

A `-u-` extension is a formatting preference, validated separately, and is not part of a catalog's
identity. A transform, private-use, or other extension receives no meaning without an explicit
profile.

A catalog locale identity carries no extension and no private-use subtag at all. A release MUST
reject one where a catalog takes its identity, and therefore where a catalog key, a cache key, a URL
value, or a persisted preference does.

Untrusted locale text is bounded in length and complexity, and a release MUST NOT use it
directly as an identity, a path, a cache key, a protocol field, a stored value, or the payload of a
diagnostic.

## 4. Inheritance

Which locale a locale inherits from is pinned data, not a consumer's statement. Equator takes each
parent from the pinned CLDR release under the inheritance rules of UTS #35 Part 1, Parent Locales
(LDML 48.2): a locale takes the parent that release declares for it; a locale it declares no parent
for takes the tag with its last subtag removed; and a locale it gives no parent below root inherits
from nothing. A declared parent may change the language, and a release MUST follow that rather than
narrow the pinned data.

The parents are those of a component. UTS #35 Part 1, Parent Locales (LDML 48.2), gives the
plurals, collations and segmentations components parent lists of their own, which stand alone
rather than adding to the main list, and a locale its component's list does not name takes the tag
with its last subtag removed. A catalog chain walks the main component. A formatting operation
walks the component its data comes from, as `08-formatting-parsing-and-domain.spec.md` section 4
states.

The main component has a rule as well as a list. A release MUST give root as the main parent of a
locale that is a language and a script other than the likely script of that language, the
`nonlikelyScript` rule of the same section, whether or not the pinned list names the locale: the
list is a subset kept for migration, and `ru-Latn` inherits from nothing although no entry names it.
A parent the pinned list declares for such a locale is still its parent, so `hi-Latn` inherits from
`en-IN`, and a locale with a region below the script truncates to the script first. The likely
script is that of the language in the pinned likely subtags, and a language they give no likely
script keeps truncation. The toolkit holds the likely script of every language the pinned data
lists, 7,207, because a project configures locales in any language. The runtime holds the 324
languages CLDR has locale data or plural rules for, because a host's data is drawn from them, so a
formatting locale in any other language reaches no locale the host has whichever parent it takes.

A pseudo-locale's script subtag carries its direction and nothing else, as
`10-compiler-and-tooling.spec.md` section 16 states, and its text is in its source language. The
rule keeps text in one script from inheriting text in another, so a release MUST NOT apply it along
the chain of a pseudo-locale: `en-Arab-XB`, which UTS #35 Part 1 describes by its region as a
"derived testing locale with forced RTL English", inherits through `en-Arab` to `en`. A locale is a
pseudo-locale where the configuration declares it under `pseudoLocales`. Its tag does not say so,
because the regions UTS #35 leaves free for pseudo-locales are free for an application's other
locales too.

A language_region can stand for a locale with a script. UTS #35 Part 1, Lookup (LDML 48.2), gives a
language written in more than one script the locales language, language_script and
language_script_region, and makes language_region an alias of language_script_region by likely
subtags. A release MUST give a language_region whose likely script differs from its language's,
where the pinned list declares no parent for it, the parent language_script_region in every
component: `zh-TW` inherits through `zh-Hant-TW` and `zh-Hant` and never through `zh`, which is
written in the other script, and `sr-ME` through `sr-Latn-ME` and `sr-Latn`. A language_region
whose likely script is its language's truncates as before, so `sr-RS` inherits from `sr`. The
toolkit holds the 60 language_region tags of the pinned likely subtags whose script differs from
their language's, and the runtime the 51 of them in the languages it holds.

A consumer that disagrees declares a parent for one locale. The declaration replaces one step of the
chain and leaves the rest pinned, and naming root says the locale inherits from nothing. It is read
at every step rather than only at the first, so a consumer may redirect a locale nobody serves that a
whole family inherits through.

A declaration for a locale that no configured locale inherits through is an error, and so is one
whose chain returns to a locale already in it. The runtime refuses a generated configuration whose
chains lead a locale back to itself through the locales it names, as it refuses any other
inconsistent table.

## 5. Aliases

An alias is a consumer's own spelling of a locale: a name its product uses, or one its storage
already held. A relation the pinned data already states is derived rather than declared.

An alias that collides with a supported locale, shadows one, forms a cycle, or names a locale the
consumer does not support is an error, and a release MUST refuse the configuration rather
than pick a reading of it.

## 6. Encompassed languages

Two language subtags can name the same language. A request for one of them against a supported
locale spelled with the other is a match, and it is decided from the locked standards data rather
than from configuration: membership from the pinned IANA Language Subtag Registry snapshot, ordering
from the pinned CLDR release's language matching data, read at the language dimension only.

A release MUST NOT read the script or region dimensions of that data as distances. Those
distinctions are decided categorically by the matching steps in section 7.

## 7. Resolution sources

The runtime provides one resolver over four sources. A consumer declares which are live and in what
order.

| Source    | Answers from                                                 |
| --------- | ------------------------------------------------------------ |
| `url`     | The locale the current address states, under the URL policy. |
| `stored`  | The configured persistence stores, in their declared order.  |
| `browser` | The request's or the browser's language preferences.         |
| `default` | The configured default locale.                               |

The first source that answers decides. An omitted source is not consulted at all. Every source except
`default` MAY decline, and answering the default in place of a source that declined would make every
later source unreachable.

When no order is declared, the order is `url`, `stored`, `browser`, `default`. The address leads
because a shared link has to open in the language it names.

Explicit selection is not one of the sources. It is a decision already taken rather than a preference
to be weighed, and an invalid one MUST return a typed failure and change no state.

A language range is matched against the supported locales by exhausting that range before the next
one is considered:

1. the range itself, after canonicalization and consumer aliases;
2. the range with trailing subtags dropped one at a time, which is RFC 4647 lookup;
3. any supported locale sharing the range's language and the script it is written in;
4. any supported locale written in that script whose language is the same language under another
   subtag, as section 6 defines.

Step 3 is required rather than optional, because lookup alone leaves a request for one region of a
language unmatched against a supported locale in another region. A request for Traditional Chinese
MUST NOT be answered in Simplified, so the script is compared. Scripts are compared after
likely-subtag maximization, because most real tags name no script. A range that expresses no
preference is not a match.

Resolution is sensitive to which source answered:

- an address and an explicit selection use exact canonical identity or a declared alias;
- a recognized noncanonical address is handled by the routing canonicalization contract in
  `07-routing-rendering-and-seo.spec.md`;
- malformed or unsupported locale intent in an address MUST NOT render another language at that
  address;
- a stored value that no longer canonicalizes to a supported locale is excluded, with a bounded
  diagnostic that MUST NOT echo the value;
- a language preference list honors its order and its quality values;
- automatic matching MUST NOT cross base languages or choose an incompatible script;
- a contradiction in trusted configuration MUST fail before use rather than degrade into a
  preference.

## 8. Persistence

Locale state works with no persistence at all. A release provides typed opt-in stores for
memory, a cookie, browser storage, and an authenticated profile. A consumer owns their order, their
names, their attributes, their lifetimes, their domain scope, their endpoints, their credentials,
their antiforgery, and any synchronization between applications.

Stores are read in the consumer's declared order and the first believable value wins. A release MUST
NOT reorder or merge them. A value is believed only while it still canonicalizes to a currently
supported locale.

Only a deliberate locale change is written. A locale that initialization resolved MUST NOT be written
back: persisting it would turn the first negotiated answer into a permanent one, and a later change
to the visitor's own preferences would stop having any effect. A write reaches every configured
store.

A remembered choice can be removed, and removing it is not a locale change. A release MUST
supply the two separately: one operation that forgets what is stored and leaves the page where it
is, and one locale change that moves the page without recording a choice. Neither alone is enough.
Forgetting alone leaves the page in the language that was stored. The only operation that moves the
page records a choice, so honouring the request with that operation stores a new one. Used together,
the two put a visitor back where resolution would have placed them with nothing stored.

A removal reaches every configured store, for the reason a write does: a choice removed from one
store and still held by another is read back at the next visit. A release MUST report a
removal that could not reach every store, because a removal reported as complete while a store still
holds the value leaves the choice in force.

Removal is not required of a store. A release MUST keep the persistence port implementable
without it and MUST treat a store that offers none as a store the removal did not reach, because the
port is what a consumer application writes against and a release that added a required method to it
would stop every store written against the previous one from compiling.

A persistence failure MUST NOT corrupt active state, and a write for an older decision MUST NOT
supersede a newer one.

While the server renders, a store answers only from what the request carries or what the server
can reach: the cookie store reads the request, and a profile store reads whatever its transport
reaches from there. Only a store that answers there can fix the language of the first response.
Browser storage cannot. A page the server drew or a build wrote is adopted as it was decided, as
`06-runtime-and-angular.spec.md` section 10 requires, and once hydration is complete a release MUST
read the stores again, so that a stored choice the declared sources would choose for the address
moves the page. The visitor sees the move, and it is not written back. A value read this way, or
when a page returns from the browser's back-forward cache, MUST NOT move the page if the visitor
asked for a locale change or a removal while it was being read: that request is the newer
decision. A release MUST report to the observability sink each way such a read ends, whether it
moves the page or leaves it where it is, and each reason the stores were not read, each as an
event none of the others produces, because a page left in the wrong language by a read that found
nothing looks, from outside, the same as one whose stores were never read. Cookie writing is done
in the browser, because the response headers belong to the consumer's server.

The locale cookie a release writes, from its browser store or from its own request handler, MUST
be one a browser stores. A release MUST refuse at configuration a cookie name that is not a token, a
path or domain a `Set-Cookie` header cannot carry, a lifetime that is not a positive number of
seconds, and an attribute combination the browser's cookie storage model discards, such as
`SameSite=None` without `Secure` or a `__Host-` name with a domain. A release MUST make each of
those refusals an `invalid-configuration` failure, as it makes every other option it refuses.

Persistence state is created per injector rather than per configuration, so a store declared in a
shared application configuration cannot carry one server-rendered request's preference into the next.

## 9. Fallback and strictness

When a translation is unavailable in the target locale, the runtime consults the locales that target
inherits from, nearest first, before it consults the source locale. The chain is walked to its end
rather than one step, because a locale inheriting through a locale nobody serves would otherwise
reach the source with its own language still unread. A member the consumer does not ship is not
consulted, having no catalog to answer with.

The first member carrying a valid compatible message supplies the result. That result keeps that
member's locale and direction, and it reports every locale consulted on the way to it.

When no member carries the message and a valid compatible source message exists, the default policy
renders the source-locale result, keeps its locale and direction, and reports a structured fallback
diagnostic. A consumer MAY set a strict policy instead, which refuses the source-locale result and
accepts an inherited one. A message supplied by a locale the target inherits from is that locale's
own answer under section 4, and it is what a completeness check counts, so refusing it at render
would make a project that passes the check a project a strict runtime cannot render.

Fallback MUST NOT accept invalid syntax, incompatible inputs, unsafe rich structure, or an
incompatible artifact, and MUST NOT emit a raw key, a parser detail, or an unexplained empty value.

## 10. Content that is not a fallback

Consumer-owned content is not a message, and a release MUST NOT apply message fallback to it.
A representation supplied in another locale is accepted only under an explicit consumer policy, and
it reports both the target locale and the locale that supplied it. Otherwise, unavailability in the
target locale stays an explicit outcome the consumer handles.

Content that is language-independent, user-authored, or deliberately multilingual is not a fallback
representation and stays valid across interface locales. It keeps its own language and direction,
per-segment metadata where it has any, or an explicit unknown state.

The unknown state is stated rather than left absent, and a release MUST classify these cases
so a consumer can tell them apart. Content carrying a resolvable script keeps its direction, even
where the language is undetermined. Content that is undetermined with no script to resolve, content
supplied with no tag, and content declared language-independent all resolve to a deferred direction
rather than an assumed one. A malformed tag remains an error.

A deferred direction instructs the renderer to apply the first-strong rule of UAX #9 to the content
in front of it. A release MUST NOT inspect that content or record a conclusion about it, because
assigning a direction to content whose direction is unknown states as fact something a release has
no basis for.

The runtime preserves a declared language and direction safely. It MUST NOT detect, translate,
rewrite, moderate, store, or decide the authoritative language of a consumer's content.

## 11. Recovery

Recovery is what renders when the localization runtime itself could not start or could not recover a
usable state.

The toolkit derives a minimal, independently loadable recovery payload from the ordinary configured
messages a consumer already writes, so no duplicate emergency catalog is authored.

A release MUST supply an accessible renderer for that payload, announced to assistive
technology, carrying the language and direction of the message it renders, and offering a retry. A
consumer owns the wording, the presentation, and where a retry leads.

## 12. Primary references

- RFC 5646, Tags for Identifying Languages: `https://www.rfc-editor.org/rfc/rfc5646`
- RFC 4647, Matching of Language Tags: `https://www.rfc-editor.org/rfc/rfc4647`
- RFC 9110 section 12.4.2, Quality Values: `https://www.rfc-editor.org/rfc/rfc9110`
- UTS #35 Part 1, Core, LDML 48.2: `https://www.unicode.org/reports/tr35/tr35-78/tr35.html`
- UAX #9, Unicode Bidirectional Algorithm: `https://www.unicode.org/reports/tr9/`
