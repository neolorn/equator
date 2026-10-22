/**
 * The processes under one process, with each one's priority and the CPU time it has used.
 *
 * The gate starts each stage at a priority and relies on every process the stage starts inheriting
 * it, which Windows does for a parent at below-normal or idle priority when the child is created
 * without a priority class of its own (`CreateProcess`, `dwCreationFlags`), and which Linux does
 * for a nice value across `fork` and `execve` (`setpriority(2)`). A child can still set its own,
 * so the gate reads the whole tree while it runs rather than trusting the rule: a process above its
 * stage's priority is a finding, and so is a stretch of time in which the tree used more processors
 * than its budget.
 *
 * One reading is a list; the rate comes from two. A process that starts and ends between two
 * readings is not seen at all, so the processors a window reports are a floor, never an
 * overestimate.
 */
import { execFile } from 'node:child_process';
import { constants, setPriority } from 'node:os';

/** Runs a reader and answers its output with its own process id, so a caller can leave it out. */
const runFile = (file, args) =>
  new Promise((settle, reject) => {
    const child = execFile(
      file,
      args,
      { maxBuffer: 1 << 26, windowsHide: true, timeout: 60_000 },
      (error, stdout) =>
        error ? reject(error) : settle({ stdout, reader: child.pid }),
    );
  });

/** `[[dd-]hh:]mm:ss`, as `ps` prints `time`, in seconds. */
export const psSeconds = (text) => {
  const [days, clock] = text.includes('-') ? text.split('-') : ['0', text];
  return (
    clock
      .split(':')
      .map(Number)
      .reduce((total, part) => total * 60 + part, 0) +
    Number(days) * 86_400
  );
};

/**
 * Every process on the machine, `{ pid, ppid, priority, cpuSeconds, started? }`, and the process id
 * of the reader that listed them. `started` is the start time in milliseconds, read on Windows only,
 * where a parent process id can name a process that is not the parent (see `descendantsOf`).
 */
export async function readProcesses() {
  if (process.platform === 'win32') {
    const { stdout: csv, reader } = await runFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { $started = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null }; "$($_.ProcessId),$($_.ParentProcessId),$($_.Priority),$($_.KernelModeTime),$($_.UserModeTime),$started" }',
    ]);
    const processes = csv
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [pid, ppid, priority, kernel, user, started] = line.split(',');
        return {
          pid: Number(pid),
          ppid: Number(ppid),
          priority: Number(priority),
          // Kernel and user time are reported in 100-nanosecond units.
          cpuSeconds: (Number(kernel) + Number(user)) / 1e7,
          ...(started === '' ? {} : { started: Number(started) }),
        };
      });
    return { processes, reader };
  }
  const { stdout: text, reader } = await runFile('ps', [
    '-A',
    '-o',
    'pid=,ppid=,nice=,time=',
  ]);
  const processes = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [pid, ppid, nice, time] = line.trim().split(/\s+/u);
      // A nice value runs the other way to a priority, so it is negated to compare the same way.
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        priority: -Number(nice),
        cpuSeconds: psSeconds(time),
      };
    });
  return { processes, reader };
}

/**
 * The descendants of `root` in a reading, not counting `root` itself or anything in `exclude`.
 *
 * Windows keeps a process's parent id after the parent exits, and a later process can be given
 * that id, so a process can name one that started after it as its parent (`Win32_Process`,
 * `ParentProcessId`). A child that started before the process it names is not that process's child,
 * and is left out. Without that, a system process whose boot-time parent id was reused by a gate
 * process is read as running under the gate. POSIX gives an orphan a system process as its parent
 * (`_exit`), so a reading without start times cannot name a parent that is not one.
 */
export function descendantsOf(processes, root, exclude = new Set()) {
  const children = new Map();
  for (const entry of processes) {
    if (!children.has(entry.ppid)) children.set(entry.ppid, []);
    children.get(entry.ppid).push(entry);
  }
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const childrenOf = (parent) =>
    (children.get(parent) ?? []).filter(
      (child) =>
        byPid.get(parent)?.started === undefined ||
        child.started === undefined ||
        child.started >= byPid.get(parent).started,
    );
  const found = [];
  const queue = [...childrenOf(root)];
  const seen = new Set([root]);
  while (queue.length > 0) {
    const entry = queue.shift();
    if (seen.has(entry.pid)) continue;
    seen.add(entry.pid);
    if (exclude.has(entry.pid)) continue;
    found.push(entry);
    queue.push(...childrenOf(entry.pid));
  }
  return found;
}

/**
 * The processors a tree used between two readings of it.
 *
 * A process in both readings contributes the CPU time it used in between. A process only in the
 * later one started inside the window, so all of its time falls in it.
 */
export function processorsBetween(earlier, later, seconds) {
  const before = new Map(earlier.map((entry) => [entry.pid, entry.cpuSeconds]));
  let used = 0;
  for (const entry of later) {
    used += Math.max(0, entry.cpuSeconds - (before.get(entry.pid) ?? 0));
  }
  return used / seconds;
}

/**
 * Lowers each process in `above` to `priority`, and answers what that could not hold down.
 *
 * A browser engine sets the priority class of some of its own processes above the one they
 * inherited: under a below-normal parent, Chromium starts one child at 10 and Firefox six at 8,
 * where WebKit keeps the inherited 6. A job object can hold a priority class over every process in
 * it, but only for a caller with a privilege an ordinary account does not have
 * (`JOBOBJECT_BASIC_LIMIT_INFORMATION`, `PriorityClass`), so each one is lowered when a reading
 * finds it. A process that cannot be lowered, or that is found above again after it was, is not
 * held by that, and is a finding. One that ended between the reading and the call is not.
 * `lowered` carries what was lowered from one reading to the next, keyed by start time as well as
 * id, since an id can be given to a new process.
 */
export function holdDown(above, priority, lowered, set) {
  const findings = [];
  for (const entry of above) {
    const key = `${entry.pid}@${entry.started ?? ''}`;
    if (lowered.has(key)) {
      findings.push(
        `process ${entry.pid} under the gate is at priority ${entry.priority} again after the gate lowered it`,
      );
      continue;
    }
    try {
      set(entry.pid, priority);
      lowered.add(key);
    } catch (error) {
      // Ended between the reading and the call, so nothing is left running above the stage.
      if (error.info?.code === 'ESRCH') continue;
      findings.push(
        `process ${entry.pid} under the gate runs at priority ${entry.priority}, above its stage's, and could not be lowered: ${error.message}`,
      );
    }
  }
  return findings;
}

/**
 * Raises each process of `tree` that runs below `floor` to `priority`, and answers how many it
 * raised. `floor` is in the reading's own units (`levelInReading`).
 *
 * A process that cannot be raised is left where it is and is not a finding: one that has ended
 * between the reading and the call, and, off Windows, any process at all, since a process without
 * privilege cannot take back a priority (`setpriority(2)`, `EACCES`). A run lifted to normal
 * priority loses nothing it was promised by a process that stays below it.
 */
export function liftUp(tree, floor, priority, set) {
  let raised = 0;
  for (const entry of tree) {
    if (entry.priority >= floor) continue;
    try {
      set(entry.pid, priority);
      raised += 1;
    } catch {
      // Left below: see above.
    }
  }
  return raised;
}

/** A level as `os.setPriority` takes it and `os.getPriority` answers it. */
export const levelForSystem = (level) =>
  level === 'normal'
    ? constants.priority.PRIORITY_NORMAL
    : constants.priority.PRIORITY_BELOW_NORMAL;

/**
 * A level in a reading's own units: the base priority Windows gives a thread of normal priority in
 * that class (8 in the normal class, 6 in the below-normal one), or a negated nice value.
 */
export const levelInReading = (level, platform = process.platform) =>
  platform === 'win32'
    ? level === 'normal'
      ? 8
      : 6
    : 0 - levelForSystem(level);

/**
 * Starts a stage at `level`; `start` creates its first process and answers it.
 *
 * On Windows the gate runs below normal and a child created without a class of its own takes its
 * parent's, so a stage below normal inherits, and for a normal stage the gate stands at normal for
 * the length of the start. Elsewhere a process without privilege can lower a priority and never
 * raise one again (`setpriority(2)`, `EACCES`), its own included, so the gate keeps the priority it
 * was started with and lowers a below-normal stage's first process as soon as it exists. That
 * process has not run long enough to start another by then, and one that had would be found and
 * lowered by the next reading of the tree.
 */
export function startAtPriority(
  level,
  start,
  { platform = process.platform, set = setPriority } = {},
) {
  if (platform === 'win32') {
    if (level !== 'normal') return start();
    set(levelForSystem('normal'));
    try {
      return start();
    } finally {
      set(levelForSystem('below-normal'));
    }
  }
  const child = start();
  if (level !== 'normal' && child?.pid !== undefined) {
    set(child.pid, levelForSystem(level));
  }
  return child;
}

/**
 * The processes under `root` that run above `ceiling`, which is in the reading's own units
 * (`levelInReading`). Undefined when `root` is not in the reading, which the caller treats as a
 * failed reading rather than a clean one.
 */
export function aboveLevel(processes, root, ceiling, exclude = new Set()) {
  if (!processes.some(({ pid }) => pid === root)) return undefined;
  return descendantsOf(processes, root, exclude).filter(
    (entry) => entry.priority > ceiling,
  );
}
