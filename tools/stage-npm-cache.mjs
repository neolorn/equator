/**
 * Puts the npm consumer's packages in the npm cache `verify:npm-consumer` installs from offline.
 *
 * The same precondition `stage:consumer-store` meets for the pnpm consumers, for the one consumer
 * npm installs: a verifier that fetches its own subject can pass by fetching the wrong one, so the
 * fetching is this separate, deliberate command and the verifier stays offline.
 *
 * The packages are the ones the committed `package-lock.json` pins, each fetched by name and
 * version, which stores its registry document beside its tarball. The tarball alone installs what
 * the lock names, but npm reads the document whenever it places a package the lock does not hold,
 * as it does for the two Equator tarballs under test, and offline it has nothing else to read. The
 * cache is under `.runtimes`, beside the staged Node builds, because it is ignored and `clean`
 * leaves it alone; the gate hands the same folder to every tree it runs in.
 *
 * What this reports is read back from the cache, not taken from the lock: npm's cache is content
 * addressed and may drop an entry, and a report of what was asked for reads the same either way.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache =
  process.env.EQUATOR_NPM_CACHE ??
  resolve(workspaceRoot, '.runtimes/npm-cache');

function npm(args) {
  const windows = process.platform === 'win32';
  const result = spawnSync(
    windows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm',
    windows ? ['/d', '/s', '/c', 'npm', ...args] : args,
    { cwd: workspaceRoot, encoding: 'utf8', maxBuffer: 1 << 28 },
  );
  assert.equal(
    result.status,
    0,
    `npm ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`,
  );
  return result.stdout;
}

const lock = JSON.parse(
  await readFile(
    resolve(workspaceRoot, 'fixtures/npm-package-consumer/package-lock.json'),
    'utf8',
  ),
);
const fetched = Object.entries(lock.packages)
  .filter(([, entry]) => entry.resolved?.startsWith('https://'))
  .map(([path, entry]) => ({
    path,
    resolved: entry.resolved,
    spec: `${path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)}@${entry.version}`,
  }));
// A lock the search reads nothing from would stage nothing and report success.
assert.ok(
  fetched.some(({ path }) => path === 'node_modules/@angular/core'),
  'The npm consumer lock names no registry address for @angular/core, so this reads the lock wrongly.',
);

await mkdir(cache, { recursive: true });
npm(['cache', 'add', `--cache=${cache}`, ...fetched.map(({ spec }) => spec)]);

const listed = npm(['cache', 'ls', `--cache=${cache}`]);
const missing = fetched.filter(({ resolved }) => !listed.includes(resolved));
assert.deepEqual(
  missing.map(({ path }) => path),
  [],
  `The npm cache at ${cache} does not hold what the lock pins, so the npm consumer cannot install offline.`,
);
console.log(
  `Equator npm cache staged: ${fetched.length} package(s) from fixtures/npm-package-consumer/package-lock.json in ${cache}.`,
);
