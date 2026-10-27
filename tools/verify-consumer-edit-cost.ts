/**
 * What three data edits cost in the file that composes the application.
 *
 * The requirement is that an application configures Equator once. Measuring that as "one provider
 * configuration" is a line count, and a line count is the wrong instrument twice over: it passes
 * while the requirement fails, three lines that each need editing per route is still three lines,
 * and it fails while the requirement holds, so deleting something a consumer needs reads as an
 * improvement.
 *
 * The requirement is about **cost of change**, so that is what this measures. Each of the three
 * edits is applied to the materialized consumer, `equator generate` is run, and `app.config.ts` is
 * required to come back byte for byte identical:
 *
 *   1. adding a route
 *   2. adding a locale
 *   3. changing one path spelling in one locale
 *
 * Every one of them is a data edit (route table, configuration and policy, projection) and none
 * of them may reach the composition. A digest rather than a diff, because the claim is that the file
 * does not move at all, not that it moves acceptably.
 *
 * It reads the fixture the lab actually ships and boots from. A target `app.config.ts` written into
 * documentation while the fixtures keep their own would prove nothing about either.
 *
 * Run after `verify:consumer`, and re-materialize afterwards: this edits the consumer in place and
 * restores each edit, but a failed assertion leaves the last edit applied on purpose, so it can be
 * looked at.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumerName = process.argv[2] ?? 'package-consumer';
const consumerRoot = resolve(
  workspaceRoot,
  'tmp/package-consumer-verification',
  consumerName,
);
const appRoot = resolve(consumerRoot, 'src/app');
const pnpmCommand = process.platform === 'win32' ? 'cmd' : 'pnpm';

const generate = () => {
  const args = ['run', 'equator:generate'];
  const result = spawnSync(
    pnpmCommand,
    process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm', ...args] : args,
    {
      cwd: consumerRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
    },
  );
  assert.equal(
    result.status,
    0,
    ['equator generate failed', result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n'),
  );
};

const digest = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path, 'utf8'), 'utf8')
    .digest('hex');

const edit = async (path: string, replace: (source: string) => string) => {
  const before = await readFile(path, 'utf8');
  const after = replace(before);
  assert.notEqual(
    after,
    before,
    `The edit to ${path} changed nothing, so the check below would pass without testing anything.`,
  );
  await writeFile(path, after, 'utf8');
  return async () => writeFile(path, before, 'utf8');
};

/**
 * Every scope's catalog for an existing *target* locale, so a new locale can be given one of each.
 *
 * Copied from a target rather than from the source, because the two are not the same shape: a
 * source catalog declares the inputs and slots each message takes, and a target catalog inherits
 * them and must not restate them. Copying `en-US` here produced four schema errors, which is the
 * check doing its job: adding a locale means adding a catalog like the other translations have,
 * not like the source has.
 */
const catalogFiles = async () => {
  const root = resolve(consumerRoot, 'i18n');
  const sourceLocale = JSON.parse(
    await readFile(resolve(consumerRoot, 'equator.config.json'), 'utf8'),
  ).sourceLocale;
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(root, entry.name);
    const target = (await readdir(directory))
      .filter((name) => name.endsWith('.yaml'))
      .find((name) => name !== `${sourceLocale}.yaml`);
    if (target === undefined) continue;
    found.push({
      directory,
      source: await readFile(resolve(directory, target), 'utf8'),
    });
  }
  return found;
};

const configPath = resolve(appRoot, 'app.config.ts');
const baseline = await digest(configPath);

/**
 * Each edit, and the data file it belongs in.
 *
 * `apply` returns its own undo, so a failure leaves exactly one edit in place rather than an
 * unwindable pile of them.
 */
const EDITS = [
  {
    label: 'adding a route',
    async apply() {
      return edit(resolve(appRoot, 'app.routes.ts'), (source) =>
        source.replace(
          "  {\n    path: 'second',",
          "  {\n    path: 'edit-cost-probe',\n    component: FeatureLabSecondRoute,\n    data: { equatorIndexing: 'indexable' },\n  },\n  {\n    path: 'second',",
        ),
      );
    },
  },
  {
    label: 'adding a locale',
    async apply() {
      // The configuration and the catalogs, and nothing else.
      //
      // A locale is declared once, in the configuration, and its words are the catalogs. The
      // fixture's route policy reads its locales from the generated configuration, so the new
      // locale has an address without an edit there, which is what spec 03 section 2 asks of a
      // declaration made once.
      const undoConfiguration = await edit(
        resolve(consumerRoot, 'equator.config.json'),
        (source) => {
          const configuration = JSON.parse(source);
          configuration.locales = [...configuration.locales, 'fr-FR'];
          return `${JSON.stringify(configuration, null, 2)}\n`;
        },
      );
      // The catalogs, copied from the source locale. Untranslated French is still a French
      // catalog as far as this measurement is concerned: the question is what the *composition*
      // costs, not what the translation costs.
      const catalogs = await catalogFiles();
      const undoCatalogs: (() => Promise<void>)[] = [];
      for (const { directory, source } of catalogs) {
        const path = resolve(directory, 'fr-FR.yaml');
        await writeFile(path, source, 'utf8');
        undoCatalogs.push(async () => rm(path, { force: true }));
      }
      assert.notEqual(
        catalogs.length,
        0,
        'No source catalogs were found, so adding a locale was not actually exercised.',
      );
      return async () => {
        for (const undo of undoCatalogs) await undo();
        await undoConfiguration();
      };
    },
  },
  {
    label: 'changing one path spelling in one locale',
    async apply() {
      return edit(resolve(appRoot, 'localization.routes.ts'), (source) =>
        source.replace(
          '  historical: Object.freeze({',
          "  localizedPaths: Object.freeze({\n    'route:second': Object.freeze({ 'ar-EG': 'althani' }),\n  }),\n  historical: Object.freeze({",
        ),
      );
    },
  },
];

const results = [];
for (const { label, apply } of EDITS) {
  const undo = await apply();
  try {
    generate();
    const after = await digest(configPath);
    assert.equal(
      after,
      baseline,
      `${label} changed app.config.ts. R1 is that this file does not move for a data edit; it moved.`,
    );
    results.push(label);
  } finally {
    await undo();
  }
}

// The undo has to restore the file exactly, or every result after the first is measured against a
// consumer that has drifted.
assert.equal(
  await digest(configPath),
  baseline,
  'app.config.ts did not come back to its baseline after the edits were undone.',
);
generate();

process.stdout.write(
  `Equator consumer edit cost verified: ${results.length} edit(s) cost no line in app.config.ts.\n`,
);
for (const label of results) process.stdout.write(`  ${label}\n`);
