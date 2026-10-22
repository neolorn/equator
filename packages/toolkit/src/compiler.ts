/**
 * One request in, one complete answer out, with nothing of the machine in between.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 2 keeps this core deterministic and
 * framework-neutral: it takes the configuration, the catalogs, the owner and whatever is
 * optional beside them, and returns diagnostics, the semantic graph, an invalidation decision
 * and the artifacts. Process state, networking, filesystem mutation, scheduling and the watch
 * lifecycle are the host's, so the same inputs answer the same way whichever surface asked.
 */

import { isAbsolute, posix, relative, resolve, sep, win32 } from 'node:path';

import ts from 'typescript';

import {
  digestCanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from './canonical-json.js';
import {
  OBSERVABILITY_ARGUMENT,
  requireArgument,
  type ArgumentShape,
} from './call-arguments.js';
import { admitCatalog, type Catalog, type CatalogMessage } from './catalog.js';
import {
  admitConfiguration,
  type ProjectConfiguration,
} from './configuration.js';
import { parseProviderId } from './identities.js';
import { canonicalizeLocale } from './locales.js';
import {
  toolkitDiagnostic,
  toolkitFailure,
  toolkitSuccess,
  type ToolkitDiagnostic,
  type ToolkitResult,
} from './diagnostics.js';
import {
  compileLocalArtifacts,
  type OwnerIdentity,
  type CompiledLocalArtifacts,
} from './compiled-artifacts.js';
import { generateContracts } from './generated-contracts.js';
import {
  analyzeApplication,
  type AnalysisSource,
  type ApplicationAnalysis,
} from './static-analysis.js';
import {
  analyzeCatalogSet,
  type SemanticGraph,
  type SemanticScope,
} from './semantic-model.js';
import type { ExtensionRegistry } from './extensions.js';
import {
  TOOLKIT_EVENT_CODES,
  emitToolkitEvent,
  type ToolkitObservabilityOptions,
} from './observability.js';
import { compareCodeUnit } from './sorted-records.js';

/** The version stamp on the state a compilation carries forward, checked before one is reused. */
export const COMPILER_STATE_PROFILE = 'equator-compiler-state/1' as const;

/**
 * What the static analysis needs to read an application's own source and see which messages it
 * uses.
 *
 * Optional on a compilation. Without it the messages still compile; what is lost is everything
 * that depends on knowing the application: which messages nothing reaches, which routes are
 * localized, and where a message is used.
 */
export interface CompilerAnalysisInput {
  /** The directory paths are resolved against. */
  readonly projectRoot: string;
  /** The entry files to analyse from, which is usually what the application's own build compiles. */
  readonly rootNames: readonly string[];
  /** Source text supplied directly, for analysing something that is not on disk. */
  readonly sources?: readonly AnalysisSource[];
  /** The type names to look for, when the application names its handles something of its own. */
  readonly typeNames?: readonly string[];
  /** The most diagnostics to collect before stopping, so one broken file cannot fill a log. */
  readonly maxDiagnostics?: number;
  /** The options to compile the application's source under. */
  readonly compilerOptions?: ts.CompilerOptions;
  /**
   * Portable, machine-independent projection of `compilerOptions` used for
   * cache identity. Absolute paths never enter the digest.
   */
  readonly compilerOptionsDigestInput?: CanonicalJsonObject;
}

/** One input to a compilation, and a digest of what it held, for deciding what changed. */
export interface CompilerInputDigest {
  /** What the input is, as a stable name rather than an absolute path. */
  readonly identity: string;
  /** A digest of its content. */
  readonly digest: string;
}

/**
 * What one compilation remembers so the next can tell whether anything moved.
 *
 * Hand it back as `previousState` on the next run. Everything in it is machine-independent, so a
 * state written on one machine is usable on another and a cache survives a checkout somewhere else.
 */
export interface CompilerState {
  /** The state-shape version stamp. A state from another version is ignored rather than misread. */
  readonly profile: typeof COMPILER_STATE_PROFILE;
  /** A digest of every input together, which is the quick answer to whether anything changed. */
  readonly inputFingerprint: string;
  /** The inputs one by one, which is what says which of them changed. */
  readonly inputs: readonly CompilerInputDigest[];
  /** A digest of the files the compilation planned to write. */
  readonly outputPlanDigest: string;
}

export interface CompilerInputFingerprint {
  readonly inputFingerprint: string;
  readonly inputs: readonly CompilerInputDigest[];
}

/** What a compilation concluded about what had changed since the state it was given. */
export interface InvalidationDecision {
  /**
   * Whether there was a previous state at all, nothing changed, or something did.
   *
   * `initial` means the first run, or a state that could not be used.
   */
  readonly kind: 'initial' | 'none' | 'inputs-changed';
  /** Which inputs differ from the previous state. Empty when nothing did. */
  readonly changedInputs: readonly string[];
  /**
   * Every generated file the output plan holds when any input changed, and none when nothing did.
   * Any input can reach any of them through the complete graph, so none is left out.
   */
  readonly affectedOutputs: readonly string[];
}

/**
 * Everything one compilation needs, with nothing read from disk.
 *
 * What `compileProject` takes. The file reading is `compileProjectFromDisk`'s job, so a
 * caller that already has its catalogs in memory, a test or an editor integration, compiles without
 * writing them out first.
 */
export interface CompileProjectRequest extends ToolkitObservabilityOptions {
  /** The project's locales, scopes and options, parsed. */
  readonly configuration: ProjectConfiguration;
  /** The catalogs to compile, source and target alike. */
  readonly catalogs: readonly Catalog[];
  /** Who this output belongs to; see {@link OwnerIdentity}. */
  readonly owner: OwnerIdentity;
  /** The extensions the messages may call. Leaving it out refuses a message that calls one. */
  readonly extensions?: ExtensionRegistry;
  /** What to analyse the application's own source with. Without it, usage is not measured. */
  readonly analysis?: CompilerAnalysisInput;
  /**
   * The messages to compile separately, for the failure path.
   *
   * These are readable when no catalog could be loaded, which is what the recovery region shows.
   * Detected from the application's source when the analysis runs, and passed here otherwise.
   */
  readonly recoveryMessageIdentities?: readonly string[];
  /** What the previous compilation remembered, which is what makes this one incremental. */
  readonly previousState?: CompilerState;
  /** Release-gate completeness: see CatalogSetAnalysisRequest.requireCompleteTargets. */
  readonly requireCompleteTargets?: boolean;
}

/** Everything a compilation produced, in memory. Nothing here has been written. */
export interface CompileProjectResult {
  /** The whole project analysed: every locale, scope and message, with their contracts. */
  readonly graph: SemanticGraph;
  /** What reading the application's own source found. Absent when no analysis was asked for. */
  readonly analysis?: ApplicationAnalysis;
  /** The compiled catalogs, the descriptor, the recovery messages, and what writes them. */
  readonly artifacts: CompiledLocalArtifacts;
  /** What to hand back as `previousState` next time. */
  readonly state: CompilerState;
  /** What changed since the state this run was given. */
  readonly invalidation: InvalidationDecision;
}

/**
 * Source messages nothing reaches.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 6 makes this a grouped source-located
 * advisory with an optional safe cleanup preview, and keeps friendly mode from deleting the
 * message, failing the compilation, writing a tombstone, or requiring a waiver or a
 * suppression ledger. Reachability is already collected and load-bearing (it drives message usages,
 * recovery-root detection and route extraction), so the advisory adds no analysis, only the report
 * that lets an owner see what its catalogs are still carrying.
 *
 * Grouped into one diagnostic per scope rather than one per message: a catalog that has drifted
 * has drifted by dozens, and dozens of separate advisories would bury the errors underneath them.
 * Reported only when the analysis ran, because without a TypeScript graph every message is
 * unreachable and the advisory would be noise rather than information.
 */
/**
 * Scopes the first render does not use.
 *
 * A scope is deferred when it is used and every use sits behind a lazy route boundary. Used
 * nowhere Equator can see is not the same thing: that scope stays a startup scope, because absence
 * of evidence is not evidence that a route will not reach it, and being wrong in that direction
 * renders a component whose text never arrives.
 */
function deferredScopeIds(
  graph: SemanticGraph,
  analysis: ApplicationAnalysis,
): readonly string[] {
  const deferredPaths = new Set(analysis.deferredSourcePaths);
  // A message used in a component's template is reported against the template, which is the file
  // a developer opens to change it. The module graph has never heard of that file: a `.html` is
  // not imported by anything, so read literally every template usage sits outside every lazy
  // boundary and no scope a template uses could ever be deferred. Reachability is a question
  // about modules, so it is asked about the component that owns the template.
  const owningSource = new Map<string, string>();
  for (const component of analysis.components) {
    owningSource.set(component.templatePath, component.sourcePath);
  }
  const scopeOf = new Map<string, string>();
  for (const scope of graph.scopes) {
    for (const message of scope.messages)
      scopeOf.set(message.identity, scope.scopeId);
  }
  const seen = new Set<string>();
  const eager = new Set<string>();
  for (const usage of analysis.messageUsages) {
    const scopeId = scopeOf.get(usage.identity);
    if (scopeId === undefined) continue;
    seen.add(scopeId);
    const path = owningSource.get(usage.sourcePath) ?? usage.sourcePath;
    if (!deferredPaths.has(path)) eager.add(scopeId);
  }
  return Object.freeze(
    [...seen].filter((scopeId) => !eager.has(scopeId)).sort(compareCodeUnit),
  );
}

/**
 * The scopes a route has to have ready before it renders.
 *
 * Every startup scope, plus the scopes used by the files this route brings in behind its own lazy
 * boundary. The startup ones are in the list even though bootstrap already loaded them, because
 * "startup" means loaded for the locale the page started in, and a locale transition has to have
 * every scope the page renders ready in the *new* locale before it commits. Leaving them out
 * committed a locale whose shell catalog had not arrived, and the shell then failed to evaluate.
 */
function routeScopes(
  graph: SemanticGraph,
  analysis: ApplicationAnalysis,
  deferredSourcePaths: readonly string[],
): readonly { readonly providerId: string; readonly scopeId: string }[] {
  const deferred = new Set(deferredSourcePaths);
  const owningSource = new Map<string, string>();
  for (const component of analysis.components) {
    owningSource.set(component.templatePath, component.sourcePath);
  }
  const scopeOf = new Map<string, SemanticScope>();
  for (const scope of graph.scopes) {
    for (const message of scope.messages) scopeOf.set(message.identity, scope);
  }
  const needed = new Map<string, { providerId: string; scopeId: string }>();
  for (const usage of analysis.messageUsages) {
    const path = owningSource.get(usage.sourcePath) ?? usage.sourcePath;
    if (!deferred.has(path)) continue;
    const scope = scopeOf.get(usage.identity);
    if (scope === undefined) continue;
    const key = `${scope.providerId}\u0000${scope.scopeId}`;
    if (!needed.has(key)) {
      needed.set(key, {
        providerId: scope.providerId,
        scopeId: scope.scopeId,
      });
    }
  }
  const deferredScopes = new Set(deferredScopeIds(graph, analysis));
  for (const scope of graph.scopes) {
    if (deferredScopes.has(scope.scopeId)) continue;
    const key = `${scope.providerId}\u0000${scope.scopeId}`;
    if (!needed.has(key)) {
      needed.set(key, {
        providerId: scope.providerId,
        scopeId: scope.scopeId,
      });
    }
  }
  return Object.freeze(
    [...needed.values()]
      .sort((left, right) => compareCodeUnit(left.scopeId, right.scopeId))
      .map((scope) => Object.freeze(scope)),
  );
}

function unusedSourceMessages(
  graph: SemanticGraph,
  analysis: ApplicationAnalysis,
): readonly ToolkitDiagnostic[] {
  const reached = new Set([
    ...analysis.messageUsages.map(({ identity }) => identity),
    ...analysis.recoveryMessageIdentities,
  ]);
  const diagnostics: ToolkitDiagnostic[] = [];
  for (const scope of graph.scopes) {
    const unused = scope.messages
      .filter(({ identity }) => !reached.has(identity))
      .map(({ messageId }) => messageId)
      .sort(compareCodeUnit);
    if (unused.length === 0) continue;
    const listed = unused.slice(0, 20);
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1311',
        `Scope ${scope.scopeId} defines ${unused.length} source ${
          unused.length === 1 ? 'message' : 'messages'
        } nothing reaches: ${listed.map((id) => JSON.stringify(id)).join(', ')}${
          unused.length > listed.length
            ? `, and ${unused.length - listed.length} more`
            : ''
        }. Removing them changes no rendered output. Reachability is the program the consumer builds, so a message used only from a file outside it, a test for instance, reads as unreached here.`,
        { severity: 'info' },
      ),
    );
  }
  return Object.freeze(diagnostics);
}

function canonicalValue(value: object): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value)) as CanonicalJsonValue;
}

function catalogMessageInput(message: CatalogMessage): object {
  return {
    kind: message.kind,
    ...(message.kind === 'message'
      ? { canonicalSource: message.semantics.canonicalSource }
      : {}),
    ...(message.description === undefined
      ? {}
      : { description: message.description }),
    ...(message.context === undefined ? {} : { context: message.context }),
    inputs: message.inputs,
    slots: message.slots,
  };
}

/**
 * An analysis input's name relative to the project, which is what a compilation's state holds.
 *
 * `argument` is the member of the request that named the file, so a refusal says which one.
 */
function portableAnalysisPath(
  projectRoot: string,
  path: string,
  argument: string,
): string {
  const absolute = isAbsolute(path)
    ? resolve(path)
    : resolve(projectRoot, path);
  const portable = relative(projectRoot, absolute);
  if (
    portable === '..' ||
    portable.startsWith(`..${sep}`) ||
    isAbsolute(portable)
  ) {
    throw new TypeError(
      `compileProject: ${argument} must be a file inside request.analysis.projectRoot, and ${JSON.stringify(path)} is outside it.`,
    );
  }
  // Split by this platform's separator, so a backslash left inside a segment is one a POSIX file
  // name holds. Windows reads that character as a separator, so the name is not one file on both.
  // relative() resolves both paths first, so no segment is ".", a ".." can only lead and is refused
  // above, and an empty segment is the project itself.
  const segments = portable.split(sep);
  const normalized = segments.join('/');
  if (
    normalized.normalize('NFC') !== normalized ||
    segments.some((segment) => segment === '' || segment.includes('\\'))
  ) {
    throw new TypeError(
      `compileProject: ${argument} must be a portable file name under request.analysis.projectRoot, and ${JSON.stringify(path)} is not one.`,
    );
  }
  return normalized;
}

function compilerInputDigests(
  request: CompileProjectRequest,
): readonly CompilerInputDigest[] {
  const inputs: CompilerInputDigest[] = [
    Object.freeze({
      identity: 'configuration',
      digest: digestCanonicalJson(
        'equator-compiler-configuration-input/1',
        canonicalValue(request.configuration),
      ),
    }),
  ];
  if (request.extensions !== undefined) {
    inputs.push(
      Object.freeze({
        identity: 'extension-registry',
        digest: request.extensions.fingerprint,
      }),
    );
  }
  if (request.analysis !== undefined) {
    const projectRoot = resolve(request.analysis.projectRoot);
    inputs.push(
      Object.freeze({
        identity: 'analysis-graph',
        digest: digestCanonicalJson('equator-compiler-analysis-graph/1', {
          rootNames: [...request.analysis.rootNames]
            .map((path, index) =>
              portableAnalysisPath(
                projectRoot,
                path,
                `request.analysis.rootNames[${index}]`,
              ),
            )
            .sort(compareCodeUnit),
          ...(request.analysis.typeNames === undefined
            ? {}
            : {
                typeNames: [...request.analysis.typeNames].sort(
                  compareCodeUnit,
                ),
              }),
          ...(request.analysis.compilerOptionsDigestInput === undefined
            ? {}
            : { compilerOptions: request.analysis.compilerOptionsDigestInput }),
        }),
      }),
    );
  }
  const recoveryMessageIdentities = request.recoveryMessageIdentities ?? [];
  if (recoveryMessageIdentities.length > 0) {
    inputs.push(
      Object.freeze({
        identity: 'recovery-message-identities',
        digest: digestCanonicalJson(
          'equator-compiler-recovery-input/1',
          [...recoveryMessageIdentities].sort(compareCodeUnit),
        ),
      }),
    );
  }
  for (const catalog of request.catalogs) {
    inputs.push(
      Object.freeze({
        identity: `catalog:${catalog.providerId}:${catalog.scopeId}:${catalog.locale}:${catalog.role}`,
        digest: digestCanonicalJson(
          'equator-compiler-catalog-input/1',
          canonicalValue({
            role: catalog.role,
            providerId: catalog.providerId,
            scopeId: catalog.scopeId,
            locale: catalog.locale,
            messages: Object.fromEntries(
              Object.entries(catalog.messages).map(([id, message]) => [
                id,
                catalogMessageInput(message),
              ]),
            ),
            families: catalog.families,
          }),
        ),
      }),
    );
  }
  const { analysis } = request;
  if (analysis?.sources !== undefined) {
    const projectRoot = resolve(analysis.projectRoot);
    for (const [index, source] of analysis.sources.entries()) {
      const sourcePath = portableAnalysisPath(
        projectRoot,
        source.path,
        `request.analysis.sources[${index}].path`,
      );
      inputs.push(
        Object.freeze({
          identity: `source:${sourcePath}`,
          digest: digestCanonicalJson(
            'equator-compiler-static-source-input/1',
            source.contents,
          ),
        }),
      );
    }
  }
  inputs.sort((left, right) => compareCodeUnit(left.identity, right.identity));
  return Object.freeze(inputs);
}

export function fingerprintCompilerInputs(
  request: CompileProjectRequest,
): CompilerInputFingerprint {
  const inputs = compilerInputDigests(request);
  return Object.freeze({
    inputs,
    inputFingerprint: digestCanonicalJson(
      'equator-compiler-input-set/1',
      inputs.map(({ identity, digest }) => ({ identity, digest })),
    ),
  });
}

/**
 * A compiler state as it came back, with the stamp saying which compiler wrote it still unread.
 *
 * The state is carried across runs, which means it is read from wherever the caller kept it. A
 * state written by another version of the compiler is the case the profile exists to catch.
 */
type ReceivedCompilerState = Omit<CompilerState, 'profile'> & {
  readonly profile: unknown;
};

function invalidationDecision(
  previous: ReceivedCompilerState | undefined,
  inputs: readonly CompilerInputDigest[],
  affectedOutputs: readonly string[],
): InvalidationDecision {
  if (previous === undefined || previous.profile !== COMPILER_STATE_PROFILE) {
    return Object.freeze({
      kind: 'initial',
      changedInputs: Object.freeze(inputs.map(({ identity }) => identity)),
      affectedOutputs: Object.freeze([...affectedOutputs]),
    });
  }
  const prior = new Map(
    previous.inputs.map((input) => [input.identity, input.digest]),
  );
  const current = new Map(
    inputs.map((input) => [input.identity, input.digest]),
  );
  const changedInputs = [...new Set([...prior.keys(), ...current.keys()])]
    .filter((identity) => prior.get(identity) !== current.get(identity))
    .sort(compareCodeUnit);
  return Object.freeze({
    kind: changedInputs.length === 0 ? 'none' : 'inputs-changed',
    changedInputs: Object.freeze(changedInputs),
    affectedOutputs: Object.freeze(
      changedInputs.length === 0 ? [] : [...affectedOutputs],
    ),
  });
}

function virtualModules(
  files: readonly { readonly path: string; readonly contents: string }[],
) {
  return [
    ...files
      .filter(({ path }) => path.endsWith('.ts'))
      .map(({ path, contents }) => ({
        specifier:
          path === 'index.ts' ? '#i18n' : `#i18n/${path.replace(/\.ts$/u, '')}`,
        contents,
      })),
    {
      specifier: '#i18n/catalog-set',
      contents:
        "import type { CatalogSetDescriptor } from '@neolorn/equator';\nexport declare const catalogSet: CatalogSetDescriptor;\n",
    },
    {
      specifier: '#i18n/catalog-loaders',
      contents:
        "import type { CatalogLoaders } from '@neolorn/equator';\nexport declare const catalogLoaders: CatalogLoaders;\n",
    },
    {
      specifier: '#i18n/recovery-payload',
      contents:
        "import type { RecoveryRepresentation } from '@neolorn/equator';\nexport declare const recoveryPayload: readonly RecoveryRepresentation[];\n",
    },
    {
      specifier: '#i18n/person-names',
      contents:
        "import type { PersonNameProfileSet } from '@neolorn/equator';\nexport declare const personNames: PersonNameProfileSet;\n",
    },
  ];
}

/**
 * The whole compilation, in the order `specs/05-compiled-artifacts-and-trust.spec.md` section 4
 * states it, returning a failure rather than a partial result at every step.
 *
 * Nothing is written from here. The result carries one output plan and publication is a separate
 * call, so a compilation that stops halfway leaves no half-written generated root behind it.
 */
function compileProjectCore(
  request: CompileProjectRequest,
): ToolkitResult<CompileProjectResult> {
  const diagnostics: ToolkitDiagnostic[] = [];
  const graph = analyzeCatalogSet({
    configuration: request.configuration,
    catalogs: request.catalogs,
    ...(request.extensions === undefined
      ? {}
      : { extensions: request.extensions }),
    ...(request.requireCompleteTargets === undefined
      ? {}
      : { requireCompleteTargets: request.requireCompleteTargets }),
  });
  if (!graph.ok) return graph;
  diagnostics.push(...graph.diagnostics);

  // The provider is in the provisional overlay too, as a declaration. It is the only thing an
  // application imports from `#i18n` to compose the runtime, so an overlay without it makes every
  // real consumer look like one that composes nothing, and reports the import it does have as
  // unresolved.
  //
  // `specs/10-compiler-and-tooling.spec.md` section 3 is the run this belongs to: the overlay
  // serves the analysis pass and is never written, imported at run time, or cached as an
  // authority for what a clean generation produces.
  const provisionalContracts = generateContracts(graph.value, {
    provider: 'declaration',
    ...(request.recoveryMessageIdentities === undefined
      ? {}
      : { recoveryMessageIdentities: request.recoveryMessageIdentities }),
  });
  if (!provisionalContracts.ok) return provisionalContracts;
  diagnostics.push(...provisionalContracts.diagnostics);

  let analysis: ApplicationAnalysis | undefined;
  if (request.analysis !== undefined) {
    const analyzed = analyzeApplication({
      projectRoot: request.analysis.projectRoot,
      rootNames: request.analysis.rootNames,
      ...(request.analysis.sources === undefined
        ? {}
        : { sources: request.analysis.sources }),
      ...(request.analysis.maxDiagnostics === undefined
        ? {}
        : { maxDiagnostics: request.analysis.maxDiagnostics }),
      ...(request.analysis.typeNames === undefined
        ? {}
        : { typeNames: request.analysis.typeNames }),
      ...(request.analysis.compilerOptions === undefined
        ? {}
        : { compilerOptions: request.analysis.compilerOptions }),
      virtualModules: virtualModules(provisionalContracts.value),
      knownMessageIdentities: graph.value.scopes.flatMap((scope) =>
        scope.messages.map(({ identity }) => identity),
      ),
    });
    if (!analyzed.ok) return analyzed;
    diagnostics.push(...analyzed.diagnostics);
    analysis = analyzed.value;
  }

  const recoveryMessageIdentities = Object.freeze(
    [
      ...(request.recoveryMessageIdentities ?? []),
      ...(analysis?.recoveryMessageIdentities ?? []),
    ]
      .filter((identity, index, values) => values.indexOf(identity) === index)
      .sort(compareCodeUnit),
  );

  if (
    analysis?.selectsApplicationRuntime === true &&
    recoveryMessageIdentities.length === 0
  ) {
    // `specs/10-compiler-and-tooling.spec.md` section 10: for an owner that selects an
    // application runtime, a missing recovery root is a protected correctness error in both
    // generate and bare check. The rule depends on the analysis telling that an owner has selected
    // one; without it, an owner that authors recovery copy and never selects it passes both
    // commands silently, and the first anyone learns of it is a blank page.
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1310',
        'This owner composes the Equator application runtime but selects no recovery message. Pass one to provideLocalization through withRecoveryMessage so a failed bootstrap can still say something.',
      ),
    );
  }

  // The locale set, stated twice, compared once.
  //
  // `equator.config.json` says which locales this owner has catalogs for. The route policy says
  // which locales have addresses. They are separate statements in separate files and they have to
  // agree, and this is where they are compared.
  //
  // Both directions are wrong and they fail differently, which is why both are reported rather than
  // one being treated as the source of truth. A locale with catalogs and no address cannot be
  // reached: the translations exist and nothing can navigate to them. A locale with an address and
  // no catalogs is worse, because it resolves: the address works and every message on the page
  // falls back to the default language, which looks like a translation gap rather than a
  // configuration mistake.
  //
  // An error rather than a warning. Unlike the route-coverage warnings, neither direction here has a
  // legitimate form: there is no application that means to have a locale in one list and not the
  // other, and both symptoms are silent at runtime.
  const policyLocales = analysis?.routePolicy;
  if (policyLocales !== undefined && policyLocales.locales.length > 0) {
    const canonical = (value: string): string => {
      const result = canonicalizeLocale(value);
      return result.ok ? result.value : value;
    };
    const declared = new Set(policyLocales.locales.map(canonical));
    const configured = new Set(graph.value.locales.map(canonical));
    // A declared pseudo-locale is exempt from both directions, and the reason is the same one:
    // whether it exists in a given build is decided by the build, while the locale URL policy is a
    // source file that cannot vary per build. Binding the two would make one of them wrong in every
    // build of the other kind.
    //
    // Forward, configured but unaddressable, is a pseudo-locale's ordinary state. It is a
    // development view of the product, not a locale the product serves, and requiring an address
    // would put a fabricated locale into what the application advertises: its alternate-language
    // links and its sitemap. It would also mean enabling a pseudo-locale required a source edit,
    // which is the one thing this feature must not need.
    //
    // Reverse, addressed but not configured, is what a consumer gets the moment they do give
    // one an address, which they must to server-render or prerender it. That address is written
    // once, in source; the catalog behind it exists only in a build that asked for it. Without this
    // exemption, adding the address would fail every production build.
    //
    // Neither exemption weakens the check for anything else: an ordinary locale missing from either
    // list is still an error, and a locale in the policy that is neither configured nor declared as
    // a pseudo-locale is still an error.
    const pseudoLocales = new Set(
      Object.keys(request.configuration.pseudoLocales).map(canonical),
    );
    const missingFromPolicy = [...configured]
      .filter((locale) => !declared.has(locale) && !pseudoLocales.has(locale))
      .sort(compareCodeUnit);
    const missingFromConfiguration = [...declared]
      .filter((locale) => !configured.has(locale) && !pseudoLocales.has(locale))
      .sort(compareCodeUnit);
    const span = {
      path: ['routes', policyLocales.sourcePath] as readonly string[],
    };
    if (missingFromPolicy.length > 0) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1408',
          `${missingFromPolicy.map((locale) => JSON.stringify(locale)).join(', ')} ${missingFromPolicy.length === 1 ? 'is a configured locale' : 'are configured locales'} that this owner's locale URL policy gives no address. Catalogs are generated for ${missingFromPolicy.length === 1 ? 'it' : 'them'} and nothing can navigate to ${missingFromPolicy.length === 1 ? 'it' : 'them'}. Add ${missingFromPolicy.length === 1 ? 'it' : 'them'} to the policy, or remove ${missingFromPolicy.length === 1 ? 'it' : 'them'} from the configuration.`,
          span,
        ),
      );
    }
    if (missingFromConfiguration.length > 0) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1408',
          `${missingFromConfiguration.map((locale) => JSON.stringify(locale)).join(', ')} ${missingFromConfiguration.length === 1 ? 'has an address' : 'have addresses'} in this owner's locale URL policy and no catalogs. ${missingFromConfiguration.length === 1 ? 'That address resolves' : 'Those addresses resolve'} and every message renders in the default locale, which reads as missing translations rather than as a missing locale. Add ${missingFromConfiguration.length === 1 ? 'it' : 'them'} to the configuration, or remove ${missingFromConfiguration.length === 1 ? 'it' : 'them'} from the policy.`,
          span,
        ),
      );
    }
    if (
      policyLocales.defaultLocale !== undefined &&
      canonical(policyLocales.defaultLocale) !==
        canonical(graph.value.defaultLocale)
    ) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1408',
          `This owner's configuration makes ${JSON.stringify(graph.value.defaultLocale)} the default locale and its locale URL policy makes ${JSON.stringify(policyLocales.defaultLocale)} the default. The policy's default decides which addresses carry no prefix and which locale an unprefixed address means, so the two disagreeing sends visitors to a different locale than the one the application falls back to.`,
          span,
        ),
      );
    }
  }

  // A policy the comparison above and the one below could not read whole.
  //
  // Both stay silent about an option they did not read, because reporting what a constant or a
  // spread might hold would block an application that is right. Silence alone reads as agreement,
  // so the build says which options it left unchecked. Advisory, because building a policy from
  // values a build cannot see is not a mistake.
  if (policyLocales !== undefined && policyLocales.unreadOptions.length > 0) {
    const names = policyLocales.unreadOptions.map((name) => `\`${name}\``);
    const one = names.length === 1;
    const listed = one
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1417',
        `This owner's locale URL policy takes ${listed} from something the build does not evaluate: a constant, a function, a spread, or a key that is not a literal. EQ1408 and EQ1409 were not checked for what ${one ? 'it holds' : 'they hold'}, so a locale with no address or no catalogs, a different default locale, or a route that begins with a segment the policy claims is not reported there. Write ${one ? 'it' : 'them'} out as literals in the call that builds the policy to have both checked.`,
        { path: ['routes', policyLocales.sourcePath], severity: 'info' },
      ),
    );
  }

  // A canonical route whose leading segment is one the policy already owns.
  //
  // The policy claims the first segment of an address before any route does: a locale prefix names
  // the locale and is removed, an alias redirects, a locale-neutral root is answered by nothing. A
  // route declared at `ar-eg/tools` under an `ar-eg` prefix is therefore not a route at a free
  // address: it is an address the resolver reads as the ar-EG locale and a route called `tools`,
  // and the declared route is unreachable at the address it declared. `buildLocalizedRoute` will
  // hand out that address, `localizedServerRoutes` will schedule a rendered file at it, and
  // `toInternalPath` will strip the segment and lose the route.
  //
  // This is the first point in a build that holds both statements. The policy is one source file
  // and the route projection is another; the validator that checks the projection is handed no
  // policy at all, and the runtime functions that meet both meet them one address at a time, after
  // the build has finished. So the whole-projection question is asked here or nowhere.
  //
  // Every route is checked, not only those whose addresses drop the prefix. Under `omitDefaultPrefix`
  // the collision is what a visitor gets; under full prefixing it is what the canonical layer, the
  // authored Angular route table, and every internal address carry. The address exists either way.
  //
  // A leading segment that is a route parameter is not checked here and cannot be: whether a slug
  // serializes to something the policy owns is decided per value, at runtime, which is where the
  // matching refusal lives.
  if (
    analysis?.routePolicy !== undefined &&
    analysis.routePolicy.claimedSegments.length > 0
  ) {
    const {
      routePolicy: policyDeclaration,
      routes,
      templateAddresses,
    } = analysis;
    const exact = new Map(
      policyDeclaration.claimedSegments
        .filter((claim) => claim.kind === 'locale-neutral root')
        .map((claim) => [claim.segment, claim] as const),
    );
    const folded = new Map(
      policyDeclaration.claimedSegments
        .filter((claim) => claim.kind !== 'locale-neutral root')
        .map((claim) => [claim.segment.toLowerCase(), claim] as const),
    );
    for (const route of routes) {
      const leading = route.path.split('/')[0];
      if (leading === undefined || leading.length === 0) continue;
      if (leading.startsWith(':')) continue;
      const claim = exact.get(leading) ?? folded.get(leading.toLowerCase());
      if (claim === undefined) continue;
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1409',
          `Route ${JSON.stringify(route.id)} is declared at ${JSON.stringify(`/${route.path}`)} and its leading segment ${JSON.stringify(leading)} is this owner's ${claim.kind} ${JSON.stringify(claim.segment)}. Equator reads the first segment of an address as the ${claim.kind} before it reads it as a route, so this route is unreachable at its own address and Equator will publish addresses for it that it cannot resolve. Rename the route's leading segment, or spell the ${claim.kind} differently in ${JSON.stringify(policyDeclaration.sourcePath)}.`,
          { path: ['routes', route.sourcePath] },
        ),
      );
    }

    // A template that writes a locale into an address it hands to the Router.
    //
    // The contract this defends: a consumer writes `routerLink="/articles/x"` and never
    // `/ar-eg/articles/x`. Nothing enforced the never, so the first place the mistake was
    // reported was a console warning in development, after the click, to whoever happened to be
    // looking.
    //
    // `routerLink` alone, and the reason is what Equator transforms rather than what the HTML
    // specification calls a URL. A click hands the Router the address as written, and
    // `UrlHandlingStrategy.extract` resolves it to its canonical form before anything matches it:
    // the prefix is removed and the page renders in the locale that is committed now. So the link
    // cannot do the one thing its address says it does, whichever locale the reader is in. An
    // `href` is a different mechanism (a full-page address the browser supplies, which
    // `LocationStrategy.path()` delocalizes on arrival) so a locale in one works, and a link to
    // another locale's page is legitimate content.
    //
    // Error, with no warning half, because unlike a static `lang` there is no legitimate form. A
    // deliberately locale-pinned `routerLink` is not a stricter version of the same thing; it is an
    // address the Router will not honour.
    //
    // Judged against the claimed segments and not the locale set, which is what makes this the
    // sibling of the check above rather than a widening of EQ1410. A policy may spell a prefix
    // differently from the tag, and an alias is claimed too. `folded` is asked and `exact` is not,
    // so the neutral roots are excluded: a locale-neutral root is the one leading segment a
    // policy claims that survives the resolution, so an address that begins with one goes where it
    // says and is correct.
    for (const address of templateAddresses) {
      const leading = address.address.split('/')[1];
      if (leading === undefined || leading.length === 0) continue;
      const claim = folded.get(leading.toLowerCase());
      if (claim === undefined) continue;
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1411',
          `The template of ${JSON.stringify(address.componentName)} writes routerLink=${JSON.stringify(address.address)}, whose leading segment ${JSON.stringify(leading)} is this owner's ${claim.kind} ${JSON.stringify(claim.segment)}. Equator resolves a routerLink to its canonical address before the Router matches it, so the locale in this one is discarded and the link opens the page in whichever locale is committed. Write the canonical address without the ${claim.kind}, ${JSON.stringify(address.address.slice(leading.length + 1) || '/')}, and change locale with "Localization.changeLocale()", which is the operation that moves the reader between locales.`,
          { path: ['components', address.templatePath] },
        ),
      );
    }
  }

  // A template that spells out a locale.
  //
  // A switcher written by hand carries the same thing three or four times per option: the locale as
  // a string, the option's language as a static `lang`, its direction as a static `dir`, and its
  // name in its own language as literal text. All four are answers Equator already has, and every
  // one of them is authored again for each locale, in each template, in a language the author may
  // not read. Adding a locale then means finding every one of those places, and nothing fails when
  // one is missed: the option simply reads wrongly, aloud, to the people who need it most.
  //
  // Judged here rather than in the analysis, which reports what a template says and does not hold
  // the locale set. The same division `routePolicy` is checked under.
  //
  // Two severities, because the two halves are not equally wrong.
  //
  // A locale spelled as a string inside a template expression is an error. There is no form of it
  // that survives a locale being added: the expression is either a switch to a locale the template
  // names, or a branch on one, and in both cases the template has to be edited for a change that
  // belongs in the configuration. Equator has the list.
  //
  // A static `lang` is a warning, because there is one legitimate form and this check cannot tell
  // it apart: a page carrying a fixed passage in another language marks that passage up exactly
  // this way, and a quotation in a language the application also serves is correct HTML. What the
  // warning can do is say so where the author is looking, with the thing to use instead named.
  if (analysis !== undefined && analysis.localeMentions.length > 0) {
    const canonical = (value: string): string => {
      const result = canonicalizeLocale(value);
      return result.ok ? result.value.toLowerCase() : value.toLowerCase();
    };
    const configured = new Set(graph.value.locales.map(canonical));
    // The primary language subtag is the first subtag of a canonical tag, by the grammar. `lang` on
    // a single option is written as the bare subtag (`en`, not `en-US`) so both spellings have
    // to be recognised or the check misses the exact shape it exists for.
    const languages = new Set(
      [...configured].map((locale) => locale.split('-')[0] ?? locale),
    );
    for (const mention of analysis.localeMentions) {
      const text = canonical(mention.text);
      const names =
        mention.kind === 'literal'
          ? configured.has(text)
          : configured.has(text) || languages.has(text);
      if (!names) continue;
      const what =
        mention.kind === 'literal'
          ? `names the locale ${JSON.stringify(mention.text)} as a literal`
          : mention.siblingDirection === undefined
            ? `writes lang=${JSON.stringify(mention.text)} by hand`
            : `writes lang=${JSON.stringify(mention.text)} and dir=${JSON.stringify(mention.siblingDirection)} by hand`;
      const literal = mention.kind === 'literal';
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1410',
          `The template of ${JSON.stringify(mention.componentName)} ${what}. Equator already knows every configured locale, its language subtag, its direction and its name in its own language: read them from "localization.localeChoices()" and put "[localeChoice]" on the control, which writes lang, dir, aria-current and aria-busy and performs the switch. A switcher built that way gains a locale when the configuration gains one.${literal ? '' : ' If this is a fixed passage in another language rather than a locale control, this is the right markup and the warning is expected.'}`,
          {
            ...(literal ? {} : { severity: 'warning' as const }),
            path: ['components', mention.templatePath],
          },
        ),
      );
    }
  }

  if (analysis !== undefined) {
    diagnostics.push(...unusedSourceMessages(graph.value, analysis));
  }

  const deferredScopes =
    analysis === undefined ? [] : deferredScopeIds(graph.value, analysis);

  const contracts = generateContracts(graph.value, {
    // Passed whenever the pass ran, empty included. An analysis that found nothing behind a lazy
    // boundary knows that every scope is needed at startup, and a generation with no analysis
    // knows nothing about either; omitting the option for both would collapse the two answers the
    // generated table exists to tell apart.
    ...(analysis === undefined ? {} : { deferredScopeIds: deferredScopes }),
    ...(recoveryMessageIdentities.length === 0
      ? {}
      : { recoveryMessageIdentities }),
    ...(analysis === undefined
      ? {}
      : {
          routes: analysis.routes.map(
            ({
              id,
              path,
              parameterNames,
              indexing,
              caching,
              sitemap,
              sourcePath,
              deferredSourcePaths,
            }) => {
              const scopes = routeScopes(
                graph.value,
                analysis,
                deferredSourcePaths,
              );
              return {
                ...(scopes.length === 0 ? {} : { scopes }),
                id,
                path,
                parameterNames,
                ...(indexing === undefined ? {} : { indexing }),
                ...(caching === undefined ? {} : { caching }),
                ...(sitemap === undefined ? {} : { sitemap }),
                sourcePath,
              };
            },
          ),
        }),
  });
  if (!contracts.ok) return contracts;
  diagnostics.push(...contracts.diagnostics);
  const artifacts = compileLocalArtifacts({
    graph: graph.value,
    catalogs: request.catalogs,
    owner: request.owner,
    contractFiles: contracts.value,
    ...(recoveryMessageIdentities.length === 0
      ? {}
      : { recoveryMessageIdentities }),
  });
  if (!artifacts.ok) return artifacts;
  diagnostics.push(...artifacts.diagnostics);

  const { inputs, inputFingerprint } = fingerprintCompilerInputs(request);
  const state: CompilerState = Object.freeze({
    profile: COMPILER_STATE_PROFILE,
    inputFingerprint,
    inputs,
    outputPlanDigest: artifacts.value.outputPlan.planDigest,
  });
  const invalidation = invalidationDecision(
    request.previousState,
    inputs,
    artifacts.value.outputPlan.files.map(({ path }) => path),
  );
  return toolkitSuccess(
    Object.freeze({
      graph: graph.value,
      ...(analysis === undefined ? {} : { analysis }),
      artifacts: artifacts.value,
      state,
      invalidation,
    }),
    diagnostics,
  );
}

const COMPILE_PROJECT_REQUEST: ArgumentShape = {
  required: {
    configuration: 'record',
    catalogs: ['record'],
    owner: { required: { providerId: 'text', generatedRootPath: 'text' } },
  },
  optional: {
    extensions: 'record',
    analysis: {
      required: { projectRoot: 'text', rootNames: ['text'] },
      optional: {
        sources: [{ required: { path: 'text', contents: 'text' } }],
        typeNames: ['text'],
        maxDiagnostics: 'number',
        compilerOptions: 'record',
        compilerOptionsDigestInput: 'data',
      },
    },
    recoveryMessageIdentities: ['text'],
    previousState: 'record',
    requireCompleteTargets: 'flag',
    observability: OBSERVABILITY_ARGUMENT,
  },
};

/**
 * Compiles a request once its configuration and catalogs have been judged.
 *
 * A caller can hand over a configuration or a catalog no parser has read, so each is admitted
 * first, and everything after this compiles what was admitted and never the object handed over.
 * The owner's provider identity is judged with them.
 */
function compileAdmitted(
  request: CompileProjectRequest,
): ToolkitResult<CompileProjectResult> {
  const configuration = admitConfiguration(request.configuration);
  const catalogs: Catalog[] = [];
  const refusedCatalogs: ToolkitDiagnostic[] = [];
  for (const catalog of request.catalogs) {
    const admitted = admitCatalog(catalog, { extensions: request.extensions });
    if (admitted.ok) catalogs.push(admitted.value);
    else refusedCatalogs.push(...admitted.diagnostics);
  }
  // The owner's provider identity is hashed into the generated owner identity whatever the
  // catalogs are, so it is held to the provider grammar here and not left to a catalog to carry.
  const provider = parseProviderId(request.owner.providerId);
  const refused = [
    ...(configuration.ok ? [] : configuration.diagnostics),
    ...refusedCatalogs,
    ...provider.diagnostics.map(({ code, summary }) =>
      toolkitDiagnostic(code, summary, { path: ['owner', 'providerId'] }),
    ),
  ];
  if (!configuration.ok || refused.length > 0) return toolkitFailure(refused);
  return compileProjectCore({
    ...request,
    configuration: configuration.value,
    catalogs,
  });
}

/**
 * Refuses a generated root that is not a portable path inside the owner.
 *
 * The path is part of the generated owner identity, so one spelled two ways, or one that leaves
 * the owner, would name an owner no host could write. Both platforms' rules for an absolute path
 * are asked, so the answer does not depend on where the compilation runs.
 */
function requireGeneratedRootPath(path: string): void {
  if (
    win32.isAbsolute(path) ||
    posix.isAbsolute(path) ||
    path.includes('\\') ||
    path.normalize('NFC') !== path ||
    path
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError(
      'compileProject: request.owner.generatedRootPath must be a portable path inside the owner: relative, with forward slashes, and with no empty, "." or ".." segment.',
    );
  }
}

/**
 * Compiles a project from catalogs already in memory, and touches no files.
 *
 * Analyses the catalogs together, settles each message's contract across its locales, compiles the
 * bodies, and produces the artifacts and an output plan that would write them. Returns all of it, or the
 * reasons it could not.
 *
 * Every call compiles from the complete semantic graph, because reachability and the catalog-set
 * descriptor depend on all of it. Handed the previous run's state, the result also says which inputs
 * moved since then; the output transaction is what leaves a file whose bytes did not change alone.
 *
 * The verb to reach for when the input is not a directory: a test, an editor, a script that
 * assembles catalogs itself. `compileProjectFromDisk` is the one that reads a project.
 */
export function compileProject(
  request: CompileProjectRequest,
): ToolkitResult<CompileProjectResult> {
  requireArgument(
    'compileProject',
    'request',
    request,
    COMPILE_PROJECT_REQUEST,
  );
  requireGeneratedRootPath(request.owner.generatedRootPath);
  const sink = request.observability;
  if (sink === undefined) return compileAdmitted(request);
  emitToolkitEvent(sink, {
    code: TOOLKIT_EVENT_CODES.compilation,
    phase: 'compilation',
    status: 'started',
  });
  let result: ToolkitResult<CompileProjectResult>;
  try {
    result = compileAdmitted(request);
  } catch (error) {
    emitToolkitEvent(sink, {
      code: TOOLKIT_EVENT_CODES.compilation,
      phase: 'compilation',
      status: 'failed',
    });
    throw error;
  }
  if (result.ok) {
    emitToolkitEvent(sink, {
      code: TOOLKIT_EVENT_CODES.compilation,
      phase: 'compilation',
      status: 'succeeded',
      count: result.value.artifacts.outputPlan.files.length,
    });
  } else {
    const diagnosticCode = result.diagnostics[0]?.code;
    emitToolkitEvent(sink, {
      code: TOOLKIT_EVENT_CODES.compilation,
      phase: 'compilation',
      status: 'failed',
      ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
    });
  }
  return result;
}
