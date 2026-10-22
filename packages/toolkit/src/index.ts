/**
 * What a build script or a plugin calls, and nothing else.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 2 draws the line: only high-level requests,
 * results, configuration, documented diagnostics and generated public contracts are consumer-facing,
 * and everything under them is an internal version boundary. So what this publishes is the four
 * project verbs, the interchange and authoring functions, the configuration and catalog parsers,
 * the extension surface a plugin registers through, the schemas of the public file formats, and
 * every type those signatures hold. The command line does not come through here; it imports the
 * modules it needs, so a name is published because a caller outside Equator needs it rather than
 * because Equator itself uses it.
 *
 * Section 1 of `specs/10-compiler-and-tooling.spec.md` keeps this package the whole of Equator's
 * build side, so nothing here reaches for a consumer's compiler, build system, or workspace
 * layout. Importing it starts no compilation, no watch and no write, which is what lets a build
 * script import one type from it without paying for anything else.
 */

export { formatCatalog, parseCatalog } from './catalog.js';
export type {
  Catalog,
  CatalogFamily,
  CatalogFormatOptions,
  CatalogMessage,
  CatalogParseOptions,
  CatalogRole,
  EmptyCatalogMessage,
  InputLiteral,
  InputRefinement,
  SlotRefinement,
  SlotShape,
  TextCatalogMessage,
} from './catalog.js';
export {
  EXTENSION_DESCRIPTOR_PROFILE,
  EXTENSION_REGISTRY_PROFILE,
  extensionDescriptor,
  defineExtensionRegistry,
} from './extensions.js';
export type {
  ExtensionDescriptor,
  ExtensionDescriptorInput,
  ExtensionRegistry,
  ExtensionValueType,
  FormattingAdapterDescriptorInput,
  IdentifierSegmentDescriptorInput,
  MessageFunctionDescriptorInput,
  ParsingAdapterDescriptorInput,
  RichSlotKindDescriptorInput,
} from './extensions.js';
export { parseConfiguration } from './configuration.js';
export type {
  ConfigurationParseOptions,
  InitConfiguration,
  ProjectConfiguration,
} from './configuration.js';
export type {
  ToolkitDiagnostic,
  ToolkitDiagnosticCode,
  ToolkitDiagnosticSeverity,
  ToolkitFailure,
  ToolkitResult,
  SourcePosition,
  SourceSpan,
  ToolkitSuccess,
} from './diagnostics.js';
export type { ProviderId, ScopeId } from './identities.js';
export type {
  MessageAttributeMap,
  MessageAttributeValue,
  MessageCatchallVariantKey,
  MessageCustomFunction,
  MessageDeclaration,
  MessageExpression,
  MessageFunctionReference,
  MessageLiteral,
  MessageLiteralVariantKey,
  MessageMarkup,
  MessageOptionMap,
  MessagePattern,
  MessagePatternPart,
  MessageSemanticModel,
  MessageValueReference,
  MessageVariableReference,
  MessageVariant,
  MessageVariantKey,
  PatternMessageSemanticModel,
  SelectMessageSemanticModel,
} from './message-format.js';
// `MessageCustomFunction` names this type, so a caller that builds one needs it. The table
// itself stays internal: it is the specification's own vocabulary, not something an application
// declares against.
export type { MessageOperandKind } from './message-function-options.js';
export type { CanonicalLocale } from './locales.js';
export {
  PSEUDO_LOCALE_BIDI,
  PSEUDO_LOCALE_ACCENTED,
} from './pseudo-locale-tags.js';
export { createPseudoCatalog } from './pseudo-localization.js';
export type {
  PseudoLocaleTransform,
  PseudoLocaleOptions,
} from './pseudo-localization.js';
export { exportXliff22, importXliff22 } from './xliff.js';
export type { XliffExportRequest, XliffImportRequest } from './xliff.js';
export {
  TOOLKIT_EVENT_CODES,
  TOOLKIT_OBSERVABILITY_PROFILE,
} from './observability.js';
export type {
  ToolkitEventCode,
  ToolkitEventPhase,
  ToolkitEventStatus,
  ToolkitObservabilityEvent,
  ToolkitObservabilityOptions,
  ToolkitObservabilitySink,
} from './observability.js';
export { diffCatalogSets } from './catalog-diff.js';
export type {
  CatalogDiff,
  CatalogDiffEntry,
  CatalogDiffKind,
  CatalogDiffRequest,
  CatalogDiffSnapshot,
  CatalogIdentityMove,
} from './catalog-diff.js';
export {
  applyAuthoredChangePlan,
  createMigrationPlan,
} from './authoring-transaction.js';
export type {
  ApplyAuthoredPlanOptions,
  ApplyAuthoredPlanResult,
  AuthoredChangeKind,
  AuthoredChangePlan,
  AuthoredFileChange,
  AuthoredFileChangeInput,
  MigrationPlanRequest,
} from './authoring-transaction.js';
export { planMessageRefactor } from './refactoring.js';
export type {
  MessageRefactorIdentity,
  MessageRefactorPlan,
  MessageRefactorRequest,
} from './refactoring.js';
export type { CanonicalJsonValue } from './canonical-json.js';
export { OUTPUT_PLAN_PROFILE } from './output-plan.js';
export type {
  OutputFileInput,
  OutputPlan,
  PlannedOutputFile,
} from './output-plan.js';
export type { ApplyOutputPlanResult, OutputFreshness } from './output-host.js';
export {
  CATALOG_DESCRIPTOR_PROFILE,
  COMPILED_IR_PROFILE,
  RESOURCE_SUMMARY_PROFILE,
} from './compiled-artifacts.js';
export type {
  ArtifactAddress,
  OwnerIdentity,
  CatalogResourceSummary,
  CatalogSetArtifact,
  CatalogSetDescriptor,
  CompiledCatalog,
  CompiledCatalogKey,
  CompiledLocalArtifacts,
  CompiledMessage,
  MessageResourceSummary,
  ProviderCatalogSet,
  RecoveryRepresentation,
} from './compiled-artifacts.js';
export { COMPILER_STATE_PROFILE, compileProject } from './compiler.js';
export type {
  CompileProjectRequest,
  CompileProjectResult,
  CompilerAnalysisInput,
  CompilerInputDigest,
  CompilerState,
  InvalidationDecision,
} from './compiler.js';
export { GENERATED_ABI_PROFILE } from './semantic-model.js';
export type {
  EffectiveInputContract,
  EffectiveSlotContract,
  PortableTypeId,
  ReferencedExtension,
  SemanticFamily,
  SemanticFamilyMember,
  SemanticFamilySegment,
  SemanticGraph,
  SemanticMessage,
  SemanticScope,
  SemanticTargetMessage,
} from './semantic-model.js';
export type {
  AnalysisSource,
  ApplicationAnalysis,
  ClaimedRouteSegment,
  ComponentTemplateAnalysis,
  MessageUsage,
  RouteCachingClass,
  RoutePolicyDeclaration,
  RouteProjection,
} from './static-analysis.js';
export {
  checkProject,
  cleanProject,
  compileProjectFromDisk,
  formatProject,
  generateProject,
  initializeProject,
  uninstallProject,
  watchProject,
} from './project-host.js';
export type {
  CheckProjectOptions,
  CheckProjectResult,
  CleanProjectOptions,
  FormatProjectOptions,
  FormatProjectResult,
  GenerateProjectOptions,
  GenerateProjectResult,
  InitProjectOptions,
  InitProjectResult,
  ProjectCompilation,
  ProjectSelection,
  UninstallProjectOptions,
  UninstallProjectResult,
  WatchCycle,
  WatchProjectOptions,
  WatchProjectResult,
} from './project-host.js';
export {
  CLI_RESULT_SCHEMA,
  CLI_WATCH_EVENT_SCHEMA,
  CONFIGURATION_SCHEMA,
  EXTENSION_REGISTRY_SCHEMA,
  SOURCE_CATALOG_SCHEMA,
  TARGET_CATALOG_SCHEMA,
} from './schemas.js';
