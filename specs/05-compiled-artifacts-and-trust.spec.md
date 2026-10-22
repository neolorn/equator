# Compiled artifacts and trust

What Equator's compiler produces from an accepted catalog set, what identifies it, what a running
application checks before it will use it, and what the loader and the memory cache are allowed to
hold.

This document takes over from `04-message-authoring-and-catalogs.spec.md` at the point of
compilation. What a running application does with an admitted catalog is
`06-runtime-and-angular.spec.md`. The serialization and fingerprint rules everything here is built
on are in `01-standards-profile.spec.md` section 13.

## 1. Non-executable representation

A compiled catalog is inert data. It carries the compiled profile label, the generated ABI, the
standards profile, its catalog key, its application-contract and semantic-registry fingerprints, the
extension descriptors it requires, its messages, and its resource summary. It carries nothing else,
and a release MUST refuse one whose top level is not exactly that set of fields.

Each compiled message carries its identifier, whether it is a message or a deliberate empty result,
whether its result is plain or structured, its source fingerprint, its effective inputs, its
effective slots, and a body.

A body is refused where it is evaluated when it holds something the toolkit could not have written.
MessageFormat's syntax gives every expression a literal, a variable, or a function, so a release
MUST refuse an expression that names neither an operand nor a function with a typed failure, and
MUST NOT print it as empty text.

A compiled catalog is JSON. A release MUST refuse a candidate carrying a function, a getter,
a setter, a prototype other than the plain object prototype, a cycle, an import reference, a
template, or a dynamically compiled expression, rather than evaluate around it.

Only trusted registered implementations run: the evaluator, registered message functions, formatting
and parsing adapters, slot renderers, and the generated loader map. Catalog data names a descriptor
identity, and an artifact MUST NOT supply the implementation behind one.

## 2. Same-release transport

A release MAY deliver a catalog compiled and deployed as part of one application build
through a lazy ES module, as a code-splitting wrapper. The generated loader map holds one entry per
artifact, from the catalog identity to a dynamic import whose only result is the compiled catalog
that module exports.

A release MUST NOT let a transport wrapper grant a catalog authority the catalog does not
have. Identity is computed over the catalog value rather than over the module carrying it, so which
chunk a catalog arrives in, and whether that chunk was minified or compressed, changes nothing an
admission check reads.

Server-rendered state is data of the same kind. It carries its own profile label, the committed
locale, the formatting context, an optional route record, the catalogs, and the participant records,
and a release MUST NOT put a function, a template, or a consumer's domain payload into it.

Transferred state arrives from a document and is therefore untrusted. A release MUST bound
and revalidate every field of it before adopting any of it, and MUST discard the whole transfer when
any part is unrecognized rather than repair the part it can read. A document that adopts nothing
renders from its own generated defaults.

The production browser and server paths carry no authored-catalog reader, which follows from the
runtime's dependency topology in `02-packages-and-platform.spec.md` section 6.

## 3. Integrity

SHA-256 is the content-digest algorithm. Every digest a release writes is `sha256-` followed by 43
unpadded base64url characters, and a release MUST refuse a value that does not match that
shape wherever one is read.

A fingerprint is taken over a domain label, a null byte, and the canonical serialization of the
value, so two values of different kinds that happen to serialize alike cannot share a fingerprint.

An artifact's content digest is generated outside the data it identifies: it is recorded in the
catalog-set descriptor, and the catalog itself carries no copy of it. No digest, artifact version,
key, signature, or other integrity field is authored.

A matching digest proves byte identity. It does not prove semantic validity, compatibility, safety,
or permission to run, and a release MUST NOT treat it as proving any of them. Those come from
the compiler and from the admission checks in section 4.

## 4. Build and runtime admission

For one compilation the toolkit:

1. reads the authored catalogs into a semantic graph, validating schema, MessageFormat semantics,
   identities, references, contracts, and completeness;
2. generates the typed contracts the application's code imports;
3. analyzes the application's own sources against those contracts where sources are supplied;
4. compiles inert data, computes each artifact's digest, fingerprints, and resource summary, and
   builds the catalog-set descriptor, the loader map, the recovery payload, and the person-name
   profiles;
5. assembles one output plan whose every path is validated and whose plan digest covers the path,
   byte count, and digest of every file in it.

A release MUST return a failure for an error at any of those steps and MUST NOT write any
part of the output.

A release MUST establish, before it accepts a generated set, that:

- the descriptor's profile, generated ABI, application-contract fingerprint, and semantic-registry
  fingerprint match the generated configuration;
- every artifact names a configured scope and a configured locale;
- every artifact's compiled profile, schema, standards profile, and generated ABI are ones this
  release supports, and its required features are all supported, where a feature that depends on
  the application, such as a formatting context that names a time zone, is supported only when the
  application supplies it;
- every artifact's fingerprints and required extension descriptors match its scope's;
- every artifact's content digest is well formed and its resource summary is within the fixed
  ceilings;
- no two artifacts claim the same catalog identity, and a loader exists for each one;
- the set is not empty.

A release MUST establish, before it accepts one loaded candidate, that the candidate is inert
JSON within the snapshot ceilings, that its fields are exactly the ones section 1 names, that its
key, profiles, fingerprints, and required extensions equal the address it was loaded for, that its
resource summary equals both the recorded summary and a summary re-measured from its own content,
and that its content digest recomputed over its canonical form equals the recorded digest.

A release MUST reject the catalog an admission failure names and MUST NOT replace the
committed localization state with it. A rejected candidate is never remembered, and a release
MUST NOT let an address verified once stand in for a later candidate offered under that address.

## 5. Artifact identity

The logical catalog key is exactly the provider, the scope, and the canonical catalog locale.

Provider identity is a catalog-authority label. A release MUST NOT treat it as a network
publisher, an origin, a signing key, an authorization realm, or an acquisition endpoint.

An artifact address binds the logical key, the compiled profile, the schema, the required features,
the standards profile, the generated ABI, the application-contract fingerprint, the
semantic-registry fingerprint, the required extension descriptors, and the full content digest. The
digest is the artifact's version, and no version field is authored beside it.

A provider's catalog-set identity is a domain-separated fingerprint over the ordered artifact
addresses of that provider alone. Module paths, byte counts, timestamps, compression, and workflow
data are outside it, because none of them changes what a catalog says.

One descriptor can carry several providers. Their authority, their artifact identities, and their
catalog-set identities stay distinct, and a release MUST NOT collapse them into one provider
or one set.

## 6. Compatibility fingerprints

Compatibility is structural, and it is computed per scope before it is rolled up per application.

The application-contract domain covers what a caller has to satisfy: each message's identity, result
kind, typed inputs, and slot contracts, and each family's template, segments, contracts, and current
members. Source and target prose is outside it, so translating a message does not change what
calling it requires.

The semantic-registry domain covers what the runtime has to provide: the built-in slot kinds the
scope actually references with their shapes, and each required extension descriptor by kind,
identity, and its own fingerprint. Handlers, renderers, components, and styles are outside it.

A descriptor's fingerprint is taken over its declared fields under the descriptor profile label. A
release MUST refuse to use an artifact until every descriptor that artifact requires is bound
to a registered implementation whose descriptor canonicalizes identically.

An artifact's compatibility identity is its own scope's, and a release MUST NOT let a change
confined to another scope change that artifact's address.

Source revisions are fingerprinted separately, per message, over the identity, result kind, inputs,
slots, and canonical source body. That value answers whether a translation was written against the
current source. It is not caller compatibility, not catalog content identity, and not a ledger of
retired identifiers.

## 7. Resource summaries and limits

Every artifact carries a summary of what it costs to hold and evaluate: its decoded byte count, and
totals for messages, identifiers, literals, data nodes, depth, selectors, variants, inputs, slots,
references, functions, and output parts, together with the largest single message's nodes, depth,
selectors, variants, inputs, slots, and output parts.

The summary carries its own profile label, so its definition is versioned with the compiled profile
rather than assumed stable.

A release MUST refuse a catalog whose compiled content exceeds a compile-time ceiling, and
MUST refuse a candidate whose recorded summary and re-measured summary disagree or whose
measurements exceed a runtime ceiling.

Ceilings are fixed in a release. An artifact MUST NOT raise one, and a consumer MUST NOT be given a
way to raise one. What a consumer sets is how many admitted catalogs the memory cache retains, from
one through the number of artifacts the build produced.

Every measure is derived from the compiled content, so no quota ledger is authored.

## 8. Loader contract

The standard loader uses generated same-release modules and nothing else. A release MUST
require no network, no backend, no content or translation management system, no service worker, no
persistent cache, no credential, no signing key, and no hosted service for it.

A load request names the scope, the candidate locale, and a cancellation signal. A success returns
one admitted compiled catalog and nothing beside it.

A locale a scope has no artifact for is a typed unavailable outcome. A release MUST NOT report
it as a load failure, so that a caller can tell an untranslated scope from a broken one.

The loader map is copied into a null-prototype frozen map before use, and a release MUST
refuse an entry that is an accessor or is not a function.

Preloading is the same load without a lease. It shares the in-flight request for the same catalog
identity and it is cancellable, and a release MUST NOT let it commit a locale or any other
state.

Because a load is shared, it can outlive every caller that cancelled it. A release MUST still
observe its failure, and MUST NOT leave it as a rejection nobody handles.

A release defines no network retry, persistent store, offline mode, service-worker cache, or remote
source discovery, and a release MUST NOT introduce one behind this contract.

## 9. Memory cache

Bounded in-memory caching and in-flight deduplication are available by default and are keyed by
catalog identity. A release MUST join a second request for a catalog already loading to the
first rather than start a second load.

An entry acquired for use is pinned for as long as it is held. Eviction is automatic and takes the
least recently used unpinned entry, and a release MUST NOT evict a pinned one. A catalog offered for
an identity that is already cached, by a transfer or by a load that finishes after one, counts as a
use of the entry already there and leaves the leases on it in force.

A release MUST NOT turn a failed load into a cache entry, and MUST release everything a
disposed context cached.

Cache identity is the provider, the scope, and the candidate locale, and admission identity adds the
content digest, the generated ABI, the standards profile, and both fingerprints. A release
MUST NOT make a credential, a user identifier, a consumer's domain value, translated content, or a
participant payload a cache key or a cache entry.

## 10. Consumer-data boundary

The loader and the cache apply to catalogs the toolkit compiled. Pages, products, articles,
comments, user-authored values, and other consumer records stay in the consumer's own services,
stores, signals, and components, and a release MUST NOT admit one into compiled data, a descriptor,
loader state, cache state, or a localization snapshot.

A diagnostic about an artifact carries bounded safe identifiers for the provider, the scope, and the
locale. A release MUST NOT echo the value that failed, because a diagnostic is written to a
log that is read somewhere else.

The runtime correlates only what it owns: readiness, outcome, safe identity, and which locale
actually supplied a result.

## 11. Primary references

- RFC 7493, The I-JSON Message Format: `https://www.rfc-editor.org/rfc/rfc7493`
- RFC 4648 section 5, Base 64 Encoding with URL and Filename Safe Alphabet:
  `https://www.rfc-editor.org/rfc/rfc4648`
- FIPS 180-4, Secure Hash Standard: `https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf`
