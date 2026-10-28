/**
 * The declared Node range, run rather than declared.
 *
 * `specs/01-standards-profile.spec.md` section 6 requires correctness-bearing behavior not to vary
 * between supported runtimes, and an engines range in a manifest is a claim about that, not
 * evidence of it. The suites run on each end of the range, so both bounds of what the manifest
 * admits have been executed.
 */
import assert from 'node:assert/strict';
import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeSpawnFailure, locateNode, nodeRoot } from './node-runtimes.ts';
import {
  compareVersions,
  developmentNode,
  nodeFloors,
  nodeRange,
} from './supported-versions.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rowWorker = resolve(
  workspaceRoot,
  'tools/verify-node-compatibility-row.ts',
);
/**
 * A row per Node line the manifests admit, at the bottom of each, plus the one this repository
 * develops on.
 *
 * Derived rather than listed. The engines range is what a consumer installs against, so a row list
 * written out beside it is a second claim about the same thing, and the failure it hides is the
 * quiet one: a raised floor with a row still proving the old one.
 *
 * The development row is skipped when it is already a floor, so the set stays one row per version
 * whatever `.node-version` says.
 */
const rows = Object.freeze(
  [
    ...nodeFloors.map((version) => ({
      id: `node-${version.split('.')[0]}-minimum`,
      version,
    })),
    ...(nodeFloors.includes(developmentNode)
      ? []
      : [{ id: 'development-reference', version: developmentNode }]),
  ]
    .sort((left, right) => compareVersions(left.version, right.version))
    .map((row) => Object.freeze(row)),
);

const isWithin = (candidate: string, owner: string): boolean => {
  const path = relative(owner, candidate);
  return (
    path === '' ||
    (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  );
};

/** The fields of a built manifest that this verifier reads. */
interface BuiltManifest {
  readonly name?: unknown;
  readonly engines?: { readonly node?: unknown };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** The evidence line one row worker prints, as this verifier reads it. */
interface RowRecord {
  readonly profile: unknown;
  readonly row: unknown;
  readonly node: unknown;
  readonly platform: unknown;
  readonly architecture: unknown;
  readonly runtimeEntrypoints: readonly unknown[];
  readonly formatting: {
    readonly profile: unknown;
    readonly [key: string]: unknown;
  };
  readonly toolkitWorkflow: {
    readonly profile: unknown;
    readonly initialGenerate: unknown;
    readonly repeatedGenerate: unknown;
    readonly repeatedCheck: unknown;
    readonly generatedFiles: number;
    readonly generatedBytes: number;
  };
}

/** The same line before the checks below have found its two evidence objects in it. */
type PrintedRowRecord = Omit<RowRecord, 'formatting' | 'toolkitWorkflow'> & {
  readonly formatting?: RowRecord['formatting'];
  readonly toolkitWorkflow?: RowRecord['toolkitWorkflow'];
};

const readJson = async (path: string): Promise<BuiltManifest> =>
  JSON.parse(await readFile(path, 'utf8')) as BuiltManifest;

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

function spawnOptions(): SpawnSyncOptionsWithStringEncoding {
  return {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      NODE_PATH: '',
      NO_COLOR: '1',
    },
    maxBuffer: 1_048_576,
    timeout: 120_000,
    windowsHide: true,
  };
}

async function locateRows() {
  const located: ((typeof rows)[number] & { readonly executable: string })[] =
    [];
  const failures: string[] = [];
  for (const row of rows) {
    const { executable, failure } = await locateNode(row.version, row.id);
    if (failure !== undefined) {
      failures.push(failure);
      continue;
    }
    located.push(Object.freeze({ ...row, executable }));
  }
  if (failures.length > 0) {
    throw new Error(
      `Portable Node compatibility rows are incomplete. No downloads are performed by this verifier. Set EQUATOR_NODE_COMPATIBILITY_ROOT to use a different portable-runtime root.\n\n${failures.join('\n\n')}`,
    );
  }
  return Object.freeze(located);
}

async function dependencySource(specifier: string): Promise<string> {
  const segments = specifier.split('/');
  const candidates = [
    resolve(workspaceRoot, 'packages/toolkit/node_modules', ...segments),
    resolve(workspaceRoot, 'packages/runtime/node_modules', ...segments),
    resolve(workspaceRoot, 'node_modules', ...segments),
  ];
  for (const candidate of candidates) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException | null | undefined)?.code !==
          'ENOENT' &&
        (error as NodeJS.ErrnoException | null | undefined)?.code !== 'ENOTDIR'
      )
        throw error;
    }
  }
  throw new Error(
    `Installed dependency ${specifier} is missing. Run the repository's locked pnpm install before compatibility verification.`,
  );
}

async function createHarness(
  runtimeManifest: BuiltManifest,
  toolkitManifest: BuiltManifest,
): Promise<string> {
  await mkdir(nodeRoot, { recursive: true });
  const harnessRoot = await mkdtemp(
    resolve(nodeRoot, '.node-compatibility-harness-'),
  );
  try {
    const nodeModules = resolve(harnessRoot, 'node_modules');
    const scopeRoot = resolve(nodeModules, '@neolorn');
    await mkdir(scopeRoot, { recursive: true });
    await cp(
      resolve(workspaceRoot, 'dist/runtime'),
      resolve(scopeRoot, 'equator'),
      {
        recursive: true,
      },
    );
    await cp(
      resolve(workspaceRoot, 'dist/toolkit'),
      resolve(scopeRoot, 'equator-toolkit'),
      { recursive: true },
    );

    const dependencies = new Set([
      ...Object.keys(runtimeManifest.dependencies ?? {}),
      ...Object.keys(runtimeManifest.peerDependencies ?? {}),
      ...Object.keys(toolkitManifest.dependencies ?? {}),
      ...Object.keys(toolkitManifest.peerDependencies ?? {}),
    ]);
    for (const specifier of [...dependencies].sort()) {
      const destination = resolve(nodeModules, ...specifier.split('/'));
      await mkdir(dirname(destination), { recursive: true });
      await symlink(
        await dependencySource(specifier),
        destination,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    return harnessRoot;
  } catch (error) {
    await rm(harnessRoot, { recursive: true, force: true });
    throw error;
  }
}

async function verifyBuiltInputs() {
  const runtimeManifestPath = resolve(
    workspaceRoot,
    'dist/runtime/package.json',
  );
  const toolkitManifestPath = resolve(
    workspaceRoot,
    'dist/toolkit/package.json',
  );
  if (
    !(await isFile(runtimeManifestPath)) ||
    !(await isFile(toolkitManifestPath))
  ) {
    throw new Error(
      'Built Equator packages are missing. Run `pnpm run build` before Node compatibility verification.',
    );
  }
  const runtimeManifest = await readJson(runtimeManifestPath);
  const toolkitManifest = await readJson(toolkitManifestPath);
  assert.equal(runtimeManifest.name, '@neolorn/equator');
  assert.equal(toolkitManifest.name, '@neolorn/equator-toolkit');
  // What shipped against what the packages declare. The range itself is not restated here: it is
  // read from the source manifests, so this compares the build to its own declaration.
  assert.equal(runtimeManifest.engines?.node, nodeRange);
  assert.equal(toolkitManifest.engines?.node, nodeRange);
  return Object.freeze({ runtimeManifest, toolkitManifest });
}

async function main() {
  const manifests = await verifyBuiltInputs();
  const locatedRows = await locateRows();
  let harnessRoot: string | undefined;
  try {
    harnessRoot = await createHarness(
      manifests.runtimeManifest,
      manifests.toolkitManifest,
    );
    const evidence: RowRecord[] = [];
    const formattingByRow = new Map<string, RowRecord['formatting']>();
    for (const row of locatedRows) {
      const result = spawnSync(
        row.executable,
        [
          rowWorker,
          '--expected-version',
          row.version,
          '--harness-root',
          harnessRoot,
          '--row',
          row.id,
        ],
        spawnOptions(),
      );
      if (
        result.status !== 0 ||
        result.error !== undefined ||
        result.signal !== null
      ) {
        throw new Error(
          `${row.id} (${row.version}) failed: ${describeSpawnFailure(result)}`,
        );
      }
      const recordLine = result.stdout
        .split(/\r?\n/u)
        .find((line) => line.startsWith('EQUATOR_NODE_ROW '));
      assert.notEqual(
        recordLine,
        undefined,
        `${row.id} did not emit compatibility evidence`,
      );
      const record = JSON.parse(
        (recordLine as string).slice('EQUATOR_NODE_ROW '.length),
      ) as PrintedRowRecord;
      assert.equal(record.profile, 'equator-node-compatibility/1');
      assert.equal(record.row, row.id);
      assert.equal(record.node, row.version);
      assert.equal(
        record.formatting?.profile,
        'equator-node-localized-output/1',
        `${row.id} produced no localized output evidence`,
      );
      formattingByRow.set(row.id, record.formatting);
      assert.equal(
        record.toolkitWorkflow?.profile,
        'equator-node-toolkit-workflow/1',
      );
      assert.equal(record.toolkitWorkflow.initialGenerate, 'changed');
      assert.equal(
        record.toolkitWorkflow.repeatedGenerate,
        'unchanged-deterministic',
      );
      assert.equal(
        record.toolkitWorkflow.repeatedCheck,
        'fresh-deterministic-read-only',
      );
      assert.ok(
        Number.isSafeInteger(record.toolkitWorkflow.generatedFiles) &&
          record.toolkitWorkflow.generatedFiles > 0,
        `${row.id} did not report bounded generated-file evidence`,
      );
      assert.ok(
        Number.isSafeInteger(record.toolkitWorkflow.generatedBytes) &&
          record.toolkitWorkflow.generatedBytes > 0,
        `${row.id} did not report bounded generated-byte evidence`,
      );
      evidence.push(record as RowRecord);
    }

    // The comparison the matrix exists for. Server and client must not diverge in locale or
    // formatting, and a build that prerenders on one Node major while a server renders on another
    // is exactly that situation.
    const [referenceRow, referenceFormatting] = ([...formattingByRow][0] ??
      []) as readonly [string | undefined, RowRecord['formatting']];
    assert.notEqual(
      referenceFormatting,
      undefined,
      'No row produced localized output evidence',
    );
    for (const [rowId, formatting] of formattingByRow) {
      if (rowId === referenceRow) continue;
      const differences = Object.keys(referenceFormatting)
        .filter(
          (key) =>
            JSON.stringify(formatting[key]) !==
            JSON.stringify(referenceFormatting[key]),
        )
        .map(
          (key) =>
            `  ${key}: ${referenceRow} produced ${JSON.stringify(referenceFormatting[key])}, ${rowId} produced ${JSON.stringify(formatting[key])}`,
        );
      assert.equal(
        differences.length,
        0,
        `Localized output differs across supported Node rows:\n${differences.join('\n')}`,
      );
    }

    process.stdout.write('Equator built-package Node compatibility:\n');
    for (const row of evidence) {
      process.stdout.write(
        `  ${row.row} ${row.node} (${row.platform}/${row.architecture}) - runtime ${row.runtimeEntrypoints.length} entry point(s), toolkit API, host admission, CLI help, identical ar-EG and en-US output, generate changed->stable, check fresh (${row.toolkitWorkflow.generatedFiles} files/${row.toolkitWorkflow.generatedBytes} bytes)\n`,
      );
    }
  } finally {
    if (harnessRoot !== undefined) {
      const resolvedHarness = resolve(harnessRoot);
      assert.ok(
        isWithin(resolvedHarness, nodeRoot) &&
          dirname(resolvedHarness) === nodeRoot &&
          resolvedHarness
            .slice(nodeRoot.length + 1)
            .startsWith('.node-compatibility-harness-'),
        `Refusing to remove unexpected harness path ${resolvedHarness}`,
      );
      await rm(resolvedHarness, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `Equator Node compatibility verification failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
