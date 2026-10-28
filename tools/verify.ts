import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { freemem, getPriority, setPriority, totalmem } from 'node:os';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLAIMS_FILE_VARIABLE } from './capability-claims.ts';
import {
  createScheduler,
  largestMinimum,
  MEMORY_FLOOR,
  processorBudget,
  priorityLifted,
  PROCESSORS_VARIABLE,
  scheduleFindings,
  stagePriority,
} from './gate-resources.ts';
import type { RunnerSettings, SkippedStage } from './gate-resources.ts';
import {
  aboveLevel,
  descendantsOf,
  holdDown,
  levelForSystem,
  levelInReading,
  liftUp,
  processorsBetween,
  processorsByGroup,
  processorsByThreadName,
  readProcesses,
  readThreads,
  startAtPriority,
} from './process-tree.ts';
import type {
  PriorityLevel,
  ProcessEntry,
  ThreadEntry,
} from './process-tree.ts';
import {
  OCCURRENCES_FILE_VARIABLE,
  collectOccurrences,
  ledgerOccurrences,
  verdictOccurrences,
} from './gate-occurrences.ts';
import { startCaptured } from './stage-output.ts';
import { readTrace, traceDrift } from './trace-drift.ts';
import { holdHeavyJobLock } from './heavy-job-lock.ts';
import { claimsFile, safeName, steps as everyStep } from './verify-stages.ts';
import type { Stage, StageDeclaration } from './verify-stages.ts';
import { attemptLedgerPath, workingRoot } from './working-state.ts';

/**
 * The gate, as a dependency graph rather than a list.
 *
 * *Why not a list.* A list encodes real dependencies (the consumer after the build, the browser
 * rows after their self-test) as adjacency, so nothing distinguishes "must follow" from "happens to
 * be next", every step pays for every step before it whether or not it reads anything that step
 * wrote, and a hand-written `needs` list describes the order rather than the dependencies.
 * `verify:edit-cost` edits in place the consumer `verify:cost-budget` reads, so a scheduler
 * trusting declared `needs` alone would run them against each other.
 *
 * *So the graph is measured, not transcribed.* `tools/trace-artefacts.cts` rides `NODE_OPTIONS` into
 * every process a stage spawns and records which artefacts it reads and writes. Deriving the graph
 * from the existing `needs` entries instead would be a check drawn from the same source as its
 * subject, agreeing by construction right up to the point where it corrupted a consumer install.
 *
 * *And the file is the graph, not the trace.* Each stage declares what it reads and writes in
 * `tools/verify-stages.ts`, and the edges are derived from those declarations. The trace is what
 * checks them: every run is traced, and a stage that touched an artefact its declaration does not
 * name turns the run red after it finishes and before green is declared. Tracing costs 1.0% of the
 * run's wall time, so there is no staleness bookkeeping and no way to run untraced.
 *
 * *Reads and writes are declared disjointly and a writer implicitly reads.* Declaring an artefact in
 * both places would be noise; every edge a writer needs is derived from the write alone.
 *
 * *The check runs in both directions.* An undeclared artefact a stage does touch is a missing edge,
 * which is a race. A declared artefact a stage never touches is either an edge that need not exist
 * or an artefact the tracer cannot see, and the second leaves the declaration checked against
 * nothing.
 *
 * *Every derived edge points backwards in the written order*, because a stage depends only on
 * writers and readers that precede it. So the graph can reorder nothing: `--serial` runs the
 * stages in exactly the order they are written there, and the concurrent run is the same order with
 * the waiting removed. That is what makes the two runs comparable stage for stage.
 *
 * `specs/12-verification.spec.md` section 1 is what the gate exists to satisfy: every shipped
 * capability verified in proportion to its risk, and nothing counted as evidence except a
 * check that ran.
 */

const DEFAULT_STEP_TIMEOUT_SECONDS = 900;

/** A stage that ran, or that a resume carries forward. */
interface RanStage {
  readonly status: 'pass' | 'fail';
  readonly seconds: number;
  readonly output: string;
}

type StageResult = RanStage | SkippedStage;

/** A failed stage as the summary and the ledger record it. */
interface Failure {
  readonly id: string;
  readonly signature: string;
}

/** What a resume reads of the summary the run it resumes wrote. */
interface PreviousSummary {
  readonly commit: string;
  readonly attempt?: number;
  readonly failures?: Failure[];
  readonly originalFailures?: Failure[];
  readonly stages: readonly {
    readonly id: string;
    readonly status: StageResult['status'];
    readonly seconds: number;
  }[];
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Forward slashes, always. `NODE_OPTIONS` is parsed as a command line, so a quoted Windows path
// loses every backslash to escape processing and node preloads `C:workequatortools...`,
// which fails every stage at once with a module-not-found from `internal/preload`. Windows accepts
// forward slashes everywhere; the quotes stay for a workspace path containing a space.
const tracerPath = resolve(workspaceRoot, 'tools/trace-artefacts.cts')
  .split(sep)
  .join('/');
const serial = process.argv.includes('--serial');
const planOnly = process.argv.includes('--plan');
const resuming = process.argv.includes('--resume');
const keepTrees = process.argv.includes('--keep-trees');
/**
 * `--only <stage>[,<stage>...]` runs the named stages and what they need, and nothing else.
 *
 * It is the gate's own runner over part of the graph: the same work trees made the same way, the
 * same environment handed to a stage, the same trace and the same drift check. That is the point of
 * it. A stage run by its script in the checkout an engineer is sitting in has a terminal, no
 * tracer, the checkout's own caches and nothing beside it, so it shows the stage's logic and not
 * the stage as the gate runs it.
 *
 * It is not a gate run and cannot become one. It works in folders of its own, so the trees and the
 * summary of a gate run are left as they were for a resume, it writes no line to the attempt
 * ledger, and its verdict line says how many of the stages it ran.
 */
const onlyAt = process.argv.indexOf('--only');
const only =
  onlyAt === -1
    ? undefined
    : (process.argv[onlyAt + 1] ?? '').split(',').filter((id) => id !== '');
if (only !== undefined && resuming) {
  throw new Error(
    'A run of named stages starts in fresh trees and has nothing to resume. Leave out --resume, or run the gate.',
  );
}
const runDirectory = resolve(
  workingRoot,
  only === undefined ? 'verify-run' : 'verify-only-run',
);
const occurrencesFile = (id: string): string =>
  resolve(runDirectory, `${safeName(id)}.occurrences.jsonl`);
// Logs, traces and the summary stay in the repository the engineer is sitting in, not in the
// worktrees, because the worktrees are removed at the end of the run and the evidence is the part
// worth keeping.
const treesRoot = resolve(
  workingRoot,
  only === undefined ? 'verify-trees' : 'verify-only-trees',
);

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: workspaceRoot, maxBuffer: 1 << 28 })
    .toString()
    .trim();

/**
 * What the gate proves is a commit, so what it runs on is a commit.
 *
 * Hashing every tracked file plus every untracked file git does not ignore would establish that a
 * resume is resuming the same thing, and it would be a reconstruction of what a commit already is.
 * It would also leave the gate proving something nobody can push: a working tree, which has moved
 * by the time the run finishes. Refusing a dirty tree takes the thing itself instead. **The hash the gate proved is the hash that gets pushed**, and there is no
 * step between them where the subject can change.
 *
 * This is also what lets the run happen somewhere else. A commit can be checked out into as many
 * worktrees as there are stages that need one, so editing continues in the tree the engineer is
 * sitting in while the gate proves the commit they made, and the stages that mutate tracked source
 * mutate a copy nothing else can see.
 */
const requireCommittedTree = () => {
  const changes = git('status', '--porcelain');
  if (changes.length > 0) {
    throw new Error(
      'The gate proves a commit, and this tree has changes that are not in one:\n\n' +
        `${changes}\n\n` +
        'Commit them and run the gate on that commit. A run against a working tree proves a state ' +
        'that is not addressable and may not exist by the time it finishes.',
    );
  }
  return git('rev-parse', 'HEAD');
};

/**
 * One line of a stage's output that identifies which failure this was.
 *
 * The ledger exists to count occurrences of a recurring failure, and counting is only useful if two
 * entries can be compared. A thrown error's own first line is what distinguishes the browser row's
 * arming assertion from the same row's timeout, which is the distinction the flake work needs.
 */
const signatureOf = (output: string): string => {
  const lines = output.split('\n').map((line) => line.trim());
  const named = lines.find(
    (line) =>
      /^[A-Za-z]*Error\b/u.test(line) ||
      line.includes('AssertionError') ||
      line.includes('did not finish within'),
  );
  const fallback = lines.filter((line) => line.length > 0).at(-1) ?? '';
  return (named ?? fallback).slice(0, 240);
};

// ---------------------------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------------------------

const position = new Map(everyStep.map((step, index) => [step.id, index]));
const stepById = new Map(everyStep.map((step) => [step.id, step]));
const readsOf = (step: StageDeclaration): readonly string[] => step.reads ?? [];
const writesOf = (step: StageDeclaration): readonly string[] =>
  step.writes ?? [];

/**
 * Which tree a stage's artefacts live in.
 *
 * An artefact is only the same artefact if it is the same file, and two stages working in two
 * checkouts of the same commit do not share one. Scoping the graph's keys by tree is what makes the
 * three injecting stages stop being barriers: they mutate `source:packages` in a tree nothing else
 * reads, so the read-after-write and write-after-read edges to twenty-eight readers are not there to
 * derive. The declarations did not change and are still true: what changed is where they are true.
 */
const treeOf = (step: StageDeclaration): string =>
  step.privateTree === true ? step.id : 'shared';
const scoped = (step: StageDeclaration, artefact: string): string =>
  `${treeOf(step)} ${artefact}`;

// The same question pointed at the gate rather than at a search. A typo in either id would leave
// `gates` empty and every stage would run exactly as it did before, with nothing to notice.
const gates = everyStep.filter(({ gate }) => gate === true).map(({ id }) => id);
if (gates.length !== 6) {
  throw new Error(
    `Expected six gate stages and found ${gates.length} (${gates.join(', ') || 'none'}). Without them every stage below runs whatever the cheap checks said.`,
  );
}

const dependencies = new Map(
  everyStep.map(({ id }) => [id, new Set<string>()]),
);
// What a stage cannot run without, which is less than what it is scheduled after: the first phase,
// its declared needs, and the earlier producers of what it reads or adds to. `--only` follows these.
const requirements = new Map(
  everyStep.map(({ id }) => [id, new Set<string>()]),
);

for (const step of everyStep) {
  if (step.gate !== true)
    for (const id of gates) requirements.get(step.id)!.add(id);
  for (const { on } of step.needs ?? []) requirements.get(step.id)!.add(on);
  if (step.gate !== true)
    for (const id of gates) dependencies.get(step.id)!.add(id);
  for (const { on, why } of step.needs ?? []) {
    if (!position.has(on)) {
      throw new Error(
        `${step.id} declares a logical dependency on ${on}, which is not a stage.`,
      );
    }
    if (typeof why !== 'string' || why.length === 0) {
      throw new Error(
        `${step.id} declares a logical dependency on ${on} with no reason. A measured edge explains itself; an asserted one has to be written down.`,
      );
    }
    dependencies.get(step.id)!.add(on);
  }
}

/**
 * Three kinds of artefact edge, and all three are needed.
 *
 * Read-after-write is the obvious one. Write-after-write orders two producers of the same artefact.
 * Write-after-read, a producer waiting for the readers of what it is about to replace, is the
 * one a readers-writer lock gives and a "needs" list cannot express at all, and it is what keeps
 * `verify:consumer-refresh` from rewriting `dist` under the stages still reading it.
 */
const artefacts = new Map<string, { readers: string[]; writers: string[] }>();
for (const step of everyStep) {
  for (const artefact of [...readsOf(step), ...writesOf(step)]) {
    if (!artefacts.has(scoped(step, artefact)))
      artefacts.set(scoped(step, artefact), { readers: [], writers: [] });
  }
  for (const artefact of readsOf(step))
    artefacts.get(scoped(step, artefact))!.readers.push(step.id);
  for (const artefact of writesOf(step))
    artefacts.get(scoped(step, artefact))!.writers.push(step.id);
}

for (const { readers, writers } of artefacts.values()) {
  const earlier = (a: string, b: string): boolean =>
    position.get(a)! < position.get(b)!;
  for (const writer of writers) {
    for (const other of [...writers, ...readers]) {
      if (other !== writer && earlier(other, writer))
        dependencies.get(writer)!.add(other);
    }
    // A later producer builds on what the earlier ones left, and a reader that came before it
    // only has to be out of the way.
    for (const other of writers) {
      if (other !== writer && earlier(other, writer))
        requirements.get(writer)!.add(other);
    }
  }
  for (const reader of readers) {
    for (const writer of writers) {
      if (writer !== reader && earlier(writer, reader)) {
        dependencies.get(reader)!.add(writer);
        requirements.get(reader)!.add(writer);
      }
    }
  }
}

/**
 * Every derived edge points backwards in the written order, so a cycle can only come from a
 * hand-written `needs`. Finding one after the scheduler stalls would look like a hang, which is the
 * failure mode this whole file exists to remove, so it is found here instead.
 */
const visiting = new Set<string>();
const visited = new Set<string>();
const visit = (id: string, trail: readonly string[]): void => {
  if (visited.has(id)) return;
  if (visiting.has(id)) {
    throw new Error(`Dependency cycle: ${[...trail, id].join(' -> ')}`);
  }
  visiting.add(id);
  for (const dependency of dependencies.get(id)!)
    visit(dependency, [...trail, id]);
  visiting.delete(id);
  visited.add(id);
};
for (const { id } of everyStep) visit(id, []);

// The stages this run is over: all of them, or the named ones and what they need.
const selected = new Set<string>();
if (only !== undefined) {
  const unknown = only.filter((id) => !stepById.has(id));
  if (only.length === 0 || unknown.length > 0) {
    throw new Error(
      only.length === 0
        ? '--only names no stage. Usage: node tools/verify.ts --only <stage>[,<stage>...]'
        : `--only names ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is not a stage' : 'are not stages'}. node tools/verify.ts --plan lists them.`,
    );
  }
  const select = (id: string): void => {
    if (selected.has(id)) return;
    selected.add(id);
    for (const needed of requirements.get(id)!) select(needed);
  };
  for (const id of only) select(id);
  // An edge to a stage this run leaves out has nothing to wait for.
  for (const [id, required] of dependencies) {
    for (const other of [...required]) {
      if (!selected.has(id) || !selected.has(other)) required.delete(other);
    }
  }
}
const steps =
  only === undefined
    ? everyStep
    : everyStep.filter(({ id }) => selected.has(id));

// `--plan` prints the graph this run would be scheduled on and stops. It is for reading the edges,
// not for deciding whether to check them: the drift check runs inside every gate and is not
// something a caller can ask for or skip.
if (planOnly) {
  const width_ = Math.max(...steps.map(({ id }) => id.length));
  for (const step of steps) {
    const listed = [...dependencies.get(step.id)!].sort(
      (a, b) => position.get(a)! - position.get(b)!,
    );
    const alone = step.exclusive === true ? ['<alone>'] : [];
    const tree = step.privateTree === true ? ['<own tree>'] : [];
    process.stdout.write(
      `${step.id.padEnd(width_)}  ${[...alone, ...tree, ...listed].join(' ') || '(nothing)'}
`,
    );
  }
  if (!resuming) process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Running a stage
// ---------------------------------------------------------------------------------------------

const pnpmCommand =
  process.platform === 'win32' ? (process.env['ComSpec'] ?? 'cmd.exe') : 'pnpm';

// A stage's own child processes outlive `child.kill()` on Windows, where this runs: `pnpm` spawns
// node and node spawns browsers. Killing the tree is the difference between a bounded pipeline and
// a bounded first process with an unbounded orphan behind it.
const killTree = (child: ChildProcess): void => {
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    return;
  }
  child.kill('SIGKILL');
};

// ---------------------------------------------------------------------------------------------
// The trees
// ---------------------------------------------------------------------------------------------

/**
 * One worktree per scope, all of them at the commit under test.
 *
 * The shared tree is where the twenty-seven ordinary stages run, and the engineer's own checkout is
 * not it, and that is the point: editing continues there while the gate proves the commit. Each
 * injecting stage gets a tree of its own, so mutating tracked source is a local act with no reader
 * to protect from it.
 *
 * What a tree does not get from the checkout is provisioned rather than copied. `node_modules` is a
 * `pnpm install` that hardlinks from the store on the same volume, so it costs seconds and almost no
 * bytes. The portable Node builds under `.runtimes` are 414 MiB of ignored files, and the
 * compatibility verifier already takes a root from the environment, so every tree points at the one
 * copy instead of having its own.
 */
const nodeRuntimesRoot = resolve(workspaceRoot, '.runtimes/node');
// The npm cache `stage:npm-cache` fills, one copy for every tree, for the same reason.
const npmCacheRoot = resolve(workspaceRoot, '.runtimes/npm-cache');

const treePath = (tree: string): string => resolve(treesRoot, safeName(tree));

// `git worktree remove` refuses these: "Filename too long", on a materialized consumer's own
// `node_modules/.pnpm` names, which already reach 304 characters before a worktree adds its prefix.
// Node removed a 1049-character path in a probe without complaining, so the removal is done here and
// git is only asked to forget the registration afterwards. The retries are for the handle a
// just-finished stage has not released yet, which arrives as EPERM on the root directory.
const removeTree = (path: string): void => {
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
};

const runIn = (path: string, command: string, args: readonly string[]) =>
  execFileSync(
    process.platform === 'win32' ? pnpmCommand : command,
    process.platform === 'win32' ? ['/d', '/s', '/c', command, ...args] : args,
    { cwd: path, stdio: 'pipe', maxBuffer: 1 << 28 },
  );

// A tree already at the right commit is reused rather than rebuilt, and that is what makes a resume
// a resume: the artefacts a passed stage produced (a built dist, a materialized consumer) live in
// the tree, not in the repository, so a run that threw them away would have to rebuild everything it
// claimed to have already proven. Which is why a red run keeps its trees.
//
// A tree is at a commit when its tracked content is that commit's content, not merely when its HEAD
// says so. A stage that dies between applying a mutation and restoring it leaves the mutation behind,
// and a run reusing that tree proves something other than the commit it names, which is the one
// thing this whole arrangement exists to guarantee. A `verify:assurance` run killed mid-injection
// leaves the injected file modified in its tree, and a resume that reuses the tree fails on its own
// anchor, "the code moved", on every attempt.
const treeState = (
  path: string,
  commit: string,
): { at: boolean; dirty: string[] } => {
  if (!existsSync(path)) return { at: false, dirty: [] };
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path })
      .toString()
      .trim();
    if (head !== commit) return { at: false, dirty: [] };
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: path })
      .toString()
      .split('\n')
      .filter((line) => line.trim().length > 0);
    return { at: true, dirty };
  } catch {
    return { at: false, dirty: [] };
  }
};

// Restoring by name, never against the root: `git restore .` and its neighbours do not belong
// anywhere near a repository root, and what a dead stage leaves is a short list of named tracked
// paths. Anything
// else (an untracked stray, a rename) is a state this cannot describe precisely, so it is not
// guessed at: the tree is rebuilt instead. `dist`, `node_modules` and `tmp` are ignored and never
// appear here, so a `??` entry is something no stage should have left.
const restoreTree = (path: string, dirty: readonly string[]): boolean => {
  const named: string[] = [];
  for (const line of dirty) {
    if (line.startsWith('??') || line.includes(' -> ')) return false;
    named.push(line.slice(3).replace(/^"|"$/gu, ''));
  }
  if (named.length === 0) return false;
  try {
    execFileSync(
      'git',
      ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...named],
      { cwd: path },
    );
  } catch {
    return false;
  }
  process.stdout.write(
    `=== restored ${named.length} path${named.length === 1 ? '' : 's'} a dead stage left in ${basename(path)}: ${named.join(', ')}\n`,
  );
  return true;
};

// Both callers below ask the same question and must get the same answer, so they ask it here. True
// means the tree exists and its tracked content is the commit's, after a restore if one was needed
// and possible. The re-read is the point: a restore that did not work must not be mistaken for a
// clean tree.
const treeUsableAt = (path: string, commit: string): boolean => {
  const state = treeState(path, commit);
  if (!state.at) return false;
  if (state.dirty.length === 0) return true;
  if (!restoreTree(path, state.dirty)) return false;
  return treeState(path, commit).dirty.length === 0;
};

const provisionTree = (tree: string, commit: string): string => {
  const path = treePath(tree);
  if (treeUsableAt(path, commit)) return path;
  removeTree(path);
  // A run that died leaves its registrations behind, and `git worktree add` refuses a path that is
  // still registered even after the directory is gone. Pruning first makes a crashed run cost
  // nothing on the next one. A run ended while git was still creating a tree leaves that
  // registration locked, and a prune keeps a locked one, so it is unlocked first; a registration
  // that is not locked refuses the unlock, which is the usual case and changes nothing.
  try {
    execFileSync('git', ['worktree', 'unlock', path], {
      cwd: workspaceRoot,
      stdio: 'ignore',
    });
  } catch {
    // Not locked, or not registered.
  }
  git('worktree', 'prune');
  git('worktree', 'add', '--detach', path, commit);
  runIn(path, 'pnpm', ['install', '--frozen-lockfile']);
  return path;
};

const releaseTrees = (paths: readonly string[]): void => {
  for (const path of paths) removeTree(path);
  git('worktree', 'prune');
};

// The first process of each stage, so a reading of the tree can say which stage a process ran for.
const stageRoots = new Map<number, string>();

const runStep = (
  id: string,
  timeoutSeconds: number,
  root: string,
  settings: RunnerSettings,
): Promise<{ code: number; output: string }> =>
  new Promise((settle) => {
    // A claiming stage is handed the one file its claims go to, and only a claiming stage is. The
    // stages that rerun the same checks under an injected defect are never handed one, so nothing
    // they run records a claim. The file is removed first, so what the matrix reads is what this
    // attempt recorded and never what an earlier attempt in a reused tree left behind.
    const claims = stepById.get(id)!.claims === true;
    if (claims) rmSync(claimsFile(root, id), { force: true });
    rmSync(occurrencesFile(id), { force: true });
    const args = ['run', id];
    const commandArguments =
      process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm', ...args] : args;
    // Appended rather than assigned: a caller's own `NODE_OPTIONS` is theirs, and dropping it would
    // change what the gate measures without saying so.
    const nodeOptions = [
      process.env['NODE_OPTIONS'],
      `--require "${tracerPath}"`,
    ]
      .filter((part) => part !== undefined && part !== '')
      .join(' ');
    const level = stagePriority(stepById.get(id)!, priorityLifted());
    // Captured rather than streamed. Thirty stages interleaving on one console is not a log, and
    // the summary below reads the same as it did when they ran one at a time.
    const stage = startCaptured(
      (stdio) =>
        startAtPriority(level, () =>
          spawn(pnpmCommand, commandArguments, {
            cwd: root,
            stdio,
            env: {
              ...process.env,
              NODE_OPTIONS: nodeOptions,
              // Read and removed by the tracer in the first node process it reaches. When that is a
              // script entry of `pnpm`, its workspace scan is the runner's work, not the stage's, and
              // attributing it to the stage gave three stages an undeclared read of `source:packages` on
              // the runs where pnpm happened not to skip that scan.
              EQUATOR_TRACE_LAUNCHER: '1',
              // The stage's share of the processor budget, in the settings its runners size themselves by,
              // as the scheduler handed and recorded them.
              ...settings,
              // What a stage starts runs under this run's lock and is not refused by it.
              ...heavyJob.environment,
              // The trace goes to the repository, because the tree it describes is about to be removed.
              EQUATOR_TRACE_FILE: resolve(
                runDirectory,
                `${safeName(id)}.jsonl`,
              ),
              // Traced against the tree the stage actually ran in, so a path resolves to the same
              // artefact name wherever it was touched. That is what makes the drift check mean the same
              // thing in a private tree as in the shared one.
              EQUATOR_TRACE_ROOT: root,
              EQUATOR_NODE_COMPATIBILITY_ROOT: nodeRuntimesRoot,
              EQUATOR_NPM_CACHE: npmCacheRoot,
              // Set to undefined rather than left out, so one set in the caller's shell reaches no stage.
              [CLAIMS_FILE_VARIABLE]: claims ? claimsFile(root, id) : undefined,
              // In the repository beside the trace, for the same reason.
              [OCCURRENCES_FILE_VARIABLE]: occurrencesFile(id),
              // Temporary, and a deliberate trade against an instrument's own cost rather than a lapse.
              //
              // The five page-side wrappers behind this switch cover the hot paths (element scrolling,
              // focus, and the two selection methods) and they were turned off because their cost moved
              // the failure *rate*, which made them useless for measuring one. This hunt is not measuring
              // a rate. It is trying to catch one occurrence with the wrappers on, and for that a higher
              // rate is welcome. So they run on unattended gate runs, where the occurrences happen, and
              // this line comes out the moment one is caught with them installed.
              EQUATOR_ASSURANCE_TRACE_CALLS: '1',
            },
          }),
        ),
      resolve(runDirectory, `${safeName(id)}.output`),
    );
    const { child } = stage;

    checkStarted(id, child.pid, level);
    if (child.pid !== undefined) stageRoots.set(child.pid, id);

    let notice = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      notice = `\n=== TIMEOUT ${id} after ${timeoutSeconds}s. Killing it; a stage that does not end is a failure that reports nothing.\n`;
      process.stderr.write(notice);
      killTree(child);
      // A process that inherited the stage's output can outlive the first one, and off Windows it
      // is then no longer under it, so it is ended by what it holds.
      for (const pid of stage.holders()) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Ended on its own.
        }
      }
    }, timeoutSeconds * 1000);

    void stage.ended.then(({ code, output }) => {
      clearTimeout(timer);
      if (child.pid !== undefined) stageRoots.delete(child.pid);
      settle({ code: timedOut ? 1 : (code ?? 1), output: output + notice });
    });
  });

// ---------------------------------------------------------------------------------------------
// The scheduler
// ---------------------------------------------------------------------------------------------

// Sized from what the machine reports rather than from a constant, so a smaller machine narrows the
// run instead of thrashing it, and to two thirds of it by default (`gate-resources.ts`), because the
// machine is usually someone's working machine while the gate runs. Never below the share a stage of
// this run cannot be held within, which it would exceed.
const budget = processorBudget(process.env, undefined, largestMinimum(steps));

/**
 * One gate run at a time on a machine.
 *
 * Two runs would each take the whole budget, which is the overload the budget exists to prevent,
 * and they would share `tmp/verify-run` and the ledger besides. The lock is the one every heavy job
 * takes (`heavy-job-lock.ts`), so a mutation run and a run of named stages are refused while a
 * gate is going, and the gate while one of them is.
 */
const heavyJob = await holdHeavyJobLock(
  only === undefined
    ? 'the gate'
    : `a run of the gate stages ${only.join(', ')}`,
);

/**
 * Below normal for every stage but one that runs alone, which runs at normal priority
 * (`stagePriority`).
 *
 * On Windows the gate's own process is set below normal, because a child created without a priority
 * class of its own receives its parent's when that is below normal or idle (`CreateProcess`,
 * `dwCreationFlags`); elsewhere each stage is lowered as it starts (`startAtPriority`), and a nice
 * value is carried across `fork` and `execve` (`setpriority(2)`). What each stage's first process
 * received is read back as it starts, and the whole tree is read while the run goes, so a process
 * that raises its own priority is lowered again rather than assumed not to exist.
 */
if (process.platform === 'win32') {
  const own = levelForSystem('below-normal');
  setPriority(own);
  if (getPriority() !== own) {
    throw new Error(
      `The gate asked for priority ${own} and has ${getPriority()}, so nothing it starts would run below normal.`,
    );
  }
}
const priorityFindings: string[] = [];
const checkStarted = (
  id: string,
  pid: number | undefined,
  level: PriorityLevel,
): void => {
  if (pid === undefined) return;
  let priority: number;
  try {
    priority = getPriority(pid);
  } catch {
    // Gone before it could be read. The tree reading below still covers what it started.
    return;
  }
  if (priority !== levelForSystem(level)) {
    priorityFindings.push(
      `${id}: its first process ${pid} runs at priority ${priority}, not the ${levelForSystem(level)} a stage at ${level} priority starts at.`,
    );
  }
};
/**
 * The level nothing under the gate may exceed now: normal while a stage that runs alone runs, and
 * while the run is lifted to it.
 */
const levelNow = (): PriorityLevel =>
  priorityLifted() ||
  [...scheduler.running.keys()].some(
    (id) => stagePriority(stepById.get(id)!) === 'normal',
  )
    ? 'normal'
    : 'below-normal';

const commit = requireCommittedTree();
const summaryPath = resolve(runDirectory, 'summary.json');

/**
 * A resume re-runs what has no result on this tree, and nothing else.
 *
 * *What must re-run.* Every stage that failed or was skipped: a skipped stage never ran, so green
 * cannot mean anything about it. And every stage made stale by one of those: if a re-run stage
 * writes an artifact, its readers and its later co-writers have to run again against what it now
 * produces.
 *
 * *What must not.* Write-after-read edges are scheduling constraints and not staleness: a stage
 * that already passed is not running, so there is nothing left to protect it from. Following those
 * edges here would re-run the whole gate and call it a resume.
 *
 * *And a failed writer takes its co-writers with it.* A stage that failed partway through writing
 * an artifact leaves it in a state nothing has described, so every stage that writes that artifact
 * runs again to rebuild it from a known one. The tree digest cannot see this, a materialized
 * consumer is not tracked, so it is handled by the graph instead of assumed away.
 */
const carried = new Map<string, StageResult>();
let attempt = 1;
let originalFailures: Failure[] = [];
if (resuming) {
  if (!existsSync(summaryPath)) {
    throw new Error(
      `No previous run to resume: ${summaryPath} does not exist. A resume proves nothing on its own; run the gate first.`,
    );
  }
  const previous = JSON.parse(
    readFileSync(summaryPath, 'utf8'),
  ) as PreviousSummary;
  if (previous.commit !== commit) {
    throw new Error(
      'That run proved a different commit, so resuming it would report a green nothing measured.\n' +
        `  that run: ${previous.commit}\n` +
        `  this one: ${commit}\n` +
        'Run the gate rather than resuming it.',
    );
  }
  attempt = (previous.attempt ?? 1) + 1;
  originalFailures = previous.originalFailures ?? previous.failures ?? [];

  const rerun = new Set(
    previous.stages
      .filter(({ status }) => status !== 'pass')
      .map(({ id }) => id),
  );
  for (const { id, status } of previous.stages) {
    if (status !== 'fail') continue;
    const step = stepById.get(id)!;
    for (const artefact of writesOf(step)) {
      // Scoped, like every other lookup into this map. A stage that died mid-write left one tree's
      // copy of an artefact in a state nothing has described, and only the stages working in that
      // tree can have read it.
      const { readers, writers } = artefacts.get(scoped(step, artefact))!;
      // Rebuilt from its first producer up to the stage that died mid-write, and every stage that
      // read it runs again because what it read is no longer what is on disk.
      for (const writer of writers) {
        if (position.get(writer)! <= position.get(id)!) rerun.add(writer);
      }
      for (const reader of readers) rerun.add(reader);
    }
  }
  for (const { id, status, seconds } of previous.stages) {
    if (!rerun.has(id))
      carried.set(id, {
        status: status as RanStage['status'],
        seconds,
        output: '',
      });
  }
  if (planOnly) {
    process.stdout.write(
      `
resume would re-run ${rerun.size} of ${steps.length} stages:
`,
    );
    for (const step of steps) {
      if (rerun.has(step.id))
        process.stdout.write(`  ${step.id}
`);
    }
    process.exit(0);
  }
  for (const id of rerun) {
    rmSync(resolve(runDirectory, `${safeName(id)}.jsonl`), { force: true });
    rmSync(resolve(runDirectory, `${safeName(id)}.log`), { force: true });
    rmSync(occurrencesFile(id), { force: true });
  }
  process.stdout.write(
    `=== RESUME attempt ${attempt}, re-running ${rerun.size} of ${steps.length} stages\n`,
  );
  for (const { id, signature } of originalFailures) {
    process.stdout.write(`         original failure ${id}: ${signature}\n`);
  }
} else {
  rmSync(runDirectory, { recursive: true, force: true });
}
mkdirSync(runDirectory, { recursive: true });

const results = new Map<string, StageResult>(carried);
const startedAt = new Map<string, number>();
let wake = () => {};

/**
 * A failing stage stops the stages that read what it was going to write, and nothing else. Its
 * siblings finish, every failure is reported, and the run exits 1 at the end rather than at the
 * first red, which is the difference between one answer per run and one answer per failure.
 *
 * Which stage starts when, within the processor budget and the memory floor, is decided in
 * `gate-resources.ts`, so the scheduler this runs on is the one its self-test drives.
 */
const describeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

const scheduler = createScheduler({
  steps,
  dependencies,
  results,
  budget,
  maxStages: serial ? 1 : Number.POSITIVE_INFINITY,
  readMemory: () => ({ free: freemem(), total: totalmem() }),
  onSkip: (step, blockedBy) => {
    process.stdout.write(
      `=== SKIP ${step.id} (requires ${blockedBy.join(', ')})\n`,
    );
  },
  launch: (step, processors, settings) => {
    startedAt.set(step.id, Date.now());
    process.stdout.write(`=== RUN  ${step.id} (${processors} of ${budget})\n`);
    // A stage that cannot be started, or whose log cannot be written, is a failed stage. Left to
    // reject, either one ends the run where it stands, with no summary and no ledger line, while
    // the stages beside it go on running.
    const finish = (code: number, output: string) => {
      const seconds = Math.round((Date.now() - startedAt.get(step.id)!) / 1000);
      let status = code === 0 ? ('pass' as const) : ('fail' as const);
      let recorded = output;
      try {
        writeFileSync(
          resolve(runDirectory, `${safeName(step.id)}.log`),
          output,
        );
      } catch (error) {
        status = 'fail';
        recorded += `\nThe stage's log could not be written: ${describeError(error)}\n`;
      }
      results.set(step.id, { status, seconds, output: recorded });
      process.stdout.write(
        `=== ${status === 'pass' ? 'PASS' : 'FAIL'} ${step.id} (${seconds}s)\n`,
      );
      scheduler.finished(step.id);
      wake();
    };
    void runStep(
      step.id,
      step.timeoutSeconds ?? DEFAULT_STEP_TIMEOUT_SECONDS,
      treesInUse.get(treeOf(step))!,
      settings,
    ).then(
      ({ code, output }) => {
        finish(code, output);
      },
      (error: unknown) => {
        finish(1, `The stage could not be started: ${describeError(error)}\n`);
      },
    );
  },
});

// Provisioned before the clock starts, and reported separately, because a run's wall time is what
// the stages cost and folding setup into it would make two different runs incomparable.
const wanted = [...new Set(steps.map(treeOf))];

// Checked before anything is built, so a refusal is a refusal rather than a refusal that first
// leaves four worktrees behind.
//
// A resume carries forward the results of stages it does not re-run, and those results are claims
// about artefacts that live in the trees rather than here. If a tree is missing, the dist and the
// materialized consumer those passes were about went with it, and carrying the passes forward would
// report a green about files that no longer exist. Red runs keep their trees precisely so this does
// not happen; a resume that finds them gone has to be a run.
//
// A tree that would have to be rebuilt is the same loss arriving by a different route, so a resume
// refuses that too rather than rebuilding: the rebuild is what would destroy the artefacts.
if (resuming) {
  const missing = wanted.filter(
    (tree) => !treeUsableAt(treePath(tree), commit),
  );
  if (missing.length > 0) {
    throw new Error(
      `These trees were not left usable by the run being resumed: ${missing.join(', ')}.\n` +
        'Their artefacts (a built dist, a materialized consumer) went with them, or their source ' +
        'no longer is this commit and rebuilding them would take the artefacts with it, so the passes ' +
        'this resume would carry forward describe files that are no longer there. Run the gate.',
    );
  }
}

// Fresh, because a tree an earlier run of named stages left holds what that run built, and the
// question this one answers is what the stages do starting from the commit.
// The whole folder, not only the trees this run wants: a tree an earlier run made for a stage this
// one leaves out would otherwise stay registered for good.
if (only !== undefined) releaseTrees([treesRoot]);

const provisionStartedAt = Date.now();
const treesInUse = new Map<string, string>();
for (const tree of wanted) {
  process.stdout.write(`=== TREE ${tree}\n`);
  treesInUse.set(tree, provisionTree(tree, commit));
}
const provisionSeconds = Math.round((Date.now() - provisionStartedAt) / 1000);
process.stdout.write(
  `=== ${treesInUse.size} worktrees at ${commit.slice(0, 7)} in ${provisionSeconds}s\n`,
);

/**
 * The whole tree, read while the run goes.
 *
 * Every process under the gate found above the running stages' priority is lowered to it
 * (`holdDown`), and a process that cannot be held down is a finding that turns the run red.
 *
 * The processors the tree used in each window are measured too, and a window over the budget is
 * reported with what used them: by stage, and by thread name where the platform names threads. It
 * does not decide the verdict. What the budget bounds is what the gate decides, the shares of the
 * stages running at once and the worker counts their runners are handed, and that is judged from the
 * scheduler's record (`scheduleFindings`). Each Node process also spends processor time on helper
 * threads no runner setting can switch off, so a window can exceed the budget with every stage
 * within its share. The reader's own process is left out of both.
 */
const SAMPLE_SECONDS = 15;
const processorWindows: string[] = [];
const lowered = new Set<string>();
let liftedBefore = false;
let raisedWhileLifted = 0;
let peakMeasured = 0;
let samples = 0;
// Cleared by the run while the sampler is suspended, which the compiler cannot see: it reads the
// sampler's loop as if it ran to completion where it is started.
let sampling = true as boolean;
let stopSampling = () => {};
// The largest shares of a reading, as a line.
const listed = (used: ReadonlyMap<string, number>): string =>
  [...used]
    .filter(([, processors]) => processors >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, processors]) => `${name} ${processors.toFixed(1)}`)
    .join(', ');
const runningNow = () => [...scheduler.running.keys()].join(', ') || 'no stage';
const sampler = (async () => {
  let previous: ProcessEntry[] | undefined;
  let previousThreads: ThreadEntry[] | undefined;
  let previousAt: number | undefined;
  while (sampling) {
    const readAt = Date.now();
    const levelBefore = levelNow();
    let reading;
    try {
      reading = await readProcesses();
    } catch (error) {
      priorityFindings.push(
        `the process tree could not be read: ${(error as Error).message}`,
      );
      return;
    }
    const tree = descendantsOf(
      reading.processes,
      process.pid,
      new Set([reading.reader]),
    );
    samples += 1;
    // A lifted run is raised to normal, stages already running included. What was lowered before a
    // lift, or raised during one, was moved by the gate and not by the process itself, so the
    // record of lowered processes starts again on either side of it.
    const lifted = priorityLifted();
    if (lifted !== liftedBefore) lowered.clear();
    liftedBefore = lifted;
    if (lifted) {
      raisedWhileLifted += liftUp(
        tree,
        levelInReading('normal'),
        levelForSystem('normal'),
        setPriority,
      );
    }
    // A reading takes long enough for a stage to end and the next to start. A process is held to
    // below normal only where no stage at normal priority ran on either side of the reading, so
    // one that has just started is never lowered by a reading taken before it.
    const level =
      levelBefore === 'normal' || levelNow() === 'normal'
        ? 'normal'
        : 'below-normal';
    const above = aboveLevel(
      reading.processes,
      process.pid,
      levelInReading(level),
      new Set([reading.reader]),
    );
    if (above === undefined) {
      priorityFindings.push(
        'the gate was missing from its own process reading, so the tree under it was not checked.',
      );
      return;
    }
    for (const finding of holdDown(
      above,
      levelForSystem(level),
      lowered,
      setPriority,
    )) {
      priorityFindings.push(`${finding}, while ${runningNow()} ran.`);
    }
    const threads = readThreads(tree.map(({ pid }) => pid));
    if (previous !== undefined) {
      const seconds = (readAt - previousAt!) / 1000;
      const used = processorsBetween(previous, tree, seconds);
      peakMeasured = Math.max(peakMeasured, used);
      if (used > budget) {
        const parentOf = new Map(tree.map(({ pid, ppid }) => [pid, ppid]));
        const stageOf = (pid: number): string => {
          for (
            let at: number | undefined = pid;
            at !== undefined;
            at = parentOf.get(at)
          ) {
            const stage = stageRoots.get(at);
            if (stage !== undefined) return stage;
          }
          return '(the gate)';
        };
        const byThread =
          threads === undefined || previousThreads === undefined
            ? ''
            : `; by thread: ${listed(processorsByThreadName(previousThreads, threads, seconds))}`;
        processorWindows.push(
          `${used.toFixed(1)} processors over ${Math.round(seconds)}s against a budget of ${budget}: ` +
            `${listed(processorsByGroup(previous, tree, seconds, stageOf))}${byThread}.`,
        );
      }
    }
    previous = tree;
    previousThreads = threads;
    previousAt = readAt;
    await new Promise<void>((resolve_) => {
      stopSampling = resolve_;
      setTimeout(resolve_, SAMPLE_SECONDS * 1000);
    });
  }
})();

// Waiting on memory has a bound of its own. With nothing of the gate's running, what holds the
// memory is something else on the machine, and a gate that waits on it forever is a hang.
const MEMORY_WAIT_SECONDS = 600;
const runStartedAt = Date.now();
scheduler.advance();
let memoryWaitSince;
while (scheduler.running.size > 0 || scheduler.waitingOnMemory) {
  if (scheduler.waitingOnMemory && scheduler.running.size === 0) {
    memoryWaitSince ??= Date.now();
    const waited = Math.round((Date.now() - memoryWaitSince) / 1000);
    process.stdout.write(
      `=== WAIT free memory ${Math.round(freemem() / 2 ** 20)} MiB of ${Math.round(totalmem() / 2 ** 20)} MiB is under ${MEMORY_FLOOR * 100}% (${waited}s)\n`,
    );
    if (waited >= MEMORY_WAIT_SECONDS) {
      throw new Error(
        `Free memory stayed under ${MEMORY_FLOOR * 100}% of the total for ${MEMORY_WAIT_SECONDS}s with no stage of the gate running, so something else on this machine holds it. Free it and run the gate again.`,
      );
    }
  } else {
    memoryWaitSince = undefined;
  }
  await new Promise<void>((resolve_) => {
    wake = resolve_;
    // A memory wait has no stage to end it, so it is read again on a timer.
    if (scheduler.waitingOnMemory) setTimeout(resolve_, 5_000);
  });
  if (scheduler.waitingOnMemory) scheduler.advance();
}
sampling = false;
stopSampling();
await sampler;
const wallSeconds = Math.round((Date.now() - runStartedAt) / 1000);
const overBudget = scheduleFindings(scheduler.record, budget);

if (results.size !== steps.length) {
  // Nothing is running and nothing became runnable. A cycle is caught above, so this is an
  // unsatisfiable resource, and a scheduler that quietly stops is the hang this file removed.
  const stalled = steps
    .filter(({ id }) => !results.has(id))
    .map(({ id }) => id);
  throw new Error(
    `Scheduler stalled with ${stalled.length} stages never run: ${stalled.join(', ')}`,
  );
}

// ---------------------------------------------------------------------------------------------
// The drift check: the trace against the declarations
// ---------------------------------------------------------------------------------------------

/**
 * The graph above is what the run was scheduled on. This is what the run actually did.
 *
 * A stage whose trace and declaration differ, in either direction (`tools/trace-drift.ts`), turns
 * the run red after finishing: before green is declared, and without hiding the stage's own result,
 * because the two are different findings.
 *
 * *Whether the tracer ran at all, first.* If it fails to load (a renamed file, a `NODE_OPTIONS` a
 * caller clobbered, a syntax error) every trace is empty, and an empty trace is reported as
 * untraced rather than as a stage that touched nothing. A check that cannot fail has not passed.
 */
const drift = [];
const untraced = [];
for (const step of steps) {
  if (results.get(step.id)!.status !== 'pass') continue;
  const entries = readTrace(
    resolve(runDirectory, `${safeName(step.id)}.jsonl`),
  );
  if (entries.length === 0) {
    if (readsOf(step).length + writesOf(step).length > 0)
      untraced.push(step.id);
    continue;
  }
  drift.push(...traceDrift(step, entries));
}

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------

const failed = steps.filter(({ id }) => results.get(id)!.status === 'fail');

const failures = failed.map(({ id }) => ({
  id,
  signature: signatureOf((results.get(id) as RanStage).output),
}));
if (originalFailures.length === 0) originalFailures = failures;

// A stage that passed by working around something outside Equator says so here. A resume keeps the
// files of the stages it carries forward, so their occurrences are counted with their passes.
const occurrences = collectOccurrences(
  steps.map(({ id }) => id),
  occurrencesFile,
);

// Every attempt is an occurrence. A resume that passes does not erase the failure it resumed from,
// and a recurring failure is only measurable if each of its occurrences was written down.
// A run of named stages is not an attempt at the gate, and the ledger counts those.
if (only === undefined) {
  appendFileSync(
    attemptLedgerPath,
    `${JSON.stringify({
      at: new Date().toISOString(),
      mode: resuming ? 'resume' : serial ? 'serial' : 'graph',
      attempt,
      commit,
      failures,
      occurrences: ledgerOccurrences(occurrences),
    })}\n`,
  );
}

for (const step of failed) {
  const tail = (results.get(step.id) as RanStage).output
    .trimEnd()
    .split('\n')
    .slice(-25);
  process.stdout.write(
    `\n=== FAILURE ${step.id} (last ${tail.length} lines)\n`,
  );
  process.stdout.write(`${tail.join('\n')}\n`);
}

const label = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' };
const width = Math.max(...steps.map(({ id }) => id.length));
process.stdout.write('\n=== SUMMARY\n');
for (const { id } of steps) {
  const result = results.get(id)!;
  const detail =
    result.status === 'skip'
      ? `requires ${result.blockedBy.join(', ')}`
      : `${result.seconds}s`;
  process.stdout.write(
    `${label[result.status]}  ${id.padEnd(width)}  ${detail}\n`,
  );
}

if (untraced.length > 0) {
  process.stdout.write(
    `\n=== UNTRACED (${untraced.length})\n` +
      'These stages declare artefacts and produced no trace, so the drift check below saw nothing and\n' +
      'proves nothing. Fix the tracer before reading this run as evidence.\n',
  );
  for (const id of untraced) process.stdout.write(`  ${id}\n`);
}

if (drift.length > 0) {
  process.stdout.write(
    `\n=== GRAPH DRIFT (${drift.length})\n` +
      "Each line is a difference between a stage's declaration in tools/verify-stages.ts and what its\n" +
      'trace saw it do. The stage passed; the graph it was scheduled on is wrong. Correct the\n' +
      'declaration, or the tracer where it cannot see the artefact, and re-run.\n',
  );
  for (const line of drift) process.stdout.write(`  ${line}\n`);
}

if (priorityFindings.length > 0) {
  process.stdout.write(
    `\n=== PRIORITY (${priorityFindings.length})\n` +
      'The gate runs below normal so the machine stays usable, and a stage that runs alone at normal\n' +
      "priority. These processes could not be held to their stage's. Find what sets their priority.\n",
  );
  for (const line of priorityFindings) process.stdout.write(`  ${line}\n`);
}

if (overBudget.length > 0) {
  process.stdout.write(
    `\n=== OVER BUDGET (${overBudget.length})\n` +
      `The gate may schedule ${budget} logical processors (${PROCESSORS_VARIABLE}). Its own record shows it\n` +
      "scheduled more, or handed a stage's runners more workers than the stage's share. The scheduler is wrong.\n",
  );
  for (const line of overBudget) process.stdout.write(`  ${line}\n`);
}

if (processorWindows.length > 0) {
  process.stdout.write(
    `\n=== PROCESSOR TIME (${processorWindows.length})\n` +
      `These windows used more than the ${budget} processors scheduled. Every Node process spends time on\n` +
      'helper threads beside its JavaScript that no runner setting holds, so this does not make the run red.\n' +
      'A stage, or a thread that is not a helper, far above its share here is a runner ignoring its setting.\n',
  );
  for (const line of processorWindows) process.stdout.write(`  ${line}\n`);
}

if (occurrences.length > 0) {
  process.stdout.write(
    `\n=== OCCURRENCES (${occurrences.length})\n` +
      'These stages worked around a failure outside Equator, which each one names. An occurrence does\n' +
      'not make the run red; the attempt ledger counts them, so a rising rate shows there.\n',
  );
  for (const { stage, signature } of occurrences) {
    process.stdout.write(`  ${stage}: ${signature}\n`);
  }
}

const counts = { pass: 0, fail: 0, skip: 0 };
for (const { id } of steps) counts[results.get(id)!.status] += 1;

const serialSeconds = steps.reduce(
  (total, { id }) => total + results.get(id)!.seconds,
  0,
);
process.stdout.write(
  `\n${only !== undefined ? 'run of named stages' : resuming ? `resumed run (attempt ${attempt})` : serial ? 'serial run' : 'graph run'}: ` +
    `${wallSeconds}s wall, ${serialSeconds}s of stage time, ` +
    `peak ${scheduler.peakStages} stages and ${scheduler.peakProcessors} of ${budget} processors scheduled, ` +
    `${peakMeasured.toFixed(1)} measured over ${samples} readings, ${lowered.size} process(es) lowered to their stage's priority${raisedWhileLifted > 0 ? `, ${raisedWhileLifted} raised while the run was lifted to normal priority` : ''}\n` +
    `logs and traces: ${runDirectory}\n`,
);

writeFileSync(
  resolve(runDirectory, 'summary.json'),
  `${JSON.stringify(
    {
      mode:
        only !== undefined
          ? 'only'
          : resuming
            ? 'resume'
            : serial
              ? 'serial'
              : 'graph',
      only,
      attempt,
      commit,
      failures,
      originalFailures,
      wallSeconds,
      stageSeconds: serialSeconds,
      peakStages: scheduler.peakStages,
      peakProcessors: scheduler.peakProcessors,
      peakMeasuredProcessors: peakMeasured,
      processorBudget: budget,
      processorBudgetVariable: PROCESSORS_VARIABLE,
      priorityFindings,
      loweredProcesses: lowered.size,
      occurrences,
      overBudget,
      processorWindows,
      drift,
      untraced,
      stages: steps.map(({ id }) => ({
        id,
        ...results.get(id),
        output: undefined,
      })),
    },
    null,
    1,
  )}\n`,
);

const red =
  counts.fail > 0 ||
  counts.skip > 0 ||
  drift.length > 0 ||
  untraced.length > 0 ||
  priorityFindings.length > 0 ||
  overBudget.length > 0;

// A green run has nothing left to say and its trees are 4 GiB of it, so they go. A red run keeps
// them: the failure is reproducible in the tree it happened in, and a resume needs the artefacts the
// passed stages left there (a dist, a materialized consumer), which live in the tree rather than
// in this repository. Throwing them away would make a resume rebuild everything it had just proven.
/**
 * What a green run leaves behind.
 *
 * A stage writes its artefacts in the tree it ran in, and a green run removes the trees, so what a
 * stage produced is gone by the time anyone reads the verdict. That is right for a dist and a
 * materialized consumer, which the next run rebuilds. It is wrong for the tarballs: RELEASING has a
 * publish take the archives the suite verified, and an archive that is not there is replaced by a
 * fresh pack nobody checked, which is the failure `verify:tarballs` exists to prevent.
 *
 * Keyed by the artefact the graph already names, so the stage that writes it and the tree it wrote
 * it in are derived here rather than restated.
 *
 * Copied over what is already here rather than replacing it. A tree holds one version, so a run
 * that emptied this directory first would take every earlier version's archives with it, and an
 * archive for a version the tree has moved past cannot be built again from here. `verify:tarballs`
 * files each one under its own version, so what this overwrites is the version just built and
 * nothing else.
 */
const KEPT_FROM_A_GREEN_RUN = new Map([['release:packages', 'release']]);

// Only the gate's verdict is what a release is cut on, so only the gate keeps the archives.
if (!red && only === undefined) {
  for (const [artefact, directory] of KEPT_FROM_A_GREEN_RUN) {
    const producers = steps.filter((step) =>
      (step.writes ?? []).includes(artefact),
    );
    if (producers.length !== 1) {
      throw new Error(
        `${artefact} is kept from a green run and ${producers.length} stages write it. Exactly one must, or there is no single tree to take ${directory} from.`,
      );
    }
    const [producer] = producers as [Stage];
    const from = resolve(treesInUse.get(treeOf(producer))!, directory);
    if (!existsSync(from)) {
      throw new Error(
        `${producer.id} passed and left no ${directory} in its tree, so there is nothing to keep. A green run promises the publishable pair at ${resolve(workspaceRoot, directory)}.`,
      );
    }
    const kept = resolve(workspaceRoot, directory);
    cpSync(from, kept, { recursive: true, force: true });
    process.stdout.write(`=== ${directory} kept from ${producer.id}\n`);
  }
}

if (keepTrees || red) {
  process.stdout.write(
    `=== trees kept at ${treesRoot}${red ? ' (this run was red; a resume will reuse them)' : ''}\n`,
  );
} else {
  releaseTrees([...treesInUse.values()]);
}

/**
 * The verdict, last, and the only line in this summary that carries counts.
 *
 * A count is not a verdict. Printing `30 passed, 0 failed, 0 skipped` above the block that made
 * the run red states that the run passed in the one place anybody reads, and leaves a reader to
 * already know that untraced and drift are verdicts too. So counts appear only inside a verdict,
 * every reason is on the same line as the word RED, and nothing prints after it.
 */
const recorded = verdictOccurrences(occurrences);
// Said on the verdict line, because that line is what gets quoted, and a green over some of the
// stages quoted without this reads as the gate's.
const scope =
  only === undefined
    ? ''
    : ` (${steps.length} of the gate's ${everyStep.length} stages; not a gate run)`;
process.stdout.write(
  red
    ? `=== RED  ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped, ` +
        `${untraced.length} untraced, ${drift.length} drifted${recorded}${scope}\n`
    : `=== GREEN  ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped${recorded}${scope}\n`,
);

process.exitCode = red ? 1 : 0;
