/**
 * `verify:gate-limits:self-test`: the gate's scheduler, driven over a planted graph and held to
 * the limits it exists to keep.
 *
 * The scheduler is the one `verify.ts` runs on (`createScheduler` in `gate-resources.ts`), handed
 * stages that finish in a fixed pseudo-random order and a memory reading that dips below the floor
 * partway through. At every start it must hold:
 *
 * - the processors of the stages running, the new one included, within the budget;
 * - an exclusive stage alone, and nothing started beside one;
 * - no start while free memory is under the floor;
 * - no stage before the stages it depends on.
 *
 * And every stage must run in the end, because a scheduler that keeps its limits by starting
 * nothing has kept them trivially. The readings the gate takes of its own process tree are planted
 * too: a process under it above its priority must be named, and the processors a window reports
 * must be the CPU time the tree used in it. The budget's default and each stage's declared share are
 * checked against the real declarations too, so a share nobody can be handed fails here rather
 * than in a run. So is the file that lifts a run to normal priority while it goes.
 *
 * The lock every heavy job takes is driven here as well (`heavy-job-lock.ts`): a second job is
 * refused by the first one's name, a job the holder started runs under the holder's lock, and a
 * lock whose holder has exited, or whose process id belongs to a later process, is taken over.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { setPriority } from 'node:os';
import { resolve } from 'node:path';

import {
  createScheduler,
  MEMORY_FLOOR,
  priorityLifted,
  processorBudget,
  PROCESSORS_VARIABLE,
  stagePriority,
  runnerEnvironment,
  stageProcessors,
} from './gate-resources.ts';
import {
  aboveLevel,
  descendantsOf,
  holdDown,
  levelInReading,
  liftUp,
  processorsBetween,
  startAtPriority,
} from './process-tree.ts';
import type { PriorityLevel } from './process-tree.ts';
import { takeHeavyJobLock } from './heavy-job-lock.ts';
import { steps as declaredSteps } from './verify-stages.ts';
import { workingRoot } from './working-state.ts';

// The default is two thirds of the machine, whatever the machine.
assert.equal(
  processorBudget({}, 32),
  21,
  'The default budget is not two thirds of 32, rounded down.',
);
assert.equal(
  processorBudget({}, 3),
  2,
  'The default budget is not two thirds of 3.',
);
assert.equal(
  processorBudget({}, 1),
  1,
  'The default budget left a one-processor machine nothing.',
);
assert.equal(
  processorBudget({ [PROCESSORS_VARIABLE]: '6' }, 32),
  6,
  'The setting was not read.',
);
for (const wrong of ['0', '-2', '1.5', 'half']) {
  assert.throws(
    () => processorBudget({ [PROCESSORS_VARIABLE]: wrong }, 32),
    new RegExp(PROCESSORS_VARIABLE, 'u'),
    `A budget of ${wrong} was accepted.`,
  );
}
assert.deepEqual(
  Object.values(runnerEnvironment(3)),
  ['3', '3', '3', '3'],
  'A runner setting was handed something other than the stage share.',
);
for (const step of declaredSteps) {
  if (step.processors === undefined) continue;
  assert.ok(
    Number.isInteger(step.processors) && step.processors >= 1,
    `${step.id} declares ${step.processors} processors; a share is a whole number, at least 1.`,
  );
}

// A small deterministic generator, so a failure names the same run every time.
let seed = 0x2f5a1c3;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const BUDGET = 8;
const planted: {
  id: string;
  processors: number | undefined;
  exclusive: boolean;
}[] = [];
for (let index = 0; index < 60; index += 1) {
  planted.push({
    id: `stage-${index}`,
    processors: [undefined, 1, 2, 4, 4, 12][index % 6],
    exclusive: index % 17 === 5,
  });
}
const dependencies = new Map(planted.map(({ id }) => [id, new Set<string>()]));
for (let index = 1; index < planted.length; index += 1) {
  if (index % 3 === 0)
    dependencies.get(planted[index]!.id)!.add(planted[index - 1]!.id);
  if (index % 7 === 0)
    dependencies.get(planted[index]!.id)!.add(planted[index - 5]!.id);
}

let clock = 0;
// Below the floor between these two moments.
const lowFrom = 40;
const lowUntil = 70;
const memory = () =>
  clock >= lowFrom && clock < lowUntil
    ? { free: MEMORY_FLOOR * 100 - 1, total: 100 }
    : { free: 90, total: 100 };

const results = new Map<string, { readonly status: string }>();
const active = new Map<string, number>();
const ends = new Map<string, number>();
const violations: string[] = [];
const scheduler = createScheduler({
  steps: planted,
  dependencies,
  results,
  budget: BUDGET,
  readMemory: memory,
  launch: (step, processors) => {
    const inUse = [...active.values()].reduce((sum, n) => sum + n, 0);
    if (inUse + processors > BUDGET)
      violations.push(
        `${step.id} took ${processors} with ${inUse} of ${BUDGET} in use`,
      );
    if (processors !== stageProcessors(step, BUDGET))
      violations.push(`${step.id} was handed ${processors}, not its share`);
    if (step.exclusive && active.size > 0)
      violations.push(
        `${step.id} runs alone and started beside ${[...active.keys()].join(', ')}`,
      );
    for (const id of active.keys()) {
      if (planted.find((other) => other.id === id)!.exclusive)
        violations.push(`${step.id} started beside ${id}, which runs alone`);
    }
    const { free, total } = memory();
    if (free < total * MEMORY_FLOOR)
      violations.push(
        `${step.id} started at ${clock} with free memory under the floor`,
      );
    for (const dependency of dependencies.get(step.id)!) {
      if (results.get(dependency)?.status !== 'pass')
        violations.push(`${step.id} started before ${dependency} passed`);
    }
    active.set(step.id, processors);
    ends.set(step.id, clock + 1 + Math.floor(random() * 9));
  },
});

let heldForMemory = 0;
scheduler.advance();
while (active.size > 0 || scheduler.waitingOnMemory) {
  clock += 1;
  assert.ok(clock < 10_000, 'The planted run never finished.');
  for (const [id, end] of [...ends]) {
    if (end > clock) continue;
    ends.delete(id);
    active.delete(id);
    results.set(id, { status: 'pass' });
    scheduler.finished(id);
  }
  if (scheduler.waitingOnMemory) {
    heldForMemory += 1;
    scheduler.advance();
  }
}

assert.deepEqual(
  violations,
  [],
  `The scheduler went over its limits:\n  ${violations.join('\n  ')}`,
);
assert.equal(
  results.size,
  planted.length,
  `The scheduler kept its limits by never starting ${planted.length - results.size} stages.`,
);
assert.ok(
  scheduler.peakProcessors === BUDGET,
  `The planted run never filled the budget (peak ${scheduler.peakProcessors} of ${BUDGET}), so it proved nothing about the edge.`,
);

// The readings the gate takes of its own tree while it runs, planted: the gate is 10 at base
// priority 6, 11 and 12 are its stage and that stage's runner, 13 is a process that raised itself,
// 14 is the reader, and 99 belongs to nobody under the gate.
const reading = (cpu: readonly [number, number, number]) => [
  { pid: 10, ppid: 1, priority: 6, cpuSeconds: 0 },
  { pid: 11, ppid: 10, priority: 6, cpuSeconds: cpu[0] },
  { pid: 12, ppid: 11, priority: 6, cpuSeconds: cpu[1] },
  { pid: 13, ppid: 12, priority: 8, cpuSeconds: cpu[2] },
  { pid: 14, ppid: 10, priority: 8, cpuSeconds: 50 },
  { pid: 99, ppid: 1, priority: 13, cpuSeconds: 500 },
];
assert.deepEqual(
  aboveLevel(reading([0, 0, 0]), 10, 6, new Set([14]))!.map(({ pid }) => pid),
  [13],
  'A process under the gate above its stage priority was not named, or one outside the tree or the reader was.',
);
assert.deepEqual(
  aboveLevel(reading([0, 0, 0]), 10, 8, new Set([14])),
  [],
  'A process at normal priority was named while a stage that runs at normal priority ran.',
);
assert.equal(
  aboveLevel(reading([0, 0, 0]), 7, 6),
  undefined,
  'A reading without the gate in it read as a clean one.',
);

// The two levels. A stage that runs alone runs at normal priority, and every other stage below it.
assert.equal(stagePriority({ id: 'a', exclusive: true }), 'normal');
assert.equal(stagePriority({ id: 'b' }), 'below-normal');
for (const step of declaredSteps) {
  const alone =
    /^verify:(browser-assurance(:|$)(?!self-test)|browser-specs$|cost-budget(:self-test)?$)/u.test(
      step.id,
    );
  assert.equal(
    stagePriority(step),
    alone ? 'normal' : 'below-normal',
    `${step.id} runs at ${stagePriority(step)} priority.`,
  );
}
// A run lifted to normal priority while it goes. The file is read each time it is asked, every
// stage is at normal while its text says so, and any other text, a file that cannot be read and
// no file named each leave a stage at its own level.
assert.equal(stagePriority({ id: 'b' }, true), 'normal');
const liftedBy = (text: string | undefined) =>
  priorityLifted({ EQUATOR_VERIFY_PRIORITY_FILE: 'level' }, () => {
    if (text === undefined) throw new Error('ENOENT');
    return text;
  });
assert.deepEqual(
  [
    liftedBy('normal'),
    liftedBy('normal\r\n'),
    liftedBy('stage'),
    liftedBy(''),
    liftedBy(undefined),
    priorityLifted({}, () => 'normal'),
    priorityLifted({ EQUATOR_VERIFY_PRIORITY_FILE: '' }, () => 'normal'),
  ],
  [true, true, false, false, false, false, false],
  'The run is lifted by something other than a named file whose text is normal.',
);
// Under a lift the processes below normal are raised to it; one at or above it is left, and one
// that cannot be raised is left and is not counted.
const lifts: [number, number][] = [];
assert.equal(
  liftUp(
    [
      { pid: 11, priority: 6 },
      { pid: 12, priority: 8 },
      { pid: 13, priority: 10 },
      { pid: 66, priority: 6 },
    ],
    levelInReading('normal', 'win32'),
    0,
    (pid, priority) => {
      if (pid === 66) throw new Error('gone');
      lifts.push([pid, priority]);
    },
  ),
  1,
  'A lift did not count the one process it raised.',
);
assert.deepEqual(
  lifts,
  [[11, 0]],
  'A lift raised something other than the process below normal priority.',
);
assert.deepEqual(
  [
    levelInReading('normal', 'win32'),
    levelInReading('below-normal', 'win32'),
    levelInReading('normal', 'linux'),
    levelInReading('below-normal', 'linux'),
  ],
  [8, 6, 0, -10],
  'A level is not read in the units a process reading uses.',
);
// How a stage is started at its level, with the platform and the priority call planted. On Windows
// the gate is below normal and a child takes its parent's class, so the gate stands at normal for
// the length of the start and no longer. Elsewhere a process cannot take back a priority it gave
// up, so the gate keeps its own and lowers the stage it has just started.
const started = (
  level: PriorityLevel,
  platform: NodeJS.Platform,
  start: () => unknown = () => ({ pid: 77 }),
) => {
  const priorityCalls: number[][] = [];
  let outcome: unknown;
  try {
    // A planted start may answer something that is not a child process, to show it is passed back.
    outcome = startAtPriority(level, start as () => { readonly pid?: number }, {
      platform,
      set: (...call: number[]) => priorityCalls.push(call),
    });
  } catch (error) {
    outcome = (error as Error).message;
  }
  return { priorityCalls, outcome };
};
assert.deepEqual(
  started('normal', 'win32', () => 'the child'),
  { priorityCalls: [[0], [10]], outcome: 'the child' },
  'On Windows a normal stage was not started with the gate at normal, or the gate was left there.',
);
assert.deepEqual(
  started('normal', 'win32', () => {
    throw new Error('no such command');
  }),
  { priorityCalls: [[0], [10]], outcome: 'no such command' },
  'A start that failed left the gate at normal priority.',
);
assert.deepEqual(
  started('below-normal', 'win32').priorityCalls,
  [],
  'On Windows a stage below normal was started by anything but inheritance.',
);
assert.deepEqual(
  started('below-normal', 'linux').priorityCalls,
  [[77, 10]],
  'Off Windows a stage below normal was not lowered as it started.',
);
assert.deepEqual(
  started('normal', 'linux').priorityCalls,
  [],
  'Off Windows a normal stage had its priority changed.',
);
const before = descendantsOf(reading([1, 2, 3]), 10, new Set([14]));
const after = descendantsOf(
  [...reading([11, 12, 13]), { pid: 15, ppid: 11, priority: 6, cpuSeconds: 5 }],
  10,
  new Set([14]),
);
assert.equal(
  processorsBetween(before, after, 10),
  3.5,
  'Three processes each busy for the window, and one that started in it, did not read as 3.5 processors.',
);

// A Windows reading, where a parent id outlives its process: 12 is a gate process that was given
// the id a boot-time process once had, and 40, started long before the gate, still names it.
const reused = [
  { pid: 10, ppid: 1, priority: 6, cpuSeconds: 0, started: 5_000 },
  { pid: 12, ppid: 10, priority: 6, cpuSeconds: 1, started: 6_000 },
  { pid: 13, ppid: 12, priority: 6, cpuSeconds: 1, started: 7_000 },
  { pid: 40, ppid: 12, priority: 13, cpuSeconds: 9_000, started: 1_000 },
];
assert.deepEqual(
  descendantsOf(reused, 10).map(({ pid }) => pid),
  [12, 13],
  'A process that started before the gate process it names as its parent was read as under the gate.',
);

// A process that raised itself is lowered and is not a finding; found above again, it is one, and
// so is one that cannot be lowered at all.
const lowered = new Set<string>();
const calls: [number, number][] = [];
const lower = (pid: number, priority: number) => {
  if (pid === 66) throw new Error('access denied');
  calls.push([pid, priority]);
};
const raised = {
  pid: 13,
  ppid: 12,
  priority: 8,
  cpuSeconds: 0,
  started: 7_000,
};
assert.deepEqual(
  holdDown([raised], 10, lowered, lower),
  [],
  'A process the gate could lower was reported instead of lowered.',
);
assert.deepEqual(
  calls,
  [[13, 10]],
  'The raised process was not lowered to the gate priority.',
);
assert.equal(
  holdDown([raised], 10, lowered, lower).length,
  1,
  'A process found above the gate again after it was lowered was not reported.',
);
assert.equal(
  holdDown([{ ...raised, started: 8_000 }], 10, lowered, lower).length,
  0,
  'A new process given a lowered process id was reported as the old one raising itself again.',
);
assert.match(
  holdDown([{ ...raised, pid: 66 }], 10, lowered, lower)[0] ?? '',
  /could not be lowered: access denied/u,
  'A process the gate could not lower was not reported.',
);

// The platform's own call on a process that has ended, so the error read is the one it throws.
const ended = spawnSync(process.execPath, ['-e', '']).pid;
assert.deepEqual(
  holdDown([{ ...raised, pid: ended }], 10, lowered, setPriority),
  [],
  'A process that ended before the gate could lower it was reported as not held.',
);

assert.ok(
  heldForMemory > 0,
  'Nothing was ready while memory was under the floor, so the floor was never tested.',
);

// The lock every heavy job takes, over a file of its own. The first holder is this process, read
// from the machine as the gate reads one, so the refusal below is of a holder really running.
const lockPath = resolve(workingRoot, 'heavy-job-lock-self-test.lock');
rmSync(lockPath, { force: true });
const outside = { path: lockPath, environment: {} };
const first = await takeHeavyJobLock('the planted first job', outside);
assert.equal(first.inherited, false, 'The first job did not take the lock.');
await assert.rejects(
  takeHeavyJobLock('the planted second job', outside),
  new RegExp(
    `A heavy job is already running: the planted first job \\(process ${process.pid}, started `,
    'u',
  ),
  'A second heavy job was started while the first held the lock, or was refused without naming it.',
);
const under = await takeHeavyJobLock('a job the first one started', {
  path: lockPath,
  environment: first.environment,
});
assert.equal(
  under.inherited,
  true,
  "A job handed the holder's token was not run under the holder's lock.",
);
under.release();
assert.ok(
  existsSync(lockPath),
  "A job running under the holder's lock released it.",
);
first.release();
assert.ok(!existsSync(lockPath), 'The holder did not release its lock.');

// A holder that is gone: a process that has exited, and a process id handed to a later process.
const exited = spawnSync(process.execPath, ['-e', '']).pid;
const plantHolder = (holder: { job: string; pid: number; startedAt: string }) =>
  writeFileSync(
    lockPath,
    `${JSON.stringify({ token: 'planted', ...holder })}\n`,
  );
plantHolder({
  job: 'the planted dead job',
  pid: exited,
  startedAt: new Date().toISOString(),
});
const afterDead = await takeHeavyJobLock('the job after a dead one', outside);
assert.match(
  afterDead.tookOver ?? '',
  new RegExp(`the planted dead job \\(process ${exited}, `, 'u'),
  'A lock whose holder had exited was not taken over by name.',
);
afterDead.release();
const lockedAt = Date.parse('2026-01-01T00:00:00.000Z');
const reusedHolder = {
  job: 'the planted job whose id was reused',
  pid: 4242,
  startedAt: new Date(lockedAt).toISOString(),
};
const machine = (started: number) => ({
  ...outside,
  processExists: () => true,
  readProcesses: () => Promise.resolve({ processes: [{ pid: 4242, started }] }),
});
plantHolder(reusedHolder);
await assert.rejects(
  takeHeavyJobLock('the job beside a live one', machine(lockedAt - 60_000)),
  /A heavy job is already running: the planted job whose id was reused/u,
  'A holder that started before its lock was written was taken for a dead one.',
);
const afterReuse = await takeHeavyJobLock(
  'the job after a reused id',
  machine(lockedAt + 60_000),
);
assert.match(
  afterReuse.tookOver ?? '',
  /the planted job whose id was reused/u,
  'A lock was kept by a process that started after it was written, which is another process with the same id.',
);
afterReuse.release();
assert.ok(!existsSync(lockPath), 'The last planted job left its lock behind.');

process.stdout.write(
  `verify:gate-limits:self-test GREEN: ${planted.length} planted stages ran within ${BUDGET} processors, alone where exclusive, held ${heldForMemory} times for memory, peak ${scheduler.peakProcessors}.\n`,
);
