import {
  spawnSync,
  type SpawnSyncOptions,
  type SpawnSyncReturns,
} from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * What `spawnSync` hands back as text, as it is rather than as declared.
 *
 * A child that never starts, such as a command that is not on the path or a working directory that
 * does not exist, leaves both streams unset and puts the reason in `error`. The declared result
 * says both streams are always strings, so a reader written against it prints `undefined` where
 * the reason should be.
 */
export type SpawnedText = Omit<
  SpawnSyncReturns<string>,
  'stderr' | 'stdout'
> & {
  readonly stderr: string | null | undefined;
  readonly stdout: string | null | undefined;
};

/** Everything a child printed, and why it never started when it did not. */
export function spawnedOutput(result: SpawnedText): string {
  const reason =
    result.error === undefined ? '' : `\n${String(result.error)}\n`;
  return `${result.stdout ?? ''}${result.stderr ?? ''}${reason}`;
}

/**
 * `spawnSync` with the child's output written to files and read back, for a reader that decides
 * something from what the child printed.
 *
 * On Linux and macOS a Node process writes to a pipe asynchronously, and one that ends on an
 * uncaught exception exits with the rest of its message unwritten, so a reader of the pipe gets the
 * message cut short. Writes to a file are synchronous on every system (nodejs.org/api/process.html,
 * "A note on process I/O"), so the whole message arrives on each. The consumer gate fails with its
 * child's whole output in the assertion, and a Linux reader of the pipe lost the half that named
 * the failed test.
 */
export function spawnSyncToFiles(
  command: string,
  args: readonly string[],
  options: Omit<SpawnSyncOptions, 'encoding' | 'maxBuffer' | 'stdio'> = {},
): SpawnedText {
  const directory = mkdtempSync(join(tmpdir(), 'equator-output-'));
  try {
    const stdoutPath = join(directory, 'stdout');
    const stderrPath = join(directory, 'stderr');
    const stdout = openSync(stdoutPath, 'w');
    const stderr = openSync(stderrPath, 'w');
    let result: SpawnSyncReturns<Buffer>;
    try {
      result = spawnSync(command, args, {
        ...options,
        stdio: ['ignore', stdout, stderr],
      });
    } finally {
      closeSync(stdout);
      closeSync(stderr);
    }
    return {
      ...result,
      output: [],
      stdout: readFileSync(stdoutPath, 'utf8'),
      stderr: readFileSync(stderrPath, 'utf8'),
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
