/**
 * The two packed tarballs, installed with npm into a consumer that has never seen the workspace.
 *
 * `specs/02-packages-and-platform.spec.md` section 5 requires both distributables to stay
 * installable by any npm-compatible package manager. Every other consumer here installs the build
 * output with pnpm, and neither half of that is what a consumer on npm receives: npm reads the
 * manifest inside the tarball, refuses a protocol pnpm resolves (`workspace:`), and settles peers
 * by its own rules. So this installs the tarballs `verify:tarballs` packed, with npm, and imports
 * every entry point each one exports.
 *
 * Offline, from a cache staged by `pnpm run stage:npm-cache`, so an upstream publish cannot change
 * what this installs. The committed lock pins every third-party package, and its two Equator
 * entries carry the digest and the dependencies of whatever was packed when it was refreshed, which
 * every build can change. Those two entries are dropped from the copy, so npm reads the tarballs'
 * manifests as they are now, and the lock it writes may differ from the committed one in their two
 * entries and nowhere else. A difference anywhere else is a dependency the tarballs ask for that the
 * lock does not hold.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { openSubpaths } from './exports-map.ts';
import { inputsRoot, repositoryRoot } from './stage-self-test.ts';

const root = inputsRoot();
const version = JSON.parse(
  await readFile(resolve(root, 'packages/runtime/package.json'), 'utf8'),
).version;
/** The fields of an npm lockfile this reads. */
interface NpmLock {
  readonly packages: Readonly<Record<string, unknown>>;
}

const cache =
  process.env['EQUATOR_NPM_CACHE'] ??
  resolve(repositoryRoot, '.runtimes/npm-cache');
const fixtureRoot = resolve(root, 'fixtures/npm-package-consumer');
const consumerRoot = resolve(root, 'tmp/npm-package-consumer-verification');

if (!existsSync(cache)) {
  process.stderr.write(
    `No npm cache at ${cache}. Run "pnpm run stage:npm-cache" first.\n`,
  );
  process.exit(1);
}

/** The one tarball `verify:tarballs` packed for this version of a package. */
function tarball(name: string) {
  const folder = resolve(root, 'release', name, version);
  const packed = existsSync(folder)
    ? readdirSync(folder).filter((file) => file.endsWith('.tgz'))
    : [];
  assert.equal(
    packed.length,
    1,
    `release/${name}/${version} holds ${packed.length} tarballs. Run "pnpm run verify:tarballs" to pack this version.`,
  );
  return resolve(folder, packed[0]!);
}

// Through the shell on Windows, where npm is a command script Node will not start directly.
function npm(args: readonly string[]) {
  const windows = process.platform === 'win32';
  return spawnSync(
    windows ? (process.env['ComSpec'] ?? 'cmd.exe') : 'npm',
    windows ? ['/d', '/s', '/c', 'npm', ...args] : args,
    {
      cwd: consumerRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 16_777_216,
      timeout: 600_000,
    },
  );
}

await rm(consumerRoot, { recursive: true, force: true });
await cp(fixtureRoot, consumerRoot, { recursive: true });
await mkdir(resolve(consumerRoot, 'equator'), { recursive: true });
await cp(tarball('runtime'), resolve(consumerRoot, 'equator/runtime.tgz'));
await cp(tarball('toolkit'), resolve(consumerRoot, 'equator/toolkit.tgz'));
const lockPath = resolve(consumerRoot, 'package-lock.json');
const copied = JSON.parse(await readFile(lockPath, 'utf8'));
for (const name of ['@neolorn/equator', '@neolorn/equator-toolkit']) {
  assert.ok(
    copied.packages[`node_modules/${name}`],
    `The committed npm lock has no entry for ${name}.`,
  );
  delete copied.packages[`node_modules/${name}`];
}
await writeFile(lockPath, `${JSON.stringify(copied, null, 2)}\n`, 'utf8');

const npmVersion = npm(['--version']).stdout.trim();
const installed = npm([
  'install',
  '--offline',
  `--cache=${cache}`,
  '--no-audit',
  '--no-fund',
  '--no-update-notifier',
  // Nothing either package or its dependencies installs runs a script, and one that tried would be
  // reaching for something outside the cache.
  '--ignore-scripts',
]);
assert.equal(
  installed.status,
  0,
  `npm ${npmVersion} did not install the two tarballs offline:\n${installed.stdout}${installed.stderr}`,
);

// Everything but Equator's own entries, which name the tarballs and carry their digests.
const pinned = (lock: NpmLock) =>
  Object.fromEntries(
    Object.entries(lock.packages).filter(
      ([path]) => path !== '' && !path.startsWith('node_modules/@neolorn/'),
    ),
  );
const committed = JSON.parse(
  await readFile(resolve(fixtureRoot, 'package-lock.json'), 'utf8'),
);
const written = JSON.parse(
  await readFile(resolve(consumerRoot, 'package-lock.json'), 'utf8'),
);
const before = pinned(committed);
const after = pinned(written);
const moved = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  .filter(
    (path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]),
  )
  .sort();
assert.deepEqual(
  moved,
  [],
  `Installing the tarballs changed what the committed lock pins: ${moved.join(', ')}. A tarball asks for something the lock does not hold; run "pnpm run refresh:consumer-locks" if the change is intended.`,
);

// Every subpath both installed packages open, imported by the specifier a consumer writes. The
// installed manifests are read here, by the reader every tool shares, so the probe only imports.
// The compiler first, as an application's own build loads it before the toolkit's analysis does.
const opened = ['@neolorn/equator', '@neolorn/equator-toolkit'].flatMap(
  (name) =>
    openSubpaths(
      JSON.parse(
        readFileSync(
          resolve(consumerRoot, 'node_modules', name, 'package.json'),
          'utf8',
        ),
      ) as { readonly name: string; readonly exports: unknown },
    ).map(({ specifier, json }) => ({ specifier, json })),
);
const probe = `
await import('@angular/compiler');
const imported = [];
for (const { specifier, json } of ${JSON.stringify(opened)}) {
  if (json) await import(specifier, { with: { type: 'json' } });
  else await import(specifier);
  imported.push(specifier);
}
process.stdout.write(JSON.stringify(imported));
`;
await writeFile(resolve(consumerRoot, 'probe.mjs'), probe, 'utf8');
const probed = spawnSync(process.execPath, ['probe.mjs'], {
  cwd: consumerRoot,
  encoding: 'utf8',
  timeout: 120_000,
});
assert.equal(
  probed.status,
  0,
  `An entry point of the installed packages did not load:\n${probed.stderr}`,
);
assert.equal(
  probed.stderr,
  '',
  `Loading the entry points wrote to stderr:\n${probed.stderr}`,
);
const imported = JSON.parse(probed.stdout);
for (const anchor of [
  '@neolorn/equator',
  '@neolorn/equator/http',
  '@neolorn/equator-toolkit',
]) {
  assert.ok(
    imported.includes(anchor),
    `The probe imported ${imported.join(', ')}, and not ${anchor}, so its reading of the export maps has stopped matching.`,
  );
}

await rm(consumerRoot, { recursive: true, force: true });
process.stdout.write(
  `verify:npm-consumer GREEN: npm ${npmVersion} installed both ${version} tarballs offline with the committed lock unchanged outside them, and ${imported.length} entry points loaded.\n`,
);
