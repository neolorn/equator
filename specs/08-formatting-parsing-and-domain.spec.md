# Formatting, parsing, and domain values

How a domain value is held, how it is rendered for a reader, how a reader's typing is read back into
one, and where the boundary between Equator and an application's own data sits.

The standards edition behind every capability here, and the rule that the host's own implementation
is the engine, are `01-standards-profile.spec.md` sections 5 and 6. The formatting context travels
with the snapshot of `06-runtime-and-angular.spec.md` section 4. What may be rendered as trusted
markup is `09-safe-content-and-ux.spec.md`.

## 1. The invariant domain boundary

A release MUST store, transport, compare, cache, validate, and identify a domain value in
locale-invariant form. A localized string is presentation output, and a release MUST NOT let
one become authoritative money, a number, a date or time, a duration, a unit, an enum, a route, a
cache key, an authorization value, or a protocol field.

Message locale, formatting locale, time zone, calendar, numbering system, hour cycle, week rules,
measurement system, and default currency policy are separate explicit dimensions. A consumer
application's own user, organization, tenant, route, field, or operation policy decides their
precedence, and a release MUST NOT take any of them from the host machine's ambient
settings.

## 2. Canonical value contracts

A release defines a lossless typed form for each value kind it carries.

| Kind                            | Canonical form                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Instant                         | A point on the UTC timeline, transported as a signed base-ten epoch-nanosecond string with no exponent and no unit ambiguity.    |
| Plain date, time, and date-time | Explicit civil fields with no implicit zone or offset.                                                                           |
| Zoned date-time                 | An instant with a canonical time-zone identity and a calendar.                                                                   |
| Duration                        | Signed structured calendar and clock units rather than an assumed millisecond count.                                             |
| Decimal                         | A normalized base-ten string, optional minus, no exponent, no grouping, no plus sign, no negative zero, no noncanonical padding. |
| Money                           | An exact decimal with an explicit currency code.                                                                                 |
| Measurement                     | An exact amount with an explicit unit.                                                                                           |
| Percent or rate                 | An exact decimal with an explicit semantic scale.                                                                                |
| Percentage points               | An exact decimal value or delta, distinct from a percent or a rate.                                                              |

A release MUST normalize and validate these through public factories, and MUST admit a
platform date, a native temporal value, a transport object, a decimal library value, or a
domain-library value only through an explicit adapter that cannot confuse seconds with
milliseconds, civil time with an instant, a currency, a precision, or a unit.

Converting civil time to an instant requires an explicit zone and an explicit disambiguation
policy, and balancing a calendar-relative duration requires an explicit reference and zone where
the result can vary. A release MUST take time-zone identity, aliases, and links from the pinned
time-zone database recorded under `01-standards-profile.spec.md` section 4, and MUST NOT let host
presentation data redefine a stored time-zone identity. A release converts nothing itself: where a
value is formatted in a zone, the conversion comes from the host's `Intl`.

A time zone's identity MUST be the primary identifier the pinned database gives its name, as
ECMA-402 section 6.5 defines one: a Zone is primary, a Link resolves to the Zone it names, a Link
that the `TZ` column of `zone.tab` lists is primary itself, any other Link whose Zone lies in
another country resolves to a name `zone.tab` lists for the Link's own country, and `Etc/UTC`,
`Etc/GMT`, `GMT` and their Links are `UTC`. Where that country has one `zone.tab` line the Link
resolves to it, and where it has several, to the name the release's `backzone` file maps the Link
to. A release MUST resolve a name the database added to replace a Zone, where the database keeps
the former name as a Link, to that former name until the pinned release is two years or more later
than the release that renamed it, the waiting period section 6.5.1 of that standard recommends,
because an identifier stored earlier is one a system on older data cannot read. A name is matched
without regard to the case of its ASCII letters, which are the only letters a name of the database
has. The fixed offsets the release names under `Etc/` are Zones of it. A name the pinned release
does not carry, which a clock offset such as `+05:00` and a zone newer than the release both are,
is refused where the value is created. The host is not asked about a name, so a name has one
identity in every engine; whether the host has rules for a zone is reported where a value is
formatted in it.

A zoned date-time's calendar is a name written as UTS #35 Part 1 writes the type of a calendar:
one or more subtags of three to eight lower-case ASCII letters and digits, joined by hyphens. A
name written any other way is refused when the value is created. The host is asked about neither
the zone nor the calendar there, so the same zone and calendar make the same value in every
engine, and a value made in one can be read in another. What the host lacks is reported where the
value is formatted: a zone the host has no rules for, a well-formed calendar name the host has no
calendar for, which the host would format in the locale's own calendar without an error, and an
alias or another spelling the host answers to under a different name each return the typed
unsupported result of section 3, and nothing is formatted in another calendar.

A plain date is counted in `iso8601` unless it names another calendar, and the name is written as
a zoned date-time's is and refused where the date is created if it is not: a value's calendar has
one syntax whichever kind of value carries it, and a date field's profile is held to the same.
`gregory` is the proleptic
Gregorian calendar, which counts the days ISO 8601 does, so a date in it has the fields of the ISO
date of the same day and is held to the same month lengths where it is created. A release MUST
format a plain date or date-time counted in `gregory`, which is what a date field of that calendar
reads, and MUST write it in the Gregorian calendar, under the calendar an operation names and over
the context's. A date in any other calendar is three fields of that calendar, held where it is
created to a month of 1 to 12 and a day of 1 to 31. Writing it needs a conversion between
calendars, which a release does not perform, so the formatter returns the typed unsupported result
of section 3 for it.

A release MUST NOT perform accounting, exchange, tax, cash rounding, business precision, rate
calculation, percentage-point conversion, or implicit unit conversion. Those belong to the consumer
application's domain.

## 3. Formatting

A release supplies typed text and structured-parts formatting for the ECMA-402 capabilities
the host provides: numbers, dates and times and their ranges, relative time, lists, display names,
plural rules, durations, collation, segmentation, and locale metadata.

A release MUST feature-detect a capability before relying on it, and MUST return a typed
unsupported result, or use an explicitly installed adapter, where required behavior is absent or
inconsistent. A release MUST NOT approximate one silently.

A release MUST accept an instant at whatever precision it carries and format it to the
precision the requested options ask for, and MUST reserve a refusal for output that was genuinely
requested and cannot be produced, which no date-time option expresses below a millisecond. The
millisecond an instant occupies is the one containing it, so an instant before the epoch is never
displayed as later than it is.

Localized output is identical across every runtime in the supported envelope, except where a
supported runtime lacks a capability: that runtime returns the typed unsupported result above, and a
release MUST name the capability and the runtime in its documentation. A release MUST format real
content in each supported locale on each supported runtime and compare the results, because a
browser and a server that render the same page must not produce different text.

A release MUST use one immutable formatting snapshot across server rendering, hydration, and
browser evaluation, so hydrated output matches the server exactly, and MUST take an explicit
reference instant or clock for a clock-sensitive operation.

Message grammar and catalog-authored literals use the supplying catalog locale, including under
fallback. A user, field, route, or operation value uses the effective formatting context. A release
MUST NOT conflate the two.

A release MUST use the declared semantic scale when formatting a percent. The standards-native
fractional scale is the default, so a quarter formats as twenty-five percent; a percent-unit scale
is declared rather than inferred. Percentage points are a separate contract and a release MUST
NOT let one enter percent formatting implicitly.

A named formatting profile is typed, reusable, composable, and declared once. A release MUST NOT let
a narrow per-operation override mutate global state. Structured parts preserve the semantic kind,
the source value identity where that is safe, and the language and direction metadata, and a release
MUST NOT put trusted markup in one.

A release MUST key a cached formatter on its complete locale and options identity and MUST
bound that cache, so arbitrary option cardinality cannot grow memory without limit.

## 4. The formatting context

A formatting context is resolved in three layers, narrowest last: the application-wide context, then
the declared context for the locale being formatted, then the pinned locale data for that locale,
which is the standard's choice rather than an absent one.
The options of one operation, a formatting call or a message expression, are narrower than all
three, and a release MUST format with the time zone, calendar, or hour cycle an operation names
over the context's. The context's calendar is the one a date that names none of its own is written
in: an instant, and a plain date or date-time counted in `iso8601`, whose fields say which day it
is and not how the day is written.

A host does not have data for every locale, and one asked for a locale it lacks raises nothing:
under ECMA-402 13th edition sections 9.2.3 and 9.2.7 it writes in the longest prefix of the tag it
has, and in its own default locale where it has none, so the same context would be written in
another language on another host. A release MUST fall back the same way on every host, through the
pinned parent chain of `03-locale-identity-and-resolution.spec.md` section 4 to the first locale the
host has for the operation. A release MUST walk the chain of the component the operation's data
comes from: plural selection the plurals component, ordering the collations component, segmentation
the segmentations component, and every other operation the main one, so `sr-Latn` takes the plural
rules of `sr` while its numbers inherit from root. A host has a locale for an operation where the
operation's constructor, asked for that locale alone with lookup matching, answers with it. A result
names the locale of the chain that wrote it where that is not the context's own: as the language of
a formatted value, as the `language` of a capability's answer, and as the `valueLanguage` of a
message's formatted part. A release MUST report a fallback, as `fallback` on the first two and
`valueFallback` on the third, where that locale differs from the context's in language or in script,
and MUST NOT report one where it differs in neither: `en` answering for `en-US` is not a fallback,
and `fr-HT` writing for `ht` and `zh` answering for `zh-TW` are. Each script is the one the tag
names, else the likely script of its language and region, else of its language, looked up in the
order of UTS #35 Part 1 section 4.3 (LDML 48.2) in the pinned CLDR data, and never asked of the
host. The pinned table holds the 324 languages CLDR has locale data or plural rules for, and where
either side's language is not among them the language alone decides.
A pseudo-locale formats in its language with what its formatting declares. A context marks one with
`pseudoLocale`, which the runtime sets on the context it builds for a locale the generated
configuration lists as a pseudo-locale, and which the application-wide context and a context
transferred from a server render never carry. A release MUST walk the chain of a context so marked
without the likely-script rule, as `03-locale-identity-and-resolution.spec.md` section 4 states,
and MUST take the context's script to be the likely script of its language, so `en-Arab-XB` is
written as `en` writes, in the digits its declaration names, and is not a fallback. A release MUST
return the typed unsupported result of section 3, with the reason `malformed-input`, from every
operation that walks the chain where the member marks a locale whose region is not one a
pseudo-locale takes.
The chain ends at root, which writes no language, and a release MUST return the typed unsupported
result of section 3, with the reason `native-capability-rejected`, where no locale of the chain is
one the host has. Root is not asked of the host, which answers `und` with its own default locale, so
`ht` is refused for plural selection, ordering and segmentation: its main parent `fr-HT` is named by
no other component, and `ht` truncates to nothing. The chain is the pinned one, and an owner's own
parent declarations shape its catalog chains and not this one. A keyword of the context's locale
that the operation reads, `ca`, `hc` or `nu` for a date, `nu` for a number, a relative time or a
duration, and `co`, `kf` or `kn` for an ordering, goes with the locale that formats, and a release
MUST report one the host drops as it reports an option the host drops. An option the operation names
takes the place of the keyword it names.

A calendar reaches a date formatter from the operation, from the value, or from the context, and
is held to one rule whichever named it. A release MUST refuse a calendar that is not written as
section 2 writes a calendar's name without asking the host, and MUST return the typed unsupported
result of section 3 from every date formatter where the host answers a well-formed name with
another calendar, which a host does without an error for a calendar it does not have and for an
alias of one it has. The first carries the reason `malformed-input` and the second
`native-capability-rejected`. A context that names `iso8601` names no calendar to write in, and a
date under it is written in the locale's own.

A numbering system reaches a formatter from the operation or from the context, and is held to the
same rule. A release MUST format with the numbering system an operation names over the context's,
MUST refuse one that is not written as UTS #35 Part 1 writes the type of a numbering system, one or
more subtags of three to eight lower-case ASCII letters and digits joined by hyphens, without
asking the host, and MUST return the typed unsupported result of section 3 from every formatter
that writes digits where the host has no digits under a well-formed name, which a host given the
name does not report. The reasons are a calendar's.

A collation reaches an ordering from the operation alone, and is held to the rule as well. A
release MUST refuse a collation that is not written as the type of a collation is, the same syntax,
without asking the host, and MUST return the typed unsupported result of section 3 where the host
answers a well-formed name with another collation, which a host does without an error for a
collation it does not have and for one the locale does not have.

A time zone reaches a date formatter from the operation, from the context, or in a message from a
variable, and the host judges it there. A release MUST return the typed unsupported result of
section 3, with the reason `native-capability-rejected`, from every date formatter and every
message function that writes a date where the host does not read the name it is given as a zone,
and MUST NOT write the date in another zone. A host reads an alias, a link, another spelling and a
clock offset such as `+05:00` as the zone they name and may answer under a name of its own, so its
answer is not compared with the name asked for. The pinned table of section 2 judges the zone of a
value where the value is made, and a zone a message writes as a literal where the message is
compiled. The message path carries no time-zone table, because every application that renders a
message would carry it, so a zone from the context or a variable is the host's to judge. An hour
cycle the context names is judged by the host the same way, and a release MUST return the same
typed unsupported result from every date formatter and every message function where the host does
not read it. A plain time or date-time has no zone and is written at its own fields, which writing
it in UTC does, so a release MUST write it under a zone an operation names where the host reads
that zone as UTC, whatever name the zone is given there, and MUST return the typed unsupported
result of section 3 under any other zone.

A release MUST let a locale declare only what is a fact about how it is written: its numbering
system, its calendar, and its hour cycle. A time zone is not one of those, so a release MUST keep
the time zone application-wide, because it belongs to the reader or the deployment rather than to
the language, and one page is read in one zone whichever language it is in.

A context transferred from a server render applies to the locale it was rendered for. A release MUST
NOT let it become the default for another locale.

A context is carried as it is given. Making one, and admitting one transferred from a server
render, judge the shape and the size of its members and nothing else about them, and what an
application declares for a locale is judged by its syntax where the configuration is read. Each
operation judges the time zone, the calendar, the numbering system and the hour cycle it reads, so
what is wrong in a context is reported where a value is formatted or a field is read under it, and
a member no operation reads is never a failure.

## 5. Relative time

Relative-time presentation is divided by owner, and a release MUST hold that division.

A release owns unit selection: the largest configured unit whose threshold the elapsed span reaches,
truncated toward zero so a phrase never claims a span is larger than it is, sign-preserving, and
reported without a sign at zero. A consumer application owns the thresholds, declaring the smallest
and largest units worth naming and the elapsed span past which relative phrasing stops, and MUST NOT
implement unit selection itself.

A span beyond that range is an explicit non-relative decision carrying the elapsed span. A release
MUST NOT report it as a formatting failure and MUST NOT substitute an absolute rendering, because
the format, the zone, and the wording of that rendering belong to the application.

The units a policy names are the seven a span is said in: year, month, week, day, hour, minute, and
second. A policy that names any other unit, names a smallest unit larger than its largest, or
declares a ceiling that is not a number of milliseconds from zero up is refused as an invalid
configuration. No unit is selected under it, and the refusal is a result of its own, apart from the
non-relative decision.

## 6. Localized parsing

A release MUST NOT expose a universal permissive parser. Every localized parser is opt-in and
field-specific and states its locale, its expected value kind, its accepted syntax, its range and
precision, its currency, unit, or percent-scale policy, its calendar, time-zone, and disambiguation
policy, and its behavior on ambiguity.

Strict parsing is the commit default. A result is one of valid, incomplete, invalid, ambiguous,
out-of-range, unsupported-capability, or policy-rejected, and a release MUST carry an
invariant typed value only on the valid one.

Every result carries the text as it was given, a date-time field's included when the fault is in one
half of it. A field's profile, its calendar and its locale are judged before what its text says: an
invalid profile is policy-rejected, and a calendar the field does not read or a locale the host has
no digits to read it in is an unsupported capability, for every text within the field's character
limit, the empty text included.

The character limit is asked first in every field, before the host is asked anything about the
field's locale or its numbering system, so text of any length costs bounded work to refuse and is
refused alike in every locale. A field whose profile declares no limit takes its kind's: 64
characters for a date, a time, or an instant, 128 for a date-time, and 256 for every other kind.

A release MAY preserve incomplete localized text during composition or editing. A release MUST NOT,
on commit, select the first plausible interpretation, change a currency or a unit, or resolve a
daylight-saving ambiguity silently.

The numeric input profile covers localized digits, signs, grouping, decimal separators, and
explicitly contracted percent, currency, and unit forms. A release MUST reverse the field's
declared scale when parsing a percent, so localized twenty-five percent yields a quarter under
fractional semantics and twenty-five under a declared percent-unit profile. Percentage-point input
stays a separate contract.

A money, measurement, or percent field reads a number typed with its marker or without it, and
refuses the bare number only where the field's profile requires the marker. A duration field refuses
a leading sign unless its profile allows or requires one.

A marker is read in each spelling the host's formatter writes beside a number in the field's locale,
so a measurement field reads its unit in the spelling of every plural category the locale has:
`1 day` and `5 days` in English. A spelling the locale writes with no number in it, as Arabic writes
one day and two days, is not read, and a value the locale writes that way is reported instead of
written. A number is negative only where the text carries the locale's minus sign.

A field is read and written under the numbering system its formatting context declares. A context
whose numbering system is not a numbering system identifier, the empty string among them, is refused
as an invalid configuration, and one the host has no digits for is refused as an unsupported
capability. Neither is read as a context that declares none.

A date, a time, a date-time, or a duration is written in the digits of its context's locale. A
locale the host has no digits for is reported on writing as an unsupported capability, with the
host's refusal as the reason, as it is on reading and as a numeric field reports it, and not as a
fault in the value or in the field's profile.

A numeric field is written back in the spelling its profile reads. Where the profile declares a
precision the value is written to it, and a value the precision would round is reported instead of
written. Where it declares none the value is written with every fraction digit it has, and a rounder
value keeps the fraction digits the locale shows for its kind.

Writing a field answers with the text or with a reported failure, and does not throw. A value that
is not of the profile's kind, a value written by hand that lacks a member its kind declares or holds
something else in its place, and a locale the host refuses are each reported. A value the field does
not take is reported before the context's numbering system is judged: the value is the caller's and
the numbering system the application's, so the fault named first is the one the caller can correct.

Temporal parsing uses declared patterns or generated field profiles. A release MUST NOT use
the platform's permissive date parser, host coercion, a guessed field order, natural-language
guessing, or the host's implicit time zone as a correctness path.

The character limit of a date-time field is the field's own and bounds the whole text. Its date and
time halves carry no limit of their own, so a half is as long as the field's limit leaves room for.

A duration field's pattern names its units from the seven a duration value holds: years, months,
weeks, days, hours, minutes, and seconds. A profile that names any other unit is refused as an
invalid profile, whatever the text.

An instant field reads the machine syntax its profile names. RFC 3339 is the one syntax a release
reads, and a profile that names another, or none, is refused as an invalid profile.

A release MUST NOT locale-parse a domain code, an enum value, an identifier, a route or cache
key, an authorization value, a protocol field, or a machine timestamp.

## 7. Locale data, person names, and what stays domain-owned

A release exposes typed access to display names, plural rules, direction, calendars, numbering
systems, hour cycles, week information, collation, and segmentation under the pinned profile.
Locale-aware collation and case conversion are presentation and search aids, and a release MUST NOT
use either for a security decision or an identity comparison.

Person-name formatting follows the pinned CLDR person-name semantics and takes explicitly structured
data. A release MUST preserve the fields supplied, MUST distinguish the name's own language
and script from the surrounding locale, MUST NOT impose a universal given-and-family persistence
schema, and MUST NOT parse an unstructured name into authoritative components.

The fields of a name are well-formed Unicode text. A field that carries half of a surrogate pair is
refused when the name is built, as one carrying a control or a direction-override character is.

A name can reach the formatter without having been built, carrying a language tag the platform
refuses. A release MUST format such a name rather than throw: a monogram is the first code point of
its field, and a field a pattern asks for in capitals takes the case mapping that belongs to no
locale.

Postal-address schemas, canonicalization, deliverability, validation, and final layout stay with the
consumer application, as do telephone parsing, regional numbering metadata, canonicalization,
dialing behavior, and validity. A release localizes the labels, the instructions, and the
issue presentation around them, and MUST NOT define an address or telephone database, validator, or
provider contract.

An extension supplying a formatting or parsing adapter is paired with its inert descriptor at
runtime setup and is invoked by passing the installed adapter rather than a name for it, so a
misnamed adapter and a value it cannot format fail to compile. A release MUST resolve the
adapter through the calling context's own registry, MUST apply the descriptor's input bound before
invoking it, MUST supply the committed formatting snapshot, and MUST refuse a generated required
descriptor whose trusted binding is absent or not byte-for-byte compatible.

An extension MUST run synchronously and return bounded text or coherent structured parts. A release
MUST return an explicit unsupported-formatting result for a handler that is missing, asynchronous,
throwing, malformed, or over its bound, and MUST take a parsing adapter's result type from the
adapter rather than from the caller, because a caller-declared result type is an assertion nothing
checks. An extension MUST NOT weaken the strict result model or reach a consumer that did not select
it.

## 8. Forms, localized input, and issues

A release provides framework-neutral localized field parsing, presentation, and issue
contracts, with thin opt-in adapters for the supported Angular Forms APIs. The core behavior works
without a Forms adapter, and a release MUST keep an optional Forms value import out of the
primary entry point, under `02-packages-and-platform.spec.md` section 6.

A validator produces a stable invariant issue code with typed parameters that are safe to put in a
schema, and a generated mapping resolves a known issue to a compatible message contract.

An unknown, malformed, or unauthorized code stays an explicit unknown state. A release MUST
give it a safe generic presentation and a diagnostic, MUST NOT reject the transport merely because a
code is unknown, and MUST NOT coerce it into a known value.

Field parsing follows this document. The control value, the selection, an active composition, the
touched, dirty, and pending state, issue precedence, asynchronous validation, acceptance, and
submission stay owned by the form and domain system.

What kind of value a field holds is independent of the element it is written with. A release
MUST NOT restrict localized input to one element type where the form system binds a value accessor
to more than one.

A consumer application's own field component stands between the form and the localized field, which
is the ordinary shape of a design system. The form system writes to the outermost accessor during
its own binding pass, and that write can land before the inner field has been given the profile it
reads and writes in. A release MUST hold such a write until it can be honoured rather than
fail on it, and MUST NOT require a consumer application to discover the ordering and buffer around
it, because the order of the two bindings is the framework's rather than the application's.

Visible messages derive reactively from invariant issue state and committed locale state. A release
MUST update the wording on a locale change while preserving the control value, the selection, the
composition, the dirty, touched, and pending state, the validation result, and the parameters.

## 9. External issue codes

A consumer application may supply a stable machine code and typed safe parameters from a frontend
validator, a backend, an API, or another domain boundary. A release maps it to a localized
message in the active context, and MUST NOT call or control the originating system.

A code pairs with its message by name. A release MUST read a code as a sequence of words and
write them back as one lower-kebab message identifier, so the same failure reaches the same message
whichever casing or separator convention the originating system uses, and a service that changes how
it spells its codes does not orphan an application's translations. The transformation encodes
nothing about any particular error taxonomy.

A word is a run of ASCII letters and ASCII digits, and a new word also starts where an uppercase
ASCII letter follows a lowercase ASCII letter or a digit. A release MUST read every other
character as a separator, a letter outside ASCII included, and MUST read the code as it is given,
with no Unicode normalization, because a message identifier is written in ASCII letters and digits
alone. A code with no word in it, and a code with a word that begins with a digit, derive no
identifier a catalog can hold; such a code pairs with no message by name and is answered the way
any code without a message is.

Nothing is written per code. A release MUST NOT require a mapping line per code, because that
is a line every new code needs and eventually does not get, and what the reader then sees is a
generic apology instead of what went wrong. An explicit binding stays available for what a
convention cannot express, a code whose message lives elsewhere or several codes deliberately
collapsing to one, and a release MUST consult it first.

A release MUST accept a message found by name only when the message's own identity ends in
the derived identifier, because a message group is an ordinary value and the wrong one can be
supplied, and rendering a message about something else is worse than rendering the generic one.

The unknown branch is required rather than optional, because an application receives codes from a
system it does not deploy and there is always one it has not heard of yet.

Messages selected this way are named nowhere in source. A release MUST treat a reference to a
message group as a reference to every message in it, where the group is handed to something, and
MUST NOT count walking through a group to reach a single message or importing it, because counting
either would silence the unused-message advisory for every scope any file imports.

Raw exception or detail text is not interface copy, and an HTTP status is not a localization
identity. A release MUST NOT let localization reinterpret a failure as a success, weaken
authorization or validation, or replace the application's own policy.

## 10. Enums and consumer-supplied content

A known domain value maps exhaustively to a localized presentation. An unknown external value stays
a typed unknown state and maps to a safe fallback with a diagnostic, and a release MUST keep
machine equality and persistence on the invariant value rather than the localized label.

Source-controlled catalogs are the input path for code-owned messages. Pages, products, articles,
comments, editorial blocks, user-authored fields, content-derived metadata, and comparable records
stay in the consumer application's services, stores, signals, and components, with their
acquisition, schemas, persistence, authorization, lifecycle, and presentation.

A release MUST NOT call or couple itself to a consumer content system, translation system,
API, backend, database, vendor library, or data service, and MUST NOT let a consumer payload become
a message identifier, compiled data, a cache entry, or part of a localization snapshot.

A region supplying such content takes part through the participant contract of
`06-runtime-and-angular.spec.md` section 8, which carries safe identity, transition correlation,
target-locale context, readiness or outcome, and the locale actually supplying the region.

Only a locale-bound representation takes part in locale fallback. An acquisition, cancellation,
protocol, or coordination failure is an operational failure; exhausting the approved representation
policy is a requested-representation-unavailable outcome; and a valid empty, absent, or restricted
result is a domain outcome. A release MUST keep the three apart.

Language-independent, user-authored, intentionally multilingual, and unknown-language content stays
valid across a locale change. A release MUST preserve its known or unknown actual language
and direction and MUST NOT relabel it as fallback merely because it differs from the target locale.

## 11. Renderers the runtime does not own

In-app interactive notifications are localized through the same message, parameter, rich-content,
supplying-locale, accessibility, and transition contracts as any other interface. Notification
queues and delivery state stay with the consumer application.

Email, messaging, operating-system push text, documents, exports, and other final external artifacts
are localized by the renderer that creates and delivers them. The recipient's locale, time zone,
formatting policy, content, authorization, retries, delivery, and audit behavior sit outside the
Angular runtime, and a release MUST NOT call, host, or govern such a renderer. Standard
interchange is a translation-workflow capability under `01-standards-profile.spec.md` sections 10 to
12 rather than a promise that a non-Angular renderer consumes the runtime's artifacts.

Logs, metrics, analytics, security events, and protocol fields use invariant codes and structured
values, and a release MUST NOT put localized text in one. A localized presentation may be
derived from such an event at an explicit boundary without changing the event.

## 12. Primary references

- ECMA-402, ECMAScript Internationalization API Specification, 13th edition, June 2026:
  `https://402.ecma-international.org/13.0/`
- IANA Time Zone Database: `https://www.iana.org/time-zones`
- ISO 4217, Currency codes: `https://www.iso.org/iso-4217-currency-codes.html`
