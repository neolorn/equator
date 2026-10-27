/**
 * The portable Node builds `stage:node-runtimes` extracts, found and proven to be the version asked
 * for.
 *
 * Shared because two kinds of row run on them: the compatibility rows, which load the built
 * packages on every Node line, and the consumer rows on a Node other than the development one. A
 * second copy of where a build lives would be a second place for the two to disagree about it.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const nodeRoot = resolve(
  process.env['EQUATOR_NODE_COMPATIBILITY_ROOT'] ??
    resolve(workspaceRoot, '.runtimes/node'),
);

/** The variable that names one version's executable outright, in place of the staged build. */
export const nodeExecutableVariable = (version: string): string =>
  `EQUATOR_NODE_${version.replaceAll('.', '_')}_EXECUTABLE`;

function platformLayout(version: string) {
  const executable = process.platform === 'win32' ? 'node.exe' : 'bin/node';
  const distributionPlatform =
    process.platform === 'win32'
      ? 'win'
      : process.platform === 'darwin'
        ? 'darwin'
        : process.platform;
  const distribution = `node-v${version}-${distributionPlatform}-${process.arch}`;
  return Object.freeze({ executable, distribution });
}

function candidatesFor(version: string): readonly string[] {
  const explicit = process.env[nodeExecutableVariable(version)];
  if (explicit !== undefined && explicit.trim() !== '') {
    return Object.freeze([resolve(explicit)]);
  }
  const layout = platformLayout(version);
  return Object.freeze([
    resolve(nodeRoot, version, layout.executable),
    resolve(nodeRoot, `v${version}`, layout.executable),
    resolve(nodeRoot, layout.distribution, layout.executable),
    resolve(nodeRoot, version, layout.distribution, layout.executable),
  ]);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException | null | undefined)?.code === 'ENOENT' ||
      (error as NodeJS.ErrnoException | null | undefined)?.code === 'ENOTDIR'
    )
      return false;
    throw error;
  }
}

export function describeSpawnFailure(result: SpawnSyncReturns<string>): string {
  if (result.error !== undefined) return result.error.message;
  if (result.signal !== null) return `terminated by signal ${result.signal}`;
  return (result.stderr || result.stdout || `exit ${result.status}`).trim();
}

/**
 * The executable for one Node version, or why there is none.
 *
 * The executable is run and asked its version, because a file at the expected path is a claim
 * about what it is and the version it reports is the fact.
 */
/** Where one Node version's executable is, or why it could not be used. */
export type NodeLocation =
  | { readonly executable: string; readonly failure?: undefined }
  | { readonly failure: string; readonly executable?: undefined };

export async function locateNode(
  version: string,
  label: string,
): Promise<NodeLocation> {
  const candidates = candidatesFor(version);
  let executable: string | undefined;
  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      executable = await realpath(candidate);
      break;
    }
  }
  if (executable === undefined) {
    const layout = platformLayout(version);
    return {
      failure: [
        `Missing Node.js ${version} (${label}).`,
        `Looked for:`,
        ...candidates.map((candidate) => `  ${candidate}`),
        '`pnpm run stage:node-runtimes` downloads the official archive for every row,',
        `checks it against nodejs.org's published digest and extracts it under`,
        `${nodeRoot}: this one as ${layout.distribution}. Or set`,
        `${nodeExecutableVariable(version)} to that row's exact Node executable.`,
      ].join('\n'),
    };
  }
  const probe = spawnSync(
    executable,
    ['--eval', 'process.stdout.write(process.versions.node)'],
    {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
      timeout: 120_000,
      windowsHide: true,
    },
  );
  if (
    probe.status !== 0 ||
    probe.error !== undefined ||
    probe.signal !== null
  ) {
    return {
      failure: `Could not run ${label} at ${executable}: ${describeSpawnFailure(probe)}`,
    };
  }
  const actualVersion = probe.stdout.trim();
  if (actualVersion !== version) {
    return {
      failure: `${label} resolved to ${executable}, but it reports Node.js ${actualVersion}; expected exactly ${version}.`,
    };
  }
  return { executable };
}

/**
 * An environment whose `node` is the one at `executable`.
 *
 * A package's command shims run whatever `node` the search path finds first, so a Node that is only
 * the parent process's would leave every tool the row starts on the machine's own Node. Windows
 * spells the variable in any case, so the one already present is the one prefixed.
 */
export function withNodeFirst(
  env: NodeJS.ProcessEnv,
  executable: string,
): NodeJS.ProcessEnv {
  const key =
    Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  const rest = env[key];
  return {
    ...env,
    [key]:
      rest === undefined || rest === ''
        ? dirname(executable)
        : `${dirname(executable)}${delimiter}${rest}`,
  };
}
