import type { SpawnSyncReturns } from 'node:child_process';

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
