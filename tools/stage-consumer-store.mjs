/**
 * Puts the consumer fixtures' packages in the pnpm store, so the gate can install them offline.
 *
 * The consumer stages install with `--offline --frozen-lockfile`, on purpose: a floating transitive
 * publishing upstream must not be able to change what a gate run means. That determinism has a
 * precondition: the store must already hold every package those lockfiles name.
 *
 * A machine that has never run `refresh:consumer-locks` does not meet it, and `pnpm install` at the
 * workspace root does not help: the workspace lock and the consumer locks are resolved separately,
 * so a transitive can sit at one version in the first and another in the second, a warm workspace
 * store is then a cold consumer store, and the error a run gets is
 * `ERR_PNPM_NO_OFFLINE_TARBALL` from inside a stage rather than a missing precondition named up
 * front.
 *
 * So the precondition is a command, beside `stage:node-runtimes`, which exists for the same reason:
 * a verifier that fetches its own subject can pass by fetching the wrong one, so the fetching is
 * separate and deliberate and the verifier stays offline.
 *
 * The lockfiles are found rather than listed. Every committed `pnpm-lock.yaml` under `fixtures/` is
 * one a consumer stage installs from, and a fixture added later is covered the day it lands.
 *
 * What this reports is what it imported, read back off disk, not what the lockfiles asked for. A
 * report of what the lockfiles asked for reads the same whether or not anything was imported.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stagingRoot = resolve(workspaceRoot, 'tmp/consumer-store');

const lockfiles = execFileSync(
  'git',
  ['ls-files', 'fixtures/**/pnpm-lock.yaml'],
  { cwd: workspaceRoot, encoding: 'utf8' },
)
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

// Rule: an empty list is not a result until the search is known to work. A `git ls-files` that
// matched nothing would report every consumer as already staged and hydrate nothing at all.
assert.ok(
  lockfiles.length >= 4,
  `Found ${lockfiles.length} committed fixture lockfiles, which is fewer than the four consumer rows this repository ships. The search is wrong, not the repository.`,
);

// The fixtures take Equator as a `file:` dependency on the built packages, and `pnpm fetch` reads
// a `file:` dependency's directory to list what it packs. Named here because the failure it
// otherwise gets is an I/O error from inside pnpm about a path this script never mentions.
for (const built of ['dist/runtime', 'dist/toolkit']) {
  assert.ok(
    existsSync(resolve(workspaceRoot, built, 'package.json')),
    `${built} is not built. The consumer lockfiles name the built packages, so run \`pnpm run build\` before \`pnpm run stage:consumer-store\`.`,
  );
}

const pnpm = (cwd, args) => {
  const win32 = process.platform === 'win32';
  return execFileSync(
    win32 ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm',
    win32 ? ['/d', '/s', '/c', 'pnpm', ...args] : args,
    { cwd, encoding: 'utf8', maxBuffer: 1 << 28 },
  );
};

/** A lockfile identifier without its peer suffix, which is the granularity the store is keyed on. */
const identify = (name, version) =>
  `${name.replaceAll("'", '')}@${version.replaceAll("'", '').replace(/\(.*$/u, '').trim()}`;

/**
 * What a lockfile requires: what the consumer depends on directly, and what each package depends
 * on in turn.
 *
 * Not every package in the file is one this machine needs. `packages:` carries `os`, `cpu` and
 * `libc` for the prebuilt binaries that exist per platform, and pnpm is right not to fetch the ones
 * this machine cannot run, nor anything reachable only through them, which is how a WASM fallback
 * and its five dependencies are absent from a Windows store and nothing is wrong. So this reads the
 * dependency edges rather than counting entries: what has to be in the store is what the packages
 * that were actually imported ask for, and a count would have to be a tolerance instead.
 */
const readLockfile = (text) => {
  const roots = new Set();
  const dependencies = new Map();
  const platformSpecific = new Set();
  const local = (version) =>
    /^(?:file|link):/u.test(version.replaceAll("'", ''));
  let section = '';
  let entry = '';
  let block = '';
  let depended = '';
  // The project's document only. pnpm writes the package manager a manifest pins as a document of
  // its own ahead of it, and that one describes pnpm's install, which no consumer's
  // `node_modules` holds.
  const project = text.split(/^---\r?$/mu).at(-1);
  for (const line of project.split('\n')) {
    if (/^\S/u.test(line)) {
      section = line.replace(/:.*$/u, '');
      entry = '';
      block = '';
      continue;
    }
    const opened = /^ {2}(\S+):$/u.exec(line);
    if (opened !== null) {
      entry = opened[1].replaceAll("'", '').replace(/\(.*$/u, '');
      block = '';
      continue;
    }
    const nested = /^ {4}(\S+):/u.exec(line);
    if (nested !== null) {
      block = nested[1];
      if (section === 'packages' && /^(?:os|cpu|libc)$/u.test(block)) {
        platformSpecific.add(entry);
      }
      continue;
    }
    const dependency = /^ {6}('[^']+'|[^\s:]+): *(.*)$/u.exec(line);
    if (dependency !== null) {
      depended = dependency[1];
      if (
        section === 'snapshots' &&
        /^(?:dependencies|optionalDependencies)$/u.test(block) &&
        !local(dependency[2])
      ) {
        const edges = dependencies.get(entry) ?? new Set();
        edges.add(identify(depended, dependency[2]));
        dependencies.set(entry, edges);
      }
      continue;
    }
    const version = /^ {8}version: (.+)$/u.exec(line);
    if (version !== null && section === 'importers' && !local(version[1])) {
      roots.add(identify(depended, version[1]));
    }
  }
  return { roots, dependencies, platformSpecific };
};

/**
 * The packages a fetch actually imported, by the name and version in each one's own manifest.
 *
 * Read from the manifests rather than the directory names because pnpm truncates those past 27
 * characters and replaces the peer suffix with a hash, so `@angular/compiler-cli@22.1.3` is on disk
 * as `@angular+compiler-cli@22.1._d87920d5c9faac9877b8fc35bf084642`.
 */
const importedPackages = async (virtualStore) => {
  const imported = new Set();
  // A fetch that imported nothing leaves no virtual store at all, which is the exact failure this
  // is here to catch. It belongs in the report as the packages that are missing, not as a missing
  // directory two frames up the stack.
  const entries = await readdir(virtualStore, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    const inner = resolve(virtualStore, entry.name, 'node_modules');
    for (const candidate of await readdir(inner, { withFileTypes: true })) {
      // Only the package itself is a real directory in here. Its dependencies are links to other
      // entries in the same virtual store, and following them would count packages many times over
      // and read one that this fetch did not import.
      if (!candidate.isDirectory() || candidate.name.startsWith('.')) continue;
      const directories = candidate.name.startsWith('@')
        ? (
            await readdir(resolve(inner, candidate.name), {
              withFileTypes: true,
            })
          )
            .filter((scoped) => scoped.isDirectory())
            .map((scoped) => resolve(inner, candidate.name, scoped.name))
        : [resolve(inner, candidate.name)];
      for (const directory of directories) {
        const manifest = JSON.parse(
          await readFile(resolve(directory, 'package.json'), 'utf8'),
        );
        imported.add(`${manifest.name}@${manifest.version}`);
      }
    }
  }
  return imported;
};

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

const staged = [];
for (const lockfile of lockfiles) {
  const name = relative('fixtures', dirname(lockfile)).replaceAll(
    /[\\/]/gu,
    '-',
  );
  const directory = resolve(stagingRoot, name);
  await mkdir(directory, { recursive: true });
  await cp(
    resolve(workspaceRoot, lockfile),
    resolve(directory, 'pnpm-lock.yaml'),
  );

  // A manifest of its own, and without it this file stages nothing. Given a directory holding only
  // a lockfile, pnpm walks up for the nearest `package.json`, finds Equator's own, decides that
  // project is already installed and prints "Already up to date": five fetches in four seconds,
  // nothing added to the store, exit zero.
  // A workspace file does not prevent it, because what pnpm found was a manifest and not the
  // workspace file. The contents do not matter, since `pnpm fetch` takes the lockfile as its
  // input by design. The file has to be there for the lockfile beside it to be the one it
  // reads.
  await writeFile(
    resolve(directory, 'package.json'),
    `${JSON.stringify(
      { name: `consumer-store-${name}`, version: '0.0.0', private: true },
      undefined,
      2,
    )}\n`,
  );

  // The settings the consumer installs under, beside the lockfile they produced. pnpm refuses a
  // frozen fetch whose peer policy differs from the one the lockfile records, and refuses a package
  // whose build script no setting names. A lock under `package-consumer-locks/` belongs to a row of
  // the consumer template, so it takes the template's file.
  const ownSettings = resolve(
    workspaceRoot,
    dirname(lockfile),
    'pnpm-workspace.yaml',
  );
  await cp(
    existsSync(ownSettings)
      ? ownSettings
      : resolve(
          workspaceRoot,
          'fixtures/package-consumer-template/pnpm-workspace.yaml',
        ),
    resolve(directory, 'pnpm-workspace.yaml'),
  );

  // Copied out of `fixtures/` rather than fetched in place: `pnpm fetch` writes a virtual store
  // beside the lockfile, and a fixture directory is not the place for it.
  //
  // The workspace file copied above is what makes this the consumer's lockfile rather than
  // Equator's, and it is not a tidiness measure. Without a workspace file of its own pnpm walks up to
  // the repository's `pnpm-workspace.yaml`, treats the command as a workspace fetch, and
  // `pnpm fetch` **purges the workspace's node_modules** on the way: `node_modules/` at the
  // repository root is emptied and the next command cannot find `prettier`. The confirmation prompt
  // that would catch it is the one this call disables, because a staging step has no terminal to
  // answer it.
  pnpm(directory, ['fetch', '--config.confirmModulesPurge=false']);
  // Checked against the lockfile before the evidence is deleted. A fetch that quietly did nothing
  // exits zero and prints reassuring progress, and the store is the kind of state where the next
  // thing to notice is a stage failing offline half an hour later.
  const { roots, dependencies, platformSpecific } = readLockfile(
    await readFile(resolve(directory, 'pnpm-lock.yaml'), 'utf8'),
  );
  const imported = await importedPackages(
    resolve(directory, 'node_modules/.pnpm'),
  );
  const required = new Set(roots);
  for (const entry of imported) {
    for (const edge of dependencies.get(entry) ?? []) required.add(edge);
  }
  const missing = [...required]
    .filter((entry) => !imported.has(entry) && !platformSpecific.has(entry))
    .sort();
  assert.deepEqual(
    missing,
    [],
    `Fetching ${lockfile} left ${missing.length} package(s) out of the store that something it did import depends on, and none of them is one the lockfile marks for another platform. The consumer stages install offline, so they will fail on the first of these: ${missing.slice(0, 5).join(', ')}.`,
  );

  await rm(resolve(directory, 'node_modules'), {
    recursive: true,
    force: true,
  });
  staged.push({ lockfile, imported: imported.size });
}

console.log(
  `Equator consumer store staged: ${staged.length} lockfile(s), ${staged
    .map(({ lockfile, imported }) => `${lockfile} (${imported})`)
    .join(', ')}.`,
);
