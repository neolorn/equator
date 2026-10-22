// Regenerates the committed consumer fixture lockfiles.
//
// The consumer verification gates install with `--offline --frozen-lockfile` so
// that a floating transitive dependency publishing upstream cannot break them.
// That determinism is only possible because every consumer fixture ships a
// committed lockfile. This is the deliberate, network-using command that
// refreshes those lockfiles after a fixture manifest or a profile row changes.
//
// It is not what puts those packages in the store. Left to this command's side
// effect, the store is stocked only on whichever machine last ran it, and a machine
// that never has fails the consumer stages with `ERR_PNPM_NO_OFFLINE_TARBALL`.
// Hydrating the store from the committed lockfiles is
// `pnpm run stage:consumer-store`, and it is a precondition of the gate rather than
// a side effect of this.

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  consumerProfiles,
  resolveRowVersion,
} from './package-consumer-profiles.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = resolve(workspaceRoot, 'tmp');
const lockRoot = resolve(workspaceRoot, 'fixtures/package-consumer-locks');
const minimalTemplateRoot = resolve(
  workspaceRoot,
  'fixtures/minimal-package-consumer-template',
);
const documentScaffoldRoot = resolve(
  workspaceRoot,
  'fixtures/document-consumer-scaffold',
);

const assertContained = (path, owner) => {
  if (path !== owner && !path.startsWith(`${owner}${sep}`)) {
    throw new Error(`Refusing path outside ${owner}: ${path}`);
  }
};

const run = (command, args, cwd) => {
  // Through the shell on Windows, where both package managers are command scripts Node will not
  // start directly.
  const viaShell =
    process.platform === 'win32' && (command === 'pnpm' || command === 'npm');
  const commandArguments = viaShell
    ? ['/d', '/s', '/c', command, ...args]
    : args;
  const executable = viaShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
  // `CI` is deliberately cleared: pnpm treats a CI environment as
  // `--frozen-lockfile`, which is the opposite of what this command does.
  const { CI: _ignoredCi, ...environment } = process.env;
  const result = spawnSync(executable, commandArguments, {
    cwd,
    encoding: 'utf8',
    env: environment,
  });

  assert.equal(
    result.status,
    0,
    [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n'),
  );
  return result;
};

const resolveLockfile = (consumerRoot) => {
  run(
    'pnpm',
    ['install', '--lockfile-only', '--no-frozen-lockfile'],
    consumerRoot,
  );
};

const packageLocator = (consumerRoot, outputRoot) => {
  const path = relative(consumerRoot, resolve(workspaceRoot, outputRoot));
  return `file:${path.replaceAll('\\', '/')}`;
};

for (const outputRoot of ['dist/runtime', 'dist/toolkit']) {
  const manifestPath = resolve(workspaceRoot, outputRoot, 'package.json');
  await readFile(manifestPath, 'utf8').catch(() => {
    throw new Error(
      `Missing built package ${outputRoot}. Run "pnpm run build" before refreshing consumer lockfiles.`,
    );
  });
}

for (const [consumerName, consumerProfile] of consumerProfiles) {
  const consumerRoot = resolve(
    temporaryRoot,
    'package-consumer-verification',
    consumerName,
  );
  run(
    process.execPath,
    [
      resolve(workspaceRoot, 'tools/materialize-package-consumer.mjs'),
      consumerName,
      '--allow-missing-lock',
    ],
    workspaceRoot,
  );
  resolveLockfile(consumerRoot);

  const destination = resolve(lockRoot, consumerName);
  assertContained(destination, lockRoot);
  await mkdir(destination, { recursive: true });
  await cp(
    resolve(consumerRoot, 'pnpm-lock.yaml'),
    resolve(destination, 'pnpm-lock.yaml'),
  );
  process.stdout.write(
    `Refreshed ${consumerName} lockfile (${consumerProfile.label}).\n`,
  );
}

// Two fixtures carry their lockfile inside the template, because the gate stage
// that uses each one copies the template wholesale. Their `file:` locators are
// relative, so the staging path has to sit at the depth that stage installs at,
// or the recorded locators would not match what it resolves.
const refreshTemplateLock = async (templateRoot, stagingRoot, label) => {
  assertContained(stagingRoot, temporaryRoot);
  await rm(stagingRoot, { force: true, recursive: true });
  await mkdir(dirname(stagingRoot), { recursive: true });
  await cp(templateRoot, stagingRoot, { recursive: true });

  const manifestPath = resolve(stagingRoot, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.dependencies['@neolorn/equator'] = packageLocator(
    stagingRoot,
    'dist/runtime',
  );
  manifest.devDependencies['@neolorn/equator-toolkit'] = packageLocator(
    stagingRoot,
    'dist/toolkit',
  );
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  resolveLockfile(stagingRoot);
  await cp(
    resolve(stagingRoot, 'pnpm-lock.yaml'),
    resolve(templateRoot, 'pnpm-lock.yaml'),
  );
  process.stdout.write(`Refreshed ${label} lockfile.\n`);
};

await refreshTemplateLock(
  minimalTemplateRoot,
  resolve(
    temporaryRoot,
    'focused-package-consumer-verification',
    'minimal-runtime-consumer',
  ),
  'minimal-runtime-consumer',
);

// The document gate proves the documents on the development row, so the scaffold carries that
// row's version of every package it installs rather than whatever `ng new` resolved on the day it
// was made. Equator's own two are the build under test.
const scaffoldManifestPath = resolve(documentScaffoldRoot, 'package.json');
const scaffoldManifest = JSON.parse(
  await readFile(scaffoldManifestPath, 'utf8'),
);
const templateManifest = JSON.parse(
  await readFile(
    resolve(workspaceRoot, 'fixtures/package-consumer-template/package.json'),
    'utf8',
  ),
);
for (const dependencySet of [
  scaffoldManifest.dependencies,
  scaffoldManifest.devDependencies,
]) {
  for (const dependency of Object.keys(dependencySet)) {
    if (dependency.startsWith('@neolorn/')) continue;
    const version = resolveRowVersion(
      consumerProfiles.get('package-consumer'),
      templateManifest,
      dependency,
    );
    if (version === undefined) {
      throw new Error(
        `The document scaffold installs ${dependency}, which the development row does not. Add it to fixtures/package-consumer-template or remove it from the scaffold.`,
      );
    }
    dependencySet[dependency] = version;
  }
}
await writeFile(
  scaffoldManifestPath,
  `${JSON.stringify(scaffoldManifest, null, 2)}
`,
  'utf8',
);

await refreshTemplateLock(
  documentScaffoldRoot,
  resolve(temporaryRoot, 'document-blocks', 'base'),
  'document-consumer-scaffold',
);

// The npm consumer's lock, resolved by npm with the two packed tarballs of this version in place,
// because what npm records for a tarball is read from the tarball. Its other packages are the
// development row's, as the document scaffold's are, so the two consumers install one set.
const npmFixtureRoot = resolve(workspaceRoot, 'fixtures/npm-package-consumer');
const npmManifestPath = resolve(npmFixtureRoot, 'package.json');
const npmManifest = JSON.parse(await readFile(npmManifestPath, 'utf8'));
for (const dependency of Object.keys(npmManifest.dependencies)) {
  if (dependency.startsWith('@neolorn/')) continue;
  const version = resolveRowVersion(
    consumerProfiles.get('package-consumer'),
    templateManifest,
    dependency,
  );
  if (version === undefined) {
    throw new Error(
      `The npm consumer installs ${dependency}, which the development row does not. Add it to fixtures/package-consumer-template or remove it from the npm consumer.`,
    );
  }
  npmManifest.dependencies[dependency] = version;
}
await writeFile(
  npmManifestPath,
  `${JSON.stringify(npmManifest, null, 2)}\n`,
  'utf8',
);
const packedVersion = JSON.parse(
  await readFile(resolve(workspaceRoot, 'dist/runtime/package.json'), 'utf8'),
).version;
const npmStagingRoot = resolve(temporaryRoot, 'npm-package-consumer-lock');
assertContained(npmStagingRoot, temporaryRoot);
await rm(npmStagingRoot, { force: true, recursive: true });
await mkdir(resolve(npmStagingRoot, 'equator'), { recursive: true });
await cp(npmManifestPath, resolve(npmStagingRoot, 'package.json'));
for (const name of ['runtime', 'toolkit']) {
  const folder = resolve(workspaceRoot, 'release', name, packedVersion);
  const packed = readdirSync(folder).filter((file) => file.endsWith('.tgz'));
  if (packed.length !== 1) {
    throw new Error(
      `release/${name}/${packedVersion} holds ${packed.length} tarballs. Run "pnpm run verify:tarballs" first.`,
    );
  }
  await cp(
    resolve(folder, packed[0]),
    resolve(npmStagingRoot, 'equator', `${name}.tgz`),
  );
}
run(
  'npm',
  [
    'install',
    '--package-lock-only',
    '--no-audit',
    '--no-fund',
    '--no-update-notifier',
    '--ignore-scripts',
  ],
  npmStagingRoot,
);
await cp(
  resolve(npmStagingRoot, 'package-lock.json'),
  resolve(npmFixtureRoot, 'package-lock.json'),
);
process.stdout.write('Refreshed npm-package-consumer lockfile.\n');
