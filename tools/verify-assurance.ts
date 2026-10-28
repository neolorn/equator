/**
 * Does the suite still fail when it should?
 *
 * A test that cannot fail is worse than an absent one: it reports a guarantee nobody is holding.
 * A test that asserts on an outcome flag and one severity keeps passing when the behavior it names
 * is removed, if the regression reports through another channel, and nothing in a passing run shows
 * it. What is missing in that case is a check that the checks work.
 *
 * So this gate removes a behavior and requires the named test to notice. Each entry names the
 * invariant in its own words, so a failure here says what stopped being guarded rather than only
 * that a string no longer matched.
 *
 * This is a declared list, not exhaustive mutation testing. It grows when a defect is fixed and the
 * fix deserves a guard that is itself guarded.
 *
 * Every injection here patches a module and runs one vitest file, which is why it is seconds rather
 * than minutes. That is a property of the invariant, not of the package: it holds for any module
 * whose import graph reaches no Angular symbol at runtime, so the runtime's pure modules belong
 * here too. `verify-assurance-runtime.ts` keeps the ones that genuinely need a built package
 * inside a materialized consumer.
 *
 * `specs/12-verification.spec.md` section 9 states the rule this gate is: withdraw the behavior
 * a check guards and require the check to notice, because a check nobody has seen fail is
 * indistinguishable from one that cannot.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { injections } from './assurance-injections.ts';
import { measureInjection } from './assurance-runner.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LABEL = { caught: 'caught ', passed: 'MISSED ', unmeasured: 'NOT RUN' };
const missed = [];
const unmeasured = [];
for (const injection of injections) {
  const outcome = await measureInjection(workspaceRoot, injection);
  process.stdout.write(
    `${LABEL[outcome.verdict]} ${injection.id}\n          ${injection.invariant}\n` +
      (outcome.why === undefined ? '' : `          ${outcome.why}\n`),
  );
  if (outcome.verdict === 'passed') missed.push(injection);
  if (outcome.verdict === 'unmeasured') {
    unmeasured.push({ ...injection, why: outcome.why });
  }
}

if (unmeasured.length > 0) {
  process.stderr.write(
    `\n${unmeasured.length} invariant(s) could not be measured, because the test named for them did not run to a failure:\n${unmeasured
      .map(({ id, why }) => `  ${id}\n    ${why}\n`)
      .join('')}`,
  );
  process.exitCode = 1;
}

if (missed.length > 0) {
  process.stderr.write(
    `\n${missed.length} invariant(s) are not guarded by the test named for them:\n${missed
      .map(
        ({ id, invariant, caughtBy }) =>
          `  ${id}\n    ${invariant}\n    ${caughtBy} passed with the behaviour removed.\n`,
      )
      .join('')}`,
  );
  process.exitCode = 1;
}

if (missed.length === 0 && unmeasured.length === 0) {
  process.stdout.write(
    `\nAssurance verified: ${injections.length} removed behaviours were each caught by the test named for them.\n`,
  );
}
