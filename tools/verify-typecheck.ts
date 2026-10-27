import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SpawnedText } from './spawned-text.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(workspaceRoot, 'tsconfig.typecheck.json');
const toolsRoot = resolve(workspaceRoot, 'tools');
const toolsConfigPath = resolve(toolsRoot, 'tsconfig.json');

/**
 * Typechecks every TypeScript file in the repository, including the ones no build reaches.
 *
 * *What a build does not check.* A build checks types only as a side effect: `ngc` compiles what
 * each entry point's `public-api.ts` imports, and `tsc -p tsconfig.build.json` compiles the
 * toolkit's `src`. Two categories fall outside every such program. Test files, all of them, because
 * vitest transpiles with esbuild, which strips types without checking them. And any module no entry
 * point reaches: `pnpm run build` reports success while such a file is in no program at all, which
 * from outside looks exactly like a file that compiled.
 *
 * *Why this is a script and not just a config.* A `tsconfig` cannot check that it covers the ground
 * it was written for, and that is the failure this script exists to prevent: a hand-written
 * `include` that passes every run while covering nothing new. So two things are derived from disk
 * here and compared against the config: the entry points, and the files the program actually
 * loaded. A new entry point, a new package, or a new test directory is covered on the day it lands,
 * and if the config stops reaching it this fails and names what it missed.
 *
 * *The tools.* `tools/` is a second program, `tools/tsconfig.json`, because it runs under Node's
 * module resolution and Node's types where the packages run under a bundler's and the DOM's. It is
 * held to the same rule: every `.ts` and `.cts` file in the folder is one the program loaded.
 */

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.equator',
  'tmp',
]);

/** What this reads of an entry point's `ng-package.json`. */
interface NgPackageDeclaration {
  readonly lib: { readonly entryFile: string };
}

/** Every `src` and `test` directory under `packages/`, at any depth. */
async function sourceRoots(from: string): Promise<string[]> {
  const roots: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.name === 'src' || entry.name === 'test') roots.push(path);
      await walk(path);
    }
  };
  await walk(from);
  return roots.sort();
}

/** Every `.ts` file under a root, excluding declaration files, which are not compiled units. */
async function typeScriptFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(path);
        continue;
      }
      if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(path);
      }
    }
  };
  await walk(root);
  return files;
}

/**
 * The published specifier every entry point answers to, and the file behind it.
 *
 * A secondary entry point imports the primary by its published name rather than by a relative path,
 * which is what keeps the shared core compiled into one bundle. `ng-packagr` resolves that during a
 * build; a bare `tsc` has to be told, and being told by hand is how the list rots. Each entry point
 * already declares its own `entryFile`, so the list is read from the same declarations the build
 * reads.
 */
async function entryPointPaths(): Promise<Map<string, string>> {
  const mappings = new Map<string, string>();
  for (const packageDirectory of await readdir(
    resolve(workspaceRoot, 'packages'),
    { withFileTypes: true },
  )) {
    if (!packageDirectory.isDirectory()) continue;
    const packageRoot = resolve(
      workspaceRoot,
      'packages',
      packageDirectory.name,
    );
    const manifest = JSON.parse(
      await readFile(resolve(packageRoot, 'package.json'), 'utf8'),
    ) as { readonly name: string };

    let sawEntryPoint = false;
    for (const root of [packageRoot, ...(await subdirectories(packageRoot))]) {
      const declaration = await readJson(resolve(root, 'ng-package.json'));
      if (declaration === undefined) continue;
      sawEntryPoint = true;
      const subpath = relative(packageRoot, root).replaceAll('\\', '/');
      const specifier =
        subpath === '' ? manifest.name : `${manifest.name}/${subpath}`;
      mappings.set(
        specifier,
        `./${relative(workspaceRoot, resolve(root, declaration.lib.entryFile)).replaceAll('\\', '/')}`,
      );
    }

    // A package that declares no Angular entry points still publishes one module, and the toolkit
    // is that package. Its entry is the file its build config takes as `rootDir`'s index.
    if (!sawEntryPoint) {
      mappings.set(
        manifest.name,
        `./${relative(workspaceRoot, resolve(packageRoot, 'src/index.ts')).replaceAll('\\', '/')}`,
      );
    }
  }
  return mappings;
}

async function subdirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name),
    )
    .map((entry) => resolve(root, entry.name));
}

async function readJson(
  path: string,
): Promise<NgPackageDeclaration | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as NgPackageDeclaration;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

const configuration = JSON.parse(readFileSync(configPath, 'utf8')) as {
  readonly compilerOptions: {
    readonly paths?: Readonly<Record<string, readonly string[]>>;
  };
};

// 1. The entry points the config maps are exactly the ones on disk.
const expected = await entryPointPaths();
const declared = new Map(
  Object.entries(configuration.compilerOptions.paths ?? {}).map(
    ([specifier, targets]) => [specifier, targets[0]],
  ),
);
const expectedText = JSON.stringify(
  Object.fromEntries([...expected].sort()),
  null,
  2,
);
assert.equal(
  JSON.stringify(Object.fromEntries([...declared].sort()), null, 2),
  expectedText,
  `tsconfig.typecheck.json no longer maps the entry points that exist. An unmapped entry point ` +
    `does not fail to resolve quietly: it produces a cascade of unrelated errors in every file ` +
    `that imports it. Set "compilerOptions.paths" to:\n${expectedText}\n`,
);

// 2. The program loads every file under every derived root.
const roots = await sourceRoots(resolve(workspaceRoot, 'packages'));
assert.ok(
  roots.length > 0,
  'No src or test directory was found under packages/, which cannot be right: the walk is broken.',
);

/** One program's run: what it printed, the files it loaded, and its exit status. */
function compile(project: string) {
  const run: SpawnedText = spawnSync(
    process.execPath,
    [
      resolve(workspaceRoot, 'node_modules/typescript/bin/tsc'),
      '-p',
      project,
      '--noEmit',
      '--listFiles',
      '--pretty',
      'false',
    ],
    { cwd: workspaceRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const printed = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return {
    printed,
    status: run.status,
    files: new Set(
      printed
        .split(/\r?\n/u)
        .filter((line) => /\.(?:ts|tsx|cts|mts)$/u.test(line))
        .map((line) => resolve(workspaceRoot, line.trim())),
    ),
  };
}

const packagesRun = compile(configPath);
const loaded = packagesRun.files;

const missing: string[] = [];
for (const root of roots) {
  for (const file of await typeScriptFiles(root)) {
    if (!loaded.has(resolve(file))) missing.push(relative(workspaceRoot, file));
  }
}
assert.deepEqual(
  missing,
  [],
  `The typecheck program did not load ${missing.length} file(s) that exist under packages/. This ` +
    `is the failure this check exists for: a file outside every program compiles by not being ` +
    `compiled, and reads from outside exactly like one that passed. Widen "include" in ` +
    `tsconfig.typecheck.json until this is empty.\n  ${missing.join('\n  ')}\n`,
);

// 3. The tools' program loads every file in the folder.
const toolFiles = (await readdir(toolsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.c?ts$/u.test(entry.name))
  .map((entry) => resolve(toolsRoot, entry.name));
assert.ok(
  toolFiles.length > 0,
  'No .ts or .cts file was found in tools/, which cannot be right: the listing is broken.',
);
const toolsRun = compile(toolsConfigPath);
const toolsMissing = toolFiles
  .filter((file) => !toolsRun.files.has(file))
  .map((file) => relative(workspaceRoot, file));
assert.deepEqual(
  toolsMissing,
  [],
  `The tools' program did not load ${toolsMissing.length} file(s) in tools/. Widen "include" in ` +
    `tools/tsconfig.json until this is empty.\n  ${toolsMissing.join('\n  ')}\n`,
);

// 4. And the types themselves, in both programs.
const diagnostics = [packagesRun, toolsRun].flatMap(({ printed }) =>
  printed.split(/\r?\n/u).filter((line) => /error TS\d+:/u.test(line)),
);
if (
  diagnostics.length > 0 ||
  packagesRun.status !== 0 ||
  toolsRun.status !== 0
) {
  process.stderr.write(
    `${diagnostics.join('\n')}\n\nEquator typecheck failed with ${diagnostics.length} error(s).\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Equator typecheck verified: ${loaded.size} files loaded across ${roots.length} source roots, ` +
    `${expected.size} entry points mapped, ${toolFiles.length} tools loaded, no type errors.\n`,
);
