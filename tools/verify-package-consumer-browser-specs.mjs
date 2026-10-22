/**
 * The consumer's specs that exercise `@neolorn/equator/testing`, run in each engine Playwright
 * drives, through the Angular test builder's own browser mode.
 *
 * Every other run of these specs is jsdom's, which is a DOM written for Node and not an engine a
 * consumer's reader has. Angular's unit-test builder runs the same specs in a real browser when it
 * is given `browsers` and `@vitest/browser-playwright` is installed, and a consumer that does so
 * runs the testing entry point's helpers there. So they are run there here: the address bar, the
 * cookie jar and the storages the environment reset puts back are the engine's own, and the claims
 * each spec makes carry the engine the claims reporter reads off the project it ran in.
 *
 * The specs are found in the consumer's sources rather than listed, so a spec that starts doing what
 * selects it runs here on the day it does. Two things select one: claiming a testing helper, and
 * calling the locale matcher. The matcher reads CLDR likely subtags from the engine's `Intl`, and
 * `specs/01-standards-profile.spec.md` section 6 requires its answer not to vary between browsers.
 *
 * The seat is left as the consumer stage left it. The pseudo-locale spec reads the catalog
 * `equator generate --pseudo` writes, so the run generates it first and generates the production
 * output again afterwards, whatever the run did.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as playwright from 'playwright';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumerRoot = resolve(
  workspaceRoot,
  'tmp/package-consumer-verification/package-consumer',
);

// The engines are asked of Playwright, as the matrix asks for its engine columns, so an engine it
// adds is run here without an edit.
const engines = Object.values(playwright)
  .filter(
    (value) =>
      typeof value?.name === 'function' &&
      typeof value?.executablePath === 'function' &&
      typeof value?.launch === 'function',
  )
  .map((browserType) => browserType.name())
  .sort();
assert.ok(
  engines.includes('chromium') && engines.includes('webkit'),
  `Playwright reports ${engines.join(', ')}, so the scan for its browser types has stopped matching.`,
);

const sourceRoot = resolve(consumerRoot, 'src');
const specFiles = [];
for (const entry of await readdir(sourceRoot, {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile() || !entry.name.endsWith('.spec.ts')) continue;
  const path = resolve(entry.parentPath, entry.name);
  const source = await readFile(path, 'utf8');
  if (
    /\bclaimCapability\(\s*['"]testing:/u.test(source) ||
    /\b(?:negotiateLocale|parseAcceptLanguage)\(/u.test(source)
  ) {
    specFiles.push(relative(consumerRoot, path).split(sep).join('/'));
  }
}
specFiles.sort();
for (const required of [
  'src/app/testing-entry-point.spec.ts',
  'src/app/locale-matching.spec.ts',
]) {
  assert.ok(
    specFiles.includes(required),
    `The scan for specs that claim a testing helper or call the locale matcher found ${specFiles.join(', ') || 'none'}, and not ${required}, which must be among them.`,
  );
}

const run = (entry, args, label, timeout) => {
  const started = Date.now();
  process.stdout.write(`[browser-specs] ${label}\n`);
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: consumerRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    timeout,
  });
  process.stdout.write(
    `[browser-specs] ${label} ended ${String(result.status)} in ${Date.now() - started}ms\n`,
  );
  return {
    ...result,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replaceAll(
      /\u001B\[[0-9;]*m/gu,
      '',
    ),
  };
};
const equator = resolve(
  consumerRoot,
  'node_modules/@neolorn/equator-toolkit/cli.js',
);
const ng = resolve(consumerRoot, 'node_modules/@angular/cli/bin/ng.js');

// Browser mode pre-bundles the installed packages into `node_modules/.vite`, and the copy is keyed
// on the lockfile and the configuration rather than on what the packages contain. A package
// replaced in place would be served from the copy made before it, so the run starts without one.
await rm(resolve(consumerRoot, 'node_modules/.vite'), {
  recursive: true,
  force: true,
});

let tested;
try {
  const generated = run(
    equator,
    ['generate', '--pseudo'],
    'equator generate --pseudo',
    300_000,
  );
  assert.equal(
    generated.status,
    0,
    `equator generate --pseudo failed:\n${generated.output}`,
  );
  tested = run(
    ng,
    [
      'test',
      '--watch=false',
      '--headless',
      ...engines.map((engine) => `--browsers=${engine}`),
      ...specFiles.map((file) => `--include=${file}`),
    ],
    `ng test in ${engines.join(', ')}`,
    1_200_000,
  );
} finally {
  const restored = run(equator, ['generate'], 'equator generate', 300_000);
  assert.equal(
    restored.status,
    0,
    `equator generate failed, so the seat is left with the pseudo-locales generated:\n${restored.output}`,
  );
}

assert.equal(
  tested.status,
  0,
  `The testing specs failed in the browser:\n${tested.error?.message ?? ''}\n${tested.output}`,
);
// Every spec file in every engine, read from the run's own report, because a file an engine did
// not collect passes by not running. The reporter marks a passed file and names the project, which
// the builder names after the engine. The reporter sets the project off with a coloured badge where
// it writes colour and with a bar on each side where it does not, so both are read.
for (const engine of engines) {
  for (const file of specFiles) {
    assert.match(
      tested.output,
      new RegExp(
        `✓\\s+\\|?\\S+ \\(${engine}\\)\\|?\\s+${file.replaceAll('.', '\\.')} \\(`,
        'u',
      ),
      `${file} did not pass in ${engine}:\n${tested.output}`,
    );
  }
}
const collected =
  /Test Files\s+(\d+) passed(?:\s+\|\s+(\d+) skipped)?\s+\((\d+)\)/u.exec(
    tested.output,
  );
assert.ok(
  collected !== null,
  `The browser run reported no file count:\n${tested.output}`,
);
assert.equal(
  Number(collected[3]),
  specFiles.length * engines.length,
  `${specFiles.length} spec file(s) in ${engines.length} engine(s), and the run collected ${collected[3]}:\n${tested.output}`,
);
process.stdout.write(
  `The testing specs passed in ${engines.join(', ')}: ${specFiles.join(', ')}.\n`,
);
