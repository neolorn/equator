import { Readable } from 'node:stream';

import { vi } from 'vitest';

/**
 * Runs the `equator` executable in this process, as the installed binary would run it, and returns
 * what it wrote to each stream and the exit code it set.
 *
 * The executable runs its command when it loads, so each run is a fresh evaluation of `cli.ts`
 * after the module registry is reset. It reads its version from a `package.json` beside itself,
 * which only the built package has, so that one read is answered here and every other read goes to
 * the disk.
 */
export interface CliRun {
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliRunOptions {
  /** Whether standard input and standard error claim to be a terminal. */
  readonly terminal?: boolean;
  /** Lines standard input carries, one per prompt. */
  readonly input?: readonly string[];
}

export async function runCli(
  arguments_: readonly string[],
  options: CliRunOptions = {},
): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const argv = process.argv;
  const exitCode = process.exitCode;
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const stderrTerminal = process.stderr.isTTY;
  const stdoutTerminal = process.stdout.isTTY;

  vi.resetModules();
  vi.doMock('node:fs/promises', async (original) => {
    const actual = await original<typeof import('node:fs/promises')>();
    return {
      ...actual,
      readFile: ((path: unknown, ...rest: unknown[]) =>
        path instanceof URL && path.pathname.endsWith('/src/package.json')
          ? Promise.resolve('{"version":"0.0.0-test"}')
          : Reflect.apply(actual.readFile, actual, [path, ...rest])) as never,
    };
  });

  const capture =
    (into: string[]) =>
    (chunk: unknown): boolean => {
      into.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    };
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(capture(stdout) as never);
  const errSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(capture(stderr) as never);

  const terminal = options.terminal ?? false;
  const input = Readable.from(
    (options.input ?? []).map((line) => `${line}\n`),
  ) as Readable & { isTTY?: boolean };
  input.isTTY = terminal;
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    get: () => input,
  });
  process.stderr.isTTY = terminal;
  process.stdout.isTTY = false;
  process.argv = [argv[0] ?? 'node', 'equator', ...arguments_];
  process.exitCode = undefined;
  try {
    await import('../src/cli.js');
    return {
      exitCode:
        typeof process.exitCode === 'number' ? process.exitCode : undefined,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  } finally {
    process.exitCode = exitCode;
    process.argv = argv;
    if (stdinDescriptor !== undefined) {
      Object.defineProperty(process, 'stdin', stdinDescriptor);
    }
    process.stderr.isTTY = stderrTerminal;
    process.stdout.isTTY = stdoutTerminal;
    outSpy.mockRestore();
    errSpy.mockRestore();
    vi.doUnmock('node:fs/promises');
  }
}
