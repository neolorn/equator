import assert from 'node:assert/strict';
import { cp, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { builtPackageLocator } from './built-package.mjs';
import {
  resolveAngularVersion,
  resolveConsumerProfile,
} from './package-consumer-profiles.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = resolve(
  workspaceRoot,
  'fixtures/package-consumer-template',
);
const lockRoot = resolve(workspaceRoot, 'fixtures/package-consumer-locks');
const consumerName = process.argv[2] ?? 'package-consumer';
const consumerProfile = resolveConsumerProfile(consumerName);
const allowMissingLock = process.argv.includes('--allow-missing-lock');
const temporaryRoot = resolve(
  workspaceRoot,
  'tmp/package-consumer-verification',
);
const consumerRoot = resolve(temporaryRoot, consumerName);

const assertContained = (path, owner) => {
  if (path !== owner && !path.startsWith(`${owner}${sep}`)) {
    throw new Error(`Refusing path outside ${owner}: ${path}`);
  }
};

assertContained(consumerRoot, temporaryRoot);
await rm(consumerRoot, { force: true, recursive: true });
await mkdir(temporaryRoot, { recursive: true });
await cp(templateRoot, consumerRoot, { recursive: true });

// Sources a row adds to the template, copied over it. A row that needs application code the other
// rows do not have declares the directory holding it rather than the template carrying code every
// row must then keep compiling. That separation is what lets one row be the discriminator for a
// defect: the code that would meet it exists in that row and nowhere else.
if (consumerProfile.overlay !== undefined) {
  const overlayRoot = resolve(workspaceRoot, consumerProfile.overlay);
  assertContained(overlayRoot, workspaceRoot);
  await cp(overlayRoot, consumerRoot, { recursive: true });
}

// The compiler this row's application uses. Analysis adopts a consumer's own options, so a row
// that changes them changes the program every Equator diagnostic is computed against.
if (consumerProfile.compilerOptions !== undefined) {
  const tsconfigPath = resolve(consumerRoot, 'tsconfig.json');
  const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8'));
  tsconfig.compilerOptions = {
    ...tsconfig.compilerOptions,
    ...consumerProfile.compilerOptions,
  };
  await writeFile(
    tsconfigPath,
    `${JSON.stringify(tsconfig, null, 2)}\n`,
    'utf8',
  );
}

// The claim and its recorder, so the consumer's specs record what they assert the way the
// workspace suites do. Copied rather than imported from the workspace, because the consumer is
// installed and run as its own project and must not reach outside itself.
const claimModules = [
  'capability-claims.mjs',
  'capability-claims-in-tests.mjs',
  'capability-claims-in-tests.d.mts',
  'capability-evidence.mjs',
];
await mkdir(resolve(consumerRoot, 'tools'), { recursive: true });
for (const name of claimModules) {
  await cp(
    resolve(workspaceRoot, 'tools', name),
    resolve(consumerRoot, 'tools', name),
  );
}

// A consumer that varies no version installs from its row's lock, so the two cannot drift.
const lockPath = resolve(lockRoot, consumerProfile.row, 'pnpm-lock.yaml');
const lockExists = await lstat(lockPath).then(
  (entry) => entry.isFile(),
  () => false,
);
if (lockExists) {
  await cp(lockPath, resolve(consumerRoot, 'pnpm-lock.yaml'));
} else if (!allowMissingLock) {
  throw new Error(
    `Missing committed lockfile for ${consumerName}: ${lockPath}\nRun "pnpm run refresh:consumer-locks" to regenerate the consumer fixture lockfiles.`,
  );
}

const manifestPath = resolve(consumerRoot, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.name = `@neolorn/feature-lab-${consumerName}`;
for (const dependencySet of [manifest.dependencies, manifest.devDependencies]) {
  for (const dependency of Object.keys(dependencySet)) {
    if (dependency.startsWith('@angular/')) {
      dependencySet[dependency] = resolveAngularVersion(
        consumerProfile,
        dependency,
      );
    }
  }
}
manifest.dependencies.rxjs = consumerProfile.rxjs;
manifest.devDependencies.typescript = consumerProfile.typescript;

const packageLocator = (outputRoot) =>
  builtPackageLocator(consumerRoot, workspaceRoot, outputRoot);

manifest.dependencies['@neolorn/equator'] = packageLocator('dist/runtime');
manifest.devDependencies['@neolorn/equator-toolkit'] =
  packageLocator('dist/toolkit');

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

// The row this consumer was built as, with the versions that make it that row. The recorder checks
// them against what the install put in `node_modules`, so a claim names the row whose packages
// actually ran rather than the row this script was asked for.
const rowPackages = ['@angular/core', '@angular/build', 'typescript', 'rxjs'];
const allDependencies = {
  ...manifest.dependencies,
  ...manifest.devDependencies,
};
await writeFile(
  resolve(consumerRoot, 'tools/consumer-row.json'),
  `${JSON.stringify(
    {
      row: consumerProfile.row,
      versions: Object.fromEntries(
        rowPackages.map((name) => [name, allDependencies[name]]),
      ),
    },
    null,
    2,
  )}\n`,
  'utf8',
);

process.stdout.write(`${consumerRoot}\n`);
