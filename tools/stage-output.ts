/**
 * A stage's output, read whole, and the moment the stage has ended.
 *
 * A stage has ended when every process it started has, not when its first process exits: a runner
 * that leaves a child writing after it returns is still running, and its output is still arriving.
 *
 * On Windows the stage writes to pipes. A pipe stays open while any process holds it, so its end
 * is that moment, and Windows writes to a pipe synchronously, so what a process writes before it
 * exits is in the pipe when it exits (`process`, "A note on process I/O").
 *
 * On Linux a pipe would keep the first rule and lose the second. Node writes to a pipe there
 * asynchronously, and a process that ends by throwing exits with its pending writes unwritten, so
 * the end of the message it printed, which is usually the part that names what failed, never
 * reaches the reader. A file is written synchronously on every platform, so on Linux the stage
 * writes to a file instead, and the moment it has ended is read as the moment no process holds that
 * file open, from each process's open descriptors under `/proc/<pid>/fd` (`proc_pid_fd(5)`): a
 * process that inherited the stage's output holds it, as it would hold the pipe, and one started
 * with output of its own does not. Windows has no documented way for a process to ask which
 * processes hold a file, which is why it keeps the pipe.
 */
import type { ChildProcess, StdioOptions } from 'node:child_process';
import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import type { Readable } from 'node:stream';

/** How often a stage whose first process has exited is read again for processes holding its output. */
const HOLDER_POLL_MILLISECONDS = 100;

/** The processes other than this one that hold `path` open, matched by device and inode. */
export function processesHolding(path: string): number[] {
  const { dev, ino } = statSync(path);
  const holders: number[] = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/u.test(name) || Number(name) === process.pid) continue;
    let descriptors: string[];
    try {
      descriptors = readdirSync(`/proc/${name}/fd`);
    } catch {
      // Ended while it was read, or not this user's to read.
      continue;
    }
    for (const descriptor of descriptors) {
      try {
        const target = statSync(`/proc/${name}/fd/${descriptor}`);
        if (target.dev === dev && target.ino === ino) {
          holders.push(Number(name));
          break;
        }
      } catch {
        // Closed while it was read.
      }
    }
  }
  return holders;
}

/** A started stage: its first process, its output once it has ended, and what still holds it. */
export interface CapturedStage {
  readonly child: ChildProcess;
  /** The exit code of the first process, or undefined where it was killed or never started. */
  readonly ended: Promise<{
    readonly code: number | undefined;
    readonly output: string;
  }>;
  /** The processes still writing the stage's output; empty where the platform cannot say. */
  readonly holders: () => number[];
}

/**
 * Starts a stage through `start`, which spawns it with the standard streams it is handed, and reads
 * its output until it has ended. `outputPath` is where the output is written on Linux; it is removed
 * once read.
 */
export function startCaptured(
  start: (stdio: StdioOptions) => ChildProcess,
  outputPath: string,
  platform: NodeJS.Platform = process.platform,
): CapturedStage {
  if (platform === 'linux') {
    const descriptor = openSync(outputPath, 'w');
    let child: ChildProcess;
    try {
      child = start(['ignore', descriptor, descriptor]);
    } finally {
      // Closed here once the child has its copies, so this process never counts as a holder.
      closeSync(descriptor);
    }
    let output: string | undefined;
    // Read once: an exit and an error can both be reported for one child.
    const read = () => {
      output ??= readFileSync(outputPath, 'utf8');
      rmSync(outputPath, { force: true });
      return output;
    };
    const ended = new Promise<{ code: number | undefined; output: string }>(
      (settle) => {
        child.once('error', (error) => {
          settle({ code: undefined, output: `${read()}${error.message}\n` });
        });
        child.once('exit', (code) => {
          const poll = () => {
            if (processesHolding(outputPath).length > 0) {
              setTimeout(poll, HOLDER_POLL_MILLISECONDS);
              return;
            }
            settle({ code: code ?? undefined, output: read() });
          };
          poll();
        });
      },
    );
    return { child, ended, holders: () => processesHolding(outputPath) };
  }
  const child = start(['ignore', 'pipe', 'pipe']);
  let output = '';
  const capture = (source: Readable | null): void => {
    source?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
  };
  capture(child.stdout);
  capture(child.stderr);
  const ended = new Promise<{ code: number | undefined; output: string }>(
    (settle) => {
      child.once('error', (error) => {
        settle({ code: undefined, output: `${output}${error.message}\n` });
      });
      child.once('close', (code) => {
        settle({ code: code ?? undefined, output });
      });
    },
  );
  return { child, ended, holders: () => [] };
}
