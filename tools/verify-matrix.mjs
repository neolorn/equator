/**
 * `verify:matrix`: the capability matrix, read from what this run recorded.
 *
 * Every row and column is derived (`capability-matrix.mjs`), every claim is read from the evidence
 * each claiming stage left in this tree, and every claim is read again in the source of the check
 * that made it. The stage is red on any cell with neither a claim nor a reason, and on anything
 * that would let a cell be filled or emptied without anyone seeing why: a reason over an exercised
 * cell or over none, a claim its check never names, a stage that should have left evidence and
 * did not. Everything it finds is printed, not only the first thing.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEvidence } from './capability-evidence.mjs';
import {
  claimSites,
  deriveColumns,
  deriveRows,
  evaluateMatrix,
  loadReasons,
} from './capability-matrix.mjs';
import {
  fixtureContentLanguages,
  fixtureLocales,
  localeKindCoverage,
  pinnedLocaleData,
} from './locale-kinds.mjs';
import { claimsFile, steps } from './verify-stages.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { rows, resolveFailures } = deriveRows();
const columns = deriveColumns();
const reasons = loadReasons();
const evidence = steps
  .filter(({ claims }) => claims === true)
  .map(({ id }) => ({
    stage: id,
    ...readEvidence(claimsFile(workspaceRoot, id)),
  }));
const { sites, problems } = claimSites(workspaceRoot);

const result = evaluateMatrix({
  rows,
  columns,
  reasons,
  evidence,
  sites,
  siteProblems: problems,
  resolveFailures,
});

// The contexts are also the locales the fixtures run in: section 5 of
// `specs/12-verification.spec.md` names the kinds of locale the checks must meet, and a kind no
// fixture configures is one no check met.
const localeKinds = localeKindCoverage({
  locales: fixtureLocales(workspaceRoot),
  contentLanguages: fixtureContentLanguages(workspaceRoot),
  data: pinnedLocaleData(workspaceRoot),
});
const findings = [
  ...result.findings,
  ...localeKinds
    .filter(({ covering }) => covering.length === 0)
    .map(({ name }) => ({
      kind: 'locale-kind',
      message: `No fixture locale or content language covers ${name}.`,
    })),
];

const out = (line = '') => process.stdout.write(`${line}\n`);
const claimCount = evidence.reduce(
  (total, { claims }) => total + claims.length,
  0,
);

out(
  `Capability matrix: ${rows.length} rows by ${columns.length} columns, ${result.cells} cells.`,
);
out(
  `  exercised ${result.exercised.size}, reasoned ${result.reasoned.size} by ${reasons.length} reasons, red ${result.red.length}.`,
);
out(
  `  ${claimCount} claims from ${evidence.length} claiming stages, made at ${sites.length} places in the checks.`,
);
out();

out('Red cells by column:');
const width = Math.max(...columns.map(({ id }) => id.length));
for (const column of columns) {
  const count = result.red.filter((cell) => cell.column === column.id).length;
  out(
    `  ${column.id.padEnd(width)}  ${String(count).padStart(4)}  ${column.name}`,
  );
}
out();

out('Red cells by row:');
for (const row of rows) {
  const missing = result.red
    .filter((cell) => cell.row === row.id)
    .map((cell) => cell.column);
  if (missing.length === 0) continue;
  out(
    `  ${row.id} (${missing.length}): ${missing.length === columns.length ? 'every column' : missing.join(', ')}`,
  );
}
out();

out('Locale kinds:');
for (const { name, covering } of localeKinds) {
  out(`  ${name}: ${covering.length === 0 ? 'none' : covering.join(', ')}`);
}
out();

const others = findings.filter(({ kind }) => kind !== 'unreasoned');
out(`Findings (${findings.length}):`);
for (const { kind, message } of findings) out(`  [${kind}] ${message}`);
out();

if (findings.length === 0) {
  out(
    'verify:matrix GREEN: every cell is exercised by a claim or carries a reason, and a fixture covers every locale kind.',
  );
} else {
  out(
    `verify:matrix RED: ${result.red.length} red cells and ${others.length} other findings.`,
  );
  process.exitCode = 1;
}
