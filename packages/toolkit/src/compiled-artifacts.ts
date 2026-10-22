/**
 * The compiler's output: inert catalogs, their addresses, the descriptor that lists them, and the
 * one plan that writes them.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 1 is why every compiled body goes through
 * JSON on the way in: a function, an accessor and a prototype all fail to survive the round trip,
 * so no reader downstream has to decide whether a value is safe to evaluate.
 */
import {
  digestCanonicalJson,
  stringifyCanonicalJson,
  type CanonicalJsonValue,
} from './canonical-json.js';
import type { Catalog, CatalogMessage } from './catalog.js';
import {
  toolkitDiagnostic,
  toolkitFailure,
  toolkitSuccess,
  type ToolkitDiagnostic,
  type ToolkitResult,
} from './diagnostics.js';
import type { GeneratedContractFile } from './generated-contracts.js';
import type {
  MessageDeclaration,
  MessageExpression,
  MessagePattern,
  MessageSemanticModel,
  MessageVariant,
} from './message-format.js';
import {
  MESSAGE_FUNCTION_OPTIONS,
  inheritedOptions,
  resolvedDateOptions,
} from './message-function-options.js';
import { createOutputPlan, type OutputPlan } from './output-plan.js';
import {
  personNameProfilesFor,
  type PersonNameProfileSet,
} from './person-names.js';
import { RESOURCE_LIMITS } from './resource-limits.js';
import {
  recoveryRootRefusal,
  type EffectiveInputContract,
  type EffectiveSlotContract,
  type ReferencedExtension,
  type SemanticGraph,
  type SemanticMessage,
  type SemanticScope,
} from './semantic-model.js';
import { compareCodeUnit } from './sorted-records.js';

/**
 * The version stamp on every compiled catalog, which a loader checks before reading one.
 *
 * It changes when the compiled shape changes in a way a reader would notice, so an artifact built
 * by one version of Equator and loaded by another is refused rather than misread.
 */
export const COMPILED_IR_PROFILE = 'equator-compiled-ir/1' as const;
/** The version stamp on the descriptor that lists a build's compiled catalogs. */
export const CATALOG_DESCRIPTOR_PROFILE = 'equator-catalog-set/1' as const;
/** The version stamp on the resource counts carried beside a compiled catalog. */
export const RESOURCE_SUMMARY_PROFILE = 'equator-resource-summary/1' as const;

/** What identifies one compiled catalog: whose it is, which scope, and which locale. */
export interface CompiledCatalogKey {
  /** The package that owns the messages. */
  readonly providerId: string;
  /** The scope within it, which is the unit the runtime loads. */
  readonly scopeId: string;
  /** The locale this catalog holds, canonically spelled. */
  readonly catalogLocale: string;
}

/**
 * What the single most expensive message in a catalog costs, by each measure separately.
 *
 * Each number may come from a different message. The point is the worst case per dimension, which
 * is what a per-message ceiling is checked against.
 */
export interface MessageResourceSummary {
  /** Nodes in the compiled body. */
  readonly irNodes: number;
  /** How deeply that body nests. */
  readonly depth: number;
  /** How many values it selects on. */
  readonly selectors: number;
  /** How many branches it has. */
  readonly variants: number;
  /** How many values it takes. */
  readonly inputs: number;
  /** How many named regions it places. */
  readonly slots: number;
  /** How many pieces its output can come apart into. */
  readonly outputParts: number;
}

/**
 * What a compiled catalog costs, counted at compile time so the runtime does not have to measure it.
 *
 * The runtime checks these against its own fixed ceilings before it evaluates anything, which is
 * how a catalog too large to be safe is refused rather than discovered while a page is rendering.
 * A build script can read the same numbers to see how close a catalog is to a bound.
 */
export interface CatalogResourceSummary {
  /** The version stamp of this shape. */
  readonly profile: typeof RESOURCE_SUMMARY_PROFILE;
  /** How large the catalog is once decoded. */
  readonly decodedBytes: number;
  /** How many messages are in it. */
  readonly messages: number;
  /** How many distinct names its messages use. */
  readonly identifiers: number;
  /** How many literal values they contain. */
  readonly literals: number;
  /** Nodes across every compiled body. */
  readonly irNodes: number;
  /** The deepest nesting any one body reaches. */
  readonly depth: number;
  /** How many selections the catalog makes in total. */
  readonly selectors: number;
  /** How many branches across all of them. */
  readonly variants: number;
  /** How many values its messages take in total. */
  readonly inputs: number;
  /** How many named regions they place in total. */
  readonly slots: number;
  /** How many references its bodies resolve. */
  readonly references: number;
  /** How many function calls they make. */
  readonly functions: number;
  /** How many output pieces they can produce in total. */
  readonly outputParts: number;
  /** The worst case per measure, for the per-message ceilings. */
  readonly maximumMessage: MessageResourceSummary;
}

/**
 * One message as the runtime receives it: a contract, and a body with nothing executable in it.
 *
 * The body has been through JSON, so a function, an accessor and a foreign prototype all failed to
 * survive the trip. That is what lets the evaluator read it without deciding whether any part of it
 * is safe to touch.
 */
export interface CompiledMessage {
  /** The message's key within its scope. */
  readonly messageId: string;
  /** Whether it has text, or is a declaration still waiting for a translation. */
  readonly kind: 'empty' | 'message';
  /** Whether it renders as a string or as parts a template places. */
  readonly resultKind: 'plain' | 'structured';
  /**
   * A digest of the authored source this was compiled from.
   *
   * What tells a target message whether the source it translates has changed since.
   */
  readonly sourceFingerprint: string;
  /** The values it takes, with the types the generated code declares for them. */
  readonly inputs: readonly EffectiveInputContract[];
  /** The named regions it places, with what each one must be bound to. */
  readonly slots: readonly EffectiveSlotContract[];
  /** The compiled body, as plain data. */
  readonly body: CanonicalJsonValue;
}

/**
 * A whole catalog compiled: its messages, what it needs in order to be loaded, and what it costs.
 *
 * Everything above the messages is there so a loader can refuse an artifact it cannot honor before
 * it evaluates anything out of it.
 */
export interface CompiledCatalog {
  /** The compiled-shape version stamp. */
  readonly profile: typeof COMPILED_IR_PROFILE;
  /** Which generated interface this was built against, so old output and new code do not mix. */
  readonly generatedAbi: string;
  /** Which standards profile the messages were compiled under. */
  readonly standardsProfile: 'equator-1';
  /** Whose catalog this is, which scope, and which locale. */
  readonly key: CompiledCatalogKey;
  /** A digest of the application's message contracts, which a loader matches against its own. */
  readonly applicationContractFingerprint: string;
  /** A digest of the semantic registry the messages were compiled against. */
  readonly semanticRegistryFingerprint: string;
  /** The extensions that must be registered before any of this can be evaluated. */
  readonly requiredExtensions: readonly ReferencedExtension[];
  /** The messages. */
  readonly messages: readonly CompiledMessage[];
  /** What loading and evaluating this catalog costs. */
  readonly resources: CatalogResourceSummary;
}

/**
 * Everything about a compiled catalog that can be known without opening it.
 *
 * Carried in the descriptor so a loader can decide whether an artifact is usable, and whether it
 * has changed, without fetching it. The digest is of the content, so two builds that produced the
 * same catalog produce the same address.
 */
export interface ArtifactAddress {
  /** Whose catalog, which scope, which locale. */
  readonly key: CompiledCatalogKey;
  /** The compiled-shape version stamp the artifact carries. */
  readonly compiledIrProfile: typeof COMPILED_IR_PROFILE;
  /** The schema of the file itself. */
  readonly schema: 'equator-compiled-catalog/1';
  /** Runtime capabilities the artifact needs, which a host without them can refuse on. */
  readonly requiredFeatures: readonly string[];
  /** The standards profile it was compiled under. */
  readonly standardsProfile: 'equator-1';
  /** The generated interface version it matches. */
  readonly generatedAbi: string;
  /** The application contract digest it was built against. */
  readonly applicationContractFingerprint: string;
  /** The semantic registry digest it was built against. */
  readonly semanticRegistryFingerprint: string;
  /** The extensions it needs registered. */
  readonly requiredExtensions: readonly ReferencedExtension[];
  /** A digest of the artifact's content, for cache keys and for telling two builds apart. */
  readonly contentDigest: string;
}

/** One artifact as the descriptor lists it: what it is, where it is, and what it costs. */
export interface CatalogSetArtifact {
  /** Everything knowable about it without opening it. */
  readonly address: ArtifactAddress;
  /** Where the module sits, as a path the loader imports. */
  readonly modulePath: string;
  /** What loading it costs, repeated here so the descriptor answers without a fetch. */
  readonly resources: CatalogResourceSummary;
}

/** One package's compiled catalogs, grouped under the set they were built as. */
export interface ProviderCatalogSet {
  /** The package these belong to. */
  readonly providerId: string;
  /** Which set within that package, which is what distinguishes two builds of one package. */
  readonly catalogSetId: string;
  /** The artifacts, one per scope and locale. */
  readonly artifacts: readonly CatalogSetArtifact[];
}

/**
 * The index of a build's compiled catalogs: what exists, where, and what it was built against.
 *
 * The one file a loader reads first. An application that composes several packages gets one
 * descriptor listing all of them, so which catalogs exist is answered once rather than per package.
 */
export interface CatalogSetDescriptor {
  /** The descriptor-shape version stamp. */
  readonly profile: typeof CATALOG_DESCRIPTOR_PROFILE;
  /** The generated interface version every artifact in it matches. */
  readonly generatedAbi: string;
  /** The application contract digest they were all built against. */
  readonly applicationContractFingerprint: string;
  /** The semantic registry digest they were all built against. */
  readonly semanticRegistryFingerprint: string;
  /** The packages, each with its own artifacts. */
  readonly providers: readonly ProviderCatalogSet[];
}

/**
 * A recovery message compiled on its own, so it can be read when no catalog could be loaded.
 *
 * The failure path cannot depend on the thing that failed. These are built into the output
 * separately, one per locale, and are the only messages available when localization did not start.
 */
export interface RecoveryRepresentation {
  /** Which message this is, by the identity its handle carries. */
  readonly identity: string;
  /** The locale it is written in. */
  readonly locale: string;
  /** A digest of the source it was compiled from. */
  readonly sourceFingerprint: string;
  /** The compiled body, as plain data. */
  readonly body: CanonicalJsonValue;
}

/**
 * Which project this generated output belongs to, and where it writes.
 *
 * Two Equator-owned trees can sit in one repository, and the work root and the generated root each
 * carry an owner identity so that one project's disposable state can never be adopted by another's
 * build. This is what that identity is made of, and the two fields are the whole of it: the package
 * that owns the catalogs, and the path it generates into, relative to that package.
 *
 * **It is deliberately not derived from anything the owner generates.** An identity that digests
 * the scope list changes the first time a consumer writes a catalog and again every time they add a
 * scope, so the work root records an owner the next run no longer computes, and `equator generate`
 * refuses with `EQ1602` until `equator clean` removes the marker. Adding a scope is ordinary
 * localization work and must cost no Equator step. An identity that moves when the work moves is
 * not an identity; it is a digest of the work, which the completion manifest already keeps under
 * `planDigest`.
 *
 * What does move it is a project becoming a different project: a renamed package, or a generated
 * root pointed somewhere else. Re-owning is the correct outcome for both.
 */
export interface OwnerIdentity {
  /**
   * The owning package's Equator provider identity, which is its package name.
   *
   * `compileProject` refuses one outside the provider grammar with `EQ1104`.
   */
  readonly providerId: string;
  /**
   * Where this owner generates, as a portable path relative to the owner root.
   *
   * Forward slashes, and no empty, `.` or `..` segment. `compileProject` throws a `TypeError` for
   * any other.
   */
  readonly generatedRootPath: string;
}

/**
 * The identity recorded in the work-root marker and the completion manifest.
 *
 * Published because a consumer's own tooling may need to recognise which of several Equator-owned
 * trees a directory belongs to without running a compilation to find out.
 */
export function generatedOwnerId(owner: OwnerIdentity): string {
  return digestCanonicalJson('equator-generated-owner/1', {
    providerId: owner.providerId,
    generatedRootPath: owner.generatedRootPath,
  });
}

export interface CompileLocalArtifactsRequest {
  readonly graph: SemanticGraph;
  readonly catalogs: readonly Catalog[];
  /**
   * Who this output belongs to. Required, and supplied rather than derived: which project is
   * generating, and where, is a fact about the project on disk that a pure compilation cannot see.
   */
  readonly owner: OwnerIdentity;
  readonly contractFiles?: readonly GeneratedContractFile[];
  readonly recoveryMessageIdentities?: readonly string[];
}

/**
 * Everything one compilation produced, in memory, before anything is written.
 *
 * Compilation and writing are separate on purpose: a caller can compile, inspect what came out, and
 * decide whether to apply an output plan. Applying one is what puts anything on disk.
 */
export interface CompiledLocalArtifacts {
  /** Which project this output belongs to, so one project cannot adopt another's generated tree. */
  readonly ownerId: string;
  /** The compiled catalogs, one per scope and locale. */
  readonly catalogs: readonly CompiledCatalog[];
  /** The index listing them. */
  readonly descriptor: CatalogSetDescriptor;
  /** The recovery messages, compiled apart from the catalogs they exist for the failure of. */
  readonly recovery: readonly RecoveryRepresentation[];
  /** The files to write, with what is already current left out of it. */
  readonly outputPlan: OutputPlan;
}

interface JsonMetrics {
  readonly nodes: number;
  readonly depth: number;
  readonly literals: number;
  readonly references: number;
  readonly functions: number;
}

/**
 * `JSON.stringify` as it behaves rather than as it is declared.
 *
 * The declaration promises a string back. Nothing comes back for `undefined`, for a function or
 * for a symbol, and the values reaching here are a project's rather than this code's own.
 */
function serializeJson(value: unknown): string | undefined {
  return JSON.stringify(value);
}

function canonicalValue(value: unknown): CanonicalJsonValue {
  const serialized = serializeJson(value);
  if (serialized === undefined) {
    throw new TypeError('Equator compiled data is not JSON serializable.');
  }
  return JSON.parse(serialized) as CanonicalJsonValue;
}

function compiledBody(message: CatalogMessage): CanonicalJsonValue {
  if (message.kind === 'empty') return { kind: 'empty' };
  const semantics = message.semantics;
  return semantics.kind === 'pattern'
    ? canonicalValue({
        kind: 'pattern',
        declarations: semantics.declarations,
        pattern: semantics.pattern,
      })
    : canonicalValue({
        kind: 'select',
        declarations: semantics.declarations,
        selectors: semantics.selectors,
        variants: semantics.variants,
      });
}

function jsonMetrics(value: CanonicalJsonValue, depth = 1): JsonMetrics {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return { nodes: 1, depth, literals: 1, references: 0, functions: 0 };
  }
  const children = Array.isArray(value)
    ? value
    : Object.values(value as Readonly<Record<string, CanonicalJsonValue>>);
  let nodes = 1;
  let maximumDepth = depth;
  let literals = 0;
  let references = 0;
  let functions = 0;
  for (const child of children) {
    const metrics = jsonMetrics(child, depth + 1);
    nodes += metrics.nodes;
    maximumDepth = Math.max(maximumDepth, metrics.depth);
    literals += metrics.literals;
    references += metrics.references;
    functions += metrics.functions;
  }
  if (!Array.isArray(value)) {
    const record = value as Readonly<Record<string, CanonicalJsonValue>>;
    if (record['kind'] === 'variable') references += 1;
    if (typeof record['function'] === 'object' && record['function'] !== null) {
      functions += 1;
    }
  }
  return {
    nodes,
    depth: maximumDepth,
    literals,
    references,
    functions,
  };
}

function outputPartCount(semantics: MessageSemanticModel): number {
  return semantics.kind === 'pattern'
    ? semantics.pattern.length
    : semantics.variants.reduce(
        (total, variant) => total + variant.pattern.length,
        0,
      );
}

function messageSummary(
  catalogMessage: CatalogMessage,
  semanticMessage: SemanticMessage,
  body: CanonicalJsonValue,
): MessageResourceSummary {
  const metrics = jsonMetrics(body);
  const semantics =
    catalogMessage.kind === 'message' ? catalogMessage.semantics : undefined;
  return Object.freeze({
    irNodes: metrics.nodes,
    depth: metrics.depth,
    selectors: semantics?.kind === 'select' ? semantics.selectors.length : 0,
    variants: semantics?.kind === 'select' ? semantics.variants.length : 0,
    inputs: semanticMessage.inputs.length,
    slots: semanticMessage.slots.length,
    outputParts: semantics === undefined ? 0 : outputPartCount(semantics),
  });
}

function emptyMessageMaximum(): MessageResourceSummary {
  return Object.freeze({
    irNodes: 0,
    depth: 0,
    selectors: 0,
    variants: 0,
    inputs: 0,
    slots: 0,
    outputParts: 0,
  });
}

function maximumMessageSummary(
  summaries: readonly MessageResourceSummary[],
): MessageResourceSummary {
  return summaries.reduce<MessageResourceSummary>(
    (maximum, summary) =>
      Object.freeze({
        irNodes: Math.max(maximum.irNodes, summary.irNodes),
        depth: Math.max(maximum.depth, summary.depth),
        selectors: Math.max(maximum.selectors, summary.selectors),
        variants: Math.max(maximum.variants, summary.variants),
        inputs: Math.max(maximum.inputs, summary.inputs),
        slots: Math.max(maximum.slots, summary.slots),
        outputParts: Math.max(maximum.outputParts, summary.outputParts),
      }),
    emptyMessageMaximum(),
  );
}

/**
 * What this catalog costs to hold and to evaluate, measured once at compile time.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 7 fixes the fields, and the runtime
 * measures the same ones from the candidate's own content and compares the two, so a summary that
 * understates what a catalog costs is refused before the catalog is admitted.
 */
function catalogResourceSummary(
  messages: readonly CompiledMessage[],
  sourceMessages: readonly CatalogMessage[],
  semanticMessages: readonly SemanticMessage[],
  canonicalCatalog: string,
): CatalogResourceSummary {
  const bodies = messages.map(({ body }) => jsonMetrics(body));
  const messageSummaries = messages.map((message, index) =>
    messageSummary(
      sourceMessages[index] as CatalogMessage,
      semanticMessages[index] as SemanticMessage,
      message.body,
    ),
  );
  return Object.freeze({
    profile: RESOURCE_SUMMARY_PROFILE,
    decodedBytes: Buffer.byteLength(canonicalCatalog, 'utf8'),
    messages: messages.length,
    identifiers: messages.reduce(
      (total, message) =>
        total +
        message.messageId.split('.').length +
        message.inputs.length +
        message.slots.length,
      0,
    ),
    literals: bodies.reduce((total, metrics) => total + metrics.literals, 0),
    irNodes: bodies.reduce((total, metrics) => total + metrics.nodes, 0),
    depth: bodies.reduce(
      (maximum, metrics) => Math.max(maximum, metrics.depth),
      0,
    ),
    selectors: messageSummaries.reduce(
      (total, summary) => total + summary.selectors,
      0,
    ),
    variants: messageSummaries.reduce(
      (total, summary) => total + summary.variants,
      0,
    ),
    inputs: messages.reduce(
      (total, message) => total + message.inputs.length,
      0,
    ),
    slots: messages.reduce((total, message) => total + message.slots.length, 0),
    references: bodies.reduce(
      (total, metrics) => total + metrics.references,
      0,
    ),
    functions: bodies.reduce((total, metrics) => total + metrics.functions, 0),
    outputParts: messageSummaries.reduce(
      (total, summary) => total + summary.outputParts,
      0,
    ),
    maximumMessage: maximumMessageSummary(messageSummaries),
  });
}

function semanticMessagesById(
  scope: SemanticScope,
): ReadonlyMap<string, SemanticMessage> {
  return new Map(scope.messages.map((message) => [message.messageId, message]));
}

function compileCatalog(
  graph: SemanticGraph,
  scope: SemanticScope,
  catalog: Catalog,
  diagnostics: ToolkitDiagnostic[],
): CompiledCatalog {
  const semanticMessages = semanticMessagesById(scope);
  const compiledMessages: CompiledMessage[] = [];
  const sourceMessages: CatalogMessage[] = [];
  const alignedSemanticMessages: SemanticMessage[] = [];
  for (const [messageId, message] of Object.entries(catalog.messages).sort(
    ([left], [right]) => compareCodeUnit(left, right),
  )) {
    const semantic = semanticMessages.get(messageId);
    if (semantic === undefined) continue;
    const body = compiledBody(message);
    compiledMessages.push(
      Object.freeze({
        messageId,
        kind: message.kind,
        resultKind: semantic.resultKind,
        sourceFingerprint: semantic.sourceFingerprint,
        inputs: semantic.inputs,
        slots: semantic.slots,
        body,
      }),
    );
    sourceMessages.push(message);
    alignedSemanticMessages.push(semantic);
  }
  const base = {
    profile: COMPILED_IR_PROFILE,
    generatedAbi: graph.generatedAbi,
    standardsProfile: 'equator-1' as const,
    key: Object.freeze({
      providerId: catalog.providerId,
      scopeId: catalog.scopeId,
      catalogLocale: catalog.locale,
    }),
    applicationContractFingerprint: scope.applicationContractFingerprint,
    semanticRegistryFingerprint: scope.semanticRegistryFingerprint,
    requiredExtensions: scope.requiredExtensions,
    messages: Object.freeze(compiledMessages),
  };
  const canonicalBase = stringifyCanonicalJson(canonicalValue(base));
  const resources = catalogResourceSummary(
    compiledMessages,
    sourceMessages,
    alignedSemanticMessages,
    canonicalBase,
  );
  if (resources.irNodes > RESOURCE_LIMITS.irNodesPerCatalog) {
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1502',
        `Compiled catalog ${catalog.providerId}/${catalog.scopeId}/${catalog.locale} exceeds the ${RESOURCE_LIMITS.irNodesPerCatalog}-node IR ceiling.`,
      ),
    );
  }
  if (resources.depth > RESOURCE_LIMITS.irDepth) {
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1502',
        `Compiled catalog ${catalog.providerId}/${catalog.scopeId}/${catalog.locale} exceeds the IR depth ceiling of ${RESOURCE_LIMITS.irDepth}.`,
      ),
    );
  }
  return Object.freeze({ ...base, resources });
}

/**
 * What one expression resolves to, as far as a time zone goes.
 *
 * `variableZone` is a zone the caller supplies at render through an option variable, which the
 * literal options cannot show and which no formatting context is asked for.
 */
interface ResolvedZone {
  readonly options: Readonly<Record<string, string>>;
  readonly variableZone: boolean;
}

/**
 * Whether a message formats a date or a time in the formatting context's zone rather than one it
 * names.
 *
 * A date expression's zone is the one it writes, the one its operand's declaration wrote, which it
 * inherits as an override option, or, with neither, the formatting context's. A context without one
 * is a behavior the standard leaves open, and `specs/04-message-authoring-and-catalogs.spec.md`
 * section 6 resolves it as a refusal before render, so the catalog says it needs a zone and an
 * application that configured none is refused when the catalog set is admitted.
 *
 * Every date expression counts, a declaration's included, whether or not a pattern places it, so the
 * answer can only err towards requiring a zone that a message turns out not to use.
 */
function formatsInContextZone(
  body: Readonly<Record<string, CanonicalJsonValue>>,
): boolean {
  const zones = new Map<string, ResolvedZone>();
  let contextZone = false;
  const resolve = (expression: MessageExpression): ResolvedZone => {
    const from =
      expression.operand?.kind === 'variable'
        ? zones.get(expression.operand.name)
        : undefined;
    const reference = expression.function;
    if (reference === undefined) {
      return from ?? { options: {}, variableZone: false };
    }
    const written: Record<string, string> = {};
    for (const [name, value] of Object.entries(reference.options)) {
      if (value.kind === 'literal') written[name] = value.value;
    }
    const profile = MESSAGE_FUNCTION_OPTIONS[reference.name];
    if (profile?.operand !== 'date-time') {
      return {
        options: inheritedOptions(from?.options, written, profile),
        variableZone: from?.variableZone ?? false,
      };
    }
    const options = resolvedDateOptions(from?.options, written, profile);
    const variableZone =
      reference.options['timeZone']?.kind === 'variable' ||
      (written['timeZone'] === undefined && (from?.variableZone ?? false));
    if (options['timeZone'] === undefined && !variableZone) contextZone = true;
    return { options, variableZone };
  };
  const visit = (pattern: MessagePattern): void => {
    for (const part of pattern) {
      if (typeof part !== 'string' && part.kind === 'expression') resolve(part);
    }
  };
  for (const declaration of (body['declarations'] ??
    []) as unknown as readonly MessageDeclaration[]) {
    zones.set(declaration.name, resolve(declaration.value));
  }
  if (body['kind'] === 'pattern') {
    visit(body['pattern'] as unknown as MessagePattern);
  }
  if (body['kind'] === 'select') {
    for (const variant of body[
      'variants'
    ] as unknown as readonly MessageVariant[]) {
      visit(variant.pattern);
    }
  }
  return contextZone;
}

function requiredFeatures(catalog: CompiledCatalog): readonly string[] {
  const features = new Set<string>();
  for (const message of catalog.messages) {
    if (message.kind === 'empty') features.add('explicit-empty');
    if (message.resultKind === 'structured') features.add('structured-output');
    const body = message.body as Readonly<Record<string, CanonicalJsonValue>>;
    if (body['kind'] === 'select') features.add('selection');
    if (message.kind !== 'empty' && formatsInContextZone(body)) {
      features.add('context-time-zone');
    }
  }
  return Object.freeze([...features].sort(compareCodeUnit));
}

/**
 * Everything a reader has to agree with before it can use this catalog.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 5 lists what an address binds. The
 * content digest is the last of them and serves as the artifact's version, so nothing authored
 * carries one.
 */
function artifactAddress(catalog: CompiledCatalog): ArtifactAddress {
  return Object.freeze({
    key: catalog.key,
    compiledIrProfile: COMPILED_IR_PROFILE,
    schema: 'equator-compiled-catalog/1',
    requiredFeatures: requiredFeatures(catalog),
    standardsProfile: 'equator-1',
    generatedAbi: catalog.generatedAbi,
    applicationContractFingerprint: catalog.applicationContractFingerprint,
    semanticRegistryFingerprint: catalog.semanticRegistryFingerprint,
    requiredExtensions: catalog.requiredExtensions,
    contentDigest: digestCanonicalJson(
      'equator-compiled-catalog/1',
      canonicalValue(catalog),
    ),
  });
}

function artifactPath(catalog: CompiledCatalog): string {
  const provider = digestCanonicalJson(
    'equator-provider-output-path/1',
    catalog.key.providerId,
  ).slice('sha256-'.length);
  return `catalogs/${provider}/${catalog.key.scopeId}/${catalog.key.catalogLocale}.ts`;
}

function artifactIdentity(address: ArtifactAddress): string {
  return `${address.key.providerId}:${address.key.scopeId}:${address.key.catalogLocale}`;
}

function addressIdentityJson(address: ArtifactAddress): CanonicalJsonValue {
  return canonicalValue(address);
}

/**
 * The providers of one build, each with its own set identity.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 5 keeps providers separate and
 * fingerprints each set over that provider's ordered addresses alone. Module paths and byte counts
 * stay out of it, because moving a chunk does not change what a catalog says.
 */
function catalogDescriptor(
  graph: SemanticGraph,
  catalogs: readonly CompiledCatalog[],
): CatalogSetDescriptor {
  const providers = new Map<string, CompiledCatalog[]>();
  for (const catalog of catalogs) {
    const entries = providers.get(catalog.key.providerId) ?? [];
    entries.push(catalog);
    providers.set(catalog.key.providerId, entries);
  }
  const providerSets = [...providers.entries()]
    .sort(([left], [right]) => compareCodeUnit(left, right))
    .map(([providerId, providerCatalogs]) => {
      providerCatalogs.sort((left, right) =>
        compareCodeUnit(
          artifactIdentity(artifactAddress(left)),
          artifactIdentity(artifactAddress(right)),
        ),
      );
      const artifacts = providerCatalogs.map((catalog) =>
        Object.freeze({
          address: artifactAddress(catalog),
          modulePath: artifactPath(catalog),
          resources: catalog.resources,
        }),
      );
      const catalogSetId = digestCanonicalJson(
        'equator-provider-catalog-set/1',
        artifacts.map(({ address }) => addressIdentityJson(address)),
      );
      return Object.freeze({
        providerId,
        catalogSetId,
        artifacts: Object.freeze(artifacts),
      });
    });
  return Object.freeze({
    profile: CATALOG_DESCRIPTOR_PROFILE,
    generatedAbi: graph.generatedAbi,
    applicationContractFingerprint: graph.applicationContractFingerprint,
    semanticRegistryFingerprint: graph.semanticRegistryFingerprint,
    providers: Object.freeze(providerSets),
  });
}

function dataModule(exportName: string, value: unknown): string {
  return [
    '/** Generated by Equator. Do not edit. */',
    `export const ${exportName} = ${JSON.stringify(value, null, 2)} as const;`,
    '',
  ].join('\n');
}

/**
 * The person-name profiles this application's own locales reach.
 *
 * One line rather than `dataModule`: the rows are fifty-four small integers each, and pretty
 * printing them costs about twenty times the bytes to say the same thing. `prettier-ignore`
 * because a consumer that formats its generated root would otherwise reflow it on every run.
 */
function personNamesModule(profileSet: PersonNameProfileSet): string {
  return [
    '/** Generated by Equator. Do not edit. */',
    '/**',
    ' * Person-name patterns for the configured locales, from pinned CLDR.',
    ' *',
    ' * Rows keep their own tag rather than the configured tag that reached them, and the runtime',
    ' * resolves a locale through the same longest-prefix walk that selected them. A locale the',
    ' * pinned release does not cover contributes no row and falls back to the runtime`s compiled',
    ' * root profile.',
    ' */',
    '// prettier-ignore',
    `export const personNames = ${JSON.stringify(profileSet)} as const;`,
    '',
  ].join('\n');
}

/** Whether `tag` resolves to `rowTag` under the longest-prefix walk the runtime uses. */
function matchesRow(rowTag: string, tag: string): boolean {
  const row = rowTag.toLowerCase();
  let candidate = tag.toLowerCase();
  for (;;) {
    if (candidate === row) return true;
    const boundary = candidate.lastIndexOf('-');
    if (boundary <= 0) return false;
    candidate = candidate.slice(0, boundary);
  }
}

/**
 * One entry per artifact, from catalog identity to the import that yields it.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 2 makes this a code-splitting wrapper and
 * nothing more. The module's only export is the compiled catalog, and identity is computed over
 * that value rather than over the module, so the chunk a catalog arrives in is invisible to every
 * admission check.
 */
function loaderModule(descriptor: CatalogSetDescriptor): string {
  const rows = descriptor.providers.flatMap((provider) =>
    provider.artifacts.map((artifact) => {
      const key = artifactIdentity(artifact.address);
      const modulePath = `./${artifact.modulePath.replace(/\.ts$/u, '.js')}`;
      return `  ${JSON.stringify(key)}: () => import(${JSON.stringify(modulePath)}).then((module) => module.compiledCatalog),`;
    }),
  );
  return [
    '/** Generated by Equator. Do not edit. */',
    'export const catalogLoaders = Object.freeze({',
    ...rows,
    '});',
    '',
  ].join('\n');
}

function recoveryRepresentations(
  graph: SemanticGraph,
  catalogs: readonly CompiledCatalog[],
  identities: readonly string[],
  diagnostics: ToolkitDiagnostic[],
): readonly RecoveryRepresentation[] {
  const selected = new Set(identities);
  const semantic = new Map(
    graph.scopes.flatMap((scope) =>
      scope.messages.map((message) => [message.identity, message] as const),
    ),
  );
  for (const identity of selected) {
    const refusal = recoveryRootRefusal(identity, semantic.get(identity));
    if (refusal !== undefined) diagnostics.push(refusal);
  }
  const result: RecoveryRepresentation[] = [];
  for (const catalog of catalogs) {
    for (const message of catalog.messages) {
      const identity = `${catalog.key.providerId}:${catalog.key.scopeId}:${message.messageId}`;
      if (!selected.has(identity)) continue;
      result.push(
        Object.freeze({
          identity,
          locale: catalog.key.catalogLocale,
          sourceFingerprint: message.sourceFingerprint,
          body: message.body,
        }),
      );
    }
  }
  result.sort((left, right) =>
    compareCodeUnit(
      `${left.identity}\u0000${left.locale}`,
      `${right.identity}\u0000${right.locale}`,
    ),
  );
  return Object.freeze(result);
}

export function compileLocalArtifacts(
  request: CompileLocalArtifactsRequest,
): ToolkitResult<CompiledLocalArtifacts> {
  const diagnostics: ToolkitDiagnostic[] = [];
  const scopeMap = new Map(
    request.graph.scopes.map((scope) => [
      `${scope.providerId}\u0000${scope.scopeId}`,
      scope,
    ]),
  );
  const catalogs: CompiledCatalog[] = [];
  for (const catalog of request.catalogs) {
    const scope = scopeMap.get(`${catalog.providerId}\u0000${catalog.scopeId}`);
    if (scope === undefined) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1501',
          `Catalog ${catalog.providerId}/${catalog.scopeId}/${catalog.locale} is absent from the accepted semantic graph.`,
        ),
      );
      continue;
    }
    catalogs.push(compileCatalog(request.graph, scope, catalog, diagnostics));
  }
  catalogs.sort((left, right) =>
    compareCodeUnit(
      `${left.key.providerId}\u0000${left.key.scopeId}\u0000${left.key.catalogLocale}`,
      `${right.key.providerId}\u0000${right.key.scopeId}\u0000${right.key.catalogLocale}`,
    ),
  );
  // The locales this owner is translated into, plus the ones it declared it formats names in.
  // The second half is a fact about the product, which languages the names it renders are
  // written in, and there is nothing in an owner's sources to derive it from.
  const personNameProfiles = personNameProfilesFor([
    ...request.graph.locales,
    ...request.graph.personNameLocales,
  ]);
  for (const locale of request.graph.personNameLocales) {
    if (personNameProfiles.rows.some((row) => matchesRow(row[0], locale))) {
      continue;
    }
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1004',
        `The pinned CLDR release carries no person-name patterns for ${JSON.stringify(locale)}, so declaring it changes nothing. Names in that locale are formatted with the interface's own patterns.`,
        { path: ['personNameLocales'], severity: 'warning' },
      ),
    );
  }

  const descriptor = catalogDescriptor(request.graph, catalogs);
  const recovery = recoveryRepresentations(
    request.graph,
    catalogs,
    request.recoveryMessageIdentities ?? [],
    diagnostics,
  );
  if (diagnostics.some(({ severity }) => severity === 'error')) {
    return toolkitFailure(diagnostics);
  }
  const files = [
    ...(request.contractFiles ?? []),
    ...catalogs.map((catalog) => ({
      path: artifactPath(catalog),
      contents: dataModule('compiledCatalog', catalog),
    })),
    {
      path: 'catalog-set.json',
      contents: stringifyCanonicalJson(canonicalValue(descriptor)),
    },
    {
      path: 'catalog-set.ts',
      contents: dataModule('catalogSet', descriptor),
    },
    {
      path: 'catalog-loaders.ts',
      contents: loaderModule(descriptor),
    },
    {
      path: 'recovery-payload.ts',
      contents: dataModule('recoveryPayload', recovery),
    },
    {
      path: 'person-names.ts',
      contents: personNamesModule(personNameProfiles),
    },
    {
      path: 'resource-summary.json',
      contents: stringifyCanonicalJson(
        canonicalValue(
          descriptor.providers.flatMap((provider) =>
            provider.artifacts.map((artifact) => ({
              key: artifact.address.key,
              resources: artifact.resources,
            })),
          ),
        ),
      ),
    },
  ];
  const outputPlan = createOutputPlan(files);
  if (!outputPlan.ok) return outputPlan;
  const ownerId = generatedOwnerId(request.owner);
  return toolkitSuccess(
    Object.freeze({
      ownerId,
      catalogs: Object.freeze(catalogs),
      descriptor,
      recovery,
      outputPlan: outputPlan.value,
    }),
    diagnostics,
  );
}
