# Standards profile

Equator rests on published standards at exact editions, and this document declares which ones. It
covers the text and locale-data baseline, the sources that data is derived from, how the host
platform's own internationalization is used, what may not differ between runtimes, the MessageFormat
and XLIFF profiles, how generated data is serialized and fingerprinted, and which packages a
published package depends on.

What a release does with these standards is elsewhere. Locale resolution is owned by
`03-locale-identity-and-resolution.spec.md`, message authoring by
`04-message-authoring-and-catalogs.spec.md`, the compiled representation by
`05-compiled-artifacts-and-trust.spec.md`, and the host ranges by
`02-packages-and-platform.spec.md`. This document names the editions those documents are read
against.

## 1. Profile declaration

A release MUST be built and verified against one declared standards profile, and every part
of it MUST use that same profile: authoring, compiler validation, compiled artifacts, runtime
evaluation, interchange, diagnostics, and generated compatibility data.

The profile covers:

- Unicode text and locale identifiers;
- CLDR and LDML locale data and behavior;
- MessageFormat syntax and semantics;
- XLIFF translation interchange;
- the sitemap protocol a release writes, which `07-routing-rendering-and-seo.spec.md` owns;
- the ECMA-402 edition whose rules a message's number options are judged by, which
  `04-message-authoring-and-catalogs.spec.md` section 6 owns;
- a release's own schemas and durable formats;
- the compiler-host, runtime, and browser ranges, which `02-packages-and-platform.spec.md` owns.

The profile of this release line is `equator-1`. Its standards editions, and every data source
behind them, are recorded in `standards/sources.lock.json`.

A release MUST NOT resolve any part of the profile from an unpinned latest revision at build
time or at run time, and MUST NOT infer an edition from a package label or from the host runtime's
own data.

## 2. Text and locale-data baseline

A release MUST be built and verified against Unicode 17.0.0 and Unicode CLDR and LDML 48.2.
CLDR 48.2 is the corrective edition aligned with Unicode 17.

Selecting those editions does not select a locale-data package and does not oblige a release to
carry a locale database. Where a release needs a fact the host platform does not supply, it derives
one bounded table from a locked source and generates it into a package:

| Generated table                                                | Derived from                            |
| -------------------------------------------------------------- | --------------------------------------- |
| Right-to-left scripts, and the code points that reorder text   | `cldr-core`, Unicode `DerivedBidiClass` |
| Distances between subtags that name one language two ways      | `cldr-core`, the IANA registry snapshot |
| The root person-name patterns a runtime falls back to          | `cldr-person-names-full`                |
| The name each locale has for itself                            | `cldr-localenames-full`                 |
| Parent locales                                                 | `cldr-core`                             |
| Person-name patterns for the locales an application configures | `cldr-person-names-full`                |
| Plural categories                                              | `cldr-core`                             |
| The single units ECMAScript sanctions                          | ECMA-402 13th edition, section 6.6.2    |
| The fraction digits a currency is written with                 | `cldr-core`                             |

A release MUST derive every such table from a source recorded under section 4, and MUST NOT
ship a source package's data wholesale. Each generated table names the release it came from, and is
regenerated from its pinned source and required to agree with it.

## 3. Locale identity and matching

A locale identity is a language tag: RFC 5646 for its syntax, and the language identifier grammar of
UTS #35 Part 1 for the subset a release accepts.

An Equator release MUST canonicalize a locale identity from the pinned CLDR release and the recorded
IANA Language Subtag Registry snapshot, and MUST NOT let a host runtime's own registry decide an
identity that is stored, compared, or exchanged.

The canonical form applies the language, script, region, and variant aliases of UTS #35 Part 1
Annex C, including its territory exception. An identity a release stores carries no extension, so
the values of an extension keep their spelling and only their order is canonical.

Matching a requested locale against a supported set is the problem RFC 4647 states, and the runtime
answers it from the same locked data: membership from the registry snapshot, ordering from the
pinned release's language matching data read at the language dimension only. Script and region
distinctions are decided categorically elsewhere in this profile and MUST NOT be reopened as
distances. A consumer declares an alias only for an identifier no standard can know, such as a
spelling its own storage already held. A relation the locked data already states is derived rather
than declared.

What resolution does with a match, and in what order, is
`03-locale-identity-and-resolution.spec.md`.

## 4. Locked data sources

An Equator release MUST record every source it derives data from, or verifies conformance against,
in `standards/sources.lock.json`, with the exact release, the acquisition URL, the role, the
license, and a digest.

A vendored source MUST match its recorded digest byte for byte. A source that is not vendored MUST
record the digest of the artifact that was acquired, and where that artifact is an installed
package, that digest MUST be the one the package manager recorded for the same version.

A vendored source MUST carry beside it the notice its license requires on copies, recorded in the
lock with its digest, or the lock MUST record why its license requires none. Every file under
`standards/data/` MUST belong to a recorded source as its data or its notice.

The locked sources are the CLDR `core.zip` release, the `cldr-core`, `cldr-localenames-full`, and
`cldr-person-names-full` packages, the MessageFormat conformance suite for the pinned edition, the
IANA Language Subtag Registry snapshot, the Unicode `DerivedBidiClass` file, the IANA Time Zone
Database release, the measurement unit section of ECMA-402's 13th edition, the OASIS XLIFF
schemas, the W3C XML namespace and XHTML schemas, and the sitemaps.org schemas.

A supported engine that leaves out a step of a pinned edition narrows what a release accepts, as
section 5 permits. Each narrowing is recorded here, and is removed once a release of every
supported engine has the step:

- ECMA-402 13th edition, section 16.1.2, SetNumberFormatDigitOptions, step 13: "If
  roundingIncrement is not 1, set mxfdDefault to mnfdDefault." V8 14.6, the engine of Node
  26.10.0, leaves the step out and throws a `RangeError` for an option set that the edition accepts
  only because of it, such as a `roundingIncrement` with no fraction digits written. A release
  refuses such an option set where the message is compiled, as
  `04-message-authoring-and-catalogs.spec.md` section 6 states.

Every vendored digest is recomputed before anything derives from the source it covers. An edited
file, a partial download, and a line-ending change all leave a source that still parses.

## 5. Native platform strategy

A release MUST use the host's ECMA-402 implementation as its locale-data and formatting
engine, and MUST:

- invoke every capability with an explicit locale and explicit options;
- feature-detect a capability before relying on it;
- return a typed unsupported outcome where a required capability is absent, rather than a substitute
  result;
- treat host locale data as presentation only, never as an identity, a protocol value, or a cache
  key.

A release MUST NOT carry a second formatting implementation or a locale database that
duplicates what the host supplies. What it carries instead is the bounded set of generated tables in
section 2, and the dependency sets in section 14.

Where a host capability is materially inconsistent with the standard it implements, a release
MAY replace that one answer from a locked source, or MAY declare the combination unsupported. It
MUST NOT let a known inconsistency reach a rendered result. The required capabilities are probed on
the pinned Node version and in each of the three browser engines a release supports.

## 6. Cross-runtime determinism

Correctness-bearing localization behavior MUST NOT vary between supported toolkit, server, and
browser combinations. This binds:

- canonical locale identity and alias handling;
- locale matching and fallback selection;
- catalog and message selection;
- MessageFormat declarations, selectors, variants, and error behavior;
- message and artifact identities, compatibility fingerprints, and cache keys;
- rich-part structure, safety decisions, and protocol values.

Server-rendered output that participates in hydration MUST produce the same initial localized result
in the browser. A host difference that changes text, information, accessibility, bidirectional
behavior, or meaning makes that combination unsupported until a release supplies a targeted answer
for it.

Two independently rendered environments MAY differ cosmetically where meaning, information, safety,
accessibility, and identity are unchanged and no hydration comparison is involved.

Formatted presentation text MUST NOT become an identity, a protocol field, a persisted domain value,
or a cache key.

## 7. MessageFormat baseline

Message syntax, its data model, selection, error semantics, and the default bidirectional
strategy are governed by UTS #35 Part 9, MessageFormat, LDML 48.2.

A release MUST be verified against the working group's conformance suite for that same
edition, run through the built packages rather than through their sources.

Draft material from a later LDML edition MUST NOT enter the profile except by moving the whole
profile to that edition.

## 8. Default function profile

A release implements every default function the pinned edition defines:

| Status in LDML 48.2 | Functions                                                            |
| ------------------- | -------------------------------------------------------------------- |
| Stable              | `:string`, `:number`, `:integer`, `:offset`, `:currency`, `:percent` |
| Draft               | `:unit`, `:datetime`, `:date`, `:time`                               |

Implementing a function means implementing the option vocabulary its definition gives it, not only
its name. Each option is resolved one of three ways: implemented directly where the platform
expresses it; implemented through a mapping the profile declares where the platform expresses it
under another name or shape; refused by name with its reason where the platform cannot express it at
all. A release MUST NOT accept an option it does not read: the message would render without
it and report nothing.

A release MUST reject an unknown, unimplemented, or incompatible function rather than guess
at it, and MUST NOT rename a draft standard function to hide its status.

`:percent` keeps the pinned standard's fractional convention: one whole is one hundred percent, so
`0.25` renders as twenty-five percent. A domain that stores the same rate as `25` declares that
scale explicitly through the typed formatting profile, and a release MUST NOT infer a scale from a
value's magnitude. Percentage points are a separate contract and MUST NOT enter `:percent`
implicitly; `08-formatting-parsing-and-domain.spec.md` states how a declared scale is preserved and
reversed.

A release MUST NOT present this profile as implemented until all ten functions and their
option vocabularies are implemented and verified.

## 9. Custom functions

A release MAY accept explicitly registered custom MessageFormat functions. Standard functions
remain preferred, and an extension MUST name its functions in a namespace its provider owns so that
one cannot collide with Unicode's or with another extension's. The `equator` namespace is the library's own:
a registry that registers any descriptor in it is refused with `EQ1805`.

A custom function has two projections, and a release MUST keep them separate. The descriptor
is versioned JSON data carrying identity, operand, option, result, selector, capability,
resource-bound, and compatibility semantics, and nothing executable: no handler, import, callback,
injection token, or configuration that runs. The handler is trusted code, registered at runtime
through application composition. The toolkit MUST read a descriptor as data and MUST NOT import or
execute an application module to discover one.

Runtime registration binds a handler to the exact descriptor identity and compatibility fingerprint.
A missing or mismatched descriptor or handler MUST fail compilation, generation, or artifact
admission before any message is evaluated.

A catalog MAY reference a registered function and MUST NOT carry, fetch, discover, or execute its
code.

An extension's handler MUST be deterministic, synchronous, bounded, and safe under server rendering.
It MUST NOT perform network or filesystem access, DOM work, dependency injection, asynchronous
acquisition, global mutation, or environment-dependent selection while a message is being evaluated.

The same separation applies to every other catalog-visible extension contract, including custom
operand types, identifier-segment types, and semantic slot kinds. This section approves no function
and no dependency.

## 10. XLIFF baseline

The toolkit's translation-interchange target is XLIFF 2.2 Committee Specification 01, dated 13 March
2025: Part 1 Core, with the Part 2 modules named in section 11.

A release MUST NOT emit or accept XLIFF 2.1 by default. Support for it MAY be added as an
explicitly versioned adapter for a workflow whose tooling cannot read the normative profile, and an
older tool's limitation MUST NOT silently downgrade what the toolkit writes.

XLIFF is an exchange artifact for translators and translation-management systems. A release
MUST NOT treat it as an authoring format, as a runtime format, or as a source of message identity.

XLIFF processing MUST NOT execute document content or fetch a schema, DTD, entity, key, or any other
external resource.

## 11. XLIFF module profile

Every document the toolkit writes uses Core, in the version-stamped namespace of the pinned edition
rather than an earlier one. Beyond Core, a release interprets the Metadata module and its own
extension namespace, and nothing else. A document a release writes MUST validate against the schemas
of the pinned Committee Specification.

A release emits a module's data only where that data exists. An empty container conveys that
a field was considered and left blank, which is not what an absent field means.

Content belonging to another official module, or to another vendor's extension, MUST NOT be removed,
flattened, or treated as understood. It stays in the interchange document and the operator is told
the toolkit read it and did not store it.

A document the toolkit cannot parse, or cannot separate into units safely, is refused. Where the
problem is provably confined to one independently processable unit, only that unit is refused or
flagged.

A workflow that needs the toolkit to understand a further module supplies the adapter for it. This
section approves none.

## 12. XLIFF semantic mapping

The mapping has two layers. Standard Core and its inline codes carry what a translator reads and
edits. A namespaced, versioned metadata layer carries the machine mapping wherever Core cannot
express the pinned MessageFormat semantics without loss.

The mapping MUST preserve:

- complete provider, scope, and message identity;
- source and target locales;
- the source fingerprint and the revision relationship;
- MessageFormat declarations, selectors, variants, variables, functions, and options;
- typed inputs and catalog-visible contracts;
- rich-slot and inline-code identity;
- notes, context, and segment state.

Authored guidance maps to Core notes. A message description and its context are written as `<note>`
elements carrying the `equator:description` and `equator:context` categories, with `appliesTo`
separating guidance about the source message from guidance about the translation. A release MUST
read back only its own categories: a note written by a translator or by a translation-management
system is reported and left in the document rather than absorbed into a catalog, and source guidance
that returns changed is reported rather than applied. A note MUST NOT be removed silently.

Target state maps to the `state` attribute of `<segment>`, where the pinned version puts it, and
never to `<target>`. A segment in the initial state MUST NOT be imported as a translation, because an
initial target is a placeholder rather than translated work. A state the standard does not define
MUST fail the import.

A translator MAY reorder human-language content and protected placeholders as far as the message
contract allows, and MUST NOT alter protected identity, introduce executable behavior, or remove
required structure.

An import that cannot reconstruct equivalent semantics MUST fail with an actionable diagnostic
rather than approximate the source.

## 13. Generated serialization

Generated data that is fingerprinted, exchanged, or compared is JSON restricted to I-JSON, RFC 7493.
A release MUST refuse an unpaired surrogate, a number that is not finite, an integer outside
the safe range, and negative zero, rather than serialize a value two readers would read differently.

The canonical form sorts object members by name and emits no insignificant whitespace, so one value
has one serialization and a fingerprint over it is stable.

A fingerprint is the SHA-256 (FIPS 180-4) of a domain label, a null byte, and that canonical form,
encoded with the URL and filename safe alphabet of RFC 4648 section 5 and written as `sha256-`
followed by its forty-three characters. The domain separates values of different kinds that share a
shape, and the prefix names the algorithm.

A generated artifact carries generator and compatibility identity sufficient for safe use, and no
author-maintained version field. It regenerates when the tooling that produced it moves,
and it receives no independent version lifecycle, deprecation program, or migration ledger.

A format receives its own family identifier, version, supported reader and writer range, and
migration policy only where it is independently exchanged, persisted, deployed, or expected to
outlive the release that generated it. An incompatible change to such a format increments its own
major version, and a package version MUST NOT stand in for that declaration.

A change to such a format is incompatible when it lets a reader of one version refuse data that
version's shape admits, or accept data whose meaning differs from what its writer meant. Removing
or renaming a field, changing whether a field is required, changing a field's type or set of values,
and changing what a field or a digest input means are incompatible for every reader. Adding a field
is incompatible for a reader that refuses unknown fields, and for a reader that rewrites the data
and so loses the field. For a reader that ignores unknown fields, adding an optional field that no
reader needs to interpret is compatible.

The `code` of an observability event and the diagnostic code it carries are open sets of values. A
reader accepts a value it does not know, so adding a value to one is compatible, and a release MUST
NOT withdraw a value or give it another meaning within a major version of the format.

A stamp whose writer and every reader ship in one package at one version, on data that does not
outlive the run or render that wrote it, names a shape and owes no compatibility.

The shape of each major version of such a format, and whether its readers refuse unknown fields,
MUST be recorded in the repository and compared with the declarations the built packages publish.

## 14. Dependency policy

A release adds a third-party package, service, data set, parser, or polyfill only after an
explicit review, proportional to what the addition decides. The review considers, where each
applies: standards conformance and semantic completeness; maintenance status and release discipline;
license and provenance; security and supply-chain exposure; runtime and bundle cost; platform and
framework compatibility; determinism and server-rendering behavior; how far it can be isolated or
replaced; and its long-term maintenance cost against the cost of implementing the behavior directly.

A package that decides correctness gets focused conformance evidence: a parser, a MessageFormat
engine, locale data, cryptography, a compiler integration, or anything reaching the runtime. A
bounded build-time utility gets a smaller review.

No dependency becomes an authority over a release's public semantics, resource limits, diagnostics,
or compatibility claims, and no dependency's own testing substitutes for a release verifying its own
contract. Where no external implementation satisfies the required behavior, a release implements it
and holds it to the same standard.

A release MUST NOT change correctness-bearing locale matching, message evaluation, function
behavior, XLIFF mapping, identity, or canonicalization through an ordinary dependency update.

The runtime package depends on `tslib` and nothing else. Everything else it needs is a peer
dependency, listed in `02-packages-and-platform.spec.md`.

The toolkit package depends on `tslib` and four packages, each bounded to one responsibility:

- `yaml` 2.9.1 parses YAML 1.2 through its documented document and node APIs. The toolkit applies
  its own restricted admission for profile, duplicate keys, tags, directives, aliases, anchors,
  merge keys, scalars, resources, and semantics before it constructs catalog data.
- `ajv` 8.20.0 validates the toolkit's own closed JSON Schema Draft 2020-12 contracts. It compiles
  the toolkit's schemas only, resolves nothing over the network, and never enters a browser bundle.
- `jsonc-parser` 3.3.1 supplies the syntax tree and source locations that admit
  `equator.config.json` strictly, detect duplicate keys before construction, and place diagnostics.
  Comment syntax is disabled and the toolkit constructs its own prototype-safe configuration value.
- `messageformat` 4.0.0 supplies the LDML 48 MessageFormat 2 parser, its data model, its validation
  and traversal, and its reference function surface. A release owns the normalized semantic model,
  the compiled representation, compatibility identity, diagnostics, and the browser evaluator; the
  dependency enters neither a generated catalog nor a runtime bundle.

`cldr-core` 48.2.0, `cldr-localenames-full` 48.2.0, and `cldr-person-names-full` 48.2.0 are
development-only inputs to the generated tables of section 2. None is a dependency of a published
package and none is shipped.

The dependency sets of the published packages MUST be exactly those stated here.

## 15. Primary references

A document this specification pins by revision is given at the address of that revision, which is
the one `standards/sources.lock.json` records.

- Unicode 17.0.0: `https://www.unicode.org/versions/Unicode17.0.0/`
- UTS #35 Part 1, Core, LDML 48.2: `https://www.unicode.org/reports/tr35/tr35-78/tr35.html`
- UTS #35 Part 9, MessageFormat, LDML 48.2:
  `https://www.unicode.org/reports/tr35/tr35-78/tr35-messageFormat.html`
- CLDR 48: `https://cldr.unicode.org/downloads/cldr-48`
- IANA Language Subtag Registry:
  `https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry`
- IANA Time Zone Database: `https://www.iana.org/time-zones`
- XLIFF 2.2 CS01 Part 1, Core:
  `https://docs.oasis-open.org/xliff/xliff-core/v2.2/cs01/xliff-core-v2.2-cs01-part1.html`
- XLIFF 2.2 CS01 Part 2, Extended:
  `https://docs.oasis-open.org/xliff/xliff-core/v2.2/cs01/xliff-extended-v2.2-cs01-part2.html`
- RFC 5646, Tags for Identifying Languages: `https://www.rfc-editor.org/rfc/rfc5646`
- RFC 4647, Matching of Language Tags: `https://www.rfc-editor.org/rfc/rfc4647`
- RFC 7493, The I-JSON Message Format: `https://www.rfc-editor.org/rfc/rfc7493`
- RFC 4648, The Base16, Base32, and Base64 Data Encodings: `https://www.rfc-editor.org/rfc/rfc4648`
- ECMA-402, ECMAScript Internationalization API Specification, 13th edition, June 2026:
  `https://402.ecma-international.org/13.0/`
- FIPS 180-4, Secure Hash Standard: `https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf`
