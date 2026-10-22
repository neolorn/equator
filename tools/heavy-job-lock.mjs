/**
 * One heavy job at a time on a machine.
 *
 * The gate, a run of some of its stages and a mutation run each take the processor budget
 * (`gate-resources.mjs`), so two of them at once take twice what either was allowed, and the
 * timeouts each one measures by stop meaning anything. They also share `tmp`. So every way one of
 * them starts takes this lock first, and a second job is refused with the first one's name.
 *
 * The lock is a file created exclusively, so two jobs starting together cannot both take it. It
 * names the process holding it. A holder is gone when no process has its id, or when the process
 * that has it started after the lock was written: a process id is reused, and a lock that outlived
 * its holder would otherwise be kept by whatever was handed the id next. A lock whose holder is
 * gone is taken over, and the takeover is reported.
 *
 * A job the holder starts runs under the holder's lock. The holder hands its children the lock's
 * token in `EQUATOR_HEAVY_JOB`, and a process that carries the token the file holds neither takes
 * the lock nor releases it. That is what lets the gate start a stage that would take the lock on its
 * own.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { readProcesses as readMachineProcesses } from './process-tree.mjs';
import { workingRoot } from './working-state.mjs';

export const HEAVY_JOB_VARIABLE = 'EQUATOR_HEAVY_JOB';
export const heavyJobLockPath = resolve(workingRoot, 'heavy-job.lock');

// A process's start time is read to the millisecond and the lock is written after the process
// began, so a holder always started before its lock. The slack is for two clocks read apart.
const START_SLACK_MS = 2_000;

const exists = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const readHolder = (path) => {
  try {
    const holder = JSON.parse(readFileSync(path, 'utf8'));
    return typeof holder === 'object' && holder !== null ? holder : undefined;
  } catch {
    // Unreadable or half-written: nobody can be named from it, so nobody holds it.
    return undefined;
  }
};

/** Whether the process a lock names is still the one that wrote it. */
export async function holderIsAlive(
  holder,
  { processExists = exists, readProcesses = readMachineProcesses } = {},
) {
  if (!Number.isInteger(holder?.pid) || !processExists(holder.pid)) {
    return false;
  }
  const taken = Date.parse(holder.startedAt);
  if (!Number.isFinite(taken)) return true;
  let listed;
  try {
    listed = (await readProcesses()).processes.find(
      ({ pid }) => pid === holder.pid,
    );
  } catch {
    // The machine could not be read. A process has the id, and refusing is the safe answer.
    return true;
  }
  if (listed === undefined) return false;
  if (listed.started === undefined) return true;
  return listed.started <= taken + START_SLACK_MS;
}

const describe = ({ job, pid, startedAt }) =>
  `${job ?? 'a job that did not name itself'} (process ${pid}, started ${startedAt})`;

/**
 * Takes the lock for `job`, or throws naming the job that holds it.
 *
 * Resolves to `{ release, environment, inherited, tookOver }`. `environment` is what a child the
 * job starts must be handed to run under this lock. `tookOver` describes a dead holder whose lock
 * was taken, and is undefined otherwise.
 */
export async function takeHeavyJobLock(
  job,
  {
    path = heavyJobLockPath,
    environment = process.env,
    pid = process.pid,
    processExists,
    readProcesses,
  } = {},
) {
  const carried = environment[HEAVY_JOB_VARIABLE];
  const current = readHolder(path);
  if (
    carried !== undefined &&
    carried !== '' &&
    current?.token === carried &&
    (await holderIsAlive(current, { processExists, readProcesses }))
  ) {
    return {
      inherited: true,
      tookOver: undefined,
      environment: { [HEAVY_JOB_VARIABLE]: carried },
      release: () => {},
    };
  }

  const token = randomUUID();
  const record = `${JSON.stringify({
    job,
    pid,
    startedAt: new Date().toISOString(),
    token,
  })}\n`;
  mkdirSync(dirname(path), { recursive: true });
  let tookOver;
  // Twice at most: once to find the lock held, once more after a dead holder's lock is removed.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, record, { flag: 'wx' });
      return {
        inherited: false,
        tookOver,
        environment: { [HEAVY_JOB_VARIABLE]: token },
        release: () => {
          // Only its own: a lock taken over from this job while it hung is the other job's.
          if (readHolder(path)?.token === token) rmSync(path, { force: true });
        },
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const holder = readHolder(path);
    if (
      holder !== undefined &&
      (await holderIsAlive(holder, { processExists, readProcesses }))
    ) {
      throw new Error(
        `A heavy job is already running: ${describe(holder)}. One at a time, because each takes the whole processor budget; wait for it, or end it. This was ${job}.`,
      );
    }
    tookOver =
      holder === undefined
        ? 'a lock nobody could be named from'
        : describe(holder);
    rmSync(path, { force: true });
  }
  throw new Error(
    `The heavy-job lock at ${path} was taken by another job while this one was taking over a dead holder's. This was ${job}.`,
  );
}

/** Takes the lock for the life of this process, and says so when it took over a dead holder's. */
export async function holdHeavyJobLock(job, options) {
  const lock = await takeHeavyJobLock(job, options);
  if (lock.tookOver !== undefined) {
    process.stdout.write(
      `=== LOCK taken over from ${lock.tookOver}, which is no longer running\n`,
    );
  }
  process.on('exit', lock.release);
  return lock;
}
