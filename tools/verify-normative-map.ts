/**
 * `verify:normative-map`: every normative statement against the check that proves it.
 *
 * Red on a statement with no entry, on an entry naming a statement its document no longer makes, on
 * an entry naming a check the gate does not prove able to fail, and on an entry with both checks
 * and a reason or neither. Everything it finds is printed, not only the first thing.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { injections as assurance } from './assurance-injections.ts';
import { injections as assuranceRuntime } from './assurance-runtime-injections.ts';
import { evaluateMap, loadMap, provenChecks } from './normative-map.ts';
import { readNormativeStatements } from './normative-statements.ts';
import { stagePlants } from './stage-plants.ts';
import { steps } from './verify-stages.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const statements = readNormativeStatements(workspaceRoot);
const entries = loadMap();
const checks = provenChecks({
  assurance,
  assuranceRuntime,
  stages: steps.map(({ id }) => id),
  stagePlants,
});
const { findings, proven, reasoned } = evaluateMap({
  statements,
  entries,
  checks,
});

const out = (line = '') => process.stdout.write(`${line}\n`);
out(
  `Normative map: ${statements.length} statements, ${entries.length} entries, ${proven} proven by a check and ${reasoned} carrying a reason.`,
);
out(`Findings (${findings.length}):`);
for (const { kind, message } of findings) out(`  [${kind}] ${message}`);
out();
if (findings.length === 0) {
  out(
    'verify:normative-map GREEN: every normative statement is proven by a check or carries a reason.',
  );
} else {
  out(`verify:normative-map RED: ${findings.length} findings.`);
  process.exitCode = 1;
}
