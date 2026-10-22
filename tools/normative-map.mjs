/**
 * The normative map: every normative statement of the specifications, and what proves it.
 *
 * An entry names a statement by its document and its exact text, and either the checks that prove
 * it or the reason no check can. A check is something the gate proves able to fail on every run:
 * an injection that withdraws a behavior and requires a named suite to notice, or a self-test stage
 * that plants the defects its stage exists to refuse. A test on its own is not a check here,
 * because nothing would show it failing, and a check nobody has seen fail is indistinguishable
 * from one that cannot (`specs/12-verification.spec.md` section 9).
 *
 * The text is the key rather than a number or a digest, so an edited statement leaves its entry
 * naming words the document no longer says, and the edit is read against its proof before the gate
 * goes green again.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const mapPath = resolve(workspaceRoot, 'tools/normative-map.json');

export function loadMap(path = mapPath) {
  return JSON.parse(readFileSync(path, 'utf8')).entries;
}

/**
 * The checks an entry may name, each proven able to fail by the stage that runs it.
 *
 * A runtime injection marked as a known gap is left out: its suite is recorded as passing with the
 * behavior withdrawn, which is the opposite of a proof. A planted defect counts only while its
 * stage's self-test is in the gate, because the self-test is what plants it.
 */
export function provenChecks({
  assurance,
  assuranceRuntime,
  stages,
  stagePlants = {},
}) {
  const checks = new Map();
  for (const { id, invariant } of assurance) {
    checks.set(`assurance:${id}`, invariant);
  }
  for (const { id, invariant, knownGap } of assuranceRuntime) {
    if (knownGap === undefined)
      checks.set(`assurance-runtime:${id}`, invariant);
  }
  for (const id of stages) {
    if (id.endsWith(':self-test')) checks.set(`self-test:${id}`, id);
  }
  for (const [stage, plants] of Object.entries(stagePlants)) {
    if (!stages.includes(`${stage}:self-test`)) continue;
    for (const plant of plants) {
      checks.set(`plant:${stage}:${plant}`, `${stage}:self-test`);
    }
  }
  return checks;
}

const keyOf = (spec, statement) => `${spec}\u0000${statement}`;

/** Every finding, not only the first, so one run shows the whole distance to green. */
export function evaluateMap({ statements, entries, checks }) {
  const findings = [];
  const current = new Map(
    statements.map(({ file, section, statement }) => [
      keyOf(file, statement),
      { file, section, statement },
    ]),
  );
  const mapped = new Map();
  const excerpt = (text) =>
    text.length > 100 ? `${text.slice(0, 100)}...` : text;

  for (const [index, entry] of entries.entries()) {
    const where = `entry ${index + 1} (${entry.spec}: "${excerpt(String(entry.statement))}")`;
    const key = keyOf(entry.spec, entry.statement);
    if (!current.has(key)) {
      findings.push({
        kind: 'gone',
        message: `${where} names a statement its document no longer makes.`,
      });
    }
    if (mapped.has(key)) {
      findings.push({
        kind: 'duplicate',
        message: `${where} maps a statement entry ${mapped.get(key) + 1} already maps.`,
      });
    } else {
      mapped.set(key, index);
    }
    const hasChecks = Array.isArray(entry.checks) && entry.checks.length > 0;
    const hasReason =
      typeof entry.reason === 'string' && entry.reason.trim() !== '';
    if (hasChecks === hasReason) {
      findings.push({
        kind: 'shape',
        message: `${where} must carry either checks or a reason, and carries ${hasChecks ? 'both' : 'neither'}.`,
      });
    }
    for (const check of hasChecks ? entry.checks : []) {
      if (!checks.has(check)) {
        findings.push({
          kind: 'missing-check',
          message: `${where} names ${check}, which is no check the gate proves able to fail.`,
        });
      }
    }
  }

  for (const [key, { file, section, statement }] of current) {
    if (!mapped.has(key)) {
      findings.push({
        kind: 'unmapped',
        message: `${file}, ${section}: "${excerpt(statement)}" has no entry.`,
      });
    }
  }

  const proven = entries.filter(
    (entry) => Array.isArray(entry.checks) && entry.checks.length > 0,
  ).length;
  return { findings, proven, reasoned: entries.length - proven };
}
