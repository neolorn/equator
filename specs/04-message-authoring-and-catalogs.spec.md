# Message authoring and catalogs

How a message is written for Equator, what identifies it, what its inputs and its rich structure
are, and how a catalog is composed. This document owns the authored source format and everything
derived from it up to the point of compilation, which `05-compiled-artifacts-and-trust.spec.md`
takes over.

The MessageFormat edition a body is written in is pinned by `01-standards-profile.spec.md` section 7.
What a rich result becomes when it is rendered is `09-safe-content-and-ux.spec.md`.

## 1. Ownership

The toolkit owns the format, the identity, the typing, the validation, and the generated contracts.
A consumer owns the words, which messages exist, and how its catalogs are organized.

Authoring is catalog first. The source-locale catalog is authoritative for message identity, the
MessageFormat body, the effective typed inputs, and the effective rich-slot contract. A target
catalog owns the localized body for that same identity and inherits the contract.

Inline prose, template text, an extracted default, and a code literal MUST NOT become a second
authoring authority. Tooling MAY propose a catalog edit a person reviews.

XLIFF, compiled catalogs, generated descriptors, generated TypeScript, route projections, reports,
caches, and pseudo-locales are derived or interchange artifacts. None of them is an authoring
authority.

## 2. Canonical source format

A catalog is UTF-8 `.yaml` in a restricted YAML 1.2.2 profile that constructs a non-executable,
JSON-compatible tree and nothing else.

A catalog:

- contains exactly one document, whose root is a mapping with string keys;
- refuses directives, custom tags, constructors, anchors, aliases, merge keys, complex keys, more
  than one document, and non-finite numbers;
- detects a duplicate key before the mapping is constructed;
- permits plain, quoted, literal, and folded string scalars;
- is validated against the toolkit's own JSON Schema Draft 2020-12 contracts and then semantically,
  with no network schema resolution;
- treats comments as carrying no meaning, because durable translator guidance has fields of its
  own;
- is formatted deterministically, without changing the MessageFormat value it constructs or any
  meaningful Unicode in it.

A release MUST refuse a catalog that constructs anything executable, and MUST NOT resolve a
schema, a tag, or an entity over the network while reading one.

## 3. Catalog composition

The conventional layout is:

```text
<owner>/i18n/<scope-id>/<locale>.yaml
```

The file is named by its exact catalog locale, and the provider and scope are inferred from the owner
and the path. A layout that does not follow the convention is supported through explicit
configuration.

A scope is a provider-local catalog and typing namespace, and it is the default compilation and
loading boundary. It may line up with a feature, an owner, a completeness boundary, or a release
boundary. A release MUST NOT require those concerns to coincide, and MUST NOT refuse a scope
for its breadth, or for its name unless the name is reserved.

A scope's generated module takes the scope's name, and it sits beside the modules a release
generates for every owner, in the one namespace a consumer application imports generated modules
from. A scope name is reserved where no module of its own can exist: the name of one of those
generated modules, and a name a supported platform reserves for a device and gives to no file. A
release MUST refuse a scope with a reserved name at generation, with a diagnostic that names the
path it could not write, and MUST NOT write one generated module over another.

Messages that belong to a consumer's own interface form the build-known catalog input set. A
consumer's domain records are runtime data from a release's point of view, wherever they are stored,
and a release MUST NOT turn one into a message identity, compiled data, a generated contract, a
cache entry, or part of a localization snapshot. What the runtime coordinates for that content is
bounded readiness, an outcome, a safe identity, and the locale that actually supplied it.

A release generates a registry only for a catalog that has content. An empty provider, scope,
or typed registry MUST NOT be generated as scaffolding for something that does not exist yet.

## 4. Message identity

A message identity is exactly a provider, a scope, and a message:

```text
providerId + scopeId + messageId
```

Locale is a representation dimension and MUST NOT be part of identity.

| Part     | Grammar                                                     |
| -------- | ----------------------------------------------------------- |
| Provider | `(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*`           |
| Scope    | `[a-z][a-z0-9]*(?:-[a-z0-9]+)*`                             |
| Message  | Dot-separated parts of `[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*` |

A provider is an opaque authority label. It MUST NOT be read as a URL, a discovery location, a
registry lookup, an environment, a version, or proof of ownership. A scope does not repeat the
provider, the application, the organization, the locale, a route, a tenant, an environment, a schema,
a release, or a path.

A catalog carries one flat `messages` mapping from complete dotted identities to entries. A nested
identity map and a repeated `id` field are not supported. A complete identity may also be the prefix
of another, and both stay distinct.

Message identities are ordinary keys in a consumer's own source. Renaming, moving, or deleting one
is an ordinary edit, and a release keeps no alias table, tombstone, retirement registry, or ledger
for it.

## 5. Message entries

A string scalar is exactly shorthand for `{ message: <string> }`. A structured entry contains exactly
one of `message` or `empty: true`, so a deliberately empty result is distinguishable from a missing
entry and from an accidental blank. The canonical writer uses the scalar whenever no other field is
authored.

Beyond those, a source entry may contain only `description`, `context`, `inputs`, and `slots`. A
release MUST refuse identity, locale, ownership, revision, approval, ticket, vendor, or other
workflow fields inside an entry.

`description` and `context` are the durable translator-guidance fields this model provides in place
of comments, and they MUST NOT be used interchangeably. `description` states what the message means
and any constraint on rendering it: a wording that must not be corrected, a length limit, a
deliberate abbreviation, a term that stays untranslated. `context` states where and when the message
appears, which is what a translator cannot infer from the text.

Neither takes part in identity, selection, evaluation, or compatibility, and neither is rendered.
Both are carried through compilation and preserved in interchange under
`01-standards-profile.spec.md` section 12.

A target entry MAY carry its own `description` or `context` where guidance is locale-specific, and
otherwise the source entry's guidance applies. A target entry uses the same three forms and MUST NOT
declare `inputs` or `slots`: it inherits the effective source contract.

## 6. Message bodies

A body is written in the pinned MessageFormat profile, and the source body is authoritative for the
external input set. The toolkit derives the variables, selectors, functions, operand types, and uses
from it before any refinement:

- an unannotated external variable is a required, non-nullable string;
- a variable annotated by a function takes that function's operand type;
- incompatible uses of one variable fail validation rather than widening or coercing it;
- a target may omit an input its own grammar does not need, and MUST NOT add one or change its type,
  its optionality, or its nullability.

Where the standard leaves a behavior implementation-defined, a release MUST resolve it as a refusal
at compile time, and MUST NOT resolve it as a fallback value or a thrown error at render time. The
standard permits an implementation to report an error and continue with a fallback, and a release
does not take that permission, because a localization defect would otherwise surface in front of a
reader, in a language the people who shipped it usually cannot read. A behavior the standard fixes
is implemented as the standard fixes it; this governs only what the standard leaves open.

Six refusals follow from that rather than standing as separate rules:

- a literal operand that cannot be the type its function requires is refused where it is written;
- a `select` option that reaches an expression from its operand rather than being written there as a
  literal is refused, because `select` decides which plural table a target catalog's coverage is
  measured against. Where the annotating function defines no `select`, the standard itself
  requires the option to be discarded, so nothing is open and nothing is refused;
- an option name a function's definition does not give it is refused rather than dropped, on the same
  reasoning that refuses an unregistered function name rather than ignoring the annotation;
- a `.match` whose selector came from a function that formats but does not select is refused, rather
  than reported at render time with the selector matching only the catch-all. Which functions select
  is closed and known before anything runs, and taking the standard's permission here leaves every
  keyed variant the author wrote unreachable while the message still renders;
- `timeZone=input` on a date function, where nothing in the message gives the operand a zone, is
  refused where it is written. The option names the operand's own zone, and the only operand that can
  answer is one whose declaration wrote one. The alternative is a rendered fallback in whatever zone
  the consumer's context happens to hold, which near midnight is a different day on the screen;
- a date function whose zone neither the message nor its operand writes takes the formatting
  context's, and an application whose context names none is refused when its catalogs are admitted,
  before anything renders, naming where the zone is set. The zone is not known when a catalog is
  compiled, so the compiled catalog states that it needs one as a required feature
  (`05-compiled-artifacts-and-trust.spec.md` section 4), and the application supplies it.

An option value that names data is judged where a message is compiled by the standards a release
pins, so a message has one answer on every machine that compiles it. A release MUST judge a
`calendar` option by how a calendar's name is written and a `timeZone` option by the names the
pinned time-zone database carries, as `08-formatting-parsing-and-domain.spec.md` section 2 states
both, and MUST NOT ask the host about either. A calendar whose name is well formed and which the
rendering host does not count in is reported where the date is formatted, as section 4 of that
specification requires.

The options of a numeric function are judged the same way. A release MUST judge a `unit` option,
and the options a numeric expression resolves to taken together, by the rules the pinned ECMA-402
edition gives the `Intl.NumberFormat` constructor, reading the units that edition sanctions from its
own text and the fraction digits a currency is written with from the pinned CLDR release, and MUST
NOT ask the host. The edition lowers the default maximum fraction digits to the minimum when a
`roundingIncrement` other than 1 is given, and V8 does not, so it throws for an option set the
edition accepts only because of that step. A release MUST refuse such an option set where the
message is compiled, declaring the combination unsupported as `01-standards-profile.spec.md`
section 5 permits, rather than compile a message that would throw where it is rendered.

A registered function speaks MessageFormat's vocabulary rather than a release's. Its option names
follow MessageFormat's `name` production, bounded in length and without that production's optional
surrounding bidirectional controls, which are removed before a name reaches the toolkit and would
otherwise give one option two spellings. An option value written as a literal is read as the type
its descriptor declares, and a closed value set is compared against the value rather than against
its spelling. A release's own lower-kebab convention continues to govern what the release itself
names.

A registered function states the variant keys it matches as one ordered list, best first. The
standard defines both selection operations on a resolved value, whether a key matches and which of
two matching keys is better, and one ordered list answers both by membership and by position. An
empty list is a value that supports selection and matches nothing, which is not the same as a
function that does not select. A function that formats but fails as a selector, or the reverse,
is outside this model: one call produces the formatted text and the keys together, and either
succeeds or refuses for both.

A resolved value carries the options it resolved with, and a later annotation over it inherits them,
with options written on the expression taking priority. Inheritance carries the whole mapping so a
longer chain does not lose what a function further along declares, and each function receives only
the options its own descriptor names. Inheritance MUST NOT become a second way past a closed
descriptor.

An option may be written as a variable, and the input behind it may be optional or nullable. Where
that input was omitted or is null the option has no value, which the standard resolves by leaving
the option out. A release MUST call the function, or build the slot, without an option whose
variable was omitted or is null, MUST leave in force what the operand carried under that name, and
MUST refuse the call where the function requires the option.

## 7. Typed inputs

A source-only `inputs` mapping is permitted where the toolkit cannot infer the complete contract
safely. Each key is the exact inferred external variable name without `$`, and a release MUST refuse
a key that introduces a new, misspelled, or unused input.

A refinement is either a portable type identifier, meaning `{ type: <type-id> }`, or a record
containing only `type`, `enum`, `optional`, `nullable`, and `description`:

- `type` resolves through a release's portable operand-type registry, and MUST NOT be a TypeScript
  symbol, an import, a type expression, or a source path;
- `enum` is a nonempty sequence of unique literal values compatible with the effective type, and
  `null` is governed only by `nullable`;
- `optional` and `nullable` are independent booleans defaulting to false: `optional` permits
  omission or `undefined`, `nullable` permits an explicit `null`;
- neither creates a default value.

A refinement may narrow, brand, close, or clarify what was inferred. It MUST NOT contradict
MessageFormat syntax or a registered function contract, and MUST NOT declare a default, a
substitution, a coercion, or a conversion. Input maps and the values supplied through them are read
only.

Generated TypeScript and Angular contracts reject a statically known missing, extra, or invalid
input. A dynamic or adapter-backed call validates the same contract at the earliest safe runtime
boundary.

A runtime value outside a closed literal set is a contract violation. The runtime reports a bounded
diagnostic and, where the value is otherwise valid for the applicable selector, renders the authored
catch-all variant; where no safe pattern remains, recovery renders at the selected boundary. A
release MUST NOT coerce the value, substitute a permitted member, or interpolate the invalid value.

The canonical formatter orders input keys by UTF-16 code unit and their fields as `type`, `enum`,
`optional`, `nullable`, `description`, omitting false defaults and an empty mapping.

## 8. Rich slots

Plain text is the default. A MessageFormat markup name is a semantic slot identifier, and a release
MUST NOT read it as an HTML element, a component, a template, an import, a style, a destination, a
callback, or executable configuration.

A rich message evaluates to immutable renderer-neutral parts: text, formatted values, paired
container slots with children, and standalone slots. Parts keep the language and direction that
supplied them.

The toolkit derives slot identity, paired or standalone shape, child relationships,
reachable-variant cardinality, nesting, and registered kind wherever it can prove them. A
source-only `slots` mapping refines only what cannot be inferred safely. A target catalog MUST NOT
contain `slots` and inherits the effective source contract.

A slot key is an exact lowercase-kebab identifier matching `[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*`,
written without MessageFormat's `#` and `/` sigils. A scalar refinement is a portable kind identifier
and means `{ kind: <kind-id> }`. An expanded refinement contains only:

- `kind`, resolved through the portable slot-kind registry. Omitting it selects a required
  message-local trusted binding, and it MUST NOT infer a component, template, element, URL, action,
  callback, class, style, or implementation symbol.
- `shape`, exactly `paired` or `standalone`, required only where a source-unused slot is allowed and
  its kind does not determine the shape.
- `optional` and `repeatable`, independent booleans. False and false is exactly one; true and false
  is zero or one; false and true is one or more; true and true is zero or more within the global
  resource bounds.
- `within`, a nonempty sequence of allowed immediate parent slot names or the reserved `@root`. It
  may narrow a compatible placement and MUST NOT weaken a registered or global nesting constraint.
- `description`, translator guidance for the case where the slot's use, its name, and its registered
  kind are not enough.

Cardinality is inferred across every reachable rendered variant rather than by counting occurrences
in the text. Absence from any reachable variant makes a slot optional; more than one occurrence on
any reachable path makes it repeatable. A declared slot absent from every source variant explicitly
permits compatible target use, is optional, and still requires a determinable kind and shape.

A target may reorder slots, change nesting compatibly, omit optional slots, and repeat repeatable
ones. It MUST NOT invent a slot, alter a kind or a shape, exceed cardinality, remove a required
semantic action, or edit protected implementation data.

The built-in paired kinds are `emphasis`, `strong`, `code`, `link`, and `action`. The first three
have safe semantic defaults. `link` requires an application-owned typed destination and `action` an
application-owned typed handler, because neither is something a catalog may decide.

A custom kind uses the authority separation of `01-standards-profile.spec.md` section 9: tooling
consumes an inert descriptor, and trusted runtime code binds the renderer to the exact descriptor
identity and compatibility fingerprint.

A catalog MAY control an option only where a registered kind declares a closed, typed, bounded,
translation-safe semantic option. A catalog MUST NOT control HTML, a URL, a route, a component, a
template, a class, a style, a color, a DOM property, an accessibility role, a permission, a
sanitizer, a callback, or any executable behavior.

An interactive slot MUST NOT contain or be contained by another interactive slot. `code` contains
only text and safely formatted values. Every rich contract has a deterministic safe text projection,
and a standalone custom kind MUST provide one.

The canonical formatter orders slot keys by UTF-16 code unit, uses the scalar form when `kind` is
the only refinement, otherwise orders fields as `kind`, `shape`, `optional`, `repeatable`,
`within`, `description`, sorts `within` by UTF-16 code unit, and omits inferred defaults and an
empty mapping.

## 9. Generated handles

The toolkit projects each dotted identity into a deep-readonly tree. Each kebab-case part maps
independently to lower camel case and each dot becomes a property level. Every projection is
collision-checked in both directions.

Where an exact message exists at a node, that node is an opaque immutable handle, and it may still
carry descendants. A node that is only a branch is not a handle, and no universal terminal property
is introduced.

A handle preserves the provider, the scope, the identity, the input contract, the rich-slot
contract, the result kind, and the generated compatibility identity. Application code passes handles
to the runtime's APIs and MUST NOT construct a qualified string to stand in for one.

## 10. Collections and families

An ordinary runtime choice between messages uses handles, readonly collections, prefix views, or
discriminated unions. The toolkit keeps each selected handle's relationship to its own contracts and
MUST NOT widen a heterogeneous choice into an untyped parameter map.

A genuinely open bounded set uses a source-locale root `families` mapping beside `messages`. It is
scope-local, MUST NOT appear in a target catalog, and is omitted where a scope has none.

A family name follows the message-part grammar. A scalar value is shorthand for
`{ template: <value> }`, and the expanded record contains only a required `template` and an optional
`segments`.

A template is a fixed dot-separated sequence of literal message-identity parts and named
placeholders such as `{variant}`. Each placeholder occupies one complete part, names are unique and
follow the part grammar, and a template contains at least one literal part and at least one
placeholder. A template MUST NOT use a glob, a regular expression, an optional or repeated part,
alternation, recursion, an executable predicate, or runtime concatenation.

An undeclared placeholder takes a release's bounded message-part contract. A `segments` key MUST
match a placeholder exactly, and its value is a portable registered identifier-segment type with
deterministic validation and a canonical one-part serialization.

At least one current source message MUST match the template. The toolkit derives the common
effective input and rich-slot contract from the current matches, and every current and future member
MUST satisfy it. Members that differ stay a finite discriminated collection rather than being
widened into one open family.

Every normalized source message satisfying the template, the segments, and the contract becomes a
member automatically, and targets inherit membership. A release MUST NOT require a per-message
family field, an enrollment list, an include or exclude list, an alias table, or a duplicate ledger.

A duplicate family name or template, a segment that does not round-trip, a generated-name collision,
an ambiguous overlap, and an incompatible contract all fail before generation. At runtime, family
resolution validates the bounds, the canonical spelling, the template shape, the segment types,
current trusted membership, and contract compatibility. Matching a template MUST NOT by itself
invent or authorize a message.

An external identifier becomes a handle only through a generated family-bound or allowlist-bound
resolver. A release MUST NOT expose an unrestricted lookup by arbitrary string, and MUST NOT
perform a fuzzy match, a hidden alias lookup, or a guessed prefix.

The canonical formatter orders family names by UTF-16 code unit, uses the scalar form where
`segments` is absent, otherwise orders `template` then `segments`, and omits an empty mapping.

## 11. Source revisions

The toolkit computes a source fingerprint from the normalized body and the effective input and
rich-slot contracts, so a wording change that keeps the contract is distinguishable from one that
does not.

The default policy keeps a contract-compatible target after a source-only wording change and reports
its freshness as an advisory. A release MUST NOT fail a build on that advisory by default; a
stricter freshness or completeness policy is opt-in.

The fingerprint is derived from what the catalog says, so no revision field, translation ledger, or
record of what changed is authored.

## 12. Primary references

- YAML 1.2.2: `https://yaml.org/spec/1.2.2/`
- JSON Schema Draft 2020-12: `https://json-schema.org/draft/2020-12`
- UTS #35 Part 9, MessageFormat, LDML 48.2:
  `https://www.unicode.org/reports/tr35/tr35-78/tr35-messageFormat.html`
