/**
 * Publishing a generation, or leaving the previous one exactly as it was.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 9 makes the completion manifest the commit
 * marker and everything around it recoverable: output is staged, canonical bytes are compared,
 * a changed file is replaced through a same-directory sibling rather than by swapping a
 * directory or a link, and ownership is revalidated before every mutation without following a
 * link. A file whose bytes are unchanged is not rewritten, because a run that touches every
 * file makes every watcher downstream do its work again for nothing.
 */

import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  toolkitDiagnostic,
  toolkitFailure,
  toolkitSuccess,
  type ToolkitDiagnostic,
  type ToolkitResult,
} from './diagnostics.js';
import {
  COMPLETION_MANIFEST_PATH,
  createCompletionManifest,
  createOutputPlan,
  digestBytes,
  formatCompletionManifest,
  parseCompletionManifest,
  type CompletionManifest,
  type OutputPlan,
} from './output-plan.js';
import { compareCodeUnit } from './sorted-records.js';
import { pathExists, writeSynced } from './file-system.js';

/**
 * The file that marks a work root as Equator's, relative to the work root itself.
 *
 * Equator will create a work root, and will refuse an existing directory that does not carry this
 * marker. That refusal is the whole reason the constant is published: a consumer whose tooling
 * removes or relocates Equator's disposable state has to be able to recognise the directory as
 * Equator-owned before deleting anything, and recognising it by a path spelled out in the
 * consumer's own script is a guess that goes stale silently. Read the marker, check its `profile`
 * against {@link WORK_OWNER_PROFILE}, and only then treat the directory as Equator's.
 *
 * The marker also carries an `ownerId`, which is what makes two Equator-owned trees in one
 * repository distinguishable. A work root whose `ownerId` does not match the generated output
 * beside it is refused rather than adopted: one project's cache silently serving another's build is
 * the failure this prevents.
 */
export const WORK_OWNER_PATH = '.equator-owner.json' as const;
export const COMPILER_CACHE_PATH = 'cache/compiler-state.json' as const;
const TRANSACTION_PATH = 'transaction.json';
const LOCK_PATH = 'generation.lock';
/**
 * The `profile` value inside a work-root ownership marker, and the version of its shape.
 *
 * Compare against this rather than against the string: the trailing `/1` is a format version, and a
 * future Equator that changes what the marker holds will bump it. A consumer that matched on the
 * literal would then keep deleting a directory whose contents it no longer understands, which is
 * the one outcome an ownership check exists to prevent. A marker whose profile is not this one is
 * not a marker this version of Equator wrote, and the safe reading of it is "leave it alone".
 */
export const WORK_OWNER_PROFILE = 'equator-work-owner/1' as const;
export const TRANSACTION_PROFILE = 'equator-output-transaction/1' as const;

// Exported so the built declarations carry the persisted format's shape, which its shape record in
// `tools/format-shapes.json` is compared with. The package entry does not re-export it.
export interface WorkOwnerMarker {
  readonly profile: typeof WORK_OWNER_PROFILE;
  readonly ownerId: string;
}

export interface ApplyOutputPlanRequest {
  readonly ownerRoot: string;
  readonly generatedRoot: string;
  readonly workRoot: string;
  readonly ownerId: string;
  readonly plan: OutputPlan;
  readonly dryRun?: boolean;
  readonly expectedInputFingerprint?: string;
  readonly revalidateInputFingerprint?: () => Promise<string>;
}

/** What writing a plan did to the generated tree. */
export interface ApplyOutputPlanResult {
  /** Whether anything moved at all, which is what a build reports as a no-op. */
  readonly changed: boolean;
  /** The files created or rewritten. */
  readonly written: readonly string[];
  /** The files taken away, which are the ones the sources no longer produce. */
  readonly removed: readonly string[];
  /** The files already holding what was planned, left untouched down to their timestamps. */
  readonly unchanged: readonly string[];
}

/**
 * Whether the generated tree on disk is still what the sources produce, and where it is not.
 *
 * What a check reports and a pull request fails on: a generated tree somebody forgot to rebuild, or
 * edited by hand, is caught here rather than in a browser.
 */
export interface OutputFreshness {
  /** Whether everything matches. False when any of the three lists below has anything in it. */
  readonly fresh: boolean;
  /** Files the sources produce that are not on disk. */
  readonly missing: readonly string[];
  /** Files on disk holding something other than what the sources produce. */
  readonly changed: readonly string[];
  /** Files Equator wrote that the sources no longer produce. */
  readonly stale: readonly string[];
}

export interface CleanOutputRequest {
  readonly ownerRoot: string;
  readonly generatedRoot: string;
  readonly workRoot: string;
  readonly dryRun?: boolean;
}

export interface CleanOutputResult {
  readonly changed: boolean;
  readonly removed: readonly string[];
}

// Exported so the built declarations carry the persisted format's shape, which its shape record in
// `tools/format-shapes.json` is compared with. The package entry does not re-export it.
export interface TransactionOperation {
  readonly path: string;
  readonly temporary?: string;
  readonly backup: string;
  readonly hadOriginal: boolean;
}

export interface TransactionJournal {
  readonly profile: typeof TRANSACTION_PROFILE;
  readonly ownerId: string;
  readonly operations: readonly TransactionOperation[];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

/**
 * Whether `candidate` is `owner` or sits inside it.
 *
 * Exported because three call sites need the same answer (output writing, project discovery and
 * static analysis), and a path predicate that gates reads and writes must not exist as three
 * copies that can drift.
 */
export function containedPath(candidate: string, owner: string): boolean {
  const path = relative(owner, candidate);
  return (
    path === '' ||
    (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  );
}

function portableRelative(owner: string, candidate: string): string {
  return relative(owner, candidate).replaceAll('\\', '/');
}

function absoluteFromPortable(owner: string, path: string): string {
  const candidate = resolve(owner, ...path.split('/'));
  if (!containedPath(candidate, owner)) {
    throw new TypeError(`Equator transaction path escapes its owner: ${path}`);
  }
  return candidate;
}

async function assertSafeExistingPath(
  ownerRoot: string,
  target: string,
): Promise<void> {
  if (!containedPath(target, ownerRoot)) {
    throw new TypeError(`Equator path escapes its owner: ${target}`);
  }
  const relativePath = relative(ownerRoot, target);
  let current = ownerRoot;
  const segments = relativePath === '' ? [] : relativePath.split(sep);
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!(await pathExists(current))) break;
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new TypeError(`Equator refuses linked output path: ${current}`);
    }
  }
  const existing = await pathExists(target);
  if (existing) {
    const canonicalOwner = await realpath(ownerRoot);
    const canonicalTarget = await realpath(target);
    if (!containedPath(canonicalTarget, canonicalOwner)) {
      throw new TypeError(
        `Equator output path resolves outside its owner: ${target}`,
      );
    }
  }
}

async function validateRoots(
  request: Pick<
    ApplyOutputPlanRequest,
    'ownerRoot' | 'generatedRoot' | 'workRoot'
  >,
): Promise<{
  readonly ownerRoot: string;
  readonly generatedRoot: string;
  readonly workRoot: string;
}> {
  const ownerRoot = resolve(request.ownerRoot);
  const generatedRoot = resolve(request.generatedRoot);
  const workRoot = resolve(request.workRoot);
  const ownerMetadata = await lstat(ownerRoot);
  if (!ownerMetadata.isDirectory() || ownerMetadata.isSymbolicLink()) {
    throw new TypeError(
      'Equator owner root must be an existing ordinary directory.',
    );
  }
  if (
    !containedPath(generatedRoot, ownerRoot) ||
    !containedPath(workRoot, ownerRoot) ||
    generatedRoot === ownerRoot ||
    workRoot === ownerRoot ||
    generatedRoot === workRoot ||
    containedPath(generatedRoot, workRoot) ||
    containedPath(workRoot, generatedRoot)
  ) {
    throw new TypeError(
      'Equator generated and work roots must be separate contained owner subdirectories.',
    );
  }
  await assertSafeExistingPath(ownerRoot, generatedRoot);
  await assertSafeExistingPath(ownerRoot, workRoot);
  return { ownerRoot, generatedRoot, workRoot };
}

async function collectFiles(root: string): Promise<readonly string[]> {
  if (!(await pathExists(root))) return [];
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new TypeError(
          `Equator refuses linked content in an owned root: ${path}`,
        );
      }
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(portableRelative(root, path));
      else
        throw new TypeError(
          `Equator refuses special file in an owned root: ${path}`,
        );
    }
  };
  await visit(root);
  files.sort(compareCodeUnit);
  return files;
}

async function readCurrentManifest(
  generatedRoot: string,
): Promise<ToolkitResult<CompletionManifest> | undefined> {
  if (!(await pathExists(generatedRoot))) return undefined;
  const manifestPath = resolve(generatedRoot, COMPLETION_MANIFEST_PATH);
  if (!(await pathExists(manifestPath))) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1601',
        'Equator refuses an existing generated root without its completion/ownership manifest.',
      ),
    ]);
  }
  const parsed = parseCompletionManifest(await readFile(manifestPath, 'utf8'));
  return parsed.ok
    ? parsed
    : toolkitFailure(
        parsed.diagnostics.map((diagnostic) =>
          toolkitDiagnostic('EQ1601', diagnostic.summary, {
            path: diagnostic.path,
          }),
        ),
      );
}

async function verifyOwnedInventory(
  generatedRoot: string,
  manifest: CompletionManifest,
): Promise<readonly ToolkitDiagnostic[]> {
  const diagnostics: ToolkitDiagnostic[] = [];
  const expected = new Set([
    COMPLETION_MANIFEST_PATH,
    ...manifest.files.map(({ path }) => path),
  ]);
  for (const path of await collectFiles(generatedRoot)) {
    if (!expected.has(path)) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1601',
          `Equator generated root contains unowned file ${JSON.stringify(path)}.`,
          { path: ['outputs', path] },
        ),
      );
    }
  }
  for (const file of manifest.files) {
    const path = absoluteFromPortable(generatedRoot, file.path);
    if (!(await pathExists(path))) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1603',
          `Equator generated output ${JSON.stringify(file.path)} is missing.`,
          { path: ['outputs', file.path] },
        ),
      );
      continue;
    }
    const contents = await readFile(path);
    if (
      contents.byteLength !== file.bytes ||
      digestBytes(contents) !== file.digest
    ) {
      diagnostics.push(
        toolkitDiagnostic(
          'EQ1603',
          `Equator generated output ${JSON.stringify(file.path)} does not match its completion manifest.`,
          { path: ['outputs', file.path] },
        ),
      );
    }
  }
  return diagnostics;
}

async function ensureWorkOwner(
  workRoot: string,
  ownerId: string,
): Promise<void> {
  const markerPath = resolve(workRoot, WORK_OWNER_PATH);
  if (!(await pathExists(workRoot))) {
    await mkdir(workRoot, { recursive: true });
    await writeFile(
      markerPath,
      `${JSON.stringify({ profile: WORK_OWNER_PROFILE, ownerId } satisfies WorkOwnerMarker, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    return;
  }
  if (!(await pathExists(markerPath))) {
    throw new TypeError(
      `Equator refuses an existing unmarked work root at ${JSON.stringify(workRoot)}: it holds no ${WORK_OWNER_PATH}, so Equator cannot tell whether the directory is its own. Remove it, or point this project's work root somewhere Equator owns.`,
    );
  }
  const found = await readWorkOwnerId(workRoot);
  if (found !== ownerId) {
    // Named on both sides, because the two readings are what tell the two causes apart. A second
    // Equator-owned tree in the same repository is a configuration to fix; the identity of a
    // project that was renamed or that moved where it generates is a work root to discard, and the
    // work root holds nothing but disposable state.
    throw new TypeError(
      `Equator work root at ${JSON.stringify(workRoot)} belongs to another generated owner: it records ${JSON.stringify(found ?? 'an unreadable identity')} and this project is ${JSON.stringify(ownerId)}. Run equator clean to discard that work root, it holds only Equator's own disposable state, or give this project a work root of its own.`,
    );
  }
  const allowed = new Set([
    WORK_OWNER_PATH,
    COMPILER_CACHE_PATH,
    LOCK_PATH,
    TRANSACTION_PATH,
  ]);
  for (const path of await collectFiles(workRoot)) {
    if (!allowed.has(path)) {
      throw new TypeError(`Equator work root contains unowned file ${path}.`);
    }
  }
}

async function readWorkOwnerId(workRoot: string): Promise<string | undefined> {
  if (!(await pathExists(workRoot))) return undefined;
  const markerPath = resolve(workRoot, WORK_OWNER_PATH);
  if (!(await pathExists(markerPath))) {
    throw new TypeError('Equator refuses an existing unmarked work root.');
  }
  let marker: unknown;
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    throw new TypeError('Equator work-root ownership marker is invalid.');
  }
  if (
    typeof marker !== 'object' ||
    marker === null ||
    Array.isArray(marker) ||
    Object.keys(marker).sort().join(',') !== 'ownerId,profile' ||
    (marker as Record<string, unknown>)['profile'] !== WORK_OWNER_PROFILE ||
    typeof (marker as Record<string, unknown>)['ownerId'] !== 'string' ||
    !/^sha256-[A-Za-z0-9_-]{43}$/u.test(
      (marker as Record<string, unknown>)['ownerId'] as string,
    )
  ) {
    throw new TypeError('Equator work-root ownership marker is invalid.');
  }
  return (marker as Record<string, string>)['ownerId'];
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(20 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function removeEmptyDirectories(root: string): Promise<void> {
  if (!(await pathExists(root))) return;
  const directories: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(resolve(directory, entry.name));
    }
    directories.push(directory);
  };
  await visit(root);
  for (const directory of directories) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        !['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(String(error.code))
      ) {
        throw error;
      }
    }
  }
}

/**
 * A journal as it was read back, with the stamp saying which writer produced it still unread.
 *
 * The file survives a crash, which is the whole point of it, so it also survives an upgrade. The
 * profile is the field that separates a journal this version can replay from one it cannot.
 */
type ReceivedTransactionJournal = Omit<TransactionJournal, 'profile'> & {
  readonly profile: unknown;
};

async function recoverTransaction(
  generatedRoot: string,
  workRoot: string,
  ownerId: string,
): Promise<void> {
  const journalPath = resolve(workRoot, TRANSACTION_PATH);
  if (!(await pathExists(journalPath))) return;
  const journal = JSON.parse(
    await readFile(journalPath, 'utf8'),
  ) as ReceivedTransactionJournal;
  if (journal.profile !== TRANSACTION_PROFILE || journal.ownerId !== ownerId) {
    throw new TypeError('Equator output transaction journal is incompatible.');
  }
  for (const operation of [...journal.operations].reverse()) {
    const path = absoluteFromPortable(generatedRoot, operation.path);
    const backup = absoluteFromPortable(generatedRoot, operation.backup);
    const temporary =
      operation.temporary === undefined
        ? undefined
        : absoluteFromPortable(generatedRoot, operation.temporary);
    if (await pathExists(backup)) {
      if (await pathExists(path)) await unlink(path);
      await renameWithRetry(backup, path);
    } else if (!operation.hadOriginal && (await pathExists(path))) {
      await unlink(path);
    }
    if (temporary !== undefined && (await pathExists(temporary))) {
      await unlink(temporary);
    }
  }
  await unlink(journalPath);
  await removeEmptyDirectories(generatedRoot);
}

async function freshness(
  generatedRoot: string,
  ownerId: string,
  plan: OutputPlan,
): Promise<ToolkitResult<OutputFreshness>> {
  const current = await readCurrentManifest(generatedRoot);
  if (current === undefined) {
    return toolkitSuccess(
      Object.freeze({
        fresh: false,
        missing: Object.freeze(plan.files.map(({ path }) => path)),
        changed: Object.freeze([]),
        stale: Object.freeze([]),
      }),
    );
  }
  if (!current.ok) return current;
  if (current.value.ownerId !== ownerId) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1601',
        `Equator generated root at ${JSON.stringify(generatedRoot)} belongs to another owner identity: its completion manifest records ${JSON.stringify(current.value.ownerId)} and this project is ${JSON.stringify(ownerId)}. Run equator clean to remove the output that manifest describes, or generate into a root of this project's own.`,
      ),
    ]);
  }
  const inventoryDiagnostics = await verifyOwnedInventory(
    generatedRoot,
    current.value,
  );
  if (inventoryDiagnostics.some(({ severity }) => severity === 'error')) {
    return toolkitFailure(inventoryDiagnostics);
  }
  const confirmed = await readCurrentManifest(generatedRoot);
  if (
    confirmed === undefined ||
    !confirmed.ok ||
    confirmed.value.ownerId !== current.value.ownerId ||
    confirmed.value.planDigest !== current.value.planDigest
  ) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1603',
        'Equator completion manifest changed while generated output was being inspected.',
      ),
    ]);
  }
  const currentFiles = new Map(
    current.value.files.map((file) => [file.path, file]),
  );
  const desired = new Map(plan.files.map((file) => [file.path, file]));
  const missing: string[] = [];
  const changed: string[] = [];
  const stale: string[] = [];
  for (const file of plan.files) {
    const existing = currentFiles.get(file.path);
    if (existing === undefined) missing.push(file.path);
    else if (existing.digest !== file.digest || existing.bytes !== file.bytes) {
      changed.push(file.path);
    }
  }
  for (const file of current.value.files) {
    if (!desired.has(file.path)) stale.push(file.path);
  }
  return toolkitSuccess(
    Object.freeze({
      fresh:
        missing.length === 0 &&
        changed.length === 0 &&
        stale.length === 0 &&
        current.value.planDigest === plan.planDigest,
      missing: Object.freeze(missing),
      changed: Object.freeze(changed),
      stale: Object.freeze(stale),
    }),
  );
}

/**
 * Whether the generated output on disk is what this output plan would produce, without writing
 * anything.
 *
 * The same comparison `equator check --require-fresh` makes, published so a consumer's own gate can
 * ask it without shelling out to the CLI and parsing its output. The result separates three
 * different ways output can be out of date, because they are three different problems: `missing` is
 * a file the output plan expects and disk does not have, `changed` is a file whose contents no
 * longer match, and `stale` is a file on disk the output plan no longer produces. `fresh` is true
 * only when all three are empty *and* the recorded plan digest matches, which is what catches an
 * output plan that produces the same files by a different route.
 *
 * This reads; it does not repair. A caller that wants disk brought into line runs the generation.
 *
 * Failure here is an `EQ1601` diagnostic rather than a thrown error, in keeping with the rest of
 * this surface: an unreadable or unowned root is a fact about the project, not a bug in the call.
 */
export async function inspectOutputFreshness(
  request: Omit<ApplyOutputPlanRequest, 'dryRun'>,
): Promise<ToolkitResult<OutputFreshness>> {
  try {
    const roots = await validateRoots(request);
    // Awaited inside the `try`, because the inventory walk refuses a link or a special file by
    // throwing and a promise returned unawaited would carry that past the `catch`.
    return await freshness(roots.generatedRoot, request.ownerId, request.plan);
  } catch (error) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1601',
        error instanceof Error ? error.message : String(error),
      ),
    ]);
  }
}

export async function applyOutputPlan(
  request: ApplyOutputPlanRequest,
): Promise<ToolkitResult<ApplyOutputPlanResult>> {
  let roots: Awaited<ReturnType<typeof validateRoots>>;
  try {
    roots = await validateRoots(request);
  } catch (error) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1601',
        error instanceof Error ? error.message : String(error),
      ),
    ]);
  }
  let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
  const lockPath = resolve(roots.workRoot, LOCK_PATH);
  const releaseLock = async (): Promise<void> => {
    if (lockHandle === undefined) return;
    await lockHandle.close();
    lockHandle = undefined;
    await rm(lockPath, { force: true });
  };
  if (request.dryRun !== true) {
    try {
      await ensureWorkOwner(roots.workRoot, request.ownerId);
      lockHandle = await open(lockPath, 'wx');
      await recoverTransaction(
        roots.generatedRoot,
        roots.workRoot,
        request.ownerId,
      );
    } catch (error) {
      await releaseLock();
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1602',
          `Equator could not acquire or recover its output transaction: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ]);
    }
  }
  let state: ToolkitResult<OutputFreshness>;
  try {
    state = await freshness(roots.generatedRoot, request.ownerId, request.plan);
  } catch (error) {
    // The lock is held by here, and the inventory walk refuses a link or a special file by
    // throwing, so the refusal is reported as the root's and the lock is given back.
    await releaseLock();
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1601',
        error instanceof Error ? error.message : String(error),
      ),
    ]);
  }
  if (!state.ok) {
    await releaseLock();
    return state;
  }
  const unchanged = request.plan.files
    .map(({ path }) => path)
    .filter(
      (path) =>
        !state.value.missing.includes(path) &&
        !state.value.changed.includes(path),
    );
  if (state.value.fresh) {
    await releaseLock();
    return toolkitSuccess(
      Object.freeze({
        changed: false,
        written: Object.freeze([]),
        removed: Object.freeze([]),
        unchanged: Object.freeze(unchanged),
      }),
    );
  }
  const written = [...state.value.missing, ...state.value.changed].sort(
    compareCodeUnit,
  );
  const removed = [...state.value.stale].sort(compareCodeUnit);
  if (request.dryRun === true) {
    await releaseLock();
    return toolkitSuccess(
      Object.freeze({
        changed: true,
        written: Object.freeze(written),
        removed: Object.freeze(removed),
        unchanged: Object.freeze(unchanged),
      }),
    );
  }

  const transactionId = randomBytes(12).toString('hex');
  const journalPath = resolve(roots.workRoot, TRANSACTION_PATH);
  try {
    if (
      request.expectedInputFingerprint !== undefined &&
      request.revalidateInputFingerprint !== undefined &&
      (await request.revalidateInputFingerprint()) !==
        request.expectedInputFingerprint
    ) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1602',
          'Equator inputs changed after compilation; generation was not published.',
        ),
      ]);
    }
    const manifest = createCompletionManifest(request.ownerId, request.plan);
    const desired = new Map(
      request.plan.files.map((file) => [file.path, file.contents]),
    );
    desired.set(COMPLETION_MANIFEST_PATH, formatCompletionManifest(manifest));
    const operationPaths = [
      ...new Set([...written, ...removed, COMPLETION_MANIFEST_PATH]),
    ].sort((left, right) => {
      if (left === COMPLETION_MANIFEST_PATH) return 1;
      if (right === COMPLETION_MANIFEST_PATH) return -1;
      return compareCodeUnit(left, right);
    });
    const operations: TransactionOperation[] = [];
    for (const path of operationPaths) {
      const destination = absoluteFromPortable(roots.generatedRoot, path);
      const token = `.equator-${transactionId}`;
      const backupPath = resolve(
        dirname(destination),
        `.${basename(destination)}${token}.bak`,
      );
      const contents = desired.get(path);
      const temporaryPath =
        contents === undefined
          ? undefined
          : resolve(
              dirname(destination),
              `.${basename(destination)}${token}.tmp`,
            );
      operations.push(
        Object.freeze({
          path,
          ...(temporaryPath === undefined
            ? {}
            : {
                temporary: portableRelative(roots.generatedRoot, temporaryPath),
              }),
          backup: portableRelative(roots.generatedRoot, backupPath),
          hadOriginal: await pathExists(destination),
        }),
      );
    }
    const journal: TransactionJournal = Object.freeze({
      profile: TRANSACTION_PROFILE,
      ownerId: request.ownerId,
      operations: Object.freeze(operations),
    });
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    for (const operation of operations) {
      if (operation.temporary === undefined) continue;
      const temporary = absoluteFromPortable(
        roots.generatedRoot,
        operation.temporary,
      );
      await mkdir(dirname(temporary), { recursive: true });
      await assertSafeExistingPath(roots.ownerRoot, dirname(temporary));
      await writeSynced(temporary, desired.get(operation.path) as string);
    }
    for (const operation of operations) {
      const destination = absoluteFromPortable(
        roots.generatedRoot,
        operation.path,
      );
      const backup = absoluteFromPortable(
        roots.generatedRoot,
        operation.backup,
      );
      if (operation.hadOriginal) await renameWithRetry(destination, backup);
      if (operation.temporary !== undefined) {
        await renameWithRetry(
          absoluteFromPortable(roots.generatedRoot, operation.temporary),
          destination,
        );
      }
    }
    for (const operation of operations) {
      const backup = absoluteFromPortable(
        roots.generatedRoot,
        operation.backup,
      );
      if (await pathExists(backup)) await unlink(backup);
    }
    await unlink(journalPath);
    await removeEmptyDirectories(roots.generatedRoot);
    return toolkitSuccess(
      Object.freeze({
        changed: true,
        written: Object.freeze(written),
        removed: Object.freeze(removed),
        unchanged: Object.freeze(unchanged),
      }),
    );
  } catch (error) {
    try {
      if (await pathExists(journalPath)) {
        await recoverTransaction(
          roots.generatedRoot,
          roots.workRoot,
          request.ownerId,
        );
      }
    } catch {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1602',
          'Equator output publication failed and automatic rollback could not be completed safely.',
        ),
      ]);
    }
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1602',
        `Equator output publication failed safely: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ]);
  } finally {
    await releaseLock();
  }
}

/**
 * Removes what Equator generated, and nothing else.
 *
 * The inventory is not a pattern and not a directory sweep: it is the completion manifest Equator
 * wrote when it generated, so every removed path is one Equator recorded creating. A file that
 * appeared in the generated root by another route is not in the manifest, is not removed, and makes
 * the call fail rather than pass quietly: an unrecognised file in an owned directory means the
 * directory is not what Equator thinks it is, and deleting the rest of it on that assumption is how
 * a cleanup destroys someone's work.
 *
 * Both roots are checked to belong to the same owner before anything is removed. Different owner
 * identities on the generated and work roots is `EQ1601`: two projects have been pointed at one
 * tree, and the right answer is to stop.
 *
 * `dryRun` returns the same `removed` list without touching disk, which is what makes this safe to
 * offer in a consumer's own tooling. It refuses to preview while an output transaction is pending
 * recovery, because the list would describe a tree that is mid-write.
 */
export async function cleanOutput(
  request: CleanOutputRequest,
): Promise<ToolkitResult<CleanOutputResult>> {
  let roots: Awaited<ReturnType<typeof validateRoots>>;
  try {
    roots = await validateRoots(request);
  } catch (error) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1601',
        error instanceof Error ? error.message : String(error),
      ),
    ]);
  }

  try {
    const manifest = await readCurrentManifest(roots.generatedRoot);
    const workOwnerId = await readWorkOwnerId(roots.workRoot);
    if (manifest !== undefined && !manifest.ok) {
      const generatedFiles = await collectFiles(roots.generatedRoot);
      if (!(generatedFiles.length === 0 && workOwnerId !== undefined)) {
        return manifest;
      }
    }
    const generatedOwnerId = manifest?.ok ? manifest.value.ownerId : undefined;
    if (
      generatedOwnerId !== undefined &&
      workOwnerId !== undefined &&
      generatedOwnerId !== workOwnerId
    ) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1601',
          'Equator generated and work roots have different owner identities.',
        ),
      ]);
    }
    const ownerId = generatedOwnerId ?? workOwnerId;
    if (ownerId === undefined) {
      return toolkitSuccess(
        Object.freeze({ changed: false, removed: Object.freeze([]) }),
      );
    }
    if (manifest?.ok) {
      const inventoryDiagnostics = await verifyOwnedInventory(
        roots.generatedRoot,
        manifest.value,
      );
      if (inventoryDiagnostics.length > 0) {
        return toolkitFailure(inventoryDiagnostics);
      }
    }
    if (
      request.dryRun === true &&
      (await pathExists(resolve(roots.workRoot, TRANSACTION_PATH)))
    ) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1602',
          'Equator clean cannot preview while an output transaction requires recovery.',
        ),
      ]);
    }
    if (workOwnerId !== undefined) {
      await ensureWorkOwner(roots.workRoot, ownerId);
    }
    const generatedFiles = manifest?.ok
      ? [
          ...manifest.value.files.map(({ path }) => path),
          COMPLETION_MANIFEST_PATH,
        ]
      : [];
    const workFiles =
      workOwnerId === undefined
        ? []
        : [
            ...((await pathExists(
              absoluteFromPortable(roots.workRoot, COMPILER_CACHE_PATH),
            ))
              ? [COMPILER_CACHE_PATH]
              : []),
            WORK_OWNER_PATH,
          ];
    const plannedRemoved = [
      ...generatedFiles.map((path) =>
        portableRelative(
          roots.ownerRoot,
          resolve(roots.generatedRoot, ...path.split('/')),
        ),
      ),
      ...workFiles.map((path) =>
        portableRelative(
          roots.ownerRoot,
          resolve(roots.workRoot, ...path.split('/')),
        ),
      ),
    ].sort(compareCodeUnit);
    if (request.dryRun === true) {
      return toolkitSuccess(
        Object.freeze({
          changed: plannedRemoved.length > 0,
          removed: Object.freeze(plannedRemoved),
        }),
      );
    }

    if (manifest !== undefined && !manifest.ok) {
      await removeEmptyDirectories(roots.generatedRoot);
    }

    const emptyPlan = createOutputPlan([]);
    if (!emptyPlan.ok) return emptyPlan;
    const emptied = await applyOutputPlan({
      ownerRoot: roots.ownerRoot,
      generatedRoot: roots.generatedRoot,
      workRoot: roots.workRoot,
      ownerId,
      plan: emptyPlan.value,
    });
    if (!emptied.ok) return emptied;

    await ensureWorkOwner(roots.workRoot, ownerId);
    const lockPath = resolve(roots.workRoot, LOCK_PATH);
    const lockHandle = await open(lockPath, 'wx');
    try {
      await ensureWorkOwner(roots.workRoot, ownerId);
      const accepted = await readCurrentManifest(roots.generatedRoot);
      if (
        accepted === undefined ||
        !accepted.ok ||
        accepted.value.ownerId !== ownerId ||
        accepted.value.planDigest !== emptyPlan.value.planDigest
      ) {
        throw new TypeError(
          'Equator generated output changed while clean was finalizing.',
        );
      }
      const acceptedDiagnostics = await verifyOwnedInventory(
        roots.generatedRoot,
        accepted.value,
      );
      if (acceptedDiagnostics.length > 0) {
        throw new TypeError(
          'Equator generated output changed while clean was finalizing.',
        );
      }
      await unlink(resolve(roots.generatedRoot, COMPLETION_MANIFEST_PATH));
      await removeEmptyDirectories(roots.generatedRoot);
      const cachePath = absoluteFromPortable(
        roots.workRoot,
        COMPILER_CACHE_PATH,
      );
      if (await pathExists(cachePath)) await unlink(cachePath);
      await removeEmptyDirectories(resolve(roots.workRoot, 'cache'));
      await unlink(resolve(roots.workRoot, WORK_OWNER_PATH));
    } finally {
      await lockHandle.close();
      await rm(lockPath, { force: true });
    }
    await removeEmptyDirectories(roots.workRoot);
    return toolkitSuccess(
      Object.freeze({
        changed: plannedRemoved.length > 0,
        removed: Object.freeze(plannedRemoved),
      }),
    );
  } catch (error) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1602',
        `Equator clean failed safely: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ]);
  }
}
