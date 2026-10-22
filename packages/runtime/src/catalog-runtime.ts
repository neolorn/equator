import {
  CATALOG_SET_PROFILE,
  COMPILED_IR_PROFILE,
  GENERATED_ABI,
  LocalizationError,
  RESOURCE_SUMMARY_PROFILE,
  type CatalogKey,
  type CatalogLoaders,
  type CatalogResourceSummary,
  type CatalogSetArtifact,
  type ArtifactAddress,
  type CatalogSetDescriptor,
  type GeneratedConfiguration,
  type LocalizationDiagnostic,
  type LocalizationScope,
  type MessageResourceSummary,
  type ProviderCatalogSet,
  type RuntimeExtensionDescriptor,
} from '@neolorn/equator/core';
import {
  type AsReceived,
  RUNTIME_LIMITS,
  hasExactKeys,
  hasOwn,
  isDataRecord,
  safeDiagnosticIdentifier,
  snapshotGeneratedJson,
  snapshotInertJson,
  waitForSignal,
  type InertJsonSnapshot,
  compareCodeUnit,
} from './runtime-safety';
import {
  RUNTIME_EVENT_CODES,
  type LocalizationEventEmitter,
} from './observability';

export interface CompiledInputContract {
  readonly name: string;
  readonly type: 'boolean' | 'date-time' | 'integer' | 'number' | 'string';
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly enum?: readonly (string | number | boolean)[];
}

export interface CompiledSlotContract {
  readonly name: string;
  readonly kind: string;
  readonly shape: 'paired' | 'standalone';
  readonly optional: boolean;
  readonly repeatable: boolean;
  readonly within: readonly string[];
}

export interface CompiledMessage {
  readonly messageId: string;
  readonly kind: 'empty' | 'message';
  readonly resultKind: 'plain' | 'structured';
  readonly sourceFingerprint: string;
  readonly inputs: readonly CompiledInputContract[];
  readonly slots: readonly CompiledSlotContract[];
  readonly body: unknown;
}

export interface CompiledCatalog {
  readonly profile: typeof COMPILED_IR_PROFILE;
  readonly generatedAbi: typeof GENERATED_ABI;
  readonly standardsProfile: 'equator-1';
  readonly key: CatalogKey;
  readonly applicationContractFingerprint: string;
  readonly semanticRegistryFingerprint: string;
  readonly requiredExtensions: readonly RuntimeExtensionDescriptor[];
  readonly messages: readonly CompiledMessage[];
  readonly resources: CatalogResourceSummary;
}

export interface CatalogLease {
  readonly key: string;
  readonly catalog: CompiledCatalog;
  release(): void;
}

interface CachedCatalog {
  readonly catalog: CompiledCatalog;
  pins: number;
  lastUsed: number;
}

const supportedArtifactFeatures = new Set([
  'context-time-zone',
  'explicit-empty',
  'selection',
  'structured-output',
]);

/**
 * The canonical text of a value an inert snapshot produced.
 *
 * Nothing else reaches this function: the configuration, the catalog set and every candidate are
 * copied by `snapshotInertJson` before any part of them is compared, and that copy has already
 * refused an unpaired surrogate, a number that is not canonical and a record that is not plain.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (!isDataRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort(compareCodeUnit)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`;
}

function base64Url(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] as number;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += alphabet[first >> 2];
    result += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) {
      result += alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    }
    if (third !== undefined) result += alphabet[third & 0x3f];
  }
  return result;
}

/**
 * The digest the runtime recomputes, in the same domain the toolkit wrote it in.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 3 fixes the algorithm, the encoding and
 * the domain separator, so this and the toolkit's own implementation agree without sharing a line
 * of code. Web Crypto rather than a bundled hash, because the runtime ships no cryptography.
 */
/**
 * The Web Crypto subtle interface, or nothing where the host does not expose one.
 *
 * `lib.dom` declares `crypto` and `crypto.subtle` as always present. A page served over plain HTTP
 * is not a secure context and has no `subtle` at all, so the declaration describes the standard
 * rather than the host this code is running on. Read through here, the answer is the host's.
 */
function webCryptoSubtle(): SubtleCrypto | undefined {
  const host = globalThis as {
    readonly crypto?: { readonly subtle?: SubtleCrypto };
  };
  return host.crypto?.subtle;
}

/**
 * Whether a signal has aborted, asked at the moment of asking.
 *
 * `aborted` is a live getter on a host object: it turns true while this code is awaiting something
 * else, and there is no assignment for a checker to see. Read as a property it keeps whatever
 * answer it gave before the await, which is the one moment the question is not worth asking.
 */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function digestCanonicalCatalog(value: unknown): Promise<string> {
  const subtle = webCryptoSubtle();
  if (subtle === undefined) {
    throw new TypeError('Web Crypto SHA-256 is unavailable.');
  }
  const bytes = new TextEncoder().encode(
    `equator-compiled-catalog/1\u0000${canonicalize(value)}`,
  );
  const digest = await subtle.digest('SHA-256', bytes);
  return `sha256-${base64Url(new Uint8Array(digest))}`;
}

export function catalogIdentity(
  providerId: string,
  scopeId: string,
  locale: string,
): string {
  return `${providerId}:${scopeId}:${locale}`;
}

export function scopeIdentity(scope: LocalizationScope): string {
  return `${scope.providerId}:${scope.scopeId}`;
}

/**
 * What a failure says about an artifact, and what it refuses to say.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 10 allows bounded safe identifiers for
 * the provider, the scope and the locale, and nothing of the value that failed. A diagnostic is
 * written to a log read outside this process, so anything echoed into one leaves with it.
 */
function operationalDiagnostic(
  code: LocalizationDiagnostic['code'],
  message: string,
  artifact?: ReceivedCatalogSetArtifact,
  reason?: LocalizationDiagnostic['reason'],
): LocalizationDiagnostic {
  return Object.freeze({
    code,
    outcome: 'operational-failure',
    message,
    ...(reason === undefined ? {} : { reason }),
    ...(artifact === undefined
      ? {}
      : {
          targetLocale: safeDiagnosticIdentifier(
            artifact.address.key.catalogLocale,
          ),
          providerId: safeDiagnosticIdentifier(artifact.address.key.providerId),
          scopeId: safeDiagnosticIdentifier(artifact.address.key.scopeId),
        }),
  });
}

function unavailableDiagnostic(
  scope: LocalizationScope,
  locale: string,
): LocalizationDiagnostic {
  return Object.freeze({
    code: 'scope-unavailable',
    outcome: 'localized-representation-unavailable',
    message: `No generated local catalog exists for ${safeDiagnosticIdentifier(scope.providerId)}/${safeDiagnosticIdentifier(scope.scopeId)} in ${safeDiagnosticIdentifier(locale)}.`,
    targetLocale: safeDiagnosticIdentifier(locale),
    providerId: safeDiagnosticIdentifier(scope.providerId),
    scopeId: safeDiagnosticIdentifier(scope.scopeId),
  });
}

const summaryKeys = Object.freeze([
  'irNodes',
  'depth',
  'selectors',
  'variants',
  'inputs',
  'slots',
  'outputParts',
] as const);

function boundedCount(value: unknown, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= maximum
  );
}

function validMessageSummary(value: unknown): boolean {
  return (
    isDataRecord(value) &&
    hasExactKeys(value, summaryKeys) &&
    boundedCount(value['irNodes'], RUNTIME_LIMITS.irNodesPerCatalog) &&
    boundedCount(value['depth'], RUNTIME_LIMITS.jsonDepth) &&
    boundedCount(value['selectors'], RUNTIME_LIMITS.selectorsPerMessage) &&
    boundedCount(value['variants'], RUNTIME_LIMITS.variantsPerMessage) &&
    boundedCount(value['inputs'], RUNTIME_LIMITS.inputsPerMessage) &&
    boundedCount(value['slots'], RUNTIME_LIMITS.slotsPerMessage) &&
    boundedCount(value['outputParts'], RUNTIME_LIMITS.outputPartsPerMessage)
  );
}

function validResources(value: unknown): value is CatalogResourceSummary {
  return (
    isDataRecord(value) &&
    hasExactKeys(value, [
      'profile',
      'decodedBytes',
      'messages',
      'identifiers',
      'literals',
      'irNodes',
      'depth',
      'selectors',
      'variants',
      'inputs',
      'slots',
      'references',
      'functions',
      'outputParts',
      'maximumMessage',
    ]) &&
    value['profile'] === RESOURCE_SUMMARY_PROFILE &&
    boundedCount(value['decodedBytes'], RUNTIME_LIMITS.catalogBytes) &&
    boundedCount(value['messages'], RUNTIME_LIMITS.messagesPerCatalog) &&
    boundedCount(value['identifiers'], RUNTIME_LIMITS.identifiersPerCatalog) &&
    boundedCount(value['literals'], RUNTIME_LIMITS.literalsPerCatalog) &&
    boundedCount(value['irNodes'], RUNTIME_LIMITS.irNodesPerCatalog) &&
    boundedCount(value['depth'], RUNTIME_LIMITS.jsonDepth) &&
    boundedCount(value['selectors'], RUNTIME_LIMITS.selectorsPerCatalog) &&
    boundedCount(value['variants'], RUNTIME_LIMITS.variantsPerCatalog) &&
    boundedCount(value['inputs'], RUNTIME_LIMITS.inputsPerCatalog) &&
    boundedCount(value['slots'], RUNTIME_LIMITS.slotsPerCatalog) &&
    boundedCount(value['references'], RUNTIME_LIMITS.referencesPerCatalog) &&
    boundedCount(value['functions'], RUNTIME_LIMITS.functionsPerCatalog) &&
    boundedCount(value['outputParts'], RUNTIME_LIMITS.outputPartsPerCatalog) &&
    validMessageSummary(value['maximumMessage'])
  );
}

/**
 * A catalog set as it arrives, with every stamp in it still unread.
 *
 * The four addresses on an artifact say which compiler wrote it, which schema it follows and which
 * standards profile it was compiled under. Those are the fields a stale or substituted artifact
 * gets wrong, so they carry what was read until `assertDescriptor` has compared them.
 */
type ReceivedCatalogSetDescriptor = Omit<
  CatalogSetDescriptor,
  'profile' | 'generatedAbi' | 'providers'
> & {
  readonly profile: unknown;
  readonly generatedAbi: unknown;
  readonly providers: readonly ReceivedProviderCatalogSet[];
};

type ReceivedProviderCatalogSet = Omit<ProviderCatalogSet, 'artifacts'> & {
  readonly artifacts: readonly ReceivedCatalogSetArtifact[];
};

type ReceivedCatalogSetArtifact = Omit<CatalogSetArtifact, 'address'> & {
  readonly address: AsReceived<
    ArtifactAddress,
    'compiledIrProfile' | 'schema' | 'standardsProfile' | 'generatedAbi'
  >;
};

/**
 * The artifacts of a set that agrees with its configuration.
 *
 * Both values are inert copies by now, so reading a member runs no code of the application and the
 * only thing a read can throw is the `TypeError` of a member that is missing or of another shape.
 * That is a set the toolkit did not write, and it is refused as one. Every fault the comparison
 * itself finds is thrown as the configuration failure already and passes through.
 */
function assertDescriptor(
  configuration: AsReceived<GeneratedConfiguration, 'generatedAbi'>,
  descriptor: ReceivedCatalogSetDescriptor,
  loaders: CatalogLoaders,
  contextTimeZone: boolean,
): ReadonlyMap<string, CatalogSetArtifact> {
  try {
    return comparedArtifacts(
      configuration,
      descriptor,
      loaders,
      contextTimeZone,
    );
  } catch (cause) {
    if (cause instanceof LocalizationError) throw cause;
    throw new LocalizationError(
      operationalDiagnostic(
        'invalid-configuration',
        'The generated catalog set or its configuration is malformed.',
      ),
      { cause },
    );
  }
}

/**
 * Everything about a generated set that can be settled before a single catalog is loaded.
 *
 * The list is `specs/05-compiled-artifacts-and-trust.spec.md` section 4: the profiles, the
 * generated ABI, both fingerprints, a configured scope and locale, supported features, a well
 * formed digest, a summary inside the ceilings, no repeated identity, and a loader for every
 * entry. It runs once at construction, because none of it depends on a request.
 */
function comparedArtifacts(
  configuration: AsReceived<GeneratedConfiguration, 'generatedAbi'>,
  descriptor: ReceivedCatalogSetDescriptor,
  loaders: CatalogLoaders,
  contextTimeZone: boolean,
): ReadonlyMap<string, CatalogSetArtifact> {
  if (
    configuration.generatedAbi !== GENERATED_ABI ||
    descriptor.profile !== CATALOG_SET_PROFILE ||
    descriptor.generatedAbi !== configuration.generatedAbi ||
    descriptor.applicationContractFingerprint !==
      configuration.applicationContractFingerprint ||
    descriptor.semanticRegistryFingerprint !==
      configuration.semanticRegistryFingerprint
  ) {
    throw new LocalizationError(
      operationalDiagnostic(
        'invalid-configuration',
        'Generated localization configuration and catalog-set identities do not match.',
      ),
    );
  }

  const knownScopes = new Map(
    configuration.scopes.map((scope) => [scopeIdentity(scope), scope]),
  );
  const artifacts = new Map<string, CatalogSetArtifact>();
  for (const provider of descriptor.providers) {
    if (
      provider.providerId.length === 0 ||
      provider.catalogSetId.length === 0
    ) {
      throw new LocalizationError(
        operationalDiagnostic(
          'invalid-configuration',
          'A generated provider catalog set has an invalid identity.',
        ),
      );
    }
    for (const artifact of provider.artifacts) {
      const { address } = artifact;
      const scope = knownScopes.get(scopeIdentity(address.key));
      const key = catalogIdentity(
        address.key.providerId,
        address.key.scopeId,
        address.key.catalogLocale,
      );
      // The one feature an application supplies rather than the runtime. A message that writes no
      // zone formats in the context's, and a context without one is a behavior the standard leaves
      // open, which `specs/04-message-authoring-and-catalogs.spec.md` section 6 refuses before
      // render rather than at the first date a reader is shown.
      if (
        !contextTimeZone &&
        Array.isArray(address.requiredFeatures) &&
        address.requiredFeatures.includes('context-time-zone')
      ) {
        throw new LocalizationError(
          operationalDiagnostic(
            'invalid-configuration',
            `Catalog ${key} formats a date or a time in the formatting context's time zone, and this application configured no time zone. Name one with withFormattingContext({ timeZone: 'UTC' }), or write timeZone on each date expression.`,
            artifact,
          ),
        );
      }
      if (
        scope === undefined ||
        provider.providerId !== address.key.providerId ||
        !configuration.locales.includes(address.key.catalogLocale) ||
        address.compiledIrProfile !== COMPILED_IR_PROFILE ||
        address.schema !== 'equator-compiled-catalog/1' ||
        address.standardsProfile !== 'equator-1' ||
        address.generatedAbi !== configuration.generatedAbi ||
        address.applicationContractFingerprint !==
          scope.applicationContractFingerprint ||
        address.semanticRegistryFingerprint !==
          scope.semanticRegistryFingerprint ||
        // Asked before the two lists are compared: an entry and a scope that both state no list
        // would otherwise agree, and the entry would pass here and be refused at every load.
        !Array.isArray(address.requiredExtensions) ||
        canonicalize(address.requiredExtensions) !==
          canonicalize(scope.requiredExtensions) ||
        !/^sha256-[A-Za-z0-9_-]{43}$/u.test(address.contentDigest) ||
        !validResources(artifact.resources) ||
        !Array.isArray(address.requiredFeatures) ||
        address.requiredFeatures.some(
          (feature) => !supportedArtifactFeatures.has(feature),
        ) ||
        artifacts.has(key) ||
        // An own entry of the loader map is a function: `copyLoaders` admitted nothing else.
        !hasOwn(loaders, key)
      ) {
        throw new LocalizationError(
          operationalDiagnostic(
            'invalid-configuration',
            `Generated catalog descriptor entry ${key} is invalid or unsupported.`,
            artifact,
          ),
        );
      }
      // Past the check above, every stamp on this entry has been read and compared, so it is a
      // descriptor entry rather than something claiming to be one.
      artifacts.set(key, artifact as CatalogSetArtifact);
    }
  }
  if (artifacts.size === 0) {
    throw new LocalizationError(
      operationalDiagnostic(
        'invalid-configuration',
        'The generated catalog set contains no local artifacts.',
      ),
    );
  }
  return artifacts;
}

/**
 * The loader map, copied into a frozen null-prototype record before anything uses it.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 8 requires the copy and the refusal of an
 * accessor. A map held by reference can gain an entry after it was checked, and a getter would run
 * consumer code at every lookup.
 */
function copyLoaders(candidate: CatalogLoaders): CatalogLoaders {
  if (!isDataRecord(candidate)) {
    throw new LocalizationError(
      operationalDiagnostic(
        'invalid-configuration',
        'Generated catalog loaders must be a plain own-property map.',
      ),
    );
  }
  const properties = Object.getOwnPropertyDescriptors(candidate);
  if (
    Reflect.ownKeys(candidate).some(
      (property) => typeof property !== 'string',
    ) ||
    Object.keys(properties).length > RUNTIME_LIMITS.jsonNodes
  ) {
    throw new LocalizationError(
      operationalDiagnostic(
        'invalid-configuration',
        'Generated catalog loaders exceed the fixed loader-map ceiling.',
      ),
    );
  }
  const copied = Object.create(null) as Record<string, () => unknown>;
  for (const [identity, property] of Object.entries(properties)) {
    // Read from the descriptor, where an accessor has no value, so one is refused without being
    // run.
    if (typeof property.value !== 'function') {
      throw new LocalizationError(
        operationalDiagnostic(
          'invalid-configuration',
          'Generated catalog loaders must contain only data functions.',
        ),
      );
    }
    copied[identity] = property.value as () => unknown;
  }
  return Object.freeze(copied);
}

function sameKey(left: CatalogKey, right: CatalogKey): boolean {
  return (
    left.providerId === right.providerId &&
    left.scopeId === right.scopeId &&
    left.catalogLocale === right.catalogLocale
  );
}

function sameResources(
  left: CatalogResourceSummary,
  right: CatalogResourceSummary,
): boolean {
  return canonicalize(left) === canonicalize(right);
}

interface JsonMetrics {
  readonly nodes: number;
  readonly depth: number;
  readonly literals: number;
  readonly references: number;
  readonly functions: number;
}

function jsonMetrics(value: unknown, depth = 1): JsonMetrics {
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
    : Object.values(value as Readonly<Record<string, unknown>>);
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
    const record = value as Readonly<Record<string, unknown>>;
    if (record['kind'] === 'variable') references += 1;
    if (isDataRecord(record['function'])) functions += 1;
  }
  return {
    nodes,
    depth: maximumDepth,
    literals,
    references,
    functions,
  };
}

function validInputContract(value: unknown): boolean {
  if (
    !isDataRecord(value) ||
    !hasExactKeys(
      value,
      ['name', 'type', 'optional', 'nullable'],
      ['enum', 'description'],
    ) ||
    typeof value['name'] !== 'string' ||
    value['name'].length === 0 ||
    value['name'].length > 128 ||
    !['boolean', 'date-time', 'integer', 'number', 'string'].includes(
      String(value['type']),
    ) ||
    typeof value['optional'] !== 'boolean' ||
    typeof value['nullable'] !== 'boolean' ||
    (value['description'] !== undefined &&
      (typeof value['description'] !== 'string' ||
        value['description'].length > 2_048))
  ) {
    return false;
  }
  const enumeration = value['enum'];
  return (
    enumeration === undefined ||
    (Array.isArray(enumeration) &&
      enumeration.length <= RUNTIME_LIMITS.extensionOptionValues &&
      enumeration.every((item) =>
        ['string', 'number', 'boolean'].includes(typeof item),
      ) &&
      new Set(enumeration).size === enumeration.length)
  );
}

function validSlotContract(value: unknown): boolean {
  return (
    isDataRecord(value) &&
    hasExactKeys(
      value,
      ['name', 'kind', 'shape', 'optional', 'repeatable', 'within'],
      ['description'],
    ) &&
    typeof value['name'] === 'string' &&
    value['name'].length > 0 &&
    value['name'].length <= 128 &&
    typeof value['kind'] === 'string' &&
    value['kind'].length > 0 &&
    value['kind'].length <= 128 &&
    ['paired', 'standalone'].includes(String(value['shape'])) &&
    typeof value['optional'] === 'boolean' &&
    typeof value['repeatable'] === 'boolean' &&
    Array.isArray(value['within']) &&
    value['within'].length <= RUNTIME_LIMITS.slotsPerMessage &&
    value['within'].every(
      (item) => typeof item === 'string' && item.length <= 128,
    ) &&
    (value['description'] === undefined ||
      (typeof value['description'] === 'string' &&
        value['description'].length <= 2_048))
  );
}

function outputPartCount(body: Readonly<Record<string, unknown>>): number {
  if (body['kind'] === 'pattern' && Array.isArray(body['pattern'])) {
    return body['pattern'].length;
  }
  if (body['kind'] !== 'select' || !Array.isArray(body['variants'])) return 0;
  let total = 0;
  for (const variant of body['variants']) {
    if (!isDataRecord(variant) || !Array.isArray(variant['pattern'])) {
      throw new TypeError('A catalog selection variant is malformed.');
    }
    total += variant['pattern'].length;
  }
  return total;
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

/**
 * The same measures the toolkit took, taken from the candidate rather than read off it.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 7 requires the comparison. A catalog
 * reporting a small summary while carrying a large body would otherwise pass every ceiling check
 * and then cost what the body costs.
 */
function remeasureCatalog(catalog: CompiledCatalog): CatalogResourceSummary {
  let identifiers = 0;
  let literals = 0;
  let irNodes = 0;
  let depth = 0;
  let selectors = 0;
  let variants = 0;
  let inputs = 0;
  let slots = 0;
  let references = 0;
  let functions = 0;
  let outputParts = 0;
  let maximumMessage = emptyMessageMaximum();
  const identities = new Set<string>();
  for (const message of catalog.messages) {
    if (
      !isDataRecord(message) ||
      !hasExactKeys(message, [
        'messageId',
        'kind',
        'resultKind',
        'sourceFingerprint',
        'inputs',
        'slots',
        'body',
      ]) ||
      typeof message.messageId !== 'string' ||
      message.messageId.length === 0 ||
      message.messageId.length > 1_024 ||
      identities.has(message.messageId) ||
      !['empty', 'message'].includes(String(message.kind)) ||
      !['plain', 'structured'].includes(String(message.resultKind)) ||
      typeof message.sourceFingerprint !== 'string' ||
      !/^sha256-[A-Za-z0-9_-]{43}$/u.test(message.sourceFingerprint) ||
      !Array.isArray(message.inputs) ||
      !message.inputs.every(validInputContract) ||
      !Array.isArray(message.slots) ||
      !message.slots.every(validSlotContract) ||
      !isDataRecord(message.body)
    ) {
      throw new TypeError('Catalog message structure is invalid.');
    }
    identities.add(message.messageId);
    const body = message.body;
    const bodyKind = body['kind'];
    if (
      (message.kind === 'empty' &&
        (bodyKind !== 'empty' || !hasExactKeys(body, ['kind']))) ||
      (message.kind === 'message' &&
        !['pattern', 'select'].includes(String(bodyKind))) ||
      (bodyKind === 'pattern' &&
        (!Array.isArray(body['declarations']) ||
          !Array.isArray(body['pattern']))) ||
      (bodyKind === 'select' &&
        (!Array.isArray(body['declarations']) ||
          !Array.isArray(body['selectors']) ||
          !Array.isArray(body['variants'])))
    ) {
      throw new TypeError('Catalog message body is invalid.');
    }
    const metrics = jsonMetrics(body);
    const messageSelectors =
      bodyKind === 'select'
        ? (body['selectors'] as readonly unknown[]).length
        : 0;
    const messageVariants =
      bodyKind === 'select'
        ? (body['variants'] as readonly unknown[]).length
        : 0;
    const messageOutputParts = outputPartCount(body);
    // Held to the per-message ceilings once, as the largest message of the measured summary: a
    // message past one of them is the largest by that count.
    const summary = Object.freeze({
      irNodes: metrics.nodes,
      depth: metrics.depth,
      selectors: messageSelectors,
      variants: messageVariants,
      inputs: message.inputs.length,
      slots: message.slots.length,
      outputParts: messageOutputParts,
    });
    identifiers +=
      message.messageId.split('.').length +
      message.inputs.length +
      message.slots.length;
    literals += metrics.literals;
    irNodes += metrics.nodes;
    depth = Math.max(depth, metrics.depth);
    selectors += messageSelectors;
    variants += messageVariants;
    inputs += message.inputs.length;
    slots += message.slots.length;
    references += metrics.references;
    functions += metrics.functions;
    outputParts += messageOutputParts;
    maximumMessage = Object.freeze({
      irNodes: Math.max(maximumMessage.irNodes, summary.irNodes),
      depth: Math.max(maximumMessage.depth, summary.depth),
      selectors: Math.max(maximumMessage.selectors, summary.selectors),
      variants: Math.max(maximumMessage.variants, summary.variants),
      inputs: Math.max(maximumMessage.inputs, summary.inputs),
      slots: Math.max(maximumMessage.slots, summary.slots),
      outputParts: Math.max(maximumMessage.outputParts, summary.outputParts),
    });
  }
  const base = {
    profile: catalog.profile,
    generatedAbi: catalog.generatedAbi,
    standardsProfile: catalog.standardsProfile,
    key: catalog.key,
    applicationContractFingerprint: catalog.applicationContractFingerprint,
    semanticRegistryFingerprint: catalog.semanticRegistryFingerprint,
    requiredExtensions: catalog.requiredExtensions,
    messages: catalog.messages,
  };
  const measured = Object.freeze({
    profile: RESOURCE_SUMMARY_PROFILE,
    decodedBytes: new TextEncoder().encode(canonicalize(base)).byteLength,
    messages: catalog.messages.length,
    identifiers,
    literals,
    irNodes,
    depth,
    selectors,
    variants,
    inputs,
    slots,
    references,
    functions,
    outputParts,
    maximumMessage,
  });
  if (!validResources(measured)) {
    throw new TypeError('Catalog resources exceed fixed runtime ceilings.');
  }
  return measured;
}

/**
 * Admission is deterministic and expensive: a deep inert-JSON snapshot of the whole catalog, a
 * full re-measure of its resources, and a SHA-256 digest over its canonical form. Every one of
 * those is O(catalog size), and running them again for each request-scoped context makes server
 * rendering pay for the catalog on every request rather than once for the process.
 *
 * The result is a pure function of the artifact address, which already carries the content digest,
 * the generated ABI, the standards profile, the catalog key and both fingerprints. Two admissions
 * of the same address cannot differ, so the verified result is reused.
 *
 * This is process-level state, and `specs/06-runtime-and-angular.spec.md` section 6 shares
 * nothing between contexts except immutable catalog artifacts whose identity proves them
 * interchangeable. It does not conflict: what that rule protects is anything that could
 * let one request observe another: active locale, direction, formatting context, transaction
 * state. Entries here are frozen inert snapshots keyed by their own content digest, so a hit
 * returns a value identical to what admission would have produced. Nothing request-shaped is
 * stored, and nothing stored can be mutated.
 *
 * Only successfully admitted catalogs are cached; a rejected candidate is never remembered.
 *
 * Keyed on the identity of the candidate object, not on the artifact address alone. Admission
 * exists to distrust the candidate, so "this address was verified once" must never stand in for
 * "this value is valid": a tampered catalog offered for an already-admitted address has to be
 * rejected on its own terms. A generated loader resolves the same frozen module export on every
 * call, so the server-rendering path hits; anything else is a different object and is verified in
 * full.
 *
 * A WeakMap needs no eviction policy: an entry cannot outlive the candidate it describes.
 *
 * Residual, stated rather than hidden: a candidate object mutated in place *after* it was admitted
 * would be served from its earlier verified snapshot rather than re-rejected. Generated catalogs
 * are frozen module exports, so this is not reachable through the supported path, and the stored
 * value is Equator's own inert snapshot which the mutation cannot reach.
 */
const admittedCatalogs = new WeakMap<
  object,
  { readonly key: string; readonly catalog: CompiledCatalog }
>();

function admissionKey(artifact: CatalogSetArtifact): string {
  const { address } = artifact;
  return [
    address.contentDigest,
    address.generatedAbi,
    address.standardsProfile,
    address.applicationContractFingerprint,
    address.semanticRegistryFingerprint,
    address.key.providerId,
    address.key.scopeId,
    address.key.catalogLocale,
  ].join('\u0000');
}

/**
 * The candidate, checked against the address it was offered for.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 4 is the order: the inert snapshot first,
 * then the exact field set, then identity against the address, then the resource summary
 * re-measured from the content, then the digest. The cheap refusals come before the expensive ones,
 * and nothing that fails is remembered.
 */
async function admitCatalog(
  candidate: unknown,
  artifact: CatalogSetArtifact,
): Promise<CompiledCatalog> {
  const key = admissionKey(artifact);
  const cacheable = typeof candidate === 'object' && candidate !== null;
  if (cacheable) {
    const admitted = admittedCatalogs.get(candidate as object);
    // The address must match too: one object must never be admitted for a scope or locale other
    // than the one it was verified against.
    if (admitted !== undefined && admitted.key === key) return admitted.catalog;
  }
  try {
    const snapshot = snapshotInertJson(candidate, {
      maximumDepth: RUNTIME_LIMITS.jsonDepth + 8,
      maximumNodes: RUNTIME_LIMITS.jsonNodes,
      maximumCodeUnits: RUNTIME_LIMITS.catalogBytes,
    });
    if (
      snapshot.utf8Bytes > RUNTIME_LIMITS.catalogBytes + 65_536 ||
      !isDataRecord(snapshot.value)
    ) {
      throw new TypeError('Catalog exceeds its encoded runtime ceiling.');
    }
    const received = snapshot.value as unknown as AsReceived<
      CompiledCatalog,
      'profile' | 'generatedAbi' | 'standardsProfile'
    >;
    if (
      !hasExactKeys(received as unknown as Readonly<Record<string, unknown>>, [
        'profile',
        'generatedAbi',
        'standardsProfile',
        'key',
        'applicationContractFingerprint',
        'semanticRegistryFingerprint',
        'requiredExtensions',
        'messages',
        'resources',
      ]) ||
      received.profile !== COMPILED_IR_PROFILE ||
      received.generatedAbi !== artifact.address.generatedAbi ||
      received.standardsProfile !== artifact.address.standardsProfile ||
      !isDataRecord(received.key) ||
      !sameKey(received.key, artifact.address.key) ||
      received.applicationContractFingerprint !==
        artifact.address.applicationContractFingerprint ||
      received.semanticRegistryFingerprint !==
        artifact.address.semanticRegistryFingerprint ||
      canonicalize(received.requiredExtensions) !==
        canonicalize(artifact.address.requiredExtensions) ||
      !Array.isArray(received.messages) ||
      !validResources(received.resources) ||
      !sameResources(received.resources, artifact.resources) ||
      received.messages.length !== received.resources.messages
    ) {
      throw new TypeError('Catalog identity or resource summary mismatch.');
    }
    // The key set is exact and every stamp has been read, so the declared shape now describes
    // this value instead of being claimed over it.
    const catalog = received as CompiledCatalog;
    const measured = remeasureCatalog(catalog);
    if (!sameResources(measured, catalog.resources)) {
      throw new LocalizationError(
        operationalDiagnostic(
          'catalog-admission-failed',
          'A generated local catalog reported a resource summary that does not match its measured content.',
          artifact,
          'integrity-mismatch',
        ),
      );
    }
    if (
      (await digestCanonicalCatalog(catalog)) !== artifact.address.contentDigest
    ) {
      throw new LocalizationError(
        operationalDiagnostic(
          'catalog-admission-failed',
          'A generated local catalog does not match the content digest recorded for it.',
          artifact,
          'integrity-mismatch',
        ),
      );
    }
    if (cacheable) {
      admittedCatalogs.set(candidate as object, { key, catalog });
    }
    return catalog;
  } catch (cause) {
    // Admission failures Equator can name are thrown above with their specific reason; rethrow
    // those rather than collapsing them back into one generic message.
    if (cause instanceof LocalizationError) throw cause;
    throw new LocalizationError(
      operationalDiagnostic(
        'catalog-admission-failed',
        'A generated local catalog failed identity, compatibility, or admission.',
        artifact,
        'malformed-input',
      ),
      { cause },
    );
  }
}

function waitForCatalog(
  promise: Promise<CompiledCatalog>,
  signal: AbortSignal,
): Promise<CompiledCatalog> {
  return waitForSignal(promise, signal);
}

export class LocalCatalogStore {
  private readonly artifacts: ReadonlyMap<string, CatalogSetArtifact>;
  private readonly descriptor: CatalogSetDescriptor;
  private readonly loaders: CatalogLoaders;
  private readonly cache = new Map<string, CachedCatalog>();
  private readonly inFlight = new Map<string, Promise<CompiledCatalog>>();
  private clock = 0;
  private disposed = false;

  readonly maximumEntries: number;

  constructor(
    configuration: GeneratedConfiguration,
    descriptor: CatalogSetDescriptor,
    loaders: CatalogLoaders,
    maximumEntries?: number,
    contextTimeZone = false,
    private readonly observability?: LocalizationEventEmitter,
  ) {
    const admittedConfiguration = snapshotGeneratedJson(
      configuration,
      {
        maximumDepth: 32,
        maximumNodes: 250_000,
        maximumCodeUnits: 4_194_304,
      },
      'Generated localization configuration must be inert data.',
    ).value as AsReceived<GeneratedConfiguration, 'generatedAbi'>;
    const admittedDescriptor = snapshotGeneratedJson(
      descriptor,
      {
        maximumDepth: 32,
        maximumNodes: RUNTIME_LIMITS.jsonNodes,
        maximumCodeUnits: RUNTIME_LIMITS.transferBytes,
      },
      'Generated catalog set must be inert data.',
    ).value as ReceivedCatalogSetDescriptor;
    this.loaders = copyLoaders(loaders);
    this.artifacts = assertDescriptor(
      admittedConfiguration,
      admittedDescriptor,
      this.loaders,
      contextTimeZone,
    );
    // Everything the stamps claim has been compared against what the bytes hold, which is what
    // makes the declared type true of this value rather than asserted over it.
    this.descriptor = admittedDescriptor as CatalogSetDescriptor;
    const limit = maximumEntries ?? this.artifacts.size;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > this.artifacts.size
    ) {
      throw new LocalizationError(
        operationalDiagnostic(
          'invalid-configuration',
          `maximumCachedCatalogs must be an integer from 1 through ${this.artifacts.size}.`,
        ),
      );
    }
    this.maximumEntries = limit;
  }

  get artifactCount(): number {
    return this.artifacts.size;
  }

  get cachedCount(): number {
    return this.cache.size;
  }

  has(scope: LocalizationScope, locale: string): boolean {
    return this.artifacts.has(
      catalogIdentity(scope.providerId, scope.scopeId, locale),
    );
  }

  catalogSetIds(): Readonly<Record<string, string>> {
    return Object.freeze(
      Object.fromEntries(
        this.descriptor.providers.map((provider) => [
          provider.providerId,
          provider.catalogSetId,
        ]),
      ),
    );
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new LocalizationError(
        operationalDiagnostic(
          'disposed',
          'The localization context is disposed.',
        ),
      );
    }
  }

  private artifact(
    scope: LocalizationScope,
    locale: string,
  ): CatalogSetArtifact {
    const artifact = this.artifacts.get(
      catalogIdentity(scope.providerId, scope.scopeId, locale),
    );
    if (artifact === undefined) {
      throw new LocalizationError(unavailableDiagnostic(scope, locale));
    }
    return artifact;
  }

  private touch(entry: CachedCatalog): void {
    entry.lastUsed = this.clock += 1;
  }

  /**
   * The cache entry for a catalog identity, counted as used, and made where there is none.
   *
   * An entry carries the count of the leases on it. A catalog offered for an identity that is
   * already cached was admitted for the same address, so it is the same content, and the entry
   * stays with its leases: `specs/05-compiled-artifacts-and-trust.spec.md` section 9 never lets go
   * of a catalog that is held, and a fresh entry would have forgotten who holds it.
   */
  private retain(key: string, catalog: CompiledCatalog): CachedCatalog {
    let entry = this.cache.get(key);
    if (entry === undefined) {
      entry = { catalog, pins: 0, lastUsed: 0 };
      this.cache.set(key, entry);
    }
    this.touch(entry);
    return entry;
  }

  /**
   * The least recently used entry among the ones nobody is holding.
   *
   * `specs/05-compiled-artifacts-and-trust.spec.md` section 9 pins what is in use, so eviction can
   * run at any moment without taking a catalog out from under an active snapshot. When everything
   * is pinned the cache stays over its bound until a lease is released, because the bound governs
   * how long a catalog is kept after use rather than how many may be in use at once.
   */
  private evict(): void {
    while (this.cache.size > this.maximumEntries) {
      const candidate = [...this.cache.entries()]
        .filter(([, entry]) => entry.pins === 0)
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (candidate === undefined) {
        this.observability?.emit({
          code: RUNTIME_EVENT_CODES.cache,
          phase: 'cache',
          status: 'unavailable',
          count: this.cache.size,
        });
        return;
      }
      this.cache.delete(candidate[0]);
      const { key } = candidate[1].catalog;
      this.observability?.emit({
        code: RUNTIME_EVENT_CODES.cache,
        phase: 'cache',
        status: 'succeeded',
        providerId: key.providerId,
        scopeId: key.scopeId,
        targetLocale: key.catalogLocale,
        count: this.cache.size,
      });
    }
  }

  /**
   * One load per catalog identity, shared by everyone who asks while it is running.
   *
   * `specs/05-compiled-artifacts-and-trust.spec.md` section 9 requires the join rather than a
   * second load. `specs/05-compiled-artifacts-and-trust.spec.md` section 8 is why a missing
   * artifact raises an unavailable outcome here instead of a load failure: nothing failed, the
   * scope was never translated into that locale.
   */
  private loadShared(
    scope: LocalizationScope,
    locale: string,
  ): Promise<CompiledCatalog> {
    this.assertActive();
    const artifact = this.artifact(scope, locale);
    const key = catalogIdentity(scope.providerId, scope.scopeId, locale);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.touch(cached);
      return Promise.resolve(cached.catalog);
    }
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;

    const promise = Promise.resolve()
      .then(() => (this.loaders[key] as () => unknown)())
      .catch((cause: unknown) => {
        throw new LocalizationError(
          operationalDiagnostic(
            'catalog-load-failed',
            'A generated local catalog module could not be loaded.',
            artifact,
            'module-load-failed',
          ),
          { cause },
        );
      })
      .then((candidate) => admitCatalog(candidate, artifact))
      .then((catalog) => {
        // Not evicted here: a caller acquiring this catalog pins it after the load settles, and
        // evicting first would drop the entry that caller is about to hold. Each caller evicts
        // once what it holds is pinned.
        if (!this.disposed) this.retain(key, catalog);
        return catalog;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  async acquire(
    scope: LocalizationScope,
    locale: string,
    signal: AbortSignal,
  ): Promise<CatalogLease> {
    const key = catalogIdentity(scope.providerId, scope.scopeId, locale);
    const catalog = await waitForCatalog(
      this.loadShared(scope, locale),
      signal,
    );
    this.assertActive();
    const entry = this.retain(key, catalog);
    entry.pins += 1;
    let released = false;
    return Object.freeze({
      key,
      catalog,
      release: () => {
        if (released) return;
        released = true;
        // The entry this lease pinned, which is still the cached one unless the store was
        // disposed: a pinned entry is never let go of and never replaced.
        entry.pins -= 1;
        this.evict();
      },
    });
  }

  async preload(
    scope: LocalizationScope,
    locale: string,
    signal: AbortSignal,
  ): Promise<void> {
    await waitForCatalog(this.loadShared(scope, locale), signal);
    this.assertActive();
    this.evict();
  }

  async seed(candidate: unknown, signal?: AbortSignal): Promise<void> {
    this.assertActive();
    const operationSignal = signal ?? new AbortController().signal;
    // The signal a context hands over is its own lifetime's, which is aborted only by disposal and
    // always with the disposed failure, so an aborted signal carries the failure to throw.
    if (aborted(operationSignal)) throw operationSignal.reason;
    let snapshot: InertJsonSnapshot;
    try {
      snapshot = snapshotInertJson(candidate, {
        maximumDepth: RUNTIME_LIMITS.jsonDepth + 8,
        maximumNodes: RUNTIME_LIMITS.jsonNodes,
        maximumCodeUnits: RUNTIME_LIMITS.catalogBytes,
      });
    } catch {
      return;
    }
    if (!isDataRecord(snapshot.value) || !isDataRecord(snapshot.value['key']))
      return;
    const keyRecord = snapshot.value['key'];
    if (
      typeof keyRecord['providerId'] !== 'string' ||
      typeof keyRecord['scopeId'] !== 'string' ||
      typeof keyRecord['catalogLocale'] !== 'string'
    ) {
      return;
    }
    const key = catalogIdentity(
      keyRecord['providerId'],
      keyRecord['scopeId'],
      keyRecord['catalogLocale'],
    );
    const artifact = this.artifacts.get(key);
    if (artifact === undefined) return;
    // A refused transfer costs nothing visible, because the catalog is loaded instead, so this is
    // the only place a server sending catalogs the browser cannot admit shows up.
    const admission = admitCatalog(snapshot.value, artifact);
    admission.catch(() =>
      this.observability?.emit({
        code: RUNTIME_EVENT_CODES.cache,
        phase: 'cache',
        status: 'failed',
        reason: 'catalog-admission-failed',
        providerId: keyRecord['providerId'] as string,
        scopeId: keyRecord['scopeId'] as string,
        targetLocale: keyRecord['catalogLocale'] as string,
      }),
    );
    const catalog = await waitForSignal(admission, operationSignal);
    this.assertActive();
    if (aborted(operationSignal)) throw operationSignal.reason;
    this.retain(key, catalog);
    this.evict();
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
  }
}
