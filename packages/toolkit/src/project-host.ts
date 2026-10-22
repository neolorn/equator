import { randomBytes } from 'node:crypto';
import { watch as watchFileSystem, type FSWatcher } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import ts from 'typescript';

import { formatCatalogSource, parseCatalog, type Catalog } from './catalog.js';
import {
  compileProject,
  fingerprintCompilerInputs,
  type CompileProjectRequest,
  type CompileProjectResult,
  type CompilerAnalysisInput,
  type CompilerState,
} from './compiler.js';
import {
  TRANSLATION_STATE_PATH,
  TRANSLATION_STATE_PROFILE,
  EMPTY_TRANSLATION_STATE,
  formatTranslationState,
  parseTranslationState,
  reconcileTranslationState,
  type StaleTranslation,
  type TranslationState,
} from './translation-state.js';
import { INIT_OPTIONS } from './cli-options.generated.js';
import { projectOptions, requireArgument } from './call-arguments.js';
import {
  completenessPolicy,
  configurationWithPseudoLocales,
  formatConfiguration,
  parseConfiguration,
  type InitConfiguration,
  type ProjectConfiguration,
} from './configuration.js';
import {
  messageCustomFunctions,
  formatExtensionRegistry,
  parseExtensionRegistry,
  type ExtensionRegistry,
} from './extensions.js';
import { createPseudoCatalog } from './pseudo-localization.js';
import {
  toolkitDiagnostic,
  toolkitFailure,
  spanAt,
  toolkitSuccess,
  type ToolkitDiagnostic,
  type ToolkitDiagnosticCode,
  type ToolkitDiagnosticSeverity,
  type ToolkitResult,
} from './diagnostics.js';
import {
  digestCanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from './canonical-json.js';
import { admitHostCompatibility } from './host-compatibility.js';
import { parseProviderId } from './identities.js';
import { canonicalizeLocale } from './locales.js';
import {
  TOOLKIT_EVENT_CODES,
  emitToolkitEvent,
  type ToolkitObservabilityOptions,
  type ToolkitObservabilitySink,
} from './observability.js';
import { RESOURCE_LIMITS } from './resource-limits.js';
import {
  COMPILER_CACHE_PATH,
  WORK_OWNER_PATH,
  WORK_OWNER_PROFILE,
  applyOutputPlan,
  cleanOutput,
  containedPath,
  inspectOutputFreshness,
  type ApplyOutputPlanResult,
  type CleanOutputResult,
  type OutputFreshness,
} from './output-host.js';
import { compareCodeUnit } from './sorted-records.js';
import {
  pathExists,
  pathMetadata,
  portablePath,
  writeSynced,
} from './file-system.js';

export const COMPILER_CACHE_PROFILE = 'equator-compiler-cache/1' as const;

const CONFIGURATION_NAME = 'equator.config.json';
const PACKAGE_MANIFEST_NAME = 'package.json';
const EXTENSION_REGISTRY_NAME = 'equator.extensions.json';
const GENERATED_ROOT = 'src/generated/i18n';
const WORK_ROOT = '.equator';
/**
 * The `#i18n` map for an owner whose generated output sits at `generatedRootPortablePath`.
 *
 * Almost always `src/generated/i18n` directly under the owner, which is what a per-application
 * layout produces. It differs when an owner at a workspace root has its Angular application
 * nested: the generated output belongs to the application that was analyzed, so the map has to
 * reach it.
 */
function packageImports(
  generatedRootPortablePath: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    '#i18n': `./${generatedRootPortablePath}/index.ts`,
    '#i18n/*': `./${generatedRootPortablePath}/*.ts`,
  });
}
/**
 * The script entries `init` writes and keeps.
 *
 * Exported so a verification gate can assert what Equator declares rather than what a fixture
 * author happened to type. A gate that runs `pnpm run equator:init` proves only that a person added
 * that entry to the fixture manifest, because Equator writes no such script.
 */
export const PACKAGE_SCRIPTS = Object.freeze({
  'equator:generate': 'equator generate',
  'equator:check': 'equator check',
  'equator:format': 'equator format',
  'equator:clean': 'equator clean',
  'equator:watch': 'equator watch',
});

/**
 * Which project on disk an operation runs against, and what it may report while it does.
 *
 * Every project verb takes this or something extending it. All of it is optional: with nothing
 * given, the operation finds the project from the current working directory.
 */
export interface ProjectSelection extends ToolkitObservabilityOptions {
  /** Where to start looking for the project. Defaults to the current working directory. */
  readonly cwd?: string;
  /** The configuration file to use, for a repository holding more than one Equator project. */
  readonly project?: string;
  /**
   * Generate the catalogs for the configured pseudo-locales. Off unless asked for.
   *
   * The switch is here, on the invocation, rather than in the configuration file that declares the
   * pseudo-locales, so one configuration serves both builds and the production build differs by
   * what it was asked to do, not by a file it had to edit first. `equator generate --pseudo` is a
   * development command; a production build runs `equator generate` and receives a locale table
   * with no pseudo-locale in it and no catalog to load.
   *
   * Deliberately not an environment variable. An environment variable set once on a CI runner
   * applies to every build on it, including the production one, which is the failure this switch
   * exists to make impossible. A flag has to be written into the specific command that wants it,
   * and it is visible in the `package.json` script where a reader will look.
   */
  readonly pseudoLocales?: boolean;
}

export interface ProjectLocation {
  readonly ownerRoot: string;
  readonly configurationPath: string;
  readonly packagePath: string;
  readonly generatedRoot: string;
  /** The generated root as a portable path relative to the owner, for the `#i18n` map. */
  readonly generatedRootPath: string;
  readonly workRoot: string;
}

export interface LoadedCatalog {
  readonly absolutePath: string;
  readonly portablePath: string;
  readonly source: string;
  readonly catalog: Catalog;
}

export interface LoadedProject extends ProjectLocation {
  readonly providerId: string;
  readonly configurationSource: string;
  readonly configuration: ProjectConfiguration;
  readonly packageSource: string;
  readonly packageManifest: Readonly<Record<string, unknown>>;
  readonly catalogFiles: readonly LoadedCatalog[];
  readonly catalogs: readonly Catalog[];
  readonly extensionSource?: string;
  readonly extensions?: ExtensionRegistry;
  readonly analysis?: CompilerAnalysisInput;
  readonly recoveryMessageIdentities: readonly string[];
}

/** What every project verb returns at minimum: the compilation it ran. */
export interface ProjectCompilation {
  /** The analysis, the compiled artifacts, the generated files, and everything reported. */
  readonly compilation: CompileProjectResult;
}

interface LoadedProjectCompilation extends ProjectCompilation {
  readonly project: LoadedProject;
}

/** What generating takes: a project, and whether to actually write. */
export interface GenerateProjectOptions extends ProjectSelection {
  /** Work out the whole result and write nothing. The result still says what would have changed. */
  readonly dryRun?: boolean;
}

/** What generating produced, and what it did to the generated tree. */
export interface GenerateProjectResult extends ProjectCompilation {
  /** What was written, what was removed, and whether anything changed at all. */
  readonly publication: ApplyOutputPlanResult;
}

/** What checking takes: a project, and how strict to be about what it finds. */
export interface CheckProjectOptions extends ProjectSelection {
  /** Reformat the catalogs that are not in canonical form, rather than only reporting them. */
  readonly fix?: boolean;
  /**
   * Require every target locale the project expects to be finished to be finished.
   *
   * For a team whose release rule is that no required locale may ship short of the source, this
   * is the switch that enforces it. Off by default, because during development a source message
   * ordinarily lands before its translations and a hard failure there would stop the work that
   * produces them.
   *
   * **What it covers is the whole family, not a selection from it.** `EQ1306` (the locale has no
   * catalog for a scope at all), `EQ1307` (a catalog omits a message), `EQ1308` (a message omits
   * a plural or ordinal category) and `EQ1309` (a translation was written against an older
   * source) are one question asked at four granularities, and they escalate together. They did not
   * always: this switch reached `EQ1307` and `EQ1308` only, so a locale missing one message of
   * three blocked a release and the same locale with no catalog at all passed it.
   *
   * **Which locales it applies to is not this option's to say.** Every locale is required unless
   * the project's own configuration declares it still in progress, which is a fact about the
   * project rather than about this run. This option decides only whether the run enforces it.
   *
   * **The name is `require`, and it stays.** The behaviour is a severity escalation, and the word
   * looked like a mismatch for that, until the pair is read together. `requireFreshOutput` does
   * the same thing to `EQ1704`, and both say the same true thing: the condition is *required for
   * this run*, and a run that does not meet it does not pass. Renaming one would separate a pair
   * that reads as a pair, and renaming both would spend a public-surface break on a word that was
   * already accurate.
   */
  readonly requireCompleteTargets?: boolean;
  /**
   * Require the generated output on disk to match what the sources would generate.
   *
   * Off by default and deliberately so: `specs/10-compiler-and-tooling.spec.md` section 12 keeps
   * freshness a non-blocking advisory in friendly mode, because generated output is routinely
   * stale in the middle of ordinary
   * authoring and a command that failed on it would be unusable. On, `EQ1704` is raised at
   * `error` rather than `warning`, which is what makes it blocking: the exit code is keyed to
   * severity, so nothing else has to be told about this option.
   *
   * Separate from `requireCompleteTargets` rather than folded into one strictness switch.
   * `specs/10-compiler-and-tooling.spec.md` section 12 enumerates completeness, freshness,
   * hygiene and automation thresholds as four opt-in policies,
   * and they are independently useful: wanting a release gate to block on stale output is not
   * wanting it to block on an untranslated message. Separate switches can be aggregated behind a
   * convenience flag later; one switch cannot be split without breaking the callers that set it.
   */
  readonly requireFreshOutput?: boolean;
}

/** What checking found: whether the generated tree is current, and what it rewrote. */
export interface CheckProjectResult extends ProjectCompilation {
  /** Whether what is on disk matches what the sources would produce now, and where it does not. */
  readonly freshness: OutputFreshness;
  /** The catalog files reformatted, empty unless `fix` was asked for. */
  readonly fixedFiles: readonly string[];
}

/** Which project to format, and whether to write anything. */
export interface FormatProjectOptions extends ProjectSelection {
  /** Work out the rewrites and write none of them, so a check can report without changing. */
  readonly dryRun?: boolean;
}

/** What formatting rewrote, or would have rewritten under a dry run. */
export interface FormatProjectResult {
  /** Whether anything was out of canonical form. False on a project already formatted. */
  readonly changed: boolean;
  /** The files rewritten, as repository-relative paths, sorted. */
  readonly files: readonly string[];
}

/**
 * Which project to initialize, what to write into its configuration, and whether to write at all.
 *
 * Unlike the other three, this one is required rather than defaulted: initialization has to be told
 * at least the source locale, and there is no sensible guess for a project's languages.
 */
export interface InitProjectOptions extends ProjectSelection {
  /**
   * The configuration fields to write, spelled as `equator.config.json` spells them.
   *
   * One field rather than one per key, and that is correctness rather than convenience. Naming
   * four of the six the parser accepts leaves `personNameLocales` and `pseudoLocales` unreachable
   * from `init`: a test that passes one has it silently discarded, and the initialized project is
   * valid, so nothing fails and nothing says anything. A named field per key is a second statement
   * of the configuration shape, and the second one going quiet is the defect rather than a risk.
   *
   * `InitConfiguration` is derived from the parser's own shape, so this follows the parser
   * without anyone keeping it in step.
   */
  readonly configuration?: InitConfiguration;
  /** Work out the files and write none of them, which is how a caller previews an init. */
  readonly dryRun?: boolean;
}

/** What initialization wrote, and the configuration the project now has. */
export interface InitProjectResult {
  /** Whether anything was written. False on a project already initialized the same way. */
  readonly changed: boolean;
  /** The files written or that would be written, as repository-relative paths, sorted. */
  readonly files: readonly string[];
  /**
   * The configuration as parsed back, with the defaults filled in.
   *
   * What the project now has rather than what was asked for, so a caller reading the locale list
   * reads the one the parser accepted.
   */
  readonly configuration: ProjectConfiguration;
}

/** Which project to clean, and whether to delete anything. */
export interface CleanProjectOptions extends ProjectSelection {
  /** Work out what would be removed and remove none of it. */
  readonly dryRun?: boolean;
}

/** Which project to remove Equator from, whether to delete anything, and how far to go. */
export interface UninstallProjectOptions extends ProjectSelection {
  /** Work out what would be removed and remove none of it. */
  readonly dryRun?: boolean;
  /** Remove authored catalogs too. Off unless asked for by name. */
  readonly catalogs?: boolean;
}

/** What uninstalling took back, what it left behind, and why. */
export interface UninstallProjectResult {
  /** Whether anything was removed. */
  readonly changed: boolean;
  /** The files taken back, as repository-relative paths, sorted. */
  readonly removed: readonly string[];
  /**
   * What Equator wrote, then somebody changed, and Equator therefore left alone.
   *
   * Named rather than reverted: an edited script or a repointed `#i18n` specifier belongs to
   * whoever edited it, and silently undoing that is the same class of mistake as silently
   * deleting a comment.
   */
  readonly retained: readonly string[];
  /** The authored catalogs removed, which is empty unless `catalogs` was asked for. */
  readonly catalogs: readonly string[];
}

/** One pass of the watcher: what number it was, and how it ended. */
export interface WatchCycle {
  /** Which pass this is, counting from one, so a log can be read in order. */
  readonly sequence: number;
  /** What generating produced this time, including a failure, which does not stop the watch. */
  readonly result: ToolkitResult<GenerateProjectResult>;
}

/** What watching takes: a project, a way to stop, and somewhere to report each pass. */
export interface WatchProjectOptions extends ProjectSelection {
  /**
   * How the watch is stopped. Required: there is no other way out.
   *
   * Aborting it lets the pass in flight finish and then returns.
   */
  readonly signal: AbortSignal;
  /**
   * How long to wait for the edits to stop before regenerating.
   *
   * A save can touch several files, and an editor can write one file twice. Waiting is what turns
   * that into one pass instead of four.
   */
  readonly debounceMilliseconds?: number;
  /**
   * Called once per pass, with what it produced.
   *
   * The only way to see a pass's diagnostics: the watch returns once, at the end, and by then every
   * pass but the last is over. It must not throw.
   *
   * An event that finds the inputs as the pass before it left them is not a pass: nothing is
   * generated and this is not called. Saving a file without changing it is the ordinary case.
   */
  readonly onCycle?: (cycle: WatchCycle) => void;
}

/** What a finished watch has to say, which is how much it did. */
export interface WatchProjectResult {
  /** How many passes ran before the watch was stopped. */
  readonly cycles: number;
}

// Exported so the built declarations carry the persisted format's shape, which its shape record in
// `tools/format-shapes.json` is compared with. The package entry does not re-export it.
export interface CompilerCacheEnvelope {
  readonly profile: typeof COMPILER_CACHE_PROFILE;
  readonly ownerId: string;
  readonly stateDigest: string;
  readonly state: CompilerState;
}

interface CachedCompilerState {
  readonly ownerId: string;
  readonly state: CompilerState;
  readonly diagnostics: readonly ToolkitDiagnostic[];
}

interface TextFileChange {
  readonly absolutePath: string;
  readonly portablePath: string;
  readonly previous: string | undefined;
  readonly contents: string;
}

/**
 * A short list of paths for a diagnostic, without a wall of them.
 *
 * Six is where a reader stops counting and starts scrolling, and a project with every catalog
 * broken at once has one cause rather than forty.
 */
function namedPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, 6);
  const rest = paths.length - shown.length;
  return rest === 0 ? shown.join(', ') : `${shown.join(', ')} and ${rest} more`;
}

function parentPath(path: string): string | undefined {
  const parent = dirname(path);
  return parent === path ? undefined : parent;
}

async function assertOrdinaryContainedPath(
  ownerRoot: string,
  target: string,
): Promise<void> {
  if (!containedPath(target, ownerRoot)) {
    throw new TypeError(`Equator path escapes its selected owner: ${target}`);
  }
  const linked = await linkedSegment(ownerRoot, target);
  if (linked !== undefined) {
    throw new TypeError(`Equator refuses linked project content: ${linked}`);
  }
}

/** The first link on the way from the owner down to a path inside it, where there is one. */
async function linkedSegment(
  ownerRoot: string,
  target: string,
): Promise<string | undefined> {
  const portable = relative(ownerRoot, target);
  let current = ownerRoot;
  for (const segment of portable === '' ? [] : portable.split(sep)) {
    current = resolve(current, segment);
    const metadata = await pathMetadata(current);
    if (metadata === undefined) return undefined;
    if (metadata.isSymbolicLink()) return current;
  }
  return undefined;
}

async function readUtf8(path: string, maximumBytes: number): Promise<string> {
  const contents = await readFile(path);
  if (contents.byteLength > maximumBytes) {
    throw new TypeError(
      `Equator refuses ${path} because it exceeds ${maximumBytes} bytes.`,
    );
  }
  return contents.toString('utf8');
}

// A leading byte-order mark is kept in the text, because whether one is allowed is each parser's
// rule and not the decoder's.
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * An authored file's text, or the refusal that file's own parser gives it.
 *
 * Every authored input is UTF-8 by its own definition (RFC 8259 section 8.1 for the JSON files,
 * `specs/04-message-authoring-and-catalogs.spec.md` section 2 for a catalog). Decoded with
 * replacement, a sequence that is not UTF-8 would become U+FFFD and the file would be accepted with
 * text nobody wrote in it. An oversized file is the application's input too, so it is refused with
 * that input's code rather than thrown as an environment failure naming an absolute path.
 *
 * TypeScript sources are the exception to strict decoding: the compiler reads them with
 * replacement, and analysis sees the program the compiler builds.
 */
async function readAuthoredText(
  ownerRoot: string,
  path: string,
  input: {
    readonly code: ToolkitDiagnosticCode;
    readonly name: string;
    readonly maximumBytes: number;
    readonly decoding?: 'strict' | 'replacement';
  },
): Promise<ToolkitResult<string>> {
  const named = `${input.name} ${JSON.stringify(portablePath(ownerRoot, path))}`;
  const oversized = () =>
    toolkitFailure([
      toolkitDiagnostic(
        input.code,
        `Equator refuses ${named} because it exceeds the ${input.maximumBytes}-byte implementation ceiling.`,
      ),
    ]);
  // Read through one handle and no further than one byte past the ceiling, as the migration plan
  // is, so a file far past it is refused without being held in memory.
  const handle = await open(path, 'r');
  const chunks: Buffer[] = [];
  let position = 0;
  try {
    while (position <= input.maximumBytes) {
      const capacity = Math.min(64 * 1024, input.maximumBytes + 1 - position);
      const chunk = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(chunk, 0, capacity, position);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  if (position > input.maximumBytes) return oversized();
  const contents = Buffer.concat(chunks, position);
  if (input.decoding === 'replacement') {
    return toolkitSuccess(contents.toString('utf8'));
  }
  try {
    return toolkitSuccess(STRICT_UTF8.decode(contents));
  } catch {
    return toolkitFailure([
      toolkitDiagnostic(
        input.code,
        `Equator refuses ${named} because it is not UTF-8 text.`,
      ),
    ]);
  }
}

const BYTE_ORDER_MARK = '\ufeff';

/**
 * The JSON a file carries, without the one leading byte-order mark an editor may have saved.
 *
 * RFC 8259 section 8.1 lets a parser ignore it, and npm, TypeScript and the Angular CLI all do, so
 * refusing it would refuse a manifest every other tool in the project reads. The file's text keeps it,
 * so a rewrite writes it back and the check that the file did not change underneath still compares
 * what is on disk.
 */
function jsonText(source: string): string {
  return source.startsWith(BYTE_ORDER_MARK) ? source.slice(1) : source;
}

function projectDiagnostic(
  summary: string,
  severity: ToolkitDiagnosticSeverity = 'error',
): ToolkitDiagnostic {
  return toolkitDiagnostic('EQ1702', summary, { severity });
}

async function explicitOwner(
  project: string,
  cwd: string,
): Promise<ToolkitResult<string>> {
  const candidate = resolve(cwd, project);
  const metadata = await pathMetadata(candidate);
  if (metadata === undefined) {
    return toolkitFailure([
      projectDiagnostic(
        `Selected Equator project ${JSON.stringify(project)} does not exist.`,
      ),
    ]);
  }
  if (metadata.isSymbolicLink()) {
    return toolkitFailure([
      projectDiagnostic('Equator project selection cannot be a symbolic link.'),
    ]);
  }
  if (metadata.isDirectory()) return toolkitSuccess(candidate);
  if (metadata.isFile() && basename(candidate) === CONFIGURATION_NAME) {
    return toolkitSuccess(dirname(candidate));
  }
  return toolkitFailure([
    projectDiagnostic(
      'Equator --project must select an owner directory or equator.config.json.',
    ),
  ]);
}

/**
 * The owner this working directory is in, searched no further than the package it is in.
 *
 * Discovery walks upward, and unbounded it walks to the filesystem root, selecting one
 * `equator.config.json` however far above and whatever stands between.
 * `specs/10-compiler-and-tooling.spec.md` section 4 says a working-directory accident never merges
 * projects, and section 10 says an application never inherits a neighboring configuration by
 * directory accident; this is the same accident one directory up.
 *
 * Unbounded, `equator init` inside `parent/child`, where `child` has its own `package.json` and
 * `parent` has an `equator.config.json`, initializes **`parent`** and reports success, naming three
 * files the reader cannot find where they are standing. In this repository it goes further: a stray
 * configuration at the workspace root makes every consumer materialized under `tmp/` select that
 * root as its owner instead of itself, and four gate stages then fail with "Equator init is already
 * complete" against a consumer whose configuration does not exist.
 *
 * **So the boundary is the nearest `package.json` upward, inclusive.** That directory is the
 * project's root (it is what a package manager, Node's own resolution and Equator's provider
 * identity all already treat as one) and a configuration above it belongs to a different project.
 * The workspace-root owner with a nested application still resolves, because nothing between the
 * application and that root carries a manifest of its own (section 134).
 *
 * With no `package.json` anywhere above, there is no project, so the only directory a configuration
 * could belong to is this one.
 */
type OwnerSearch =
  | { readonly outcome: 'one'; readonly ownerRoot: string }
  | { readonly outcome: 'many'; readonly candidates: readonly string[] }
  | {
      readonly outcome: 'none';
      readonly boundary: string;
      readonly beyond: string | undefined;
    };

async function searchOwnerWithinPackage(cwd: string): Promise<OwnerSearch> {
  const candidates: string[] = [];
  let boundary: string | undefined;
  let current: string | undefined = cwd;
  while (current !== undefined) {
    if (await pathExists(resolve(current, CONFIGURATION_NAME))) {
      candidates.push(current);
    }
    if (await pathExists(resolve(current, PACKAGE_MANIFEST_NAME))) {
      boundary = current;
      break;
    }
    current = parentPath(current);
  }
  const within =
    boundary === undefined
      ? candidates.filter((candidate) => candidate === cwd)
      : candidates;
  if (within.length === 1) {
    return { outcome: 'one', ownerRoot: within[0] as string };
  }
  if (within.length > 1) return { outcome: 'many', candidates: within };
  // Looked for only on the way to reporting nothing, and only to answer the question the reader is
  // about to ask. A configuration they can see, under a message saying none was found, is what
  // sends someone looking for a bug in discovery.
  const searched = boundary ?? cwd;
  return {
    outcome: 'none',
    boundary: searched,
    beyond: await configurationAbove(searched),
  };
}

async function discoverOwnerWithinPackage(
  cwd: string,
): Promise<ToolkitResult<string>> {
  const search = await searchOwnerWithinPackage(cwd);
  if (search.outcome === 'one') return toolkitSuccess(search.ownerRoot);
  if (search.outcome === 'many') {
    return toolkitFailure([
      projectDiagnostic(
        `Equator project discovery is ambiguous: ${search.candidates
          .map((path) => JSON.stringify(path))
          .join(', ')}. Use --project.`,
      ),
    ]);
  }
  return toolkitFailure([projectDiagnostic(noOwnerFound(search))]);
}

function noOwnerFound(
  search: Extract<OwnerSearch, { outcome: 'none' }>,
): string {
  return search.beyond === undefined
    ? `No equator.config.json was found in ${JSON.stringify(search.boundary)}. Select an owner with --project or run equator init.`
    : `No equator.config.json was found in ${JSON.stringify(search.boundary)}, which is the package this directory is in. There is one at ${JSON.stringify(search.beyond)}, above that boundary, and it belongs to that project rather than this one. Run equator init here, or select that project with --project if this directory really is part of it.`;
}

/** The nearest configuration strictly above a boundary, for a diagnostic that has to name it. */
async function configurationAbove(
  boundary: string,
): Promise<string | undefined> {
  let current = parentPath(boundary);
  while (current !== undefined) {
    if (await pathExists(resolve(current, CONFIGURATION_NAME))) return current;
    current = parentPath(current);
  }
  return undefined;
}

export async function discoverProject(
  selection: ProjectSelection = {},
): Promise<ToolkitResult<ProjectLocation>> {
  const cwd = resolve(selection.cwd ?? process.cwd());
  let ownerRoot: string;
  if (selection.project !== undefined) {
    const selected = await explicitOwner(selection.project, cwd);
    if (!selected.ok) return selected;
    ownerRoot = selected.value;
  } else {
    const discovered = await discoverOwnerWithinPackage(cwd);
    if (!discovered.ok) return discovered;
    ownerRoot = discovered.value;
  }
  const ownerMetadata = await pathMetadata(ownerRoot);
  if (
    ownerMetadata === undefined ||
    !ownerMetadata.isDirectory() ||
    ownerMetadata.isSymbolicLink()
  ) {
    return toolkitFailure([
      projectDiagnostic(
        'Equator owner must be an existing ordinary directory.',
      ),
    ]);
  }
  const generatedRoot = await generatedRootPath(ownerRoot);
  if (!generatedRoot.ok) return generatedRoot;
  return toolkitSuccess(
    Object.freeze({
      ownerRoot,
      configurationPath: resolve(ownerRoot, CONFIGURATION_NAME),
      packagePath: resolve(ownerRoot, 'package.json'),
      generatedRoot: resolve(ownerRoot, ...generatedRoot.value.split('/')),
      generatedRootPath: generatedRoot.value,
      workRoot: resolve(ownerRoot, WORK_ROOT),
    }),
  );
}

/**
 * The manifest an owner is identified by.
 *
 * `create` is set only by `equator init`. Scaffolding commands author files and build commands do
 * not, which is the division `tsc --init` and `tsc`, `eslint --init`, `git init` and
 * `cargo init` all draw. The practical reason is stronger than the convention: `generate`,
 * `check` and `watch` run unattended inside build pipelines and dev servers, so letting them
 * author files means one mistyped `--project` scatters manifests through a build.
 */
async function readPackageManifest(
  location: ProjectLocation,
  create = false,
): Promise<
  ToolkitResult<{
    readonly source: string;
    readonly value: Readonly<Record<string, unknown>>;
    readonly providerId: string;
    readonly created: boolean;
  }>
> {
  const metadata = await pathMetadata(location.packagePath);
  if (metadata !== undefined && metadata.isSymbolicLink()) {
    return toolkitFailure([
      projectDiagnostic(
        'The selected Equator owner package.json is a link. Equator refuses linked project content; replace it with an ordinary file.',
      ),
    ]);
  }
  if (metadata !== undefined && !metadata.isFile()) {
    return toolkitFailure([
      projectDiagnostic(
        'The selected Equator owner package.json is not an ordinary file.',
      ),
    ]);
  }
  if (metadata === undefined) {
    if (!create) {
      // The remedy, not just the fact. A missing manifest is the ordinary state of a new
      // application in a multi-application workspace, and the whole of what to do about it is one
      // command.
      return toolkitFailure([
        projectDiagnostic(
          `The selected Equator owner has no package.json at ${JSON.stringify(portablePath(location.ownerRoot, location.packagePath))}. Run equator init in that directory to create it; generate, check, format and watch never author files.`,
        ),
      ]);
    }
    const created = createdPackageManifest(location.ownerRoot);
    if (!created.ok) return created;
    const parsed = JSON.parse(created.value) as Readonly<
      Record<string, unknown>
    >;
    const provider = parseProviderId(parsed['name']);
    if (!provider.ok) return provider;
    return toolkitSuccess(
      Object.freeze({
        source: created.value,
        value: parsed,
        providerId: provider.value,
        created: true,
      }),
    );
  }
  const read = await readAuthoredText(
    location.ownerRoot,
    location.packagePath,
    {
      code: 'EQ1702',
      name: 'the owner package.json',
      maximumBytes: 1024 * 1024,
    },
  );
  if (!read.ok) return read;
  const source = read.value;
  let value: unknown;
  try {
    value = JSON.parse(jsonText(source));
  } catch {
    return toolkitFailure([
      projectDiagnostic('The selected owner package.json is not valid JSON.'),
    ]);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return toolkitFailure([
      projectDiagnostic('The selected owner package.json must be an object.'),
    ]);
  }
  const manifest = value as Readonly<Record<string, unknown>>;
  if (typeof manifest['name'] !== 'string') {
    return toolkitFailure([
      projectDiagnostic(
        'The selected owner package.json requires a package name for its provider identity.',
      ),
    ]);
  }
  const provider = parseProviderId(manifest['name']);
  if (!provider.ok) {
    return toolkitFailure([
      projectDiagnostic(
        `Package name ${JSON.stringify(manifest['name'])} is not a valid Equator provider identity.`,
      ),
    ]);
  }
  return toolkitSuccess(
    Object.freeze({
      source,
      value: manifest,
      providerId: provider.value,
      created: false,
    }),
  );
}

/**
 * The manifest `equator init` writes when an application has none.
 *
 * The package name comes from the directory, because that is the only name present: Equator has no
 * way to know a workspace's scope, and inventing one would put a wrong provider identity into
 * every compiled artifact. A directory whose name is not a usable identity is reported rather than
 * sanitized, since the identity is durable and a silently corrected one is worse than a refusal.
 */
function createdPackageManifest(ownerRoot: string): ToolkitResult<string> {
  const name = basename(ownerRoot);
  const provider = parseProviderId(name);
  if (!provider.ok) {
    return toolkitFailure([
      projectDiagnostic(
        `Equator cannot name a package after the directory ${JSON.stringify(name)}, which is not a valid package name. Create package.json with a name of your choosing and run equator init again.`,
      ),
    ]);
  }
  return toolkitSuccess(
    `${JSON.stringify({ name: provider.value, private: true }, null, 2)}\n`,
  );
}

function packageSetupDiagnostics(
  manifest: Readonly<Record<string, unknown>>,
  generatedRootPortablePath: string,
): readonly ToolkitDiagnostic[] {
  const diagnostics: ToolkitDiagnostic[] = [];
  const imports = manifest['imports'];
  if (
    typeof imports !== 'object' ||
    imports === null ||
    Array.isArray(imports)
  ) {
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1705',
        'package.json does not contain the Equator #i18n import mappings. Run equator init.',
      ),
    );
    return diagnostics;
  }
  for (const [specifier, target] of Object.entries(
    packageImports(generatedRootPortablePath),
  )) {
    if ((imports as Record<string, unknown>)[specifier] !== target) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1705',
          `package.json must map ${JSON.stringify(specifier)} to ${JSON.stringify(target)}. Run equator init.`,
          { path: ['imports', specifier] },
        ),
      );
    }
  }
  return diagnostics;
}

async function readConfiguration(location: ProjectLocation): Promise<
  ToolkitResult<{
    readonly source: string;
    readonly value: ProjectConfiguration;
  }>
> {
  const metadata = await pathMetadata(location.configurationPath);
  if (
    metadata === undefined ||
    !metadata.isFile() ||
    metadata.isSymbolicLink()
  ) {
    return toolkitFailure([
      projectDiagnostic(
        'The selected Equator owner requires an ordinary equator.config.json.',
      ),
    ]);
  }
  const read = await readAuthoredText(
    location.ownerRoot,
    location.configurationPath,
    {
      code: 'EQ1001',
      name: 'the configuration',
      maximumBytes: RESOURCE_LIMITS.configurationBytes,
    },
  );
  if (!read.ok) return read;
  const source = read.value;
  const parsed = parseConfiguration(jsonText(source), {
    sourcePath: CONFIGURATION_NAME,
  });
  return parsed.ok
    ? toolkitSuccess(
        Object.freeze({ source, value: parsed.value }),
        parsed.diagnostics,
      )
    : parsed;
}

async function readExtensionRegistry(location: ProjectLocation): Promise<
  ToolkitResult<
    | {
        readonly source: string;
        readonly value: ExtensionRegistry;
      }
    | undefined
  >
> {
  const path = resolve(location.ownerRoot, EXTENSION_REGISTRY_NAME);
  const metadata = await pathMetadata(path);
  if (metadata === undefined) return toolkitSuccess(undefined);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    return toolkitFailure([
      projectDiagnostic(
        `${EXTENSION_REGISTRY_NAME} must be an ordinary contained file.`,
      ),
    ]);
  }
  await assertOrdinaryContainedPath(location.ownerRoot, path);
  const read = await readAuthoredText(location.ownerRoot, path, {
    code: 'EQ1805',
    name: 'the extension registry',
    maximumBytes: RESOURCE_LIMITS.configurationBytes,
  });
  if (!read.ok) return read;
  const source = read.value;
  const parsed = parseExtensionRegistry(jsonText(source), {
    sourcePath: EXTENSION_REGISTRY_NAME,
  });
  return parsed.ok
    ? toolkitSuccess(
        Object.freeze({ source, value: parsed.value }),
        parsed.diagnostics,
      )
    : parsed;
}

/**
 * One derived catalog per declared pseudo-locale per scope, built from that scope's source catalog.
 *
 * The result is an ordinary target catalog: same shape, same provider, same scope, and a compiled
 * contract no different from a translated one's. That is the design, not a convenience: it is why
 * server rendering, lazy scopes and the locale switcher all work on a pseudo-locale without knowing
 * the concept exists.
 *
 * Derived only from `role === 'source'`. A pseudo-locale built from a translation would compound
 * two transformations and measure neither.
 */
function derivePseudoCatalogs(
  configuration: ProjectConfiguration,
  authored: readonly Catalog[],
  extensions: ExtensionRegistry | undefined,
): ToolkitResult<readonly Catalog[]> {
  const tags = Object.keys(configuration.pseudoLocales);
  if (tags.length === 0) return toolkitSuccess(Object.freeze([]));
  // The same registry the authored catalogs were parsed with. A derived catalog is an ordinary
  // catalog, and that has to include how it is read, not only what it looks like afterwards.
  const customFunctions = messageCustomFunctions(extensions);
  const derived: Catalog[] = [];
  const diagnostics: ToolkitDiagnostic[] = [];
  for (const source of authored) {
    if (source.role !== 'source') continue;
    for (const tag of tags) {
      const transform = configuration.pseudoLocales[tag];
      if (transform === undefined) continue;
      const catalog = createPseudoCatalog(source, {
        locale: tag,
        ...transform,
        customFunctions,
      });
      diagnostics.push(...catalog.diagnostics);
      if (!catalog.ok) continue;
      derived.push(catalog.value);
    }
  }
  if (diagnostics.some(({ severity }) => severity === 'error')) {
    return toolkitFailure(diagnostics);
  }
  return toolkitSuccess(Object.freeze(derived), diagnostics);
}

async function discoverCatalogs(
  location: ProjectLocation,
  providerId: string,
  configuration: ProjectConfiguration,
  extensions: ExtensionRegistry | undefined,
): Promise<ToolkitResult<readonly LoadedCatalog[]>> {
  const catalogRoot = resolve(location.ownerRoot, 'i18n');
  const rootMetadata = await pathMetadata(catalogRoot);
  if (
    rootMetadata === undefined ||
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink()
  ) {
    return toolkitFailure([
      projectDiagnostic(
        'The selected Equator owner requires an ordinary i18n directory.',
      ),
    ]);
  }
  const diagnostics: ToolkitDiagnostic[] = [];
  const catalogs: LoadedCatalog[] = [];
  // Conventional catalog files that were found and read off disk but never became a catalog.
  const unreadable: string[] = [];
  const scopeEntries = await readdir(catalogRoot, { withFileTypes: true });
  scopeEntries.sort((left, right) => compareCodeUnit(left.name, right.name));
  for (const scopeEntry of scopeEntries) {
    if (scopeEntry.isSymbolicLink() || !scopeEntry.isDirectory()) {
      diagnostics.push(
        projectDiagnostic(
          `Equator catalog root contains unsupported entry ${JSON.stringify(scopeEntry.name)}.`,
        ),
      );
      continue;
    }
    const scopeRoot = resolve(catalogRoot, scopeEntry.name);
    const localeEntries = await readdir(scopeRoot, { withFileTypes: true });
    localeEntries.sort((left, right) => compareCodeUnit(left.name, right.name));
    for (const localeEntry of localeEntries) {
      if (
        localeEntry.isSymbolicLink() ||
        !localeEntry.isFile() ||
        extname(localeEntry.name) !== '.yaml'
      ) {
        diagnostics.push(
          projectDiagnostic(
            `Equator scope ${JSON.stringify(scopeEntry.name)} contains unsupported entry ${JSON.stringify(localeEntry.name)}.`,
          ),
        );
        continue;
      }
      const localeName = basename(localeEntry.name, '.yaml');
      const canonicalLocale = canonicalizeLocale(localeName);
      if (!canonicalLocale.ok || canonicalLocale.value !== localeName) {
        diagnostics.push(
          projectDiagnostic(
            `Catalog filename ${JSON.stringify(localeEntry.name)} must use a canonical locale identifier.`,
          ),
        );
        continue;
      }
      const absolutePath = resolve(scopeRoot, localeEntry.name);
      await assertOrdinaryContainedPath(location.ownerRoot, absolutePath);
      const portable = portablePath(location.ownerRoot, absolutePath);
      // Counted where the file is read rather than where it is accepted, because the difference
      // between the two is the whole of the diagnostic below.
      unreadable.push(portable);
      const read = await readAuthoredText(location.ownerRoot, absolutePath, {
        code: 'EQ1101',
        name: 'the catalog',
        maximumBytes: RESOURCE_LIMITS.catalogBytes,
      });
      if (!read.ok) {
        diagnostics.push(...read.diagnostics);
        continue;
      }
      const source = read.value;
      const parsed = parseCatalog(source, {
        role:
          canonicalLocale.value === configuration.sourceLocale
            ? 'source'
            : 'target',
        providerId,
        scopeId: scopeEntry.name,
        locale: canonicalLocale.value,
        sourcePath: portable,
        ...(extensions === undefined ? {} : { extensions }),
      });
      diagnostics.push(...parsed.diagnostics);
      if (parsed.ok) {
        unreadable.pop();
        catalogs.push(
          Object.freeze({
            absolutePath,
            portablePath: portable,
            source,
            catalog: parsed.value,
          }),
        );
      }
    }
  }
  if (catalogs.length === 0) {
    // One sentence for both cases, *"Equator found no conventional i18n/<scope>/<locale>.yaml
    // catalogs"*, would be printed whether none exist or every one exists and fails to parse, above
    // the parse errors for the very files just read. A reader who has an `en-US.yaml` open in front
    // of them is told Equator cannot find it, which sends them to check the path convention, the
    // scope name and the locale spelling, none of which is wrong.
    //
    // Absence and unreadability are different facts and they take different sentences. The
    // unreadable case names the files, because ordering diagnostics is `orderedDiagnostics`'s
    // business and "see the errors below" is a claim about a layout this code does not control.
    //
    // They are also different *severities*. A project with no messages is not a broken
    // project: it is the state every project is in the moment after `equator init`, and the install
    // line is `init` then `generate` with nothing authored in between. So absence is a note that
    // says where the first message goes, and only unreadability is an error. The severity carries
    // it rather than a second code, the way `EQ1704` does: one fact, one diagnostic, and the
    // severity-keyed exit path decides whether it blocks.
    diagnostics.push(
      unreadable.length === 0
        ? projectDiagnostic(
            `Equator found no messages yet. Write the first catalog at i18n/<scope>/${configuration.sourceLocale}.yaml, for example i18n/shell/${configuration.sourceLocale}.yaml.`,
            'info',
          )
        : projectDiagnostic(
            unreadable.length === 1
              ? `Equator found 1 conventional catalog and could not read it: ${namedPaths(unreadable)}.`
              : `Equator found ${unreadable.length} conventional catalogs and could not read any of them: ${namedPaths(unreadable)}.`,
          ),
    );
  }
  if (diagnostics.some(({ severity }) => severity === 'error')) {
    return toolkitFailure(diagnostics);
  }
  catalogs.sort((left, right) =>
    compareCodeUnit(left.portablePath, right.portablePath),
  );
  return toolkitSuccess(Object.freeze(catalogs), diagnostics);
}

function typescriptDiagnostic(
  ownerRoot: string,
  diagnostic: ts.Diagnostic,
): ToolkitDiagnostic {
  const summary = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (
    diagnostic.file === undefined ||
    diagnostic.start === undefined ||
    diagnostic.length === undefined
  ) {
    return toolkitDiagnostic('EQ1401', `TypeScript configuration: ${summary}`);
  }
  return toolkitDiagnostic('EQ1401', `TypeScript configuration: ${summary}`, {
    span: spanAt(
      diagnostic.file.text,
      diagnostic.start,
      diagnostic.length,
      portablePath(ownerRoot, diagnostic.file.fileName),
    ),
  });
}

interface AngularApplication {
  /** Portable path of the application root, relative to the owner. Empty at the owner root. */
  readonly root: string;
  readonly tsConfig: string;
  /** Where the build writes, absolute: its `outputPath`, or Angular's `dist/<project>` default. */
  readonly outputPath?: string;
}

function angularApplication(
  ownerRoot: string,
  angular: Readonly<Record<string, unknown>>,
): ToolkitResult<AngularApplication | undefined> {
  const projects = angular['projects'];
  if (
    typeof projects !== 'object' ||
    projects === null ||
    Array.isArray(projects)
  ) {
    return toolkitSuccess(undefined);
  }
  const candidates: AngularApplication[] = [];
  for (const [projectName, rawProject] of Object.entries(projects).sort(
    ([left], [right]) => compareCodeUnit(left, right),
  )) {
    if (
      typeof rawProject !== 'object' ||
      rawProject === null ||
      Array.isArray(rawProject)
    ) {
      continue;
    }
    const project = rawProject as Readonly<Record<string, unknown>>;
    if (project['projectType'] !== 'application') continue;
    const projectRoot =
      typeof project['root'] === 'string' ? project['root'] : '';
    const absoluteProjectRoot = resolve(ownerRoot, projectRoot);
    if (!containedPath(absoluteProjectRoot, ownerRoot)) continue;
    const architect = project['architect'] ?? project['targets'];
    if (
      typeof architect !== 'object' ||
      architect === null ||
      Array.isArray(architect)
    ) {
      continue;
    }
    const build = (architect as Readonly<Record<string, unknown>>)['build'];
    if (typeof build !== 'object' || build === null || Array.isArray(build))
      continue;
    const options = (build as Readonly<Record<string, unknown>>)['options'];
    if (
      typeof options !== 'object' ||
      options === null ||
      Array.isArray(options)
    ) {
      continue;
    }
    const tsConfig = (options as Readonly<Record<string, unknown>>)['tsConfig'];
    if (typeof tsConfig === 'string') {
      const root = portablePath(ownerRoot, absoluteProjectRoot);
      const outputPath = (options as Readonly<Record<string, unknown>>)[
        'outputPath'
      ];
      const outputBase =
        typeof outputPath === 'string'
          ? outputPath
          : typeof outputPath === 'object' &&
              outputPath !== null &&
              typeof (outputPath as Readonly<Record<string, unknown>>)[
                'base'
              ] === 'string'
            ? ((outputPath as Readonly<Record<string, unknown>>)[
                'base'
              ] as string)
            : `dist/${projectName}`;
      candidates.push(
        Object.freeze({
          // portablePath answers '.' for the owner root itself; an application at the owner root
          // has no prefix at all, and carrying one would put './' into every generated path.
          root: root === '.' ? '' : root,
          tsConfig: resolve(ownerRoot, tsConfig),
          outputPath: resolve(ownerRoot, outputBase),
        }),
      );
    }
  }
  const unique = [
    ...new Map(candidates.map((entry) => [entry.tsConfig, entry])).values(),
  ].sort((left, right) => compareCodeUnit(left.tsConfig, right.tsConfig));
  if (unique.length > 1) {
    return toolkitFailure([
      projectDiagnostic(
        `Equator found multiple Angular application TypeScript graphs: ${unique
          .map(({ tsConfig }) =>
            JSON.stringify(portablePath(ownerRoot, tsConfig)),
          )
          .join(', ')}. Select one application owner with --project.`,
      ),
    ]);
  }
  return toolkitSuccess(unique[0]);
}

async function selectAngularApplication(
  ownerRoot: string,
): Promise<ToolkitResult<AngularApplication | undefined>> {
  const angularPath = resolve(ownerRoot, 'angular.json');
  if (await pathExists(angularPath)) {
    const read = await readAuthoredText(ownerRoot, angularPath, {
      code: 'EQ1702',
      name: 'the owner angular.json',
      maximumBytes: 4 * 1024 * 1024,
    });
    if (!read.ok) return read;
    let angular: unknown;
    try {
      angular = JSON.parse(jsonText(read.value));
    } catch {
      return toolkitFailure([
        projectDiagnostic('The selected owner angular.json is not valid JSON.'),
      ]);
    }
    if (
      typeof angular === 'object' &&
      angular !== null &&
      !Array.isArray(angular)
    ) {
      const selected = angularApplication(
        ownerRoot,
        angular as Readonly<Record<string, unknown>>,
      );
      if (!selected.ok || selected.value !== undefined) return selected;
    }
  }
  for (const name of ['tsconfig.app.json', 'tsconfig.json']) {
    const path = resolve(ownerRoot, name);
    if (await pathExists(path)) {
      return toolkitSuccess(Object.freeze({ root: '', tsConfig: path }));
    }
  }
  return toolkitSuccess(undefined);
}

/**
 * Where this owner's generated source belongs.
 *
 * Inside the Angular application Equator analyzed, always. When the owner is the application, the
 * per-application layout, that is `src/generated/i18n` under the owner. When an owner at a
 * workspace root has its application nested, writing to the owner's own `src/generated/i18n` would
 * create a source directory belonging to no Angular project and sitting outside the tsconfig of
 * the application just analyzed.
 */
async function generatedRootPath(
  ownerRoot: string,
): Promise<ToolkitResult<string>> {
  const application = await selectAngularApplication(ownerRoot);
  const root = application.ok ? (application.value?.root ?? '') : '';
  const path = root === '' ? GENERATED_ROOT : `${root}/${GENERATED_ROOT}`;
  // Not inside a tree something else rewrites. A package manager replaces a dependency's directory
  // on install and a build empties its output, so generated source placed in either is lost the
  // next time one runs, and whatever was there is Equator's to overwrite no more than it is ours.
  const absolute = resolve(ownerRoot, ...path.split('/'));
  const outputPath = application.ok ? application.value?.outputPath : undefined;
  const foreign = path.split('/').includes('node_modules')
    ? 'a dependency directory, which a package manager replaces on install'
    : outputPath !== undefined && containedPath(absolute, outputPath)
      ? 'the build output, which the build empties'
      : undefined;
  if (foreign !== undefined) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1601',
        `The generated root ${JSON.stringify(path)} lies inside ${foreign}. Place the Angular application outside it.`,
      ),
    ]);
  }
  return toolkitSuccess(path);
}

function externalTemplatePaths(
  ownerRoot: string,
  sourcePath: string,
  source: string,
): readonly string[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const paths = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === 'templateUrl') ||
        (ts.isStringLiteralLike(node.name) &&
          node.name.text === 'templateUrl')) &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      const path = resolve(dirname(sourcePath), node.initializer.text);
      if (containedPath(path, ownerRoot)) paths.add(path);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...paths].sort(compareCodeUnit);
}

// Machine-specific locations that describe where a project sits rather than
// how it is analyzed. They must never reach a cache digest.
const NON_PORTABLE_COMPILER_OPTIONS: ReadonlySet<string> = new Set([
  'configFilePath',
  'pathsBasePath',
  'outDir',
  'outFile',
  'rootDir',
  'rootDirs',
  'declarationDir',
  'tsBuildInfoFile',
  'sourceRoot',
  'mapRoot',
  'project',
]);

function portableCompilerOptions(
  ownerRoot: string,
  options: ts.CompilerOptions,
): CanonicalJsonObject {
  const portableValue = (value: unknown): CanonicalJsonValue => {
    if (typeof value === 'string') {
      return isAbsolute(value) ? portablePath(ownerRoot, value) : value;
    }
    if (typeof value === 'boolean' || typeof value === 'number') return value;
    if (Array.isArray(value)) return value.map(portableValue);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .map(([key, nested]): [string, CanonicalJsonValue] => [
            key,
            portableValue(nested),
          ])
          .sort(([left], [right]) => compareCodeUnit(left, right)),
      );
    }
    return null;
  };
  const entries = Object.entries(options)
    .filter(
      ([key, value]) =>
        !NON_PORTABLE_COMPILER_OPTIONS.has(key) && value !== undefined,
    )
    .map(([key, value]): [string, CanonicalJsonValue] => [
      key,
      portableValue(value),
    ])
    .sort(([left], [right]) => compareCodeUnit(left, right));
  return Object.freeze(Object.fromEntries(entries));
}

async function loadAnalysisGraph(
  location: ProjectLocation,
): Promise<ToolkitResult<CompilerAnalysisInput | undefined>> {
  const host = admitHostCompatibility();
  if (!host.ok) return host;
  const selected = await selectAngularApplication(location.ownerRoot);
  if (!selected.ok) return selected;
  if (selected.value === undefined) {
    // Silence was the worst available answer. With no TypeScript graph, Equator cannot see a single
    // template or call site, so every message looks unused, reachability is empty, and generation
    // produces an owner with nothing in it, and it all reports success. Every application meets
    // first-time configuration exactly once, so this is the moment a workspace adopting Equator is
    // most likely to hit it and least able to recognise it. Reported as a project-selection
    // failure rather than an environment one, because the fix is in the project.
    return toolkitFailure([
      ...selected.diagnostics,
      projectDiagnostic(
        'Equator found no TypeScript graph for this owner, so no template or call site can be analyzed and every message would appear unused. Expected an Angular application build tsConfig in angular.json, or tsconfig.app.json or tsconfig.json beside package.json.',
      ),
    ]);
  }
  const configPath = selected.value.tsConfig;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    return toolkitFailure([
      typescriptDiagnostic(location.ownerRoot, read.error),
    ]);
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath,
  );
  if (parsed.errors.length > 0) {
    return toolkitFailure(
      parsed.errors.map((diagnostic) =>
        typescriptDiagnostic(location.ownerRoot, diagnostic),
      ),
    );
  }
  const rootNames = parsed.fileNames
    .map((path) => resolve(path))
    .filter(
      (path) =>
        containedPath(path, location.ownerRoot) &&
        !containedPath(path, location.generatedRoot) &&
        !containedPath(path, location.workRoot) &&
        !portablePath(location.ownerRoot, path).startsWith('node_modules/'),
    )
    .sort(compareCodeUnit);
  const diagnostics: ToolkitDiagnostic[] = [];
  if (rootNames.length > RESOURCE_LIMITS.analysisSourceFiles) {
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1403',
        `Equator TypeScript analysis exceeds the ${RESOURCE_LIMITS.analysisSourceFiles}-source implementation ceiling.`,
      ),
    );
  }
  for (const path of parsed.fileNames.map((item) => resolve(item))) {
    if (!containedPath(path, location.ownerRoot)) {
      diagnostics.push(
        projectDiagnostic(
          `The selected TypeScript graph contains root ${JSON.stringify(path)} outside the Equator owner.`,
        ),
      );
    }
  }
  if (diagnostics.length > 0) return toolkitFailure(diagnostics);
  const sourceMap = new Map<string, string>();
  let sourceBytes = 0;
  const addSource = (path: string, source: string): boolean => {
    if (sourceMap.has(path)) return true;
    sourceBytes += Buffer.byteLength(source, 'utf8');
    if (
      sourceMap.size + 1 > RESOURCE_LIMITS.analysisSourceFiles ||
      sourceBytes > RESOURCE_LIMITS.analysisSourceBytes
    ) {
      return false;
    }
    sourceMap.set(path, source);
    return true;
  };
  for (const path of rootNames) {
    // A root outside the owner was refused above, so a link on the way to this one is all that
    // is left, and it is the project's fact to report and not a failure of the call.
    const linked = await linkedSegment(location.ownerRoot, path);
    if (linked !== undefined) {
      return toolkitFailure([
        projectDiagnostic(
          `The selected TypeScript graph contains root ${JSON.stringify(portablePath(location.ownerRoot, path))} behind the link ${JSON.stringify(portablePath(location.ownerRoot, linked))}, and Equator reads no linked project content.`,
        ),
      ]);
    }
    const read = await readAuthoredText(location.ownerRoot, path, {
      code: 'EQ1403',
      name: 'the analysis source',
      maximumBytes: 4 * 1024 * 1024,
      decoding: 'replacement',
    });
    if (!read.ok) return read;
    const source = read.value;
    if (!addSource(path, source)) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1403',
          `Equator analysis exceeds its ${RESOURCE_LIMITS.analysisSourceFiles}-source or ${RESOURCE_LIMITS.analysisSourceBytes}-byte implementation ceiling.`,
        ),
      ]);
    }
    for (const templatePath of externalTemplatePaths(
      location.ownerRoot,
      path,
      source,
    )) {
      const metadata = await pathMetadata(templatePath);
      if (metadata?.isSymbolicLink()) {
        return toolkitFailure([
          toolkitDiagnostic(
            'EQ1402',
            `Equator refuses linked Angular template ${JSON.stringify(
              portablePath(location.ownerRoot, templatePath),
            )}.`,
          ),
        ]);
      }
      if (
        metadata !== undefined &&
        metadata.isFile() &&
        !metadata.isSymbolicLink()
      ) {
        const template = await readAuthoredText(
          location.ownerRoot,
          templatePath,
          {
            code: 'EQ1403',
            name: 'the Angular template',
            maximumBytes: 4 * 1024 * 1024,
            decoding: 'replacement',
          },
        );
        if (!template.ok) return template;
        if (!addSource(templatePath, template.value)) {
          return toolkitFailure([
            toolkitDiagnostic(
              'EQ1403',
              `Equator analysis exceeds its ${RESOURCE_LIMITS.analysisSourceFiles}-source or ${RESOURCE_LIMITS.analysisSourceBytes}-byte implementation ceiling.`,
            ),
          ]);
        }
      }
    }
  }
  const sources = [...sourceMap.entries()]
    .sort(([left], [right]) => compareCodeUnit(left, right))
    .map(([path, contents]) => Object.freeze({ path, contents }));
  return toolkitSuccess(
    Object.freeze({
      projectRoot: location.ownerRoot,
      rootNames: Object.freeze(rootNames),
      sources: Object.freeze(sources),
      ...(parsed.options.types === undefined
        ? {}
        : { typeNames: Object.freeze([...parsed.options.types]) }),
      compilerOptions: parsed.options,
      compilerOptionsDigestInput: portableCompilerOptions(
        location.ownerRoot,
        parsed.options,
      ),
      maxDiagnostics: 100,
    }),
  );
}

export async function loadProject(
  selection: ProjectSelection = {},
  options: { readonly requirePackageSetup?: boolean } = {},
): Promise<ToolkitResult<LoadedProject>> {
  const location = await discoverProject(selection);
  if (!location.ok) return location;
  const packageManifest = await readPackageManifest(location.value);
  if (!packageManifest.ok) return packageManifest;
  if (options.requirePackageSetup === true) {
    const setupDiagnostics = packageSetupDiagnostics(
      packageManifest.value.value,
      location.value.generatedRootPath,
    );
    if (setupDiagnostics.length > 0) return toolkitFailure(setupDiagnostics);
  }
  const configuration = await readConfiguration(location.value);
  if (!configuration.ok) return configuration;
  const extensions = await readExtensionRegistry(location.value);
  if (!extensions.ok) return extensions;
  const catalogs = await discoverCatalogs(
    location.value,
    packageManifest.value.providerId,
    configuration.value.value,
    extensions.value?.value,
  );
  if (!catalogs.ok) return catalogs;
  const analysis = await loadAnalysisGraph(location.value);
  if (!analysis.ok) return analysis;

  // Pseudo-locales enter here and nowhere else. `configuration` gains their tags so the generated
  // locale table, the availability lookup and the typed constants include them; `catalogs` gains
  // the derived catalogs so every later stage compiles them like any other. The generated
  // configuration names them once, for a server route table and nothing else, so leaving the flag
  // off is still an absence rather than a disabled feature.
  //
  // They stay out of `catalogFiles`, which is the list of authored files on disk: `format` writes
  // to those paths and `uninstall` deletes them, and a derived catalog has no file to do either to.
  const authoredCatalogs = Object.freeze(
    catalogs.value.map(({ catalog }) => catalog),
  );
  const pseudo =
    selection.pseudoLocales === true
      ? derivePseudoCatalogs(
          configuration.value.value,
          authoredCatalogs,
          extensions.value?.value,
        )
      : toolkitSuccess(Object.freeze([] as readonly Catalog[]));
  if (!pseudo.ok) return pseudo;
  const configurationValue =
    pseudo.value.length === 0
      ? configuration.value.value
      : configurationWithPseudoLocales(configuration.value.value);

  return toolkitSuccess(
    Object.freeze({
      ...location.value,
      providerId: packageManifest.value.providerId,
      configurationSource: configuration.value.source,
      configuration: configurationValue,
      packageSource: packageManifest.value.source,
      packageManifest: packageManifest.value.value,
      catalogFiles: catalogs.value,
      catalogs: Object.freeze([...authoredCatalogs, ...pseudo.value]),
      ...(extensions.value === undefined
        ? {}
        : {
            extensionSource: extensions.value.source,
            extensions: extensions.value.value,
          }),
      ...(analysis.value === undefined ? {} : { analysis: analysis.value }),
      recoveryMessageIdentities: Object.freeze([]),
    }),
    [
      ...configuration.diagnostics,
      ...extensions.diagnostics,
      ...catalogs.diagnostics,
      ...analysis.diagnostics,
      ...pseudo.diagnostics,
    ],
  );
}

function compileRequest(
  project: LoadedProject,
  previousState?: CompilerState,
  observability?: ToolkitObservabilitySink,
  requireCompleteTargets?: boolean,
): CompileProjectRequest {
  return {
    configuration: project.configuration,
    catalogs: project.catalogs,
    owner: {
      providerId: project.providerId,
      generatedRootPath: project.generatedRootPath,
    },
    ...(requireCompleteTargets === undefined ? {} : { requireCompleteTargets }),
    ...(project.extensions === undefined
      ? {}
      : { extensions: project.extensions }),
    ...(project.analysis === undefined ? {} : { analysis: project.analysis }),
    recoveryMessageIdentities: project.recoveryMessageIdentities,
    ...(previousState === undefined ? {} : { previousState }),
    ...(observability === undefined ? {} : { observability }),
  };
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256-[A-Za-z0-9_-]{43}$/u.test(value);
}

function validCachedInputIdentity(identity: string): boolean {
  if (
    identity.length === 0 ||
    identity.includes('\u0000') ||
    identity.includes('\\') ||
    identity.normalize('NFC') !== identity
  ) {
    return false;
  }
  if (!identity.startsWith('source:')) return true;
  const path = identity.slice('source:'.length);
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

function parseCompilerState(value: unknown): CompilerState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const state = value as Record<string, unknown>;
  if (
    Object.keys(state).sort().join(',') !==
      'inputFingerprint,inputs,outputPlanDigest,profile' ||
    state['profile'] !== 'equator-compiler-state/1' ||
    !validDigest(state['inputFingerprint']) ||
    !validDigest(state['outputPlanDigest']) ||
    !Array.isArray(state['inputs'])
  ) {
    return undefined;
  }
  const inputs: { identity: string; digest: string }[] = [];
  for (const input of state['inputs']) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return undefined;
    }
    const record = input as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(',') !== 'digest,identity' ||
      typeof record['identity'] !== 'string' ||
      !validCachedInputIdentity(record['identity']) ||
      !validDigest(record['digest'])
    ) {
      return undefined;
    }
    inputs.push({ identity: record['identity'], digest: record['digest'] });
  }
  if (
    inputs.some(
      (input, index) =>
        index > 0 &&
        compareCodeUnit(inputs[index - 1]?.identity ?? '', input.identity) >= 0,
    )
  ) {
    return undefined;
  }
  return Object.freeze({
    profile: 'equator-compiler-state/1',
    inputFingerprint: state['inputFingerprint'],
    outputPlanDigest: state['outputPlanDigest'],
    inputs: Object.freeze(inputs.map((input) => Object.freeze(input))),
  });
}

function compilerCacheContents(ownerId: string, state: CompilerState): string {
  const stateDigest = digestCanonicalJson('equator-compiler-cache-state/1', {
    ownerId,
    state: JSON.parse(JSON.stringify(state)),
  });
  const envelope: CompilerCacheEnvelope = Object.freeze({
    profile: COMPILER_CACHE_PROFILE,
    ownerId,
    stateDigest,
    state,
  });
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

const COMPILER_CACHE_BYTES = 4 * 1024 * 1024;

/**
 * A cache that is on disk and is not used, with the advisory that says so.
 *
 * The empty owner identity is what makes the compilation that follows start from nothing.
 */
function ignoredCompilerCache(
  what: 'a corrupt' | 'an incompatible' | 'a linked' | 'an oversized',
): CachedCompilerState {
  return Object.freeze({
    ownerId: '',
    state: Object.freeze({
      profile: 'equator-compiler-state/1',
      inputFingerprint: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      outputPlanDigest: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      inputs: Object.freeze([]),
    }),
    diagnostics: Object.freeze([
      toolkitDiagnostic(
        'EQ1703',
        `Equator ignored ${what} incremental compiler cache and will recompute it.`,
        { severity: 'info' },
      ),
    ]),
  });
}

async function readCompilerCache(
  project: ProjectLocation,
): Promise<CachedCompilerState | undefined> {
  const cachePath = resolve(
    project.workRoot,
    ...COMPILER_CACHE_PATH.split('/'),
  );
  if (!(await pathExists(cachePath))) return undefined;
  // The cache is disposable, so one that is not an ordinary file of a bounded size is passed over
  // and recomputed, and neither followed nor read whole.
  if ((await linkedSegment(project.ownerRoot, cachePath)) !== undefined) {
    return ignoredCompilerCache('a linked');
  }
  const metadata = await pathMetadata(cachePath);
  if (metadata === undefined) return undefined;
  if (metadata.size > COMPILER_CACHE_BYTES) {
    return ignoredCompilerCache('an oversized');
  }
  let value: unknown;
  try {
    value = JSON.parse(await readUtf8(cachePath, COMPILER_CACHE_BYTES));
  } catch (error) {
    if (error instanceof SyntaxError) return ignoredCompilerCache('a corrupt');
    throw error;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    value = undefined;
  }
  const record = value as Record<string, unknown> | undefined;
  const state = parseCompilerState(record?.['state']);
  const ownerId = record?.['ownerId'];
  let expectedDigest: string | undefined;
  try {
    expectedDigest =
      typeof ownerId === 'string' && state !== undefined
        ? digestCanonicalJson('equator-compiler-cache-state/1', {
            ownerId,
            state: JSON.parse(JSON.stringify(state)),
          })
        : undefined;
  } catch {
    // Canonical JSON refuses text that is not well-formed Unicode, which a cache this writer
    // produced never holds. With no digest to compare, the cache is passed over below.
    expectedDigest = undefined;
  }
  if (
    record === undefined ||
    Object.keys(record).sort().join(',') !==
      'ownerId,profile,state,stateDigest' ||
    record['profile'] !== COMPILER_CACHE_PROFILE ||
    !validDigest(ownerId) ||
    state === undefined ||
    record['stateDigest'] !== expectedDigest
  ) {
    return ignoredCompilerCache('an incompatible');
  }
  return Object.freeze({
    ownerId,
    state,
    diagnostics: Object.freeze([]),
  });
}

async function writeCompilerCache(
  project: LoadedProject,
  ownerId: string,
  state: CompilerState,
): Promise<readonly ToolkitDiagnostic[]> {
  const markerPath = resolve(project.workRoot, WORK_OWNER_PATH);
  const marker = JSON.parse(await readUtf8(markerPath, 1024 * 1024)) as Record<
    string,
    unknown
  >;
  if (
    marker['profile'] !== WORK_OWNER_PROFILE ||
    marker['ownerId'] !== ownerId
  ) {
    return Object.freeze([
      toolkitDiagnostic(
        'EQ1703',
        'Equator skipped incremental cache persistence because work ownership changed.',
        { severity: 'warning' },
      ),
    ]);
  }
  const cachePath = resolve(
    project.workRoot,
    ...COMPILER_CACHE_PATH.split('/'),
  );
  const cacheRoot = dirname(cachePath);
  await assertOrdinaryContainedPath(project.ownerRoot, cacheRoot);
  await mkdir(cacheRoot, { recursive: true });
  await assertOrdinaryContainedPath(project.ownerRoot, cachePath);
  const contents = compilerCacheContents(ownerId, state);
  if (
    (await pathExists(cachePath)) &&
    (await readFile(cachePath, 'utf8')) === contents
  ) {
    return Object.freeze([]);
  }
  await writeFile(cachePath, contents, 'utf8');
  return Object.freeze([]);
}

async function compileLoadedProject(
  project: LoadedProject,
  observability?: ToolkitObservabilitySink,
  requireCompleteTargets?: boolean,
): Promise<ToolkitResult<LoadedProjectCompilation>> {
  const cached = await readCompilerCache(project);
  const candidateState = cached?.ownerId === '' ? undefined : cached?.state;
  let compiled = compileProject(
    compileRequest(
      project,
      candidateState,
      observability,
      requireCompleteTargets,
    ),
  );
  if (!compiled.ok) return compiled;
  if (
    cached !== undefined &&
    cached.ownerId !== compiled.value.artifacts.ownerId
  ) {
    compiled = compileProject(
      compileRequest(project, undefined, observability, requireCompleteTargets),
    );
    if (!compiled.ok) return compiled;
  }
  return toolkitSuccess(
    Object.freeze({ project, compilation: compiled.value }),
    [...(cached?.diagnostics ?? []), ...compiled.diagnostics],
  );
}

async function compileProjectFromDiskInternalCore(
  selection: ProjectSelection & {
    readonly requireCompleteTargets?: boolean;
  } = {},
  loaded?: ToolkitResult<LoadedProject>,
): Promise<ToolkitResult<LoadedProjectCompilation>> {
  const project =
    loaded ?? (await loadProject(selection, { requirePackageSetup: true }));
  if (!project.ok) return project;
  const compiled = await compileLoadedProject(
    project.value,
    selection.observability,
    selection.requireCompleteTargets,
  );
  return compiled.ok
    ? toolkitSuccess(compiled.value, [
        ...project.diagnostics,
        ...compiled.diagnostics,
      ])
    : compiled;
}

async function compileProjectFromDiskInternal(
  selection: ProjectSelection & {
    readonly requireCompleteTargets?: boolean;
  } = {},
  loaded?: ToolkitResult<LoadedProject>,
): Promise<ToolkitResult<LoadedProjectCompilation>> {
  const sink = selection.observability;
  if (sink === undefined) {
    return compileProjectFromDiskInternalCore(selection, loaded);
  }
  emitToolkitEvent(sink, {
    code: TOOLKIT_EVENT_CODES.compilation,
    phase: 'integration',
    status: 'started',
  });
  let result: ToolkitResult<LoadedProjectCompilation>;
  try {
    result = await compileProjectFromDiskInternalCore(selection, loaded);
  } catch (error) {
    emitToolkitEvent(sink, {
      code: TOOLKIT_EVENT_CODES.compilation,
      phase: 'integration',
      status: 'failed',
    });
    throw error;
  }
  if (result.ok) {
    emitToolkitEvent(sink, {
      code: TOOLKIT_EVENT_CODES.compilation,
      phase: 'integration',
      status: 'succeeded',
      count: result.value.compilation.artifacts.outputPlan.files.length,
    });
  } else {
    const diagnosticCode = result.diagnostics[0]?.code;
    emitToolkitEvent(sink, {
      code: TOOLKIT_EVENT_CODES.compilation,
      phase: 'integration',
      status: 'failed',
      ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
    });
  }
  return result;
}

/**
 * Compiles a project from the files on disk and writes nothing.
 *
 * Finds the configuration, reads the catalogs and the extension registry, analyses them, and
 * compiles. Returns everything that came out, or the reasons it could not.
 *
 * For a caller that wants the result rather than the side effect: a report over the messages, a
 * custom check, an editor integration. `generateProject` is the one that writes.
 */
export async function compileProjectFromDisk(
  selection: ProjectSelection = {},
): Promise<ToolkitResult<ProjectCompilation>> {
  requireArgument(
    'compileProjectFromDisk',
    'selection',
    selection,
    projectOptions(),
  );
  const compiled = await compileProjectFromDiskInternal(selection);
  return compiled.ok
    ? toolkitSuccess(
        Object.freeze({ compilation: compiled.value.compilation }),
        compiled.diagnostics,
      )
    : compiled;
}

/**
 * The translation-state record, empty when there is none yet, or the refusal of one that is present
 * and cannot be read.
 *
 * Absence is the first run. A record that is present and unreadable, such as one a merge left
 * conflict markers in, is refused and left as it is: reading it as empty would re-stamp every
 * translation as current and erase every stale report, and writing over it would erase the record
 * the owner still has to resolve.
 */
async function readTranslationState(
  ownerRoot: string,
): Promise<ToolkitResult<TranslationState>> {
  const path = resolve(ownerRoot, TRANSLATION_STATE_PATH);
  if (!(await pathExists(path))) {
    return toolkitSuccess(EMPTY_TRANSLATION_STATE);
  }
  const refusal = (reason: string) =>
    toolkitFailure([
      projectDiagnostic(
        `Equator cannot read the translation-state record ${JSON.stringify(TRANSLATION_STATE_PATH)} because ${reason}, and leaves it unchanged. Resolve it, or delete it to record every translation as current.`,
      ),
    ]);
  let read: ToolkitResult<string>;
  try {
    read = await readAuthoredText(ownerRoot, path, {
      code: 'EQ1702',
      name: 'the translation-state record',
      maximumBytes: 4 * 1024 * 1024,
    });
  } catch {
    return refusal('the file could not be opened');
  }
  if (!read.ok) return read;
  const state = parseTranslationState(jsonText(read.value));
  return state === undefined
    ? refusal(`it is not an ${TRANSLATION_STATE_PROFILE} record`)
    : toolkitSuccess(state);
}

/**
 * The fourth member of the completeness family, and the one that is about time rather than count.
 *
 * A translation written against an older source is present and wrong, which is a worse failure than
 * one that is absent and obviously so: the reader gets confident text that no longer says what
 * the source says. It escalates with the rest for that reason: "is this locale finished" is one
 * question, and a locale whose messages all exist but half of them answer an older question is not
 * finished.
 *
 * Only `check` can escalate it. `generate` has no completeness switch, so it passes `false` and the
 * finding stays the advisory it is during authoring.
 */
function staleTranslationDiagnostics(
  stale: readonly StaleTranslation[],
  configuration: Pick<ProjectConfiguration, 'inProgress'>,
  requireComplete: boolean,
): readonly ToolkitDiagnostic[] {
  return Object.freeze(
    stale.map((entry) => {
      const policy = completenessPolicy(
        configuration,
        requireComplete,
        entry.locale,
      );
      return toolkitDiagnostic(
        'EQ1309',
        `Translation ${JSON.stringify(entry.messageId)} in ${entry.locale} was written against an older ${entry.scopeId} source and may no longer match it.${policy.suffix}`,
        { path: ['messages', entry.messageId], severity: policy.severity },
      );
    }),
  );
}

/**
 * Re-read the inputs and fingerprint them again, to catch a source edited during compilation.
 *
 * The reload has to use the same selection as the compile that produced the fingerprint being
 * compared against. Any selection field that changes what is loaded changes the fingerprint, so
 * reloading under a different one reports every such build as a source that moved underneath it.
 * `observability` is dropped rather than carried: it is the one field that does not affect what
 * is loaded, and passing it would emit a second set of events for a read the caller did not ask
 * for. Spreading the rest means a field added later is honoured here without being remembered.
 */
async function revalidatedInputFingerprint(
  ownerRoot: string,
  selection: ProjectSelection,
): Promise<string> {
  const { observability: _observability, ...inputSelection } = selection;
  const project = await loadProject(
    { ...inputSelection, cwd: ownerRoot, project: ownerRoot },
    { requirePackageSetup: true },
  );
  if (!project.ok) {
    throw new TypeError(
      project.diagnostics
        .map(({ code, summary }) => `${code}: ${summary}`)
        .join('\n'),
    );
  }
  return fingerprintCompilerInputs(compileRequest(project.value))
    .inputFingerprint;
}

/**
 * A generation, and whether the inputs alone decided how it ended.
 *
 * One that published, or that loading or compiling refused, ends the same way whenever it is given
 * the same inputs. One stopped after that, by a translation-state record it could not read or an
 * output transaction that withheld, depends on something else in the owner, so the same inputs can
 * end differently the next time.
 */
interface GenerationOutcome {
  readonly result: ToolkitResult<GenerateProjectResult>;
  readonly decidedByInputs: boolean;
}

async function generateProjectCore(
  options: GenerateProjectOptions,
  loaded: ToolkitResult<LoadedProject> | undefined,
): Promise<GenerationOutcome> {
  const compiled = await compileProjectFromDiskInternal(options, loaded);
  if (!compiled.ok) return { result: compiled, decidedByInputs: true };
  const { project, compilation } = compiled.value;
  const recorded = await readTranslationState(project.ownerRoot);
  if (!recorded.ok) return { result: recorded, decidedByInputs: false };
  const publication = await applyOutputPlan({
    ownerRoot: project.ownerRoot,
    generatedRoot: project.generatedRoot,
    workRoot: project.workRoot,
    ownerId: compilation.artifacts.ownerId,
    plan: compilation.artifacts.outputPlan,
    dryRun: options.dryRun === true,
    expectedInputFingerprint: compilation.state.inputFingerprint,
    revalidateInputFingerprint: () =>
      revalidatedInputFingerprint(project.ownerRoot, options),
  });
  if (!publication.ok) return { result: publication, decidedByInputs: false };

  // The record only moves forward when output is actually published. A dry run must observe
  // staleness without recording that it observed it, or the next real run would see nothing.
  const translationState = reconcileTranslationState(
    compilation.graph,
    recorded.value,
  );
  const staleDiagnostics = staleTranslationDiagnostics(
    translationState.stale,
    project.configuration,
    false,
  );
  if (options.dryRun !== true && translationState.changed) {
    try {
      await writeFile(
        resolve(project.ownerRoot, TRANSLATION_STATE_PATH),
        formatTranslationState(translationState.state),
        'utf8',
      );
    } catch {
      // Losing the record costs an advisory, never correctness: the next run re-stamps.
    }
  }

  let cacheDiagnostics: readonly ToolkitDiagnostic[] = [];
  if (options.dryRun !== true) {
    try {
      cacheDiagnostics = await writeCompilerCache(
        project,
        compilation.artifacts.ownerId,
        compilation.state,
      );
    } catch {
      cacheDiagnostics = Object.freeze([
        toolkitDiagnostic(
          'EQ1703',
          'Equator accepted generated output but could not persist its disposable incremental cache.',
          { severity: 'warning' },
        ),
      ]);
    }
  }
  return {
    result: toolkitSuccess(
      Object.freeze({ ...compiled.value, publication: publication.value }),
      [
        ...compiled.diagnostics,
        ...publication.diagnostics,
        ...cacheDiagnostics,
        ...staleDiagnostics,
      ],
    ),
    decidedByInputs: true,
  };
}

/**
 * Compiles a project and writes its generated tree.
 *
 * The verb a build runs. Writes only the files whose content changed and removes the ones the
 * sources no longer produce, so an unchanged project leaves the tree and its timestamps alone.
 *
 * Returns what was written and removed, or the reasons nothing was. Pass `dryRun` to find out what
 * it would do without doing it.
 */
export async function generateProject(
  options: GenerateProjectOptions = {},
): Promise<ToolkitResult<GenerateProjectResult>> {
  requireArgument('generateProject', 'options', options, projectOptions());
  return (await generateFromInputs(options)).result;
}

/**
 * A generation over inputs the caller has already loaded, or over the ones on disk when it has not.
 *
 * Watch loads the inputs to decide whether a cycle has anything to do, and a generation that
 * loaded them again would read every input twice on each edit.
 */
async function generateFromInputs(
  options: GenerateProjectOptions,
  loaded?: ToolkitResult<LoadedProject>,
): Promise<GenerationOutcome> {
  const sink = options.observability;
  if (sink === undefined) return generateProjectCore(options, loaded);
  emitToolkitEvent(sink, {
    code: TOOLKIT_EVENT_CODES.compilation,
    phase: 'generation',
    status: 'started',
  });
  let outcome: GenerationOutcome;
  try {
    outcome = await generateProjectCore(options, loaded);
  } catch (error) {
    emitToolkitEvent(sink, {
      code: TOOLKIT_EVENT_CODES.compilation,
      phase: 'generation',
      status: 'failed',
    });
    throw error;
  }
  const { result } = outcome;
  if (result.ok) {
    emitToolkitEvent(sink, {
      code: TOOLKIT_EVENT_CODES.compilation,
      phase: 'generation',
      status: result.value.publication.changed ? 'succeeded' : 'unchanged',
      count:
        result.value.publication.written.length +
        result.value.publication.removed.length,
    });
  } else {
    const diagnosticCode = result.diagnostics[0]?.code;
    emitToolkitEvent(sink, {
      code: TOOLKIT_EVENT_CODES.compilation,
      phase: 'generation',
      status: 'failed',
      ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
    });
  }
  return outcome;
}

/**
 * Checks a project without writing its generated tree.
 *
 * The verb a pull request runs. Everything generating would report, plus whether what is on disk is
 * still what the sources produce, which is how a generated tree somebody forgot to commit is
 * caught.
 *
 * Returns the compilation, the freshness, and anything it reformatted. Pass `fix` to have it
 * rewrite catalogs that are out of canonical form, and `requireCompleteTargets` to make an
 * unfinished locale an error rather than a warning.
 */
export async function checkProject(
  options: CheckProjectOptions = {},
): Promise<ToolkitResult<CheckProjectResult>> {
  requireArgument(
    'checkProject',
    'options',
    options,
    projectOptions({
      fix: 'flag',
      requireCompleteTargets: 'flag',
      requireFreshOutput: 'flag',
    }),
  );
  let fixedFiles: readonly string[] = Object.freeze([]);
  if (options.fix === true) {
    const formatted = await formatProject(options);
    if (!formatted.ok) return formatted;
    fixedFiles = formatted.value.files;
  }
  const compiled = await compileProjectFromDiskInternal(options);
  if (!compiled.ok) return compiled;
  const { project, compilation } = compiled.value;
  const recorded = await readTranslationState(project.ownerRoot);
  if (!recorded.ok) return recorded;
  const freshness = await inspectOutputFreshness({
    ownerRoot: project.ownerRoot,
    generatedRoot: project.generatedRoot,
    workRoot: project.workRoot,
    ownerId: compilation.artifacts.ownerId,
    plan: compilation.artifacts.outputPlan,
  });
  if (!freshness.ok) return freshness;

  // Reconciled but not persisted: check reports what it sees and leaves the record for generate to
  // move, so a read-only command cannot quietly retire a warning it just raised.
  const translationState = reconcileTranslationState(
    compilation.graph,
    recorded.value,
  );

  const diagnostics = [
    ...compiled.diagnostics,
    ...freshness.diagnostics,
    ...staleTranslationDiagnostics(
      translationState.stale,
      project.configuration,
      options.requireCompleteTargets === true,
    ),
  ];
  if (!freshness.value.fresh) {
    diagnostics.push(
      toolkitDiagnostic(
        'EQ1704',
        `Generated output is stale (${freshness.value.missing.length} missing, ${freshness.value.changed.length} changed, ${freshness.value.stale.length} stale). Run equator generate.`,
        // The same finding either way; the policy decides whether it blocks. Escalating the
        // severity rather than raising a second code keeps one diagnostic for one fact, and the
        // severity-keyed exit path does the rest.
        {
          severity: options.requireFreshOutput === true ? 'error' : 'warning',
        },
      ),
    );
  }
  return toolkitSuccess(
    Object.freeze({
      ...compiled.value,
      freshness: freshness.value,
      fixedFiles: Object.freeze([...fixedFiles]),
    }),
    diagnostics,
  );
}

async function applyTextChanges(
  ownerRoot: string,
  changes: readonly TextFileChange[],
  dryRun: boolean,
): Promise<ToolkitResult<FormatProjectResult>> {
  const changed = changes
    .map((change) =>
      // A mark the file was saved with is the file's, and Equator writes only what it changed.
      change.previous?.startsWith(BYTE_ORDER_MARK) === true &&
      !change.contents.startsWith(BYTE_ORDER_MARK)
        ? { ...change, contents: `${BYTE_ORDER_MARK}${change.contents}` }
        : change,
    )
    .filter(({ previous, contents }) => previous !== contents)
    .sort((left, right) =>
      compareCodeUnit(left.portablePath, right.portablePath),
    );
  if (dryRun || changed.length === 0) {
    return toolkitSuccess(
      Object.freeze({
        changed: changed.length > 0,
        files: Object.freeze(changed.map(({ portablePath: path }) => path)),
      }),
    );
  }
  const lockPath = resolve(ownerRoot, '.equator-authoring.lock');
  let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
  const transactionId = randomBytes(12).toString('hex');
  const operations: {
    change: TextFileChange;
    temporary: string;
    backup: string;
    published: boolean;
  }[] = [];
  try {
    lockHandle = await open(lockPath, 'wx');
    for (const change of changed) {
      await assertOrdinaryContainedPath(ownerRoot, change.absolutePath);
      const current = (await pathExists(change.absolutePath))
        ? await readFile(change.absolutePath, 'utf8')
        : undefined;
      if (current !== change.previous) {
        throw new TypeError(
          `Equator input ${change.portablePath} changed before publication.`,
        );
      }
      const temporary = resolve(
        dirname(change.absolutePath),
        `.${basename(change.absolutePath)}.equator-${transactionId}.tmp`,
      );
      const backup = resolve(
        dirname(change.absolutePath),
        `.${basename(change.absolutePath)}.equator-${transactionId}.bak`,
      );
      await writeSynced(temporary, change.contents);
      operations.push({ change, temporary, backup, published: false });
    }
    for (const operation of operations) {
      if (operation.change.previous !== undefined) {
        await rename(operation.change.absolutePath, operation.backup);
      }
      await rename(operation.temporary, operation.change.absolutePath);
      operation.published = true;
    }
    for (const operation of operations) {
      if (operation.change.previous !== undefined)
        await unlink(operation.backup);
    }
    return toolkitSuccess(
      Object.freeze({
        changed: true,
        files: Object.freeze(changed.map(({ portablePath: path }) => path)),
      }),
    );
  } catch (error) {
    for (const operation of [...operations].reverse()) {
      try {
        if (operation.published)
          await rm(operation.change.absolutePath, { force: true });
        if (await pathExists(operation.backup)) {
          await rename(operation.backup, operation.change.absolutePath);
        }
        await rm(operation.temporary, { force: true });
      } catch {
        return toolkitFailure([
          toolkitDiagnostic(
            'EQ1602',
            'Equator authoring publication failed and automatic rollback could not be completed safely.',
          ),
        ]);
      }
    }
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1602',
        `Equator authoring publication failed safely: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ]);
  } finally {
    if (lockHandle !== undefined) {
      await lockHandle.close();
      await rm(lockPath, { force: true });
    }
  }
}

/**
 * Rewrites a project's authored files into canonical form, and writes nothing else.
 *
 * The configuration, the catalogs and the extension registry, each through the same formatter that
 * parses them, so what is written parses back to what was there. A file whose round trip does not
 * hold is reported rather than written, because a formatter that changes meaning is worse than one
 * that declines.
 *
 * Takes the project to work on and whether to write; with no options it formats the project found
 * from the current directory. Reports what it rewrote, or the diagnostics that stopped it.
 */
export async function formatProject(
  options: FormatProjectOptions = {},
): Promise<ToolkitResult<FormatProjectResult>> {
  requireArgument('formatProject', 'options', options, projectOptions());
  const project = await loadProject(options);
  if (!project.ok) return project;
  const changes: TextFileChange[] = [];
  const configurationText = formatConfiguration(project.value.configuration);
  const configurationRoundTrip = parseConfiguration(configurationText);
  if (
    !configurationRoundTrip.ok ||
    JSON.stringify(configurationRoundTrip.value) !==
      JSON.stringify(project.value.configuration)
  ) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1703',
        'Equator refused configuration formatting because semantic equality was not proven.',
      ),
    ]);
  }
  changes.push({
    absolutePath: project.value.configurationPath,
    portablePath: CONFIGURATION_NAME,
    previous: project.value.configurationSource,
    contents: configurationText,
  });
  if (
    project.value.extensions !== undefined &&
    project.value.extensionSource !== undefined
  ) {
    const contents = formatExtensionRegistry(project.value.extensions);
    const roundTrip = parseExtensionRegistry(contents);
    if (
      !roundTrip.ok ||
      JSON.stringify(roundTrip.value) !==
        JSON.stringify(project.value.extensions)
    ) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1703',
          'Equator refused extension-registry formatting because semantic equality was not proven.',
        ),
      ]);
    }
    changes.push({
      absolutePath: resolve(project.value.ownerRoot, EXTENSION_REGISTRY_NAME),
      portablePath: EXTENSION_REGISTRY_NAME,
      previous: project.value.extensionSource,
      contents,
    });
  }
  for (const file of project.value.catalogFiles) {
    const catalogOptions = {
      role: file.catalog.role,
      providerId: file.catalog.providerId,
      scopeId: file.catalog.scopeId,
      locale: file.catalog.locale,
      sourcePath: file.portablePath,
      ...(project.value.extensions === undefined
        ? {}
        : { extensions: project.value.extensions }),
    };
    // The authored document, restyled. Formatting an authored catalog from the semantic model
    // deleted every comment in it, because comments are not in that model.
    const formatted = formatCatalogSource(file.source, catalogOptions);
    if (!formatted.ok) return formatted;
    const contents = formatted.value;
    const roundTrip = parseCatalog(contents, catalogOptions);
    if (
      !roundTrip.ok ||
      JSON.stringify(roundTrip.value) !== JSON.stringify(file.catalog)
    ) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1703',
          `Equator refused formatting ${JSON.stringify(file.portablePath)} because semantic equality was not proven.`,
        ),
      ]);
    }
    changes.push({
      absolutePath: file.absolutePath,
      portablePath: file.portablePath,
      previous: file.source,
      contents,
    });
  }
  return applyTextChanges(
    project.value.ownerRoot,
    changes,
    options.dryRun === true,
  );
}

async function initOwner(
  selection: ProjectSelection,
): Promise<ToolkitResult<ProjectLocation>> {
  if (selection.project !== undefined) {
    const owner = await explicitOwner(
      selection.project,
      resolve(selection.cwd ?? process.cwd()),
    );
    if (!owner.ok) return owner;
    return discoverProject({ ...selection, project: owner.value });
  }
  // `init` is the one command that may proceed when discovery finds nothing: creating the project
  // is what it is for. Which outcome it was is read from the search rather than from the wording of
  // the diagnostic. Reading it as `summary.startsWith('No equator.config.json was found.')` makes
  // improving that sentence turn `init` into a command that refuses an empty directory.
  const ownerRoot = resolve(selection.cwd ?? process.cwd());
  const search = await searchOwnerWithinPackage(ownerRoot);
  if (search.outcome !== 'none') {
    return discoverProject(selection);
  }
  const metadata = await pathMetadata(ownerRoot);
  if (
    metadata === undefined ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink()
  ) {
    return toolkitFailure([
      projectDiagnostic(
        'Equator init requires an existing ordinary owner directory.',
      ),
    ]);
  }
  const generatedRoot = await generatedRootPath(ownerRoot);
  if (!generatedRoot.ok) return generatedRoot;
  return toolkitSuccess(
    Object.freeze({
      ownerRoot,
      configurationPath: resolve(ownerRoot, CONFIGURATION_NAME),
      packagePath: resolve(ownerRoot, 'package.json'),
      generatedRoot: resolve(ownerRoot, ...generatedRoot.value.split('/')),
      generatedRootPath: generatedRoot.value,
      workRoot: resolve(ownerRoot, WORK_ROOT),
    }),
  );
}

function requestedConfiguration(
  options: InitProjectOptions,
): ToolkitResult<ProjectConfiguration> {
  const requested = (options.configuration ?? {}) as Readonly<
    Record<string, unknown>
  >;
  // Required, and what to type to supply it, both read from the generated option table, which is
  // itself read from `CONFIGURATION_SCHEMA`. `required` is a schema fact; the flag beside it
  // is how a person sets that field, and a diagnostic about a missing input that does not say what
  // to type has told the reader the half they already knew.
  const missing = INIT_OPTIONS.filter((option) => {
    if (!option.required) return false;
    const value = requested[option.key];
    // An empty list is an absence rather than a choice: `locales: []` cannot be what anyone meant,
    // and letting it through would report it as a schema violation against a file nobody wrote.
    return value === undefined || (Array.isArray(value) && value.length === 0);
  });
  if (missing.length > 0) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1701',
        `Noninteractive equator init requires ${missing
          .map(
            (option) =>
              `${option.flag} ${option.value}${option.repeatable ? ' (repeat for each)' : ''}`,
          )
          .join(', ')}.`,
      ),
    ]);
  }
  // Everything the caller supplied, unexamined. What is acceptable is `parseConfiguration`'s
  // question and it is about to be asked: a key list here would answer it a second time, in a
  // second place, and the two would disagree the day one of them was edited.
  const source = `${JSON.stringify(
    { schemaVersion: 1, ...requested },
    null,
    2,
  )}\n`;
  return parseConfiguration(source, { sourcePath: CONFIGURATION_NAME });
}

/**
 * A package manifest written back in the style it was read in.
 *
 * `package.json` is the application's file, and Equator's part of it is a few entries. Rewriting the
 * rest in another style would put a change nobody made into the application's history, so the file
 * is left exactly as it is when its entries are what they already were, and otherwise keeps its
 * indentation and line endings. The style is read the way npm reads a manifest
 * (`json-parse-even-better-errors`): what follows the opening brace, and no indentation when the
 * first entry sits on the brace's own line.
 */
function manifestSource(
  value: Readonly<Record<string, unknown>>,
  source: string,
): string {
  if (JSON.stringify(JSON.parse(jsonText(source))) === JSON.stringify(value)) {
    return source;
  }
  const style = /^\s*\{((?:\r?\n)+)([ \t]*)/u.exec(source);
  const newline = style?.[1]?.startsWith('\r\n') === true ? '\r\n' : '\n';
  const indent =
    style !== null ? (style[2] ?? '') : source.trim() === '{}' ? '  ' : '';
  return `${JSON.stringify(value, null, indent)}\n`.replaceAll('\n', newline);
}

function updatedPackageSource(
  source: string,
  manifest: Readonly<Record<string, unknown>>,
  generatedRootPortablePath: string,
): ToolkitResult<string> {
  const mutable = JSON.parse(JSON.stringify(manifest)) as Record<
    string,
    unknown
  >;
  const currentImports = mutable['imports'];
  if (
    currentImports !== undefined &&
    (typeof currentImports !== 'object' ||
      currentImports === null ||
      Array.isArray(currentImports))
  ) {
    return toolkitFailure([
      toolkitDiagnostic('EQ1705', 'package.json imports must be an object.'),
    ]);
  }
  const imports = (currentImports ?? {}) as Record<string, unknown>;
  for (const [specifier, target] of Object.entries(
    packageImports(generatedRootPortablePath),
  )) {
    const existing = imports[specifier];
    if (existing !== undefined && existing !== target) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1705',
          `Equator init refuses conflicting package import ${JSON.stringify(specifier)}.`,
          { path: ['imports', specifier] },
        ),
      ]);
    }
    imports[specifier] = target;
  }
  mutable['imports'] = imports;
  const currentScripts = mutable['scripts'];
  if (
    currentScripts !== undefined &&
    (typeof currentScripts !== 'object' ||
      currentScripts === null ||
      Array.isArray(currentScripts))
  ) {
    return toolkitFailure([
      toolkitDiagnostic('EQ1705', 'package.json scripts must be an object.'),
    ]);
  }
  const scripts = (currentScripts ?? {}) as Record<string, unknown>;
  for (const [name, command] of Object.entries(PACKAGE_SCRIPTS)) {
    const existing = scripts[name];
    if (existing !== undefined && existing !== command) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1705',
          `Equator init refuses conflicting package script ${JSON.stringify(name)}.`,
          { path: ['scripts', name] },
        ),
      ]);
    }
    scripts[name] = command;
  }
  mutable['scripts'] = scripts;
  return toolkitSuccess(manifestSource(mutable, source));
}

/**
 * Sets a project up: writes the configuration, the package scripts, and the generated-output root.
 *
 * Safe to run again. An existing configuration is read and merged rather than replaced, and a
 * package script that already means something else is refused by name instead of overwritten.
 *
 * Takes at least the locales to configure, which is why the options are required here. Reports what
 * it wrote and the configuration the project now has, or the diagnostics that stopped it. Two
 * things are left for the project to write and are named in the result's diagnostics: the first
 * catalog, and the recovery message a visitor reads if the translations cannot be loaded.
 */
export async function initializeProject(
  options: InitProjectOptions,
): Promise<ToolkitResult<InitProjectResult>> {
  requireArgument(
    'initializeProject',
    'options',
    options,
    projectOptions({ configuration: 'record' }),
  );
  const location = await initOwner(options);
  if (!location.ok) return location;
  const packageManifest = await readPackageManifest(location.value, true);
  if (!packageManifest.ok) return packageManifest;
  const existingConfiguration = (await pathExists(
    location.value.configurationPath,
  ))
    ? await readConfiguration(location.value)
    : undefined;
  if (existingConfiguration !== undefined && !existingConfiguration.ok) {
    return existingConfiguration;
  }
  const suppliedAny =
    options.configuration !== undefined &&
    Object.keys(options.configuration).length > 0;
  const requested =
    existingConfiguration === undefined || suppliedAny
      ? requestedConfiguration(options)
      : toolkitSuccess(existingConfiguration.value.value);
  if (!requested.ok) return requested;
  if (
    existingConfiguration !== undefined &&
    formatConfiguration(existingConfiguration.value.value) !==
      formatConfiguration(requested.value)
  ) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1705',
        'Equator init arguments conflict with the existing equator.config.json.',
      ),
    ]);
  }
  const packageSource = updatedPackageSource(
    packageManifest.value.source,
    packageManifest.value.value,
    location.value.generatedRootPath,
  );
  if (!packageSource.ok) return packageSource;
  const configurationSource = formatConfiguration(requested.value);
  const changes: TextFileChange[] = [
    {
      absolutePath: location.value.configurationPath,
      portablePath: CONFIGURATION_NAME,
      previous: existingConfiguration?.value.source,
      contents: configurationSource,
    },
    {
      absolutePath: location.value.packagePath,
      portablePath: 'package.json',
      // A manifest Equator is creating has no previous contents, and claiming one would make the
      // change look like an edit to a file that was never there.
      previous: packageManifest.value.created
        ? undefined
        : packageManifest.value.source,
      contents: packageSource.value,
    },
  ];
  const applied = await applyTextChanges(
    location.value.ownerRoot,
    changes,
    options.dryRun === true,
  );
  if (!applied.ok) return applied;

  // The container, and never anything in it.
  //
  // `generate` has to succeed on a project with no messages, because that is the state every
  // project is in the moment after `init` and the install line is `init` then `generate`. The one
  // thing a consumer cannot work out for themselves is the directory's name, so `init` makes it.
  //
  // It writes no catalog. A first catalog would be Equator's words sitting in a consumer's product,
  // and an empty one is not a file that can exist: `messages.minProperties: 1` in
  // `SOURCE_CATALOG_SCHEMA` refuses `messages: {}`. Relaxing that would admit empty scopes,
  // which `specs/04-message-authoring-and-catalogs.spec.md` section 3 prohibits as reservation
  // scaffolding. So: the directory, and nothing.
  const catalogRoot = resolve(location.value.ownerRoot, 'i18n');
  const catalogRootMissing = !(await pathExists(catalogRoot));
  if (catalogRootMissing && options.dryRun !== true) {
    await assertOrdinaryContainedPath(location.value.ownerRoot, catalogRoot);
    await mkdir(catalogRoot, { recursive: true });
  }
  const files = catalogRootMissing
    ? Object.freeze(
        [...applied.value.files, 'i18n'].sort((left, right) =>
          compareCodeUnit(left, right),
        ),
      )
    : applied.value.files;

  return toolkitSuccess(
    Object.freeze({
      changed: applied.value.changed || catalogRootMissing,
      files,
      configuration: requested.value,
    }),
    [
      ...requested.diagnostics,
      ...applied.diagnostics,
      // The two things `init` cannot do for this project, said here rather than met one at a time.
      //
      // Both are content, and content is the consumer's. The first catalog is their words; the
      // recovery message is the sentence a visitor reads when the translations cannot be loaded.
      // Equator writing either would be Equator's words sitting in someone else's product, so
      // neither is scaffolded, and what `init` owes instead is to name them.
      //
      // The recovery message is here because it is the one nobody expects. `EQ1702` already names
      // the first catalog at the next `generate`; nothing named the recovery message until
      // `EQ1310` refused a build that was otherwise finished, by which time the reader has already
      // composed `provideLocalization` believing every feature optional. It is not optional for an
      // owner that composes the application runtime, and the honest time to say so is before the
      // composing rather than after it.
      toolkitDiagnostic(
        'EQ1706',
        `Equator init is done. Two things are yours to write: the first catalog at i18n/<scope>/${requested.value.sourceLocale}.yaml, for example i18n/shell/${requested.value.sourceLocale}.yaml, and a recovery message. One plain message passed to provideLocalization through withRecoveryMessage, which is what a visitor reads if the translations cannot be loaded.`,
        { severity: 'info' },
      ),
    ],
  );
}

/**
 * Removes Equator from a project: the generated output, the configuration, and the package scripts.
 *
 * Takes the project to work on, whether to write, and whether to take the authored catalogs with
 * it; with no options it uninstalls the project found from the current directory and leaves the
 * catalogs alone. Reports what it removed and what it left, or the diagnostics that stopped it.
 *
 * `clean` means "remove build output" everywhere else in the ecosystem (`cargo clean`,
 * `make clean`, `ng cache clean` all leave project configuration alone) so it keeps that
 * meaning, and this is a separate command rather than a flag on it. A flag that turns "remove
 * build output" into "remove the tool" is one that eventually runs in a pipeline by accident.
 *
 * Authored catalogs are the consumer's content and stay unless removal is asked for by name.
 * Deleting a project's translations as a side effect of uninstalling a tool would be
 * indefensible.
 *
 * Only what Equator wrote is taken back. A `#i18n` specifier a consumer has repointed, or a script
 * they have edited, is theirs now: it is left exactly as it is and named in the result, because
 * silently reverting an edit is the same class of mistake as silently deleting a comment.
 */
export async function uninstallProject(
  options: UninstallProjectOptions = {},
): Promise<ToolkitResult<UninstallProjectResult>> {
  requireArgument(
    'uninstallProject',
    'options',
    options,
    projectOptions({ catalogs: 'flag' }),
  );
  const location = await discoverProject(options);
  if (!location.ok) return location;
  const dryRun = options.dryRun === true;

  // Read while the project can still be loaded. Everything below removes the configuration that
  // makes loading possible, so asking afterwards would find nothing and quietly remove nothing.
  const authoredCatalogs =
    options.catalogs === true ? await loadProject(options) : undefined;
  if (authoredCatalogs !== undefined && !authoredCatalogs.ok) {
    return authoredCatalogs;
  }

  const cleaned = await cleanOutput({
    ownerRoot: location.value.ownerRoot,
    generatedRoot: location.value.generatedRoot,
    workRoot: location.value.workRoot,
    dryRun,
  });
  if (!cleaned.ok) return cleaned;

  const manifest = await readPackageManifest(location.value);
  if (!manifest.ok) return manifest;
  const retained: string[] = [];
  const mutable = JSON.parse(JSON.stringify(manifest.value.value)) as Record<
    string,
    unknown
  >;

  const imports = mutable['imports'];
  if (
    typeof imports === 'object' &&
    imports !== null &&
    !Array.isArray(imports)
  ) {
    const entries = imports as Record<string, unknown>;
    for (const [specifier, target] of Object.entries(
      packageImports(location.value.generatedRootPath),
    )) {
      if (!(specifier in entries)) continue;
      if (entries[specifier] === target) delete entries[specifier];
      else retained.push(`imports.${specifier}`);
    }
    // `init` creates this key when an owner has none. Leaving `"imports": {}` behind would leave
    // a trace of a tool that is supposed to be gone.
    if (Object.keys(entries).length === 0) delete mutable['imports'];
  }

  const scripts = mutable['scripts'];
  if (
    typeof scripts === 'object' &&
    scripts !== null &&
    !Array.isArray(scripts)
  ) {
    const entries = scripts as Record<string, unknown>;
    for (const [name, command] of Object.entries(PACKAGE_SCRIPTS)) {
      if (!(name in entries)) continue;
      if (entries[name] === command) delete entries[name];
      else retained.push(`scripts.${name}`);
    }
    if (Object.keys(entries).length === 0) delete mutable['scripts'];
  }

  const packageContents = manifestSource(mutable, manifest.value.source);
  const changes: TextFileChange[] = [];
  if (packageContents !== manifest.value.source) {
    changes.push({
      absolutePath: location.value.packagePath,
      portablePath: 'package.json',
      previous: manifest.value.source,
      contents: packageContents,
    });
  }
  const applied = await applyTextChanges(
    location.value.ownerRoot,
    changes,
    dryRun,
  );
  if (!applied.ok) return applied;

  const removed = [...cleaned.value.removed, ...applied.value.files];
  if (await pathExists(location.value.configurationPath)) {
    removed.push(CONFIGURATION_NAME);
    if (!dryRun) await rm(location.value.configurationPath, { force: true });
  }

  let catalogs: readonly string[] = [];
  if (authoredCatalogs?.ok === true) {
    const files = authoredCatalogs.value.catalogFiles;
    if (!dryRun) {
      for (const file of files) await rm(file.absolutePath, { force: true });
    }
    catalogs = Object.freeze(
      files.map((file) => file.portablePath).sort(compareCodeUnit),
    );
    removed.push(...catalogs);
  }

  return toolkitSuccess(
    Object.freeze({
      changed: removed.length > 0,
      removed: Object.freeze([...new Set(removed)].sort(compareCodeUnit)),
      retained: Object.freeze([...retained].sort(compareCodeUnit)),
      catalogs,
    }),
    [...cleaned.diagnostics, ...applied.diagnostics],
  );
}

/**
 * Removes a project's generated output and leaves everything else alone.
 *
 * The configuration, the authored catalogs and the package scripts stay, which is what `clean`
 * means everywhere else. Removing Equator itself is `uninstallProject`, a separate call rather
 * than a flag on this one, because a flag that turns "remove build output" into "remove the tool"
 * eventually runs in a pipeline by accident.
 *
 * Takes the project to work on and whether to delete; with no options it cleans the project found
 * from the current directory. Reports what it removed, or the diagnostics that stopped it.
 */
export async function cleanProject(
  options: CleanProjectOptions = {},
): Promise<ToolkitResult<CleanOutputResult>> {
  requireArgument('cleanProject', 'options', options, projectOptions());
  const location = await discoverProject(options);
  if (!location.ok) return location;
  return cleanOutput({
    ownerRoot: location.value.ownerRoot,
    generatedRoot: location.value.generatedRoot,
    workRoot: location.value.workRoot,
    dryRun: options.dryRun === true,
  });
}

/**
 * Whether an event names something the watch itself or a build writes, or something outside the
 * owner. The roots are absolute and are the project's own: an application with a root of its own
 * generates under that root, and a build writes wherever its configuration says.
 */
function watchIgnored(
  ownerRoot: string,
  ignoredRoots: readonly string[],
  fileName: string | Buffer | null,
): boolean {
  if (fileName === null) return false;
  const segments = fileName.toString().replaceAll('\\', '/').split('/');
  const path = resolve(ownerRoot, ...segments);
  return (
    segments.includes('node_modules') ||
    ignoredRoots.some((root) => containedPath(path, root)) ||
    !containedPath(path, ownerRoot)
  );
}

/**
 * What a watch cycle holds against the cycle before it: the inputs fingerprint a generation runs
 * on, or the refusal where the inputs are refused before one can be taken.
 *
 * A refusal stands in for the fingerprint because a refused load generates nothing, so its
 * diagnostics are all the cycle would report, and the same ones twice report nothing new.
 */
function watchedInputs(loaded: ToolkitResult<LoadedProject>): string {
  return loaded.ok
    ? fingerprintCompilerInputs(compileRequest(loaded.value)).inputFingerprint
    : JSON.stringify(loaded.diagnostics);
}

/**
 * Watching an owner, without becoming something that has to be installed.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 13 makes this an explicit foreground process
 * with no daemon, account, service or install hook behind it, and treats filesystem events as
 * hints: startup reconciles fully, content is reread, an uncertain or overflowed event widens
 * back to a full bounded reconciliation rather than trusting what the platform reported, and a
 * cycle that rereads the inputs the cycle before it settled reports nothing and generates nothing.
 *
 * Once the returned promise resolves after a stop, no further cycle is delivered and the watcher
 * holds no reference that keeps the process alive. The operating system handle is released by the
 * event loop shortly after: Node reports no event for that release, so it cannot be awaited.
 */
export async function watchProject(
  options: WatchProjectOptions,
): Promise<ToolkitResult<WatchProjectResult>> {
  requireArgument(
    'watchProject',
    'options',
    options,
    projectOptions(
      { debounceMilliseconds: 'number', onCycle: 'function' },
      { signal: { required: { addEventListener: 'function' } } },
    ),
  );
  const location = await discoverProject(options);
  if (!location.ok) return location;
  const application = await selectAngularApplication(location.value.ownerRoot);
  const ignoredRoots = Object.freeze([
    location.value.workRoot,
    location.value.generatedRoot,
    (application.ok ? application.value?.outputPath : undefined) ??
      resolve(location.value.ownerRoot, 'dist'),
  ]);
  const debounce = Math.max(
    10,
    Math.min(options.debounceMilliseconds ?? 75, 2000),
  );
  let cycles = 0;
  let running = false;
  // Raised and lowered inside the cycle below, which is an assignment the compiler cannot order
  // against a plain read of the variable.
  const isRunning = (): boolean => running;
  let pending = false;
  // An event says something may have changed, and reading an input can itself raise one where the
  // platform records access times. Kept only where the inputs alone decided how the cycle ended, so
  // a cycle that something else stopped runs again on the next event.
  let settledInputs: string | undefined;
  let stopping = false;
  let watcherError: Error | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolvePromise) => {
    resolveDone = resolvePromise;
  });
  // Settles once the platform watcher has said it closed, so a caller that removes the owner the
  // moment this returns is not racing a watcher that still holds it.
  let closed: Promise<void> = Promise.resolve();
  const stop = (): void => {
    stopping = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (watcher !== undefined) {
      const closing = watcher;
      watcher = undefined;
      closed = new Promise((resolveClosed) => {
        closing.once('close', () => resolveClosed());
      });
      closing.close();
    }
    if (!running) resolveDone?.();
  };
  const cycle = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      const selection = {
        cwd: location.value.ownerRoot,
        project: location.value.ownerRoot,
      };
      const loaded = await loadProject(selection, {
        requirePackageSetup: true,
      });
      const inputs = watchedInputs(loaded);
      if (inputs === settledInputs) return;
      settledInputs = undefined;
      const { result, decidedByInputs } = await generateFromInputs(
        {
          ...selection,
          ...(options.observability === undefined
            ? {}
            : { observability: options.observability }),
        },
        loaded,
      );
      if (decidedByInputs) settledInputs = inputs;
      cycles += 1;
      options.onCycle?.(Object.freeze({ sequence: cycles, result }));
    } catch (error) {
      settledInputs = undefined;
      cycles += 1;
      options.onCycle?.(
        Object.freeze({
          sequence: cycles,
          result: toolkitFailure([
            toolkitDiagnostic(
              'EQ1703',
              `Equator watch reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ]),
        }),
      );
    } finally {
      running = false;
      if (stopping || options.signal.aborted) {
        stop();
      } else if (pending) {
        pending = false;
        void cycle();
      }
    }
  };
  try {
    watcher = watchFileSystem(
      location.value.ownerRoot,
      { recursive: true },
      (_event, fileName) => {
        if (watchIgnored(location.value.ownerRoot, ignoredRoots, fileName)) {
          return;
        }
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          void cycle();
        }, debounce);
      },
    );
    watcher.on('error', (error) => {
      watcherError = error;
      // Node has already closed the handle before reporting the error, and a close after that
      // emits no `close` event, so there is nothing left to wait for.
      watcher = undefined;
      stop();
    });
  } catch (error) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1703',
        `Equator could not start its foreground watcher: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ]);
  }
  try {
    options.signal.addEventListener('abort', stop, { once: true });
  } catch (error) {
    // The signal is the caller's object and the watcher is open by here, so a signal that
    // cannot be listened to is answered with the watcher closed before the error is passed on.
    stop();
    await closed;
    throw error;
  }
  await cycle();
  if (options.signal.aborted && !isRunning()) stop();
  await done;
  await closed;
  if (watcherError !== undefined) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1703',
        `Equator foreground watcher failed: ${watcherError.message}`,
      ),
    ]);
  }
  return toolkitSuccess(Object.freeze({ cycles }));
}
