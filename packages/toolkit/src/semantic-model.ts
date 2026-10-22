/**
 * What a parsed message means, and what a markup name in one is allowed to be.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 5 keeps arbitrary HTML out of the message
 * surface, so a markup name resolves to a semantic slot here and never to an element, a
 * component, a template, or an import. An interactive slot cannot contain or be contained by
 * another, because there is no way for a reader to reach the inner one.
 */

import {
  toolkitDiagnostic,
  toolkitFailure,
  toolkitSuccess,
  type ToolkitDiagnostic,
  type ToolkitDiagnosticCode,
  type ToolkitResult,
} from './diagnostics.js';
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from './canonical-json.js';
import { catalogPathAnchor } from './catalog.js';
import type {
  Catalog,
  CatalogFamily,
  CatalogMessage,
  InputLiteral,
  InputRefinement,
  SlotShape,
} from './catalog.js';
import {
  PLURAL_SELECTOR_FUNCTIONS,
  type MessageExpression,
  type MessageFunctionReference,
  type MessagePattern,
  type MessageSemanticModel,
  type MessageValueReference,
} from './message-format.js';
import { localeFallbackChain, type CanonicalLocale } from './locales.js';
import {
  COMPLETENESS_CODES,
  completenessPolicy,
  type CompletenessPolicy,
  type LocaleFormatting,
  type ProjectConfiguration,
} from './configuration.js';
import {
  CARDINAL_PLURAL_CATEGORIES,
  ORDINAL_PLURAL_CATEGORIES,
} from './plural-categories.generated.js';
import {
  extensionOptionValue,
  extensionOptionValueAllowed,
} from './message-format-syntax.js';
import { RESOURCE_LIMITS } from './resource-limits.js';
import {
  extensionDescriptor,
  type ExtensionDescriptor,
  type ExtensionRegistry,
  type ExtensionValueType,
  type RichSlotKindDescriptorInput,
} from './extensions.js';
import { compareCodeUnit, frozenRecord } from './sorted-records.js';

/**
 * The version stamp on the interface between generated code and the runtime.
 *
 * It changes when that interface changes, so generated code from one version of Equator and a
 * runtime from another refuse each other rather than half working.
 */
export const GENERATED_ABI_PROFILE = 'equator-generated/1' as const;
export const APPLICATION_CONTRACT_PROFILE =
  'equator-application-contract/1' as const;
export const SEMANTIC_REGISTRY_PROFILE = 'equator-semantic-registry/1' as const;

/**
 * The five value types a message input can have, as they cross the boundary into generated code.
 *
 * Deliberately few and deliberately portable: these are the types every host Equator targets can
 * represent the same way, so a contract means the same thing on a server and in a browser.
 */
export type PortableTypeId =
  'boolean' | 'date-time' | 'integer' | 'number' | 'string';

/**
 * What a caller must pass for one of a message's inputs, after the analysis has settled it.
 *
 * Effective, because it is the author's declaration combined with how the message actually uses the
 * value. A message that formats a name as a number has a number here whatever the catalog said.
 */
export interface EffectiveInputContract {
  /** The name the caller passes it under. */
  readonly name: string;
  /** Which of the five portable types it is. */
  readonly type: PortableTypeId;
  /** The exact values allowed, when the input is one of a closed set. */
  readonly enum?: readonly InputLiteral[];
  /** Whether the caller may leave it out. */
  readonly optional: boolean;
  /** Whether it may be passed as null. */
  readonly nullable: boolean;
  /** What it means, carried through into the generated code's own documentation. */
  readonly description?: string;
}

/**
 * What an application must bind for one of a message's named regions.
 *
 * Settled the same way as an input contract: what the author declared, reconciled with how every
 * translation of the message actually uses the slot.
 */
export interface EffectiveSlotContract {
  /** The name the binding is supplied under. */
  readonly name: string;
  /** What it renders as: a link, an emphasis, a projected template. */
  readonly kind: string;
  /** Whether it wraps text or marks a point. */
  readonly shape: SlotShape;
  /** Whether a translation may leave it out. */
  readonly optional: boolean;
  /** Whether a translation may use it more than once. */
  readonly repeatable: boolean;
  /** The slots it may appear inside. Empty means it is not constrained. */
  readonly within: readonly string[];
  /** What it is for. */
  readonly description?: string;
}

/** What one translation of a message looks like, as the analysis sees it. */
export interface SemanticTargetMessage {
  /** Which locale this translation is in. */
  readonly locale: CanonicalLocale;
  /** Whether it has been written yet. */
  readonly kind: CatalogMessage['kind'];
  /** The normalized text, so two equivalent spellings compare equal. Absent for an empty entry. */
  readonly canonicalSource?: string;
}

/**
 * One message across every locale it exists in, with the contract all of them share.
 *
 * The analysis's central unit. A message's contract is one thing even though its text is many, and
 * this is where that is expressed: the inputs and slots are settled across every translation, so a
 * translation that drops a slot is a problem rather than a second contract.
 */
export interface SemanticMessage {
  /** The package that owns it. */
  readonly providerId: string;
  /** The scope within that package. */
  readonly scopeId: string;
  /** Its key within that scope. */
  readonly messageId: string;
  /** The stable identity the runtime and the generated handle both use. */
  readonly identity: string;
  /** Whether it renders as a string or as parts. */
  readonly resultKind: 'plain' | 'structured';
  /** What a caller must pass. */
  readonly inputs: readonly EffectiveInputContract[];
  /** What an application must bind. */
  readonly slots: readonly EffectiveSlotContract[];
  /** A digest of the authored text, which is what tells a translation it has gone stale. */
  readonly sourceFingerprint: string;
  /** Every translation, including the locales where it has not been written yet. */
  readonly targets: readonly SemanticTargetMessage[];
}

/** One of the parts a family's messages vary over, and what a value for it may look like. */
export interface SemanticFamilySegment {
  /** What this part is called in the template. */
  readonly name: string;
  /** What kind of value it holds, either Equator's own message part or an extension's type. */
  readonly type: 'equator:native-message-part' | string;
  /** Which spelling a value must follow, which is what keeps generated names predictable. */
  readonly syntax: 'lower-kebab' | 'ascii-token' | 'unicode-token';
  /** The longest a value may be. */
  readonly maximumLength: number;
}

/** One message a family generated, and the segment values it came from. */
export interface SemanticFamilyMember {
  /** The key this member ended up with. */
  readonly messageId: string;
  /** The value substituted for each segment. */
  readonly segments: Readonly<Record<string, string>>;
}

/**
 * A set of messages generated from one template, with the contract every member shares.
 *
 * What makes a family worth having: the contract is declared once, so a caller can hold a member
 * chosen at runtime and still know what to pass it.
 */
export interface SemanticFamily {
  /** What the family is called. */
  readonly name: string;
  /** The key template the segments are substituted into. */
  readonly template: string;
  /** The parts the members vary over. */
  readonly segments: readonly SemanticFamilySegment[];
  /** Whether the members render as strings or as parts. All of them agree. */
  readonly resultKind: 'plain' | 'structured';
  /** What every member takes. */
  readonly inputs: readonly EffectiveInputContract[];
  /** What every member places. */
  readonly slots: readonly EffectiveSlotContract[];
  /** The messages the family produced. */
  readonly members: readonly SemanticFamilyMember[];
}

/**
 * An extension a compiled artifact needs registered before it can be evaluated.
 *
 * The same shape as the descriptor a plugin declares, named separately because it appears here as a
 * requirement rather than as a declaration.
 */
export type ReferencedExtension = ExtensionDescriptor;

/** One scope analysed: its messages, its families, and what is needed to compile them. */
export interface SemanticScope {
  /** The package that owns it. */
  readonly providerId: string;
  /** Its own identity within that package. */
  readonly scopeId: string;
  /** The locale its messages were authored in. */
  readonly sourceLocale: CanonicalLocale;
  /** Every locale this scope has a catalog for, including the source. */
  readonly availableLocales: readonly CanonicalLocale[];
  /** The messages, each across all its locales. */
  readonly messages: readonly SemanticMessage[];
  /** The families, each with its members. */
  readonly families: readonly SemanticFamily[];
  /** The extensions its messages call. */
  readonly requiredExtensions: readonly ReferencedExtension[];
  /** The application contract digest this scope contributes to. */
  readonly applicationContractFingerprint: string;
  /** The semantic registry digest it was analysed under. */
  readonly semanticRegistryFingerprint: string;
}

/**
 * The whole of a project's localization, analysed: every locale, every scope, every message.
 *
 * What `analyzeCatalogSet` produces and what compilation and generation both read. Nothing
 * downstream reads catalogs again, so a question about the project is answered here once rather
 * than re-derived by each step differently.
 */
export interface SemanticGraph {
  /** The generated interface version this graph is for. */
  readonly generatedAbi: typeof GENERATED_ABI_PROFILE;
  /** The locale messages are authored in. */
  readonly sourceLocale: CanonicalLocale;
  /** The locale used when nothing else selects one. */
  readonly defaultLocale: CanonicalLocale;
  /** Every locale the project builds, canonically spelled. */
  readonly locales: readonly CanonicalLocale[];
  /** The locales among those this build derived from the source catalog rather than authored. */
  readonly pseudoLocales: readonly CanonicalLocale[];
  /** Extra locales whose person-name patterns this owner generates. See the configuration key. */
  readonly personNameLocales: readonly CanonicalLocale[];
  /** Spellings that resolve to a built locale, so an old tag keeps working after a rename. */
  readonly aliases: Readonly<Record<string, CanonicalLocale>>;
  /** How each locale is written, where this owner disagrees with CLDR. See the configuration key. */
  readonly formatting: Readonly<Record<string, LocaleFormatting>>;
  /** Which locale each locale inherits from, where this owner disagrees with CLDR. */
  readonly parentLocales: Readonly<Record<string, CanonicalLocale>>;
  /** Every scope in the project, analysed. */
  readonly scopes: readonly SemanticScope[];
  /** Every extension the project's messages reference, across all its scopes. */
  readonly extensionDescriptors: readonly ReferencedExtension[];
  /**
   * A digest of every message contract in the project.
   *
   * What tells a compiled catalog whether the application it was built for still has the same
   * messages, without comparing them one by one.
   */
  readonly applicationContractFingerprint: string;
  /** A digest of the registry the analysis ran against, which moves when an extension changes. */
  readonly semanticRegistryFingerprint: string;
}

export interface CatalogSetAnalysisRequest {
  readonly configuration: ProjectConfiguration;
  readonly catalogs: readonly Catalog[];
  readonly extensions?: ExtensionRegistry;
  /**
   * Treat a target catalog that omits a required source message as an error rather than a warning.
   *
   * Off by default because English lands before Arabic in ordinary authoring order, so erroring
   * during development would break the dev loop on every new message and train a team to bypass
   * the check. Release is where completeness is required, which is what `equator check
   * --require-complete` turns on.
   */
  readonly requireCompleteTargets?: boolean;
}

/**
 * The operand types a message's functions give each external input.
 *
 * A reference no function annotates gives none: its input is text unless another use says more.
 */
type InputUsages = Map<string, Set<PortableTypeId>>;

interface PatternSlotSummary {
  readonly counts: ReadonlyMap<string, number>;
  readonly parents: ReadonlyMap<string, ReadonlySet<string>>;
  readonly shapes: ReadonlyMap<string, ReadonlySet<SlotShape>>;
}

function validateCustomSlotOptions(
  catalog: Catalog,
  messageId: string,
  slotName: string,
  options: MessagePattern extends readonly (infer Part)[]
    ? Part extends { readonly options: infer Options }
      ? Options
      : never
    : never,
  declared: Readonly<RichSlotKindDescriptorInput>['options'],
  diagnostics: ToolkitDiagnostic[],
): void {
  for (const [name, value] of Object.entries(
    options as Readonly<Record<string, MessageValueReference>>,
  )) {
    const allowed = declared?.[name];
    if (
      allowed === undefined ||
      value.kind !== 'literal' ||
      !allowed.includes(value.value)
    ) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1805',
          `Rich slot ${JSON.stringify(slotName)} uses undeclared or nonportable option ${JSON.stringify(name)}.`,
          ['messages', messageId, 'slots', slotName],
        ),
      );
    }
  }
}

const portableTypes = new Set<PortableTypeId>([
  'boolean',
  'date-time',
  'integer',
  'number',
  'string',
]);
/**
 * The five kinds `specs/04-message-authoring-and-catalogs.spec.md` section 8 builds in.
 *
 * A slot name that is not one of these and carries no declared kind is message-local and requires a
 * trusted binding, because the alternative is inferring a component from a word an author wrote.
 * `link` and `action` are interactive and are the two that cannot nest, because a reader cannot
 * operate one control from inside another.
 */
const builtInSlotKinds = new Set([
  'action',
  'code',
  'emphasis',
  'link',
  'strong',
]);
const interactiveSlotKinds = new Set(['action', 'link']);
/**
 * Family membership is derived, not enrolled.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 10 makes every source message matching a
 * template a member automatically and forbids a per-message field, an enrollment list or a duplicate
 * ledger. A new member still has to satisfy the common contract derived from the members that
 * already match.
 */
const standardFunctionNames = new Set([
  'currency',
  'date',
  'datetime',
  'integer',
  'number',
  'offset',
  'percent',
  'string',
  'time',
  'unit',
]);
const nativeMessagePartPattern = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/u;

/** The file a catalog was read from, as a refusal of the whole catalog names it. */
function catalogFile(catalog: Catalog): string {
  return catalog.sourcePath ?? `a ${catalog.locale} catalog read from no file`;
}

/**
 * A catalog named by its file and its scope.
 *
 * A refusal of a whole catalog has no line to point at and so carries no position, which leaves
 * its sentence as the only place the file can be named.
 */
function catalogInScope(catalog: Catalog): string {
  const scope = `scope ${catalog.providerId}/${catalog.scopeId}`;
  return catalog.sourcePath === undefined
    ? `Catalog of ${scope}, read from no file,`
    : `Catalog ${catalog.sourcePath} of ${scope}`;
}

function semanticDiagnostic(
  catalog: Catalog,
  code: ToolkitDiagnosticCode,
  summary: string,
  path: readonly (string | number)[],
  severity: 'error' | 'warning' | 'info' = 'error',
): ToolkitDiagnostic {
  // One rule for every semantic diagnostic, and the reason it is here rather than at any of the
  // fifty call sites.
  //
  // Falling back to `spanAt('', 0, 0, catalog.sourcePath)` when the pointer does not
  // resolve gives offset zero of an empty string, which renders `file:1:1`. Every diagnostic
  // reporting that something is *absent* takes that path by definition, EQ1307 always, and a
  // reader sent to line 1 column 1 looks at a line that has nothing to do with it. **A wrong
  // location is worse than no location**, and one expression would produce one fifty times over.
  //
  // The pointer resolves as far as the document goes and the span is the nearest ancestor that
  // exists: `messages:` for a missing `messages/greeting`, which is the line a reader would have
  // to find anyway. When it had to stop short, the summary says so, because a caret on a line the
  // reader was not told about is its own small mystery. And when there is no honest position at all
  // the diagnostic carries none: the file name alone is a true statement and `file:1:1` is not.
  const anchor = catalogPathAnchor(catalog, path);
  const missing =
    anchor === undefined || anchor.resolved >= path.length
      ? ''
      : // Never the document root: a path here begins at `messages` or `families`, and the
        // catalog it is reported in holds that key, so at least one step resolved.
        ` Reported at ${path.slice(0, anchor.resolved).join('/')}, because ${path.join('/')} is not in this file.`;
  return toolkitDiagnostic(code, `${summary}${missing}`, {
    path,
    severity,
    ...(anchor === undefined ? {} : { span: anchor.span }),
  });
}

function functionOperandType(
  name: string,
  extensions: ExtensionRegistry | undefined,
): PortableTypeId | undefined {
  switch (name) {
    case 'string':
      return 'string';
    case 'integer':
      return 'integer';
    case 'number':
    case 'offset':
    case 'currency':
    case 'percent':
    case 'unit':
      return 'number';
    case 'datetime':
    case 'date':
    case 'time':
      return 'date-time';
    default:
      return extensionDescriptor(extensions, 'message-function', name)
        ?.operandType;
  }
}

function registerValueReference(
  value: MessageValueReference | undefined,
  type: PortableTypeId | undefined,
  externalInputs: ReadonlySet<string>,
  usages: InputUsages,
): void {
  if (
    type === undefined ||
    value?.kind !== 'variable' ||
    !externalInputs.has(value.name)
  ) {
    return;
  }

  const types = usages.get(value.name) ?? new Set();
  types.add(type);
  usages.set(value.name, types);
}

function registerExpression(
  expression: MessageExpression,
  externalInputs: ReadonlySet<string>,
  usages: InputUsages,
  extensions: ExtensionRegistry | undefined,
): void {
  const descriptor =
    expression.function === undefined
      ? undefined
      : extensionDescriptor(
          extensions,
          'message-function',
          expression.function.name,
        );
  registerValueReference(
    expression.operand,
    expression.function === undefined
      ? undefined
      : functionOperandType(expression.function.name, extensions),
    externalInputs,
    usages,
  );
  for (const [name, option] of Object.entries(
    expression.function?.options ?? {},
  )) {
    registerValueReference(
      option,
      descriptor?.options?.[name]?.type,
      externalInputs,
      usages,
    );
  }
}

function registerPatternInputs(
  pattern: MessagePattern,
  externalInputs: ReadonlySet<string>,
  usages: InputUsages,
  extensions: ExtensionRegistry | undefined,
): void {
  for (const part of pattern) {
    if (typeof part === 'string') {
      continue;
    }
    if (part.kind === 'expression') {
      registerExpression(part, externalInputs, usages, extensions);
    }
  }
}

function inputUsages(
  semantics: MessageSemanticModel,
  extensions: ExtensionRegistry | undefined,
): ReadonlyMap<string, ReadonlySet<PortableTypeId>> {
  const externalInputs = new Set(semantics.externalInputs);
  const usages: InputUsages = new Map();
  for (const declaration of semantics.declarations) {
    registerExpression(declaration.value, externalInputs, usages, extensions);
  }
  if (semantics.kind === 'pattern') {
    registerPatternInputs(
      semantics.pattern,
      externalInputs,
      usages,
      extensions,
    );
  } else {
    for (const variant of semantics.variants) {
      registerPatternInputs(
        variant.pattern,
        externalInputs,
        usages,
        extensions,
      );
    }
  }
  return usages;
}

function expressionsInMessage(
  semantics: MessageSemanticModel,
): readonly MessageExpression[] {
  const expressions = semantics.declarations.map(({ value }) => value);
  const patterns =
    semantics.kind === 'pattern'
      ? [semantics.pattern]
      : semantics.variants.map(({ pattern }) => pattern);
  for (const pattern of patterns) {
    for (const part of pattern) {
      if (typeof part !== 'string' && part.kind === 'expression') {
        expressions.push(part);
      }
    }
  }
  return expressions;
}

/**
 * Whether an authored option literal satisfies the contract its descriptor declares.
 *
 * Asking whether the *JavaScript* value is of the declared type asks it of a value that is always
 * a string: a MessageFormat option value is a literal or a variable, and a literal is text. That
 * makes `integer`, `number` and `boolean` option types a descriptor can declare and no message can
 * satisfy, and a closed `values` set unsatisfiable for the same reason, comparing against `'1'`
 * where the descriptor wrote `1`. Both are read through one rule, and it is the standard's: a digit
 * size option's value "resolves to a numerical integer value 0 or 1 or their corresponding string
 * representations".
 */
function literalSatisfiesExtensionOption(
  value: string | number | boolean,
  option: Readonly<{
    readonly type: ExtensionValueType;
    readonly values?: readonly (string | number | boolean)[];
  }>,
): boolean {
  const interpreted = extensionOptionValue(value, option.type);
  return (
    interpreted !== undefined &&
    extensionOptionValueAllowed(interpreted, option.values)
  );
}

function validateMessageFunctions(
  catalog: Catalog,
  messageId: string,
  message: CatalogMessage,
  extensions: ExtensionRegistry | undefined,
  diagnostics: ToolkitDiagnostic[],
): void {
  if (message.kind === 'empty') return;
  for (const expression of expressionsInMessage(message.semantics)) {
    const reference = expression.function;
    if (reference === undefined || standardFunctionNames.has(reference.name)) {
      continue;
    }
    const descriptor = extensionDescriptor(
      extensions,
      'message-function',
      reference.name,
    );
    if (descriptor === undefined) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1805',
          `Message function ${JSON.stringify(reference.name)} has no registered application-local descriptor.`,
          ['messages', messageId],
        ),
      );
      continue;
    }
    if (expression.operand === undefined) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1805',
          `Custom message function ${JSON.stringify(reference.name)} requires an operand.`,
          ['messages', messageId],
        ),
      );
    }
    const authoredOptions = Object.keys(reference.options);
    for (const authored of authoredOptions) {
      const option = descriptor.options?.[authored];
      const value = reference.options[authored];
      if (option === undefined) {
        diagnostics.push(
          semanticDiagnostic(
            catalog,
            'EQ1805',
            `Custom message function ${JSON.stringify(reference.name)} does not declare option ${JSON.stringify(authored)}.`,
            ['messages', messageId],
          ),
        );
      } else if (
        value?.kind === 'literal' &&
        !literalSatisfiesExtensionOption(value.value, option)
      ) {
        diagnostics.push(
          semanticDiagnostic(
            catalog,
            'EQ1805',
            `Custom message function option ${JSON.stringify(authored)} is incompatible with its portable descriptor.`,
            ['messages', messageId],
          ),
        );
      }
    }
    for (const [name, option] of Object.entries(descriptor.options ?? {})) {
      if (option.required === true && reference.options[name] === undefined) {
        diagnostics.push(
          semanticDiagnostic(
            catalog,
            'EQ1805',
            `Custom message function ${JSON.stringify(reference.name)} requires option ${JSON.stringify(name)}.`,
            ['messages', messageId],
          ),
        );
      }
    }
  }
}

/**
 * Why a message cannot be a recovery root, or nothing when it can.
 *
 * A recovery root is rendered when nothing else can be, so it is one existing plain message that
 * needs nothing passed to it. The generated recovery module and the compiled recovery payload
 * both ask, and this is the one answer and the one sentence both give.
 */
export function recoveryRootRefusal(
  identity: string,
  message: SemanticMessage | undefined,
): ToolkitDiagnostic | undefined {
  if (
    message !== undefined &&
    message.resultKind === 'plain' &&
    message.inputs.length === 0 &&
    message.slots.length === 0
  ) {
    return undefined;
  }
  return toolkitDiagnostic(
    'EQ1501',
    `Recovery identity ${JSON.stringify(identity)} must resolve to one plain message without inputs or slots.`,
    { path: ['recovery', identity] },
  );
}

function compatibleRefinement(
  inferred: PortableTypeId,
  refined: PortableTypeId,
): boolean {
  return (
    inferred === refined || (inferred === 'number' && refined === 'integer')
  );
}

function literalMatchesType(
  literal: InputLiteral,
  type: PortableTypeId,
): boolean {
  switch (type) {
    case 'string':
    case 'date-time':
      return typeof literal === 'string';
    case 'boolean':
      return typeof literal === 'boolean';
    case 'number':
      return typeof literal === 'number' && Number.isFinite(literal);
    case 'integer':
      return typeof literal === 'number' && Number.isSafeInteger(literal);
  }
}

function refinementType(
  catalog: Catalog,
  messageId: string,
  inputName: string,
  refinement: InputRefinement,
  inferred: PortableTypeId,
  diagnostics: ToolkitDiagnostic[],
): PortableTypeId {
  if (refinement.type === undefined) {
    return inferred;
  }
  if (!portableTypes.has(refinement.type as PortableTypeId)) {
    diagnostics.push(
      semanticDiagnostic(
        catalog,
        'EQ1302',
        `Input ${JSON.stringify(inputName)} uses unknown portable type ${JSON.stringify(refinement.type)}.`,
        ['messages', messageId, 'inputs', inputName, 'type'],
      ),
    );
    return inferred;
  }

  const refined = refinement.type as PortableTypeId;
  if (!compatibleRefinement(inferred, refined)) {
    diagnostics.push(
      semanticDiagnostic(
        catalog,
        'EQ1302',
        `Input ${JSON.stringify(inputName)} cannot refine inferred ${inferred} input to ${refined}.`,
        ['messages', messageId, 'inputs', inputName, 'type'],
      ),
    );
    return inferred;
  }
  return refined;
}

function effectiveInputs(
  catalog: Catalog,
  messageId: string,
  message: CatalogMessage,
  diagnostics: ToolkitDiagnostic[],
  extensions: ExtensionRegistry | undefined,
  inherited: ReadonlyMap<string, EffectiveInputContract> = new Map(),
): readonly EffectiveInputContract[] {
  if (message.kind === 'empty') {
    if (Object.keys(message.inputs).length > 0) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1302',
          'An explicit-empty message cannot declare inputs because it has no inferred input set.',
          ['messages', messageId, 'inputs'],
        ),
      );
    }
    return Object.freeze([]);
  }

  const usages = inputUsages(message.semantics, extensions);
  if (
    message.semantics.externalInputs.length > RESOURCE_LIMITS.inputsPerMessage
  ) {
    diagnostics.push(
      semanticDiagnostic(
        catalog,
        'EQ1302',
        `Message ${JSON.stringify(messageId)} exceeds the ${RESOURCE_LIMITS.inputsPerMessage}-input implementation ceiling.`,
        ['messages', messageId],
      ),
    );
  }
  for (const name of Object.keys(message.inputs)) {
    if (!message.semantics.externalInputs.includes(name)) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1302',
          `Input refinement ${JSON.stringify(name)} does not match an inferred external input.`,
          ['messages', messageId, 'inputs', name],
        ),
      );
    }
  }

  const contracts: EffectiveInputContract[] = [];
  for (const name of message.semantics.externalInputs) {
    const inheritedContract = inherited.get(name);
    const explicitTypes = [...(usages.get(name) ?? [])].sort(compareCodeUnit);
    if (explicitTypes.length > 1) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1302',
          `Input ${JSON.stringify(name)} has incompatible MessageFormat operand uses: ${explicitTypes.join(', ')}.`,
          ['messages', messageId],
        ),
      );
    }
    const inferred =
      explicitTypes[0] ?? inheritedContract?.type ?? ('string' as const);
    const refinement = message.inputs[name];
    const type =
      refinement === undefined
        ? inferred
        : refinementType(
            catalog,
            messageId,
            name,
            refinement,
            inferred,
            diagnostics,
          );
    if (
      refinement?.enum !== undefined &&
      refinement.enum.some((literal) => !literalMatchesType(literal, type))
    ) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1302',
          `Input ${JSON.stringify(name)} has an enum value incompatible with ${type}.`,
          ['messages', messageId, 'inputs', name, 'enum'],
        ),
      );
    }
    contracts.push(
      Object.freeze({
        name,
        type,
        ...(refinement?.enum === undefined
          ? {}
          : { enum: Object.freeze([...refinement.enum]) }),
        optional: refinement?.optional ?? inheritedContract?.optional ?? false,
        nullable: refinement?.nullable ?? inheritedContract?.nullable ?? false,
        ...(refinement?.description === undefined
          ? {}
          : { description: refinement.description }),
      }),
    );
  }
  return Object.freeze(contracts);
}

function patternSlotSummary(
  catalog: Catalog,
  messageId: string,
  message: CatalogMessage,
  pattern: MessagePattern,
  diagnostics: ToolkitDiagnostic[],
  extensions: ExtensionRegistry | undefined,
  inheritedSlots?: ReadonlyMap<string, EffectiveSlotContract>,
): PatternSlotSummary {
  const counts = new Map<string, number>();
  const parents = new Map<string, Set<string>>();
  const shapes = new Map<string, Set<SlotShape>>();
  const stack: string[] = [];

  for (const part of pattern) {
    if (typeof part === 'string' || part.kind === 'expression') {
      continue;
    }
    if (part.markupKind === 'close') {
      const opened = stack.pop();
      if (opened !== part.name) {
        diagnostics.push(
          semanticDiagnostic(
            catalog,
            'EQ1303',
            `Rich slot ${JSON.stringify(part.name)} closes ${JSON.stringify(opened ?? 'no open slot')}.`,
            ['messages', messageId],
          ),
        );
      }
      continue;
    }

    const shape: SlotShape =
      part.markupKind === 'standalone' ? 'standalone' : 'paired';
    counts.set(part.name, (counts.get(part.name) ?? 0) + 1);
    const slotShapes = shapes.get(part.name) ?? new Set<SlotShape>();
    slotShapes.add(shape);
    shapes.set(part.name, slotShapes);
    const slotParents = parents.get(part.name) ?? new Set<string>();
    slotParents.add(stack.at(-1) ?? '@root');
    parents.set(part.name, slotParents);

    const kind =
      message.slots[part.name]?.kind ??
      inheritedSlots?.get(part.name)?.kind ??
      (builtInSlotKinds.has(part.name) ? part.name : 'message-local');
    const descriptor = extensionDescriptor(extensions, 'rich-slot-kind', kind);
    // Only a registered kind declares options, so a built-in or message-local slot admits none and
    // every option written on one is refused rather than carried to a renderer that ignores it.
    validateCustomSlotOptions(
      catalog,
      messageId,
      part.name,
      part.options,
      descriptor?.options,
      diagnostics,
    );
    if (
      (interactiveSlotKinds.has(kind) || descriptor?.interactive === true) &&
      stack.some((name) => {
        const parentKind =
          message.slots[name]?.kind ??
          inheritedSlots?.get(name)?.kind ??
          (builtInSlotKinds.has(name) ? name : 'message-local');
        return (
          interactiveSlotKinds.has(parentKind) ||
          extensionDescriptor(extensions, 'rich-slot-kind', parentKind)
            ?.interactive === true
        );
      })
    ) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1303',
          `Interactive rich slot ${JSON.stringify(part.name)} cannot be nested inside another interactive slot.`,
          ['messages', messageId],
        ),
      );
    }
    if (
      stack.some(
        (name) =>
          (message.slots[name]?.kind ??
            inheritedSlots?.get(name)?.kind ??
            (builtInSlotKinds.has(name) ? name : 'message-local')) === 'code',
      )
    ) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1303',
          `Rich slot ${JSON.stringify(part.name)} cannot be nested inside code.`,
          ['messages', messageId],
        ),
      );
    }
    if (part.markupKind === 'open') {
      stack.push(part.name);
    }
  }

  if (stack.length > 0) {
    diagnostics.push(
      semanticDiagnostic(
        catalog,
        'EQ1303',
        `Rich slot ${JSON.stringify(stack.at(-1))} is not closed.`,
        ['messages', messageId],
      ),
    );
  }

  return { counts, parents, shapes };
}

function effectiveSlots(
  catalog: Catalog,
  messageId: string,
  message: CatalogMessage,
  diagnostics: ToolkitDiagnostic[],
  extensions: ExtensionRegistry | undefined,
  inheritedSlots?: ReadonlyMap<string, EffectiveSlotContract>,
): readonly EffectiveSlotContract[] {
  const patterns =
    message.kind === 'empty'
      ? []
      : message.semantics.kind === 'pattern'
        ? [message.semantics.pattern]
        : message.semantics.variants.map(({ pattern }) => pattern);
  const summaries = patterns.map((pattern) =>
    patternSlotSummary(
      catalog,
      messageId,
      message,
      pattern,
      diagnostics,
      extensions,
      inheritedSlots,
    ),
  );
  const names = new Set(Object.keys(message.slots));
  for (const summary of summaries) {
    for (const name of summary.counts.keys()) names.add(name);
  }

  const contracts: EffectiveSlotContract[] = [];
  if (names.size > RESOURCE_LIMITS.slotsPerMessage) {
    diagnostics.push(
      semanticDiagnostic(
        catalog,
        'EQ1303',
        `Message ${JSON.stringify(messageId)} exceeds the ${RESOURCE_LIMITS.slotsPerMessage}-slot implementation ceiling.`,
        ['messages', messageId],
      ),
    );
  }
  for (const name of [...names].sort(compareCodeUnit)) {
    const refinement = message.slots[name];
    const inherited = inheritedSlots?.get(name);
    const counts = summaries.map((summary) => summary.counts.get(name) ?? 0);
    const shapes = new Set<SlotShape>();
    const parents = new Set<string>();
    for (const summary of summaries) {
      for (const shape of summary.shapes.get(name) ?? []) shapes.add(shape);
      for (const parent of summary.parents.get(name) ?? []) parents.add(parent);
    }
    if (shapes.size > 1) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1303',
          `Rich slot ${JSON.stringify(name)} is used as both paired and standalone.`,
          ['messages', messageId, 'slots', name],
        ),
      );
    }
    const inferredShape = [...shapes][0];
    const kind =
      refinement?.kind ??
      inherited?.kind ??
      (builtInSlotKinds.has(name) ? name : 'message-local');
    const customKind = extensionDescriptor(extensions, 'rich-slot-kind', kind);
    if (
      !builtInSlotKinds.has(kind) &&
      kind !== 'message-local' &&
      customKind === undefined
    ) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1303',
          `Rich slot ${JSON.stringify(name)} references unregistered semantic kind ${JSON.stringify(kind)}.`,
          ['messages', messageId, 'slots', name, 'kind'],
        ),
      );
    }
    const builtInShape = builtInSlotKinds.has(kind)
      ? ('paired' as const)
      : undefined;
    const shape =
      refinement?.shape ?? inferredShape ?? builtInShape ?? customKind?.shape;
    if (shape === undefined) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1303',
          `Unused declared rich slot ${JSON.stringify(name)} requires a determinable kind and shape.`,
          ['messages', messageId, 'slots', name],
        ),
      );
      continue;
    }
    if (builtInShape !== undefined && shape !== builtInShape) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1303',
          `Built-in rich slot ${JSON.stringify(name)} must be paired.`,
          ['messages', messageId, 'slots', name, 'shape'],
        ),
      );
    }
    if (customKind !== undefined && shape !== customKind.shape) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1303',
          `Rich slot ${JSON.stringify(name)} must use the ${customKind.shape} shape declared by ${JSON.stringify(kind)}.`,
          ['messages', messageId, 'slots', name, 'shape'],
        ),
      );
    }
    const inferredOptional =
      counts.length === 0 || counts.some((count) => count === 0);
    const inferredRepeatable = counts.some((count) => count > 1);
    if (refinement?.optional === true && !inferredOptional) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1303',
          `Rich slot ${JSON.stringify(name)} is present in every source variant and cannot be made optional by refinement.`,
          ['messages', messageId, 'slots', name, 'optional'],
        ),
      );
    }
    if (refinement?.repeatable === true && !inferredRepeatable) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1303',
          `Rich slot ${JSON.stringify(name)} is not repeated by the source and cannot be made repeatable by refinement.`,
          ['messages', messageId, 'slots', name, 'repeatable'],
        ),
      );
    }
    const allowedParents =
      refinement?.within ?? [...parents].sort(compareCodeUnit);
    if (
      refinement?.within !== undefined &&
      [...parents].some((parent) => !refinement.within?.includes(parent))
    ) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1303',
          `Rich slot ${JSON.stringify(name)} is authored outside its declared within constraint.`,
          ['messages', messageId, 'slots', name, 'within'],
        ),
      );
    }
    // `within` narrows where a slot may sit and cannot open a placement the nesting rules forbid,
    // or a target could hold a structure no source can author.
    const interactive = (slotKind: string): boolean =>
      interactiveSlotKinds.has(slotKind) ||
      extensionDescriptor(extensions, 'rich-slot-kind', slotKind)
        ?.interactive === true;
    for (const parent of refinement?.within ?? []) {
      const parentKind =
        message.slots[parent]?.kind ??
        inheritedSlots?.get(parent)?.kind ??
        (builtInSlotKinds.has(parent) ? parent : 'message-local');
      const forbidden =
        parentKind === 'code'
          ? 'code, which holds only text and values'
          : interactive(kind) && interactive(parentKind)
            ? 'another interactive slot'
            : undefined;
      if (forbidden !== undefined) {
        diagnostics.push(
          semanticDiagnostic(
            catalog,
            'EQ1303',
            `Rich slot ${JSON.stringify(name)} cannot be permitted within ${JSON.stringify(parent)}, because it cannot be nested inside ${forbidden}.`,
            ['messages', messageId, 'slots', name, 'within'],
          ),
        );
      }
    }
    contracts.push(
      Object.freeze({
        name,
        kind,
        shape,
        optional: inferredOptional,
        repeatable: inferredRepeatable,
        within: Object.freeze([...allowedParents].sort(compareCodeUnit)),
        ...(refinement?.description === undefined
          ? {}
          : { description: refinement.description }),
      }),
    );
  }
  return Object.freeze(contracts);
}

function contractsByName<T extends { readonly name: string }>(
  contracts: readonly T[],
): ReadonlyMap<string, T> {
  return new Map(contracts.map((contract) => [contract.name, contract]));
}

/** The two category systems MF2's `select` option chooses between. `exact` has neither. */
type PluralSelectKind = 'plural' | 'ordinal';

interface PluralSelector {
  readonly position: number;
  readonly kind: PluralSelectKind;
}

/**
 * Which categories a locale's grammar requires for one `select` kind, from the pinned CLDR release.
 *
 * Derived from the release Equator pins rather than from the host `Intl`, so the answer does not
 * change with the Node version the build happens to run on.
 *
 * The two tables are not variants of one another, so reading the wrong one is wrong in both
 * directions. Arabic requires all six cardinal categories and exactly one ordinal category, so
 * checking an Arabic ordinal target against the cardinal table demands five categories the language
 * has no ordinal forms for. English requires two cardinal and four ordinal, so checking an English
 * ordinal target against the cardinal table passes a translation missing `two` and `few`, which
 * then renders "2th" and "3th".
 */
function requiredPluralCategories(
  locale: string,
  kind: PluralSelectKind,
): readonly string[] | undefined {
  return pluralCategoriesForLocale(
    kind === 'ordinal' ? ORDINAL_PLURAL_CATEGORIES : CARDINAL_PLURAL_CATEGORIES,
    locale,
  );
}

/** One case-folded key index per table, built on first use and kept with the table. */
const PLURAL_TABLE_INDEXES = new WeakMap<
  Readonly<Record<string, readonly string[]>>,
  ReadonlyMap<string, readonly string[]>
>();

function pluralTableIndex(
  table: Readonly<Record<string, readonly string[]>>,
): ReadonlyMap<string, readonly string[]> {
  const cached = PLURAL_TABLE_INDEXES.get(table);
  if (cached !== undefined) return cached;
  // A `Map` rather than the object itself: a lookup of `constructor` or `__proto__` on a plain
  // object answers with something that is not a row, and a locale subtag is client-adjacent data.
  const index = new Map<string, readonly string[]>(
    Object.entries(table).map(([key, categories]) => [
      key.toLowerCase(),
      categories,
    ]),
  );
  PLURAL_TABLE_INDEXES.set(table, index);
  return index;
}

/**
 * The row a locale selects: the longest table key that prefixes it on a subtag boundary.
 *
 * CLDR keys some rows by more than one subtag, `pt-PT` and `kok-Latn` in 48.2, so keying on the
 * language alone makes those rows unreachable. Today each of them happens to be identical to its
 * base language, which is exactly why keying on the language alone is silently wrong: the first
 * release in which one of them diverges would be read wrongly and nothing would say so.
 *
 * Longest-prefix is also what the selection this gate is gating does. `Intl.PluralRules` resolves
 * `kok-Latn-IN` to `kok-Latn` and `pt-BR` to `pt`: truncating a subtag at a time and stopping at
 * the longest key that exists. A build-time check that stopped at the language could not agree with
 * the runtime it exists to check.
 *
 * Matching is case-insensitive, because CLDR writes its keys in one case and a catalog may spell a
 * script or region in another. It is on subtag boundaries, so `pt-PT` does not answer for `pt-PTX`.
 *
 * `undefined` rather than a default, so the caller decides what an unlisted language means. CLDR
 * expresses "only `other`" by omitting the language, and the coverage check that reads this asks nothing of one.
 */
export function pluralCategoriesForLocale(
  table: Readonly<Record<string, readonly string[]>>,
  locale: string,
): readonly string[] | undefined {
  const index = pluralTableIndex(table);
  let candidate = locale.toLowerCase();
  for (;;) {
    const row = index.get(candidate);
    if (row !== undefined) return row;
    const separator = candidate.lastIndexOf('-');
    if (separator <= 0) return undefined;
    candidate = candidate.slice(0, separator);
  }
}

/**
 * Selector positions whose keys are plural categories, each with the kind that decides its table.
 *
 * `select=exact` selects on the number itself and has no categories to be missing, so it is not
 * returned. An absent option means `plural`, which is MF2's default. No other value can reach here:
 * `parseMessageSemanticModel` rejects it (`EQ1204`).
 */
function pluralSelectorPositions(
  semantics: MessageSemanticModel,
): readonly PluralSelector[] {
  if (semantics.kind !== 'select') return [];
  const byName = new Map(
    semantics.declarations.map((declaration) => [
      declaration.name,
      declaration,
    ]),
  );
  const selectors: PluralSelector[] = [];
  // A `.local` bound to a variable with no function of its own carries that variable's
  // annotation, so the function that selects is the first one met along the bindings.
  const annotation = (name: string): MessageFunctionReference | undefined => {
    const seen = new Set<string>();
    let current: string | undefined = name;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const value: MessageExpression | undefined = byName.get(current)?.value;
      if (value?.function !== undefined) return value.function;
      current =
        value?.operand?.kind === 'variable' ? value.operand.name : undefined;
    }
    return undefined;
  };
  semantics.selectors.forEach((selector, index) => {
    const reference = annotation(selector);
    if (
      reference === undefined ||
      !PLURAL_SELECTOR_FUNCTIONS.has(reference.name)
    ) {
      return;
    }
    const select = reference.options['select'];
    const value = select?.kind === 'literal' ? select.value : 'plural';
    if (value === 'exact') return;
    selectors.push({
      position: index,
      kind: value === 'ordinal' ? 'ordinal' : 'plural',
    });
  });
  return selectors;
}

/** Literal keys supplied at a selector position, ignoring the catch-all. */
function suppliedKeys(
  semantics: MessageSemanticModel,
  position: number,
): ReadonlySet<string> {
  const keys = new Set<string>();
  if (semantics.kind !== 'select') return keys;
  for (const variant of semantics.variants) {
    const key = variant.keys[position];
    if (key?.kind === 'literal') keys.add(key.value);
  }
  return keys;
}

/**
 * A target locale whose grammar needs six cardinal categories can supply one variant
 * and a catch-all, and every count then renders the same string. That parses, compiles and ships,
 * and reads as a finished translation.
 *
 * Only reported where the source itself selects on a number: a select over an enum has no
 * categories to be missing.
 */
function validateTargetPluralCoverage(
  targetCatalog: Catalog,
  messageId: string,
  sourceMessage: CatalogMessage,
  targetMessage: CatalogMessage,
  diagnostics: ToolkitDiagnostic[],
  policy: CompletenessPolicy,
): void {
  if (sourceMessage.kind !== 'message' || targetMessage.kind !== 'message') {
    return;
  }
  const selectors = pluralSelectorPositions(sourceMessage.semantics);
  if (selectors.length === 0) return;

  for (const { position, kind } of selectors) {
    // The requirement is per selector, because one message can select cardinally at one position
    // and ordinally at another, and the two tables disagree for most languages.
    const required = requiredPluralCategories(targetCatalog.locale, kind);
    // CLDR leaves a language out where `other` is its only category, and one category asks
    // nothing of a target either way.
    if (required === undefined || required.length <= 1) continue;

    const supplied = suppliedKeys(targetMessage.semantics, position);
    // An exact-value key such as `1` is a legitimate MF2 refinement, not a category, so it neither
    // satisfies nor invalidates a category requirement.
    const missing = required.filter(
      (category) => category !== 'other' && !supplied.has(category),
    );
    if (missing.length === 0) continue;

    diagnostics.push(
      semanticDiagnostic(
        targetCatalog,
        'EQ1308',
        `Target catalog ${targetCatalog.locale} omits ${kind === 'ordinal' ? 'ordinal' : 'plural'} ${missing.length === 1 ? 'category' : 'categories'} ${missing
          .map((category) => JSON.stringify(category))
          .join(
            ', ',
          )} for message ${JSON.stringify(messageId)}; those counts fall through to the catch-all.${policy.suffix}`,
        ['messages', messageId],
        policy.severity,
      ),
    );
  }
}

function validateTarget(
  sourceCatalog: Catalog,
  targetCatalog: Catalog,
  messageId: string,
  sourceMessage: CatalogMessage,
  sourceInputs: readonly EffectiveInputContract[],
  sourceSlots: readonly EffectiveSlotContract[],
  diagnostics: ToolkitDiagnostic[],
  extensions: ExtensionRegistry | undefined,
  policy: CompletenessPolicy,
  inherited: readonly Catalog[],
): SemanticTargetMessage | undefined {
  const targetMessage = targetCatalog.messages[messageId];
  if (targetMessage === undefined) {
    // A target that *invents* a message was already an error (EQ1304). A target that *omits* one
    // returned silently, so a locale could be incomplete and look finished: check exited 0,
    // generation succeeded, and the message fell back to the source locale in a production build
    // with nothing said. Being missing is at least as reportable as being extra.
    //
    // Unless a locale it inherits from carries the message. `en-AU` that omits a string `en` has
    // is not short of anything: it is a regional locale saying it has nothing to add, which is
    // what a parent is for, and reporting it would put one finding on every message such a locale
    // correctly leaves alone. The runtime resolves it the same way, so the gate and the render
    // agree about what complete means.
    if (
      inherited.some((catalog) => catalog.messages[messageId] !== undefined)
    ) {
      return undefined;
    }
    diagnostics.push(
      semanticDiagnostic(
        targetCatalog,
        'EQ1307',
        `Target catalog ${targetCatalog.locale} omits message ${JSON.stringify(messageId)}; ${sourceCatalog.locale} is used in its place.${policy.suffix}`,
        ['messages', messageId],
        policy.severity,
      ),
    );
    return undefined;
  }
  validateMessageFunctions(
    targetCatalog,
    messageId,
    targetMessage,
    extensions,
    diagnostics,
  );
  validateTargetPluralCoverage(
    targetCatalog,
    messageId,
    sourceMessage,
    targetMessage,
    diagnostics,
    policy,
  );
  if (targetMessage.kind === 'empty') {
    return Object.freeze({ locale: targetCatalog.locale, kind: 'empty' });
  }

  const sourceInputMap = contractsByName(sourceInputs);
  const targetInputs = effectiveInputs(
    targetCatalog,
    messageId,
    targetMessage,
    diagnostics,
    extensions,
    sourceInputMap,
  );
  for (const input of targetInputs) {
    const source = sourceInputMap.get(input.name);
    if (source === undefined || source.type !== input.type) {
      diagnostics.push(
        semanticDiagnostic(
          targetCatalog,
          'EQ1304',
          `Target message ${JSON.stringify(messageId)} changes or invents input ${JSON.stringify(input.name)}.`,
          ['messages', messageId],
        ),
      );
    }
  }

  const targetSlots = effectiveSlots(
    targetCatalog,
    messageId,
    targetMessage,
    diagnostics,
    extensions,
    contractsByName(sourceSlots),
  );
  const targetSlotMap = contractsByName(targetSlots);
  for (const target of targetSlots) {
    const source = sourceSlots.find(({ name }) => name === target.name);
    if (
      source === undefined ||
      source.shape !== target.shape ||
      source.kind !== target.kind ||
      (!source.repeatable && target.repeatable) ||
      target.within.some((parent) => !source.within.includes(parent))
    ) {
      diagnostics.push(
        semanticDiagnostic(
          targetCatalog,
          'EQ1304',
          `Target message ${JSON.stringify(messageId)} changes or invents rich slot ${JSON.stringify(target.name)}.`,
          ['messages', messageId],
        ),
      );
    }
  }
  for (const source of sourceSlots) {
    if (!source.optional && !targetSlotMap.has(source.name)) {
      diagnostics.push(
        semanticDiagnostic(
          targetCatalog,
          'EQ1304',
          `Target message ${JSON.stringify(messageId)} omits required rich slot ${JSON.stringify(source.name)}.`,
          ['messages', messageId],
        ),
      );
    }
  }

  return Object.freeze({
    locale: targetCatalog.locale,
    kind: 'message',
    canonicalSource: targetMessage.semantics.canonicalSource,
  });
}

function inputJson(input: EffectiveInputContract): CanonicalJsonValue {
  return {
    name: input.name,
    type: input.type,
    optional: input.optional,
    nullable: input.nullable,
    ...(input.enum === undefined ? {} : { enum: input.enum }),
  };
}

function slotJson(slot: EffectiveSlotContract): CanonicalJsonValue {
  return {
    name: slot.name,
    kind: slot.kind,
    shape: slot.shape,
    optional: slot.optional,
    repeatable: slot.repeatable,
    within: slot.within,
  };
}

function messageContractJson(message: SemanticMessage): CanonicalJsonValue {
  return {
    identity: message.identity,
    resultKind: message.resultKind,
    inputs: message.inputs.map(inputJson),
    slots: message.slots.map(slotJson),
  };
}

interface ParsedFamilyTemplate {
  readonly authored: CatalogFamily;
  readonly parts: readonly (
    | { readonly kind: 'literal'; readonly value: string }
    | { readonly kind: 'segment'; readonly name: string }
  )[];
}

function parseFamilyTemplate(
  catalog: Catalog,
  familyName: string,
  authored: CatalogFamily,
  extensions: ExtensionRegistry | undefined,
  diagnostics: ToolkitDiagnostic[],
): ParsedFamilyTemplate | undefined {
  const parts: ParsedFamilyTemplate['parts'][number][] = [];
  const placeholders = new Set<string>();
  let literalCount = 0;
  for (const part of authored.template.split('.')) {
    const placeholder = /^\{([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)\}$/u.exec(
      part,
    );
    if (placeholder !== null) {
      const name = placeholder[1] as string;
      if (placeholders.has(name)) {
        diagnostics.push(
          semanticDiagnostic(
            catalog,
            'EQ1305',
            `Open family ${JSON.stringify(familyName)} repeats placeholder ${JSON.stringify(name)}.`,
            ['families', familyName, 'template'],
          ),
        );
        return undefined;
      }
      placeholders.add(name);
      parts.push({ kind: 'segment', name });
    } else if (nativeMessagePartPattern.test(part)) {
      literalCount += 1;
      parts.push({ kind: 'literal', value: part });
    } else {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1305',
          `Open family ${JSON.stringify(familyName)} has an invalid literal or placeholder part.`,
          ['families', familyName, 'template'],
        ),
      );
      return undefined;
    }
  }
  if (literalCount === 0 || placeholders.size === 0) {
    diagnostics.push(
      semanticDiagnostic(
        catalog,
        'EQ1305',
        `Open family ${JSON.stringify(familyName)} requires at least one fixed part and one placeholder.`,
        ['families', familyName, 'template'],
      ),
    );
    return undefined;
  }
  const segmentNames = Object.keys(authored.segments).sort(compareCodeUnit);
  if (segmentNames.some((name) => !placeholders.has(name))) {
    diagnostics.push(
      semanticDiagnostic(
        catalog,
        'EQ1305',
        `Open family ${JSON.stringify(familyName)} declares a segment that is absent from its template.`,
        ['families', familyName, 'segments'],
      ),
    );
    return undefined;
  }
  for (const [name, type] of Object.entries(authored.segments)) {
    if (
      extensionDescriptor(extensions, 'identifier-segment', type) === undefined
    ) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1805',
          `Open family segment ${JSON.stringify(name)} references unregistered identifier type ${JSON.stringify(type)}.`,
          ['families', familyName, 'segments', name],
        ),
      );
      return undefined;
    }
  }
  return { authored, parts: Object.freeze(parts) };
}

function familyMatch(
  messageId: string,
  parsed: ParsedFamilyTemplate,
  extensions: ExtensionRegistry | undefined,
): Readonly<Record<string, string>> | undefined {
  const actual = messageId.split('.');
  if (actual.length !== parsed.parts.length) return undefined;
  const segments: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [index, part] of parsed.parts.entries()) {
    const value = actual[index] as string;
    if (part.kind === 'literal') {
      if (part.value !== value) return undefined;
      continue;
    }
    const type = parsed.authored.segments[part.name];
    const descriptor =
      type === undefined
        ? undefined
        : extensionDescriptor(extensions, 'identifier-segment', type);
    // The value is one part of a message identity, which a catalog holds to the lower-kebab part
    // grammar, and each of the three segment syntaxes admits every such part. The length the
    // type allows is all a segment type can still refuse it for.
    if (value.length > (descriptor?.maximumLength ?? 128)) return undefined;
    segments[part.name] = value;
  }
  return frozenRecord(
    Object.entries(segments).sort(([left], [right]) =>
      compareCodeUnit(left, right),
    ),
  );
}

function commonContractJson(message: SemanticMessage): string {
  return JSON.stringify({
    resultKind: message.resultKind,
    inputs: message.inputs.map(inputJson),
    slots: message.slots.map(slotJson),
  });
}

function analyzeFamilies(
  catalog: Catalog,
  messages: readonly SemanticMessage[],
  extensions: ExtensionRegistry | undefined,
  diagnostics: ToolkitDiagnostic[],
): readonly SemanticFamily[] {
  const families: SemanticFamily[] = [];
  const templates = new Map<string, string>();
  const projectedNames = new Map<string, string>();
  const memberships = new Map<string, string>();
  for (const [name, authored] of Object.entries(catalog.families).sort(
    ([left], [right]) => compareCodeUnit(left, right),
  )) {
    const existingTemplate = templates.get(authored.template);
    const projectedName = name.replace(/-([a-z0-9])/gu, (_, value: string) =>
      value.toUpperCase(),
    );
    const existingProjection = projectedNames.get(projectedName);
    if (existingTemplate !== undefined || existingProjection !== undefined) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1305',
          existingTemplate !== undefined
            ? `Open families ${JSON.stringify(existingTemplate)} and ${JSON.stringify(name)} duplicate one template.`
            : `Open families ${JSON.stringify(existingProjection)} and ${JSON.stringify(name)} collide at generated name ${JSON.stringify(projectedName)}.`,
          ['families', name],
        ),
      );
      continue;
    }
    templates.set(authored.template, name);
    projectedNames.set(projectedName, name);
    const parsed = parseFamilyTemplate(
      catalog,
      name,
      authored,
      extensions,
      diagnostics,
    );
    if (parsed === undefined) continue;
    const members = messages
      .map((message) => {
        const segments = familyMatch(message.messageId, parsed, extensions);
        return segments === undefined
          ? undefined
          : Object.freeze({ messageId: message.messageId, segments });
      })
      .filter((member): member is SemanticFamilyMember => member !== undefined);
    if (members.length === 0) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1305',
          `Open family ${JSON.stringify(name)} has no current source member.`,
          ['families', name],
        ),
      );
      continue;
    }
    const memberMessages = members.map(
      ({ messageId }) =>
        messages.find(
          (message) => message.messageId === messageId,
        ) as SemanticMessage,
    );
    const common = commonContractJson(memberMessages[0] as SemanticMessage);
    if (
      memberMessages.some((message) => commonContractJson(message) !== common)
    ) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1305',
          `Open family ${JSON.stringify(name)} has heterogeneous current message contracts.`,
          ['families', name],
        ),
      );
      continue;
    }
    for (const member of members) {
      const previous = memberships.get(member.messageId);
      if (previous !== undefined) {
        diagnostics.push(
          semanticDiagnostic(
            catalog,
            'EQ1305',
            `Message ${JSON.stringify(member.messageId)} ambiguously matches open families ${JSON.stringify(previous)} and ${JSON.stringify(name)}.`,
            ['families', name],
          ),
        );
      } else {
        memberships.set(member.messageId, name);
      }
    }
    const exemplar = memberMessages[0] as SemanticMessage;
    const segments = parsed.parts
      .filter(
        (
          part,
        ): part is Extract<
          ParsedFamilyTemplate['parts'][number],
          { readonly kind: 'segment' }
        > => part.kind === 'segment',
      )
      .map(({ name: segmentName }) => {
        const type = authored.segments[segmentName];
        const descriptor =
          type === undefined
            ? undefined
            : extensionDescriptor(extensions, 'identifier-segment', type);
        return Object.freeze({
          name: segmentName,
          type: type ?? ('equator:native-message-part' as const),
          syntax: descriptor?.syntax ?? ('lower-kebab' as const),
          maximumLength: descriptor?.maximumLength ?? 128,
        });
      });
    families.push(
      Object.freeze({
        name,
        template: authored.template,
        segments: Object.freeze(segments),
        resultKind: exemplar.resultKind,
        inputs: exemplar.inputs,
        slots: exemplar.slots,
        members: Object.freeze(members),
      }),
    );
  }
  return Object.freeze(families);
}

function familyContractJson(family: SemanticFamily): CanonicalJsonValue {
  return {
    name: family.name,
    template: family.template,
    segments: family.segments.map(({ name, type, syntax, maximumLength }) => ({
      name,
      type,
      syntax,
      maximumLength,
    })),
    resultKind: family.resultKind,
    inputs: family.inputs.map(inputJson),
    slots: family.slots.map(slotJson),
    members: family.members.map(({ messageId, segments }) => ({
      messageId,
      segments,
    })),
  };
}

function referencedExtensions(
  catalogs: readonly Catalog[],
  messages: readonly SemanticMessage[],
  families: readonly SemanticFamily[],
  extensions: ExtensionRegistry | undefined,
): readonly ReferencedExtension[] {
  const keys = new Set<string>();
  for (const catalog of catalogs) {
    for (const message of Object.values(catalog.messages)) {
      if (message.kind === 'empty') continue;
      for (const name of message.semantics.functions) {
        if (!standardFunctionNames.has(name))
          keys.add(`message-function\u0000${name}`);
      }
    }
  }
  for (const message of messages) {
    for (const slot of message.slots) {
      if (!builtInSlotKinds.has(slot.kind) && slot.kind !== 'message-local') {
        keys.add(`rich-slot-kind\u0000${slot.kind}`);
      }
    }
  }
  for (const family of families) {
    for (const segment of family.segments) {
      if (segment.type !== 'equator:native-message-part') {
        keys.add(`identifier-segment\u0000${segment.type}`);
      }
    }
  }
  return Object.freeze(
    [...keys]
      .sort(compareCodeUnit)
      .map((key) => {
        const [kind, id] = key.split('\u0000') as [
          ExtensionDescriptor['kind'],
          string,
        ];
        const descriptor = extensions?.descriptors.find(
          (candidate) => candidate.kind === kind && candidate.id === id,
        );
        if (descriptor === undefined) return undefined;
        return descriptor;
      })
      .filter((value): value is ReferencedExtension => value !== undefined),
  );
}

export function analyzeCatalogSet(
  request: CatalogSetAnalysisRequest,
): ToolkitResult<SemanticGraph> {
  const diagnostics: ToolkitDiagnostic[] = [];
  const groups = new Map<string, Catalog[]>();
  const supportedLocales = new Set<string>(request.configuration.locales);

  for (const catalog of request.catalogs) {
    if (!supportedLocales.has(catalog.locale)) {
      diagnostics.push(
        semanticDiagnostic(
          catalog,
          'EQ1301',
          `${catalogInScope(catalog)} is for locale ${JSON.stringify(catalog.locale)}, which the project does not declare.`,
          [],
        ),
      );
    }
    const key = `${catalog.providerId}\u0000${catalog.scopeId}`;
    const group = groups.get(key) ?? [];
    group.push(catalog);
    groups.set(key, group);
  }

  const scopes: SemanticScope[] = [];
  // Ordered by the key each group is held under, so no two groups compare as equal and the order
  // is one whatever order the catalogs came in.
  for (const [, catalogs] of [...groups].sort(([left], [right]) =>
    compareCodeUnit(left, right),
  )) {
    const exemplar = catalogs[0];
    if (exemplar === undefined) continue;
    const byLocale = new Map<string, Catalog>();
    for (const catalog of catalogs) {
      const first = byLocale.get(catalog.locale);
      if (first !== undefined) {
        diagnostics.push(
          semanticDiagnostic(
            catalog,
            'EQ1301',
            // Both files in one order, so the sentence is the same whichever was read first.
            `Scope ${catalog.providerId}/${catalog.scopeId} has two catalogs for locale ${JSON.stringify(catalog.locale)}: ${[catalogFile(first), catalogFile(catalog)].sort(compareCodeUnit).join(' and ')}.`,
            [],
          ),
        );
      } else {
        byLocale.set(catalog.locale, catalog);
      }
    }

    const sourceCatalog = byLocale.get(request.configuration.sourceLocale);
    if (sourceCatalog === undefined || sourceCatalog.role !== 'source') {
      diagnostics.push(
        semanticDiagnostic(
          exemplar,
          'EQ1301',
          `Scope ${exemplar.providerId}/${exemplar.scopeId} requires one source catalog for ${request.configuration.sourceLocale}, and has ${catalogs.map(catalogFile).join(', ')}.`,
          [],
        ),
      );
      continue;
    }
    if (Object.keys(sourceCatalog.messages).length === 0) {
      diagnostics.push(
        semanticDiagnostic(
          sourceCatalog,
          'EQ1301',
          'Empty scopes do not produce Equator registries or generated output.',
          ['messages'],
        ),
      );
    }
    for (const catalog of catalogs) {
      const expectedRole =
        catalog.locale === request.configuration.sourceLocale
          ? 'source'
          : 'target';
      if (catalog.role !== expectedRole) {
        diagnostics.push(
          semanticDiagnostic(
            catalog,
            'EQ1301',
            `${catalogInScope(catalog)} is for locale ${JSON.stringify(catalog.locale)} and must use role ${expectedRole}.`,
            [],
          ),
        );
      }
    }

    const targets = catalogs
      .filter(
        (catalog) => catalog !== sourceCatalog && catalog.role === 'target',
      )
      .sort((left, right) => compareCodeUnit(left.locale, right.locale));
    for (const target of targets) {
      for (const messageId of Object.keys(target.messages)) {
        if (sourceCatalog.messages[messageId] === undefined) {
          diagnostics.push(
            semanticDiagnostic(
              target,
              'EQ1304',
              `Target catalog invents message ${JSON.stringify(messageId)}.`,
              ['messages', messageId],
            ),
          );
        }
      }
    }

    // Which catalogs each locale inherits from in this scope, nearest first, built once.
    // `localeFallbackChain` walks CLDR's own parents and this project's declarations; what is
    // kept is the members this scope has a catalog for, since a member with no catalog supplies
    // nothing, and the source is left out because it is already the last resort below.
    const inheritedCatalogs = new Map<string, readonly Catalog[]>();
    for (const locale of request.configuration.locales) {
      inheritedCatalogs.set(
        locale,
        Object.freeze(
          localeFallbackChain(
            locale,
            request.configuration.parentLocales,
          ).flatMap((parent) => {
            const catalog = byLocale.get(parent);
            return catalog === undefined || catalog === sourceCatalog
              ? []
              : [catalog];
          }),
        ),
      );
    }
    const noInheritance: readonly Catalog[] = Object.freeze([]);

    const semanticMessages: SemanticMessage[] = [];
    for (const [messageId, sourceMessage] of Object.entries(
      sourceCatalog.messages,
    )) {
      validateMessageFunctions(
        sourceCatalog,
        messageId,
        sourceMessage,
        request.extensions,
        diagnostics,
      );
      if (
        sourceMessage.kind === 'message' &&
        sourceMessage.semantics.kind === 'select'
      ) {
        if (
          sourceMessage.semantics.selectors.length >
          RESOURCE_LIMITS.selectorsPerMessage
        ) {
          diagnostics.push(
            semanticDiagnostic(
              sourceCatalog,
              'EQ1302',
              `Message ${JSON.stringify(messageId)} exceeds the ${RESOURCE_LIMITS.selectorsPerMessage}-selector implementation ceiling.`,
              ['messages', messageId],
            ),
          );
        }
        if (
          sourceMessage.semantics.variants.length >
          RESOURCE_LIMITS.variantsPerMessage
        ) {
          diagnostics.push(
            semanticDiagnostic(
              sourceCatalog,
              'EQ1302',
              `Message ${JSON.stringify(messageId)} exceeds the ${RESOURCE_LIMITS.variantsPerMessage}-variant implementation ceiling.`,
              ['messages', messageId],
            ),
          );
        }
      }
      const inputs = effectiveInputs(
        sourceCatalog,
        messageId,
        sourceMessage,
        diagnostics,
        request.extensions,
      );
      const slots = effectiveSlots(
        sourceCatalog,
        messageId,
        sourceMessage,
        diagnostics,
        request.extensions,
      );
      const targetMessages = targets
        .map((target) =>
          validateTarget(
            sourceCatalog,
            target,
            messageId,
            sourceMessage,
            inputs,
            slots,
            diagnostics,
            request.extensions,
            completenessPolicy(
              request.configuration,
              request.requireCompleteTargets === true,
              target.locale,
            ),
            inheritedCatalogs.get(target.locale) ?? noInheritance,
          ),
        )
        .filter(
          (target): target is SemanticTargetMessage => target !== undefined,
        );
      const identity = `${sourceCatalog.providerId}:${sourceCatalog.scopeId}:${messageId}`;
      const resultKind =
        sourceMessage.kind === 'message'
          ? sourceMessage.semantics.resultKind
          : ('plain' as const);
      const contract = {
        identity,
        resultKind,
        inputs: inputs.map(inputJson),
        slots: slots.map(slotJson),
      } satisfies CanonicalJsonValue;
      const sourceFingerprint = digestCanonicalJson(
        'equator-source-message/1',
        {
          ...contract,
          source:
            sourceMessage.kind === 'message'
              ? sourceMessage.semantics.canonicalSource
              : null,
          empty: sourceMessage.kind === 'empty',
        },
      );
      semanticMessages.push(
        Object.freeze({
          providerId: sourceCatalog.providerId,
          scopeId: sourceCatalog.scopeId,
          messageId,
          identity,
          resultKind,
          inputs,
          slots,
          sourceFingerprint,
          targets: Object.freeze(targetMessages),
        }),
      );
    }
    semanticMessages.sort((left, right) =>
      compareCodeUnit(left.messageId, right.messageId),
    );
    const semanticFamilies = analyzeFamilies(
      sourceCatalog,
      semanticMessages,
      request.extensions,
      diagnostics,
    );
    const requiredExtensions = referencedExtensions(
      catalogs,
      semanticMessages,
      semanticFamilies,
      request.extensions,
    );

    for (const locale of request.configuration.locales) {
      if (
        !byLocale.has(locale) &&
        (inheritedCatalogs.get(locale) ?? noInheritance).length === 0
      ) {
        // The most complete form of incompleteness, and the one a gate escalating only missing
        // messages would ignore: a locale missing one message of three would block, and the same
        // locale missing all three, by having no catalog at all, would pass.
        //
        // A locale that inherits a catalog from a parent is not this case. Shipping `en-AU` with
        // no catalog of its own beside an `en` it inherits from is a whole locale saying it has
        // nothing to add, and whatever `en` is missing is reported against `en`, once, rather than
        // against every locale that inherits from it.
        const policy = completenessPolicy(
          request.configuration,
          request.requireCompleteTargets === true,
          locale,
        );
        diagnostics.push(
          semanticDiagnostic(
            sourceCatalog,
            'EQ1306',
            `Scope ${sourceCatalog.scopeId} has no ${locale} catalog; source-locale fallback remains available.${policy.suffix}`,
            [],
            policy.severity,
          ),
        );
      }
    }

    // `specs/05-compiled-artifacts-and-trust.spec.md` section 6: the contract domain is what a
    // caller has to satisfy, so message prose stays outside it and translating a message leaves
    // the fingerprint alone. The registry domain is what the runtime has to provide, so it carries
    // descriptor identities and never the implementations behind them.
    const applicationContractFingerprint = digestCanonicalJson(
      'equator-scope-application-contract/1',
      {
        messages: semanticMessages.map(messageContractJson),
        families: semanticFamilies.map(familyContractJson),
      },
    );
    const referencedKinds = [
      ...new Set(
        semanticMessages.flatMap((message) =>
          message.slots.map((slot) => `${slot.kind}:${slot.shape}`),
        ),
      ),
    ].sort(compareCodeUnit);
    const semanticRegistryFingerprint = digestCanonicalJson(
      'equator-scope-semantic-registry/1',
      {
        builtInKinds: referencedKinds,
        extensions: requiredExtensions.map(({ kind, id, fingerprint }) => ({
          kind,
          id,
          fingerprint,
        })),
      },
    );
    scopes.push(
      Object.freeze({
        providerId: sourceCatalog.providerId,
        scopeId: sourceCatalog.scopeId,
        sourceLocale: sourceCatalog.locale,
        availableLocales: Object.freeze(
          [...byLocale.keys()].sort(compareCodeUnit) as CanonicalLocale[],
        ),
        messages: Object.freeze(semanticMessages),
        families: semanticFamilies,
        requiredExtensions,
        applicationContractFingerprint,
        semanticRegistryFingerprint,
      }),
    );
  }

  // Failing means "there is no model here", and a severity a release policy raised does not mean
  // that. The completeness family is reported against a graph this function has finished building:
  // an incomplete locale compiles, generates, and falls back to the source, which is exactly what
  // the same call with the gate off does with the same catalogs. Returning a failure for it handed
  // the graph to nobody, so output freshness and the translation record, both of which have
  // everything they need, went uninspected, and turning the gate on took the run from three
  // findings to one. Every other error here is a fault in the model itself, and the model is what a
  // caller would otherwise generate from.
  if (
    diagnostics.some(
      ({ code, severity }) =>
        severity === 'error' && !COMPLETENESS_CODES.has(code),
    )
  ) {
    return toolkitFailure(diagnostics);
  }

  const applicationContractFingerprint = digestCanonicalJson(
    'equator-application-contract/1',
    scopes.map((scope) => ({
      providerId: scope.providerId,
      scopeId: scope.scopeId,
      fingerprint: scope.applicationContractFingerprint,
    })),
  );
  const semanticRegistryFingerprint = digestCanonicalJson(
    'equator-semantic-registry/1',
    scopes.map((scope) => ({
      providerId: scope.providerId,
      scopeId: scope.scopeId,
      fingerprint: scope.semanticRegistryFingerprint,
    })),
  );
  return toolkitSuccess(
    Object.freeze({
      generatedAbi: GENERATED_ABI_PROFILE,
      sourceLocale: request.configuration.sourceLocale,
      defaultLocale: request.configuration.defaultLocale,
      locales: Object.freeze([...request.configuration.locales]),
      // A declared pseudo-locale is in the locale set only when this build generated it.
      pseudoLocales: Object.freeze(
        request.configuration.locales.filter(
          (locale) => request.configuration.pseudoLocales[locale] !== undefined,
        ),
      ),
      personNameLocales: Object.freeze([
        ...request.configuration.personNameLocales,
      ]),
      aliases: frozenRecord(Object.entries(request.configuration.aliases)),
      formatting: Object.freeze({ ...request.configuration.formatting }),
      parentLocales: frozenRecord(
        Object.entries(request.configuration.parentLocales),
      ),
      scopes: Object.freeze(scopes),
      extensionDescriptors:
        request.extensions?.descriptors ?? Object.freeze([]),
      applicationContractFingerprint,
      semanticRegistryFingerprint,
    }),
    diagnostics,
  );
}
