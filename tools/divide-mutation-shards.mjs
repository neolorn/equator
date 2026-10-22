/**
 * Computes where `tools/mutation-shards.json` divides one half of a mutation reading, from a
 * reading of that half.
 *
 * What a mutant costs is estimated, not read: Stryker's report records which tests cover a mutant
 * and not how long it took. A mutant runs the tests that cover it, every test for a mutant Stryker
 * cannot attribute, and nothing for one no test covers; one that timed out ran for its clock, eight
 * times its tests plus ten seconds, as the configurations set it. To that each mutant adds a cost
 * for every test file it reaches, the one figure fitted: the value that makes the estimates of the
 * whole reading add up to the time its workers spent. The tests' own durations come from a plain
 * run of the mutation suite with Vitest's JSON reporter, scaled so they add up to the net time of
 * the reading's initial test run, which is the same tests timed under Stryker.
 *
 * The estimate in worker seconds becomes minutes on a hosted job by dividing by its four workers
 * and multiplying by how much slower a runner's worker is than a local one, which is given on the
 * command line and recorded in the division with the rest of the basis. Parts are filled in source
 * order up to the minutes given, and a part ends at the last statement start before the mutant
 * that would take it over.
 *
 * Usage:
 *   node tools/divide-mutation-shards.mjs --half <runtime|toolkit> --configuration <file>
 *     --report <stryker report.json> --durations <vitest json report> --dry-run-net <seconds>
 *     --wall <seconds> --workers <count> --runner-factor <factor> --minutes <per part>
 *     [--basis <text>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DIVISION_PATH, cutCandidates } from './mutation-shards.mjs';

const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const required = (name) => {
  const value = option(name);
  if (value === undefined) {
    process.stderr.write(`divide-mutation-shards: --${name} is required.\n`);
    process.exit(1);
  }
  return value;
};
const half = required('half');
const configuration = required('configuration');
const report = JSON.parse(readFileSync(resolve(required('report')), 'utf8'));
const durations = JSON.parse(
  readFileSync(resolve(required('durations')), 'utf8'),
);
const dryRunNet = Number(required('dry-run-net'));
const wall = Number(required('wall'));
const workers = Number(required('workers'));
const runnerFactor = Number(required('runner-factor'));
const minutes = Number(required('minutes'));

const slash = (path) => path.replaceAll('\\', '/');
const measured = new Map();
for (const file of durations.testResults) {
  const name = slash(file.name).replace(/^.*?\/packages\//u, 'packages/');
  for (const test of file.assertionResults) {
    measured.set(`${name}\u0000${test.fullName}`, (test.duration ?? 0) / 1000);
  }
}
const testSeconds = new Map();
const testFile = new Map();
for (const [file, { tests }] of Object.entries(report.testFiles)) {
  for (const test of tests) {
    testSeconds.set(
      test.id,
      measured.get(`${slash(file)}\u0000${test.name}`) ?? 0,
    );
    testFile.set(test.id, file);
  }
}
const scale =
  dryRunNet / [...testSeconds.values()].reduce((sum, value) => sum + value, 0);
for (const [id, value] of testSeconds) testSeconds.set(id, value * scale);
const everyTest = [...testSeconds.values()].reduce(
  (sum, value) => sum + value,
  0,
);
const everyFile = Object.keys(report.testFiles).length;

const mutants = [];
for (const [file, { mutants: list }] of Object.entries(report.files)) {
  for (const mutant of list) {
    let tests = 0;
    let files = 0;
    if (mutant.status !== 'NoCoverage' && mutant.status !== 'Ignored') {
      if (mutant.static || mutant.coveredBy === undefined) {
        tests = everyTest;
        files = everyFile;
      } else {
        tests = mutant.coveredBy.reduce(
          (sum, id) => sum + (testSeconds.get(id) ?? 0),
          0,
        );
        files = new Set(mutant.coveredBy.map((id) => testFile.get(id))).size;
      }
    }
    mutants.push({
      file: slash(file),
      line: mutant.location.start.line,
      column: mutant.location.start.column,
      tests,
      files,
      timeout: mutant.status === 'Timeout',
    });
  }
}
const fixed = mutants.reduce(
  (sum, m) => sum + (m.timeout ? 8 * m.tests + 10 : m.tests),
  0,
);
const fileRuns = mutants.reduce((sum, m) => sum + (m.timeout ? 0 : m.files), 0);
const perFile = (wall * workers - fixed) / fileRuns;
const toMinutes = (seconds) => (seconds * runnerFactor) / 4 / 60;
for (const m of mutants)
  m.minutes = toMinutes(
    m.timeout ? 8 * m.tests + 10 : m.tests + perFile * m.files,
  );
mutants.sort(
  (a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
);

const shards = [{ minutes: 0, parts: [] }];
let current = shards[0];
let fileName;
let lines = [];
for (const mutant of mutants) {
  if (mutant.file !== fileName) {
    fileName = mutant.file;
    const { offsets, lineOf } = cutCandidates(
      report.files[fileName].source,
      fileName,
    );
    lines = [...new Set(offsets.map(lineOf))];
    current.parts.push({ file: fileName, from: 1, to: null });
  }
  if (current.minutes + mutant.minutes > minutes && current.minutes > 0) {
    const part = current.parts.at(-1);
    const cut = lines
      .filter((line) => line > part.from && line <= mutant.line)
      .at(-1);
    if (cut !== undefined) {
      part.to = cut;
      current = {
        minutes: 0,
        parts: [{ file: fileName, from: cut, to: null }],
      };
      shards.push(current);
    }
  }
  current.minutes += mutant.minutes;
}
for (const shard of shards) shard.minutes = Math.round(shard.minutes);

const division = JSON.parse(readFileSync(DIVISION_PATH, 'utf8'));
division.halves[half] = {
  configuration,
  basis: {
    reading: option('basis') ?? '',
    mutants: mutants.length,
    wallSeconds: wall,
    workers,
    dryRunNetSeconds: dryRunNet,
    secondsPerTestFile: Number(perFile.toFixed(3)),
    runnerFactor,
    minutesPerPart: minutes,
  },
  shards,
};
writeFileSync(DIVISION_PATH, `${JSON.stringify(division, null, 2)}\n`);
process.stdout.write(
  `${half}: ${shards.length} part(s), estimated minutes ${shards.map(({ minutes: m }) => m).join(', ')}; ${perFile.toFixed(3)} s per test file reached.\n`,
);
