/**
 * What the gate may take from the machine it runs on, and the scheduler that keeps it there.
 *
 * The gate runs on an engineer's working machine as often as on a runner, and a run that makes the
 * machine unresponsive, or takes it down, costs more than a slower run does. So it takes a share
 * rather than all of it:
 *
 * - **Processors.** One setting, `EQUATOR_VERIFY_PROCESSORS`, defaulting to two thirds of the
 *   logical processors the machine reports, so it scales with the machine. It counts the stages
 *   that run at once and the workers each stage's runners start, together: a stage declares how many
 *   processors it occupies (`processors` in `verify-stages.ts`, one when it says nothing), the
 *   scheduler starts a stage only while the stages running and the one starting fit the budget,
 *   and each stage's runners are handed its share through the settings they read themselves.
 * - **Memory.** No stage starts while free memory is under a quarter of the total. A stage already
 *   running is left to finish, because stopping it would waste what it has done and free nothing a
 *   finished stage would not.
 * - **Alone.** An `exclusive` stage runs with nothing beside it: the browser rows, so there is only
 *   ever one browser row at a time, and the cost budget and its self-test, whose readings are
 *   wall-clock times that anything running beside them would be part of.
 *
 * - **Priority.** Below normal, except for a stage that runs alone, which runs at normal priority:
 *   what such a stage reports is a time or a browser's answer within a bound, and a working
 *   machine's foreground load starves a process below normal for long enough to move both. Nothing
 *   runs beside it, so it takes nothing from another stage. `verify.ts` starts each stage at its
 *   level, checks it as it starts, and samples the whole tree while it runs. A file can lift the
 *   whole run to normal priority while it goes (`priorityLifted`).
 */
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

export const PROCESSORS_VARIABLE = 'EQUATOR_VERIFY_PROCESSORS';

/** The share of physical memory that must be free before another stage starts. */
export const MEMORY_FLOOR = 0.25;

/** What the scheduler reads of a stage. */
export interface ScheduledStage {
  readonly id: string;
  readonly processors?: number | undefined;
  readonly exclusive?: boolean | undefined;
}

/** The result the scheduler records for a stage it will not start. */
export interface SkippedStage {
  readonly status: 'skip';
  readonly blockedBy: string[];
  readonly seconds: number;
}

/** Free and total physical memory, in the same unit. */
export interface MemoryReading {
  readonly free: number;
  readonly total: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

/** How many logical processors the gate's stages and their workers may occupy together. */
export function processorBudget(
  environment: Environment = process.env,
  parallelism: number = availableParallelism(),
): number {
  const set = environment[PROCESSORS_VARIABLE];
  if (set === undefined || set === '') {
    return Math.max(1, Math.floor((parallelism * 2) / 3));
  }
  const value = Number(set);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `${PROCESSORS_VARIABLE} is ${JSON.stringify(set)}; it must be a whole number of logical processors, at least 1.`,
    );
  }
  return value;
}

export const PRIORITY_FILE_VARIABLE = 'EQUATOR_VERIFY_PRIORITY_FILE';

const readText = (path: string): string => readFileSync(path, 'utf8');

/**
 * Whether the run is lifted to normal priority at this moment.
 *
 * A run takes hours, and the machine it shares with someone's work by day is often left to it
 * overnight. A level fixed when the run starts fits one of the two, so it can be changed while the
 * run goes: `EQUATOR_VERIFY_PRIORITY_FILE` names a file, and while its text is `normal` every
 * stage runs at normal priority. Any other text, and a file that is missing or cannot be read,
 * leaves each stage at its own level, so a fault in the file never raises anything.
 */
export function priorityLifted(
  environment: Environment = process.env,
  read: (path: string) => string = readText,
): boolean {
  const path = environment[PRIORITY_FILE_VARIABLE];
  if (path === undefined || path === '') return false;
  try {
    return read(path).trim() === 'normal';
  } catch {
    return false;
  }
}

/**
 * The priority a stage runs at: normal where it runs alone or the run is lifted, below normal
 * otherwise.
 */
export const stagePriority = (
  step: ScheduledStage,
  lifted = false,
): 'normal' | 'below-normal' =>
  lifted || step.exclusive === true ? 'normal' : 'below-normal';

/**
 * A stage's share: what it declares, and never more than the whole budget. A stage that runs alone
 * has nothing to share the budget with, so it is handed all of it.
 */
export const stageProcessors = (
  step: ScheduledStage,
  budget: number,
): number =>
  step.exclusive === true ? budget : Math.min(step.processors ?? 1, budget);

/**
 * The settings a stage's runners read to size their own parallelism, each set to its share.
 *
 * `VITEST_MAX_WORKERS` is read by Vitest when it resolves its configuration, `NG_BUILD_MAX_WORKERS`
 * by `@angular/build`, and `GOMAXPROCS` by the Go runtime inside esbuild. A tool of this
 * repository that runs work in parallel reads `EQUATOR_STAGE_PROCESSORS`.
 */
export const runnerEnvironment = (processors: number) => ({
  EQUATOR_STAGE_PROCESSORS: String(processors),
  VITEST_MAX_WORKERS: String(processors),
  NG_BUILD_MAX_WORKERS: String(processors),
  GOMAXPROCS: String(processors),
});

/** The share a tool of this repository may use, read from what the gate handed it. */
export function stageProcessorShare(
  fallback: number,
  environment: Environment = process.env,
): number {
  const value = Number(environment['EQUATOR_STAGE_PROCESSORS']);
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

export const memoryAllows = ({ free, total }: MemoryReading): boolean =>
  free >= total * MEMORY_FLOOR;

/**
 * The scheduler: which stages start, and when.
 *
 * `results` is the map the caller fills as stages finish; `launch(step, processors)` starts one and
 * must call `finished(id)` when it ends. `maxStages` is one for a serial run. `readMemory` answers
 * `{ free, total }` in bytes at the moment a start is considered.
 */
export function createScheduler<Step extends ScheduledStage>({
  steps,
  dependencies,
  results,
  budget,
  maxStages = Number.POSITIVE_INFINITY,
  readMemory,
  launch,
  onSkip = () => {},
}: {
  readonly steps: readonly Step[];
  readonly dependencies: ReadonlyMap<string, Iterable<string>>;
  readonly results: Map<string, { readonly status: string } | SkippedStage>;
  readonly budget: number;
  readonly maxStages?: number;
  readonly readMemory: () => MemoryReading;
  readonly launch: (step: Step, processors: number) => void;
  readonly onSkip?: (step: Step, blockedBy: string[]) => void;
}) {
  const running = new Map<string, number>();
  const stepById = new Map(steps.map((step) => [step.id, step]));
  let peakProcessors = 0;
  let peakStages = 0;
  let waitingOnMemory = false;

  const inUse = () => [...running.values()].reduce((sum, n) => sum + n, 0);

  const advance = () => {
    waitingOnMemory = false;
    let changed = true;
    while (changed) {
      changed = false;
      let reserved = [...running.keys()].some(
        (id) => stepById.get(id)!.exclusive === true,
      );
      for (const step of steps) {
        if (results.has(step.id) || running.has(step.id)) continue;
        const required = [...dependencies.get(step.id)!];
        const blockedBy = required.filter((id) => {
          const result = results.get(id);
          return result !== undefined && result.status !== 'pass';
        });
        if (blockedBy.length > 0) {
          results.set(step.id, { status: 'skip', blockedBy, seconds: 0 });
          onSkip(step, blockedBy);
          changed = true;
          continue;
        }
        if (required.some((id) => !results.has(id))) continue;
        if (reserved) continue;
        const processors = stageProcessors(step, budget);
        if (step.exclusive === true) {
          // Reserved from the moment it is ready, not from the moment it starts. Waiting for an
          // idle machine while later stages keep starting in front of it is a stage that never
          // runs.
          reserved = true;
          if (running.size > 0) continue;
        } else {
          if (running.size >= maxStages) continue;
          if (inUse() + processors > budget) continue;
        }
        if (!memoryAllows(readMemory())) {
          waitingOnMemory = true;
          return;
        }
        running.set(step.id, processors);
        peakProcessors = Math.max(peakProcessors, inUse());
        peakStages = Math.max(peakStages, running.size);
        launch(step, processors);
        changed = true;
      }
    }
  };

  return {
    advance,
    finished(id: string) {
      running.delete(id);
      advance();
    },
    get running() {
      return new Map(running);
    },
    get waitingOnMemory() {
      return waitingOnMemory;
    },
    get peakProcessors() {
      return peakProcessors;
    },
    get peakStages() {
      return peakStages;
    },
  };
}
