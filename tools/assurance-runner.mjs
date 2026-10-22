/**
 * One fast-harness injection, applied and measured.
 *
 * `verify:assurance` runs every declared injection through this, and its self-test runs planted
 * ones through the same code, so the classification the gate trusts is one that has been seen to
 * refuse a false catch.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The verdict a Vitest JSON report gives, for one test file (an absolute path) or, with none named,
 * for the whole run.
 *
 * `caught` only when a test ran and failed. A run whose report is missing, which is what a build
 * that did not compile leaves, and a file that failed without running a test, which is what a
 * module that did not load leaves, both exit non-zero exactly as a catch does, and are
 * `unmeasured`. So is a run stopped with tests unfinished and no failure reported, which is marked
 * `interrupted` so that a caller that stopped the run itself can run it to its end.
 */
export function verdictOf({ reportPath, status, testFile, label }) {
  const report = existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, 'utf8'))
    : undefined;
  const subject = label ?? testFile ?? 'The suite';
  const files =
    report === undefined
      ? []
      : testFile === undefined
        ? report.testResults
        : report.testResults.filter(
            ({ name }) => resolve(name) === resolve(testFile),
          );
  if (files.length === 0) {
    return {
      verdict: 'unmeasured',
      why: `${subject} did not run (exit ${status ?? 'null'}).`,
    };
  }
  const tests = files.flatMap(({ assertionResults }) => assertionResults);
  const failed = tests.filter(({ status: state }) => state === 'failed');
  if (failed.length > 0) {
    // Named, because a suite that fails with nothing injected is reported by its caller, and
    // "a test fails" sends the reader to rerun the suite to learn which.
    return {
      verdict: 'caught',
      failed: failed.map(({ fullName, title }) => fullName ?? title),
    };
  }
  if (status === 0 && tests.length > 0) return { verdict: 'passed' };
  const message = files.find(({ message: text }) => text)?.message;
  // Vitest reports a test it has no result for as `pending`. A run stopped at its first failure
  // tells the worker to stop from inside the failing test, and the result of that test is sent on
  // a timer: a worker stopped before the timer fires leaves the failure out of the report.
  const unfinished = tests.filter(({ status: state }) => state === 'pending');
  if (unfinished.length > 0) {
    return {
      verdict: 'unmeasured',
      interrupted: true,
      why: `${subject} was stopped with ${unfinished.length} test(s) unfinished and none reported as failed (exit ${status ?? 'null'}).`,
    };
  }
  return {
    verdict: 'unmeasured',
    why: `${subject} ran no test to a failure: ${message || `exit ${status ?? 'null'}`}`,
  };
}

/**
 * The verdict of a gate stage run as a suite, such as the browser gate or a consumer stage, which
 * writes no report.
 *
 * A stage is one script of many assertions, and a browser that did not start, a server that did
 * not answer, an install that failed and an address that did not exist all end it exactly as the
 * assertion guarding the invariant does. So a failure is `caught` only when its output carries
 * `caughtWhen`, the message of the assertion the injection is declared against, and is `unmeasured`
 * otherwise, with the end of the output as the reason.
 */
export function gateVerdict({ gate, status, output, caughtWhen }) {
  if (status === 0) return { verdict: 'passed' };
  if (caughtWhen !== undefined && caughtWhen.test(output)) {
    return { verdict: 'caught' };
  }
  const tail = output.trim().split('\n').slice(-6).join('\n');
  return {
    verdict: 'unmeasured',
    why: `${gate} failed (exit ${status ?? 'null'}) without the assertion this injection names:\n${tail}`,
  };
}

/**
 * What the named test file did with the behaviour removed.
 *
 * `caught` only when that file ran and one of its tests failed. A missing file, a module that fails
 * to load, or a file with no tests exits non-zero too, and counting that as a catch reports a guard
 * that never ran. So it is `unmeasured`, which fails the stage on its own account, and the verdict is
 * read from Vitest's JSON report rather than from the exit status.
 */
function runTests(workspaceRoot, testFile) {
  // Inside the Vitest cache directory, which the stage already writes, so the report adds nothing
  // to what the stage declares.
  const reportPath = resolve(
    workspaceRoot,
    'node_modules/.vite/assurance-report.json',
  );
  rmSync(reportPath, { force: true });
  const args = [
    'vitest',
    'run',
    testFile,
    '--reporter=json',
    `--outputFile=${reportPath}`,
  ];
  const result = spawnSync(
    process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npx',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'npx', ...args] : args,
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
      maxBuffer: 8_388_608,
      timeout: 300_000,
    },
  );
  return verdictOf({
    reportPath,
    status: result.status,
    testFile: resolve(workspaceRoot, testFile),
    label: testFile,
  });
}

/**
 * Each test file's run on the source as it is, once per process.
 *
 * A test that already fails with nothing injected fails with the injection too, and that is not a
 * catch. So an injection counts only against a file seen passing without it.
 */
const baselines = new Map();

/** Applies the injection, runs its test, and restores the source whatever happened. */
export async function measureInjection(workspaceRoot, injection) {
  const key = resolve(workspaceRoot, injection.caughtBy);
  if (!baselines.has(key)) {
    baselines.set(key, runTests(workspaceRoot, injection.caughtBy));
  }
  const baseline = baselines.get(key);
  if (baseline.verdict !== 'passed') {
    return {
      verdict: 'unmeasured',
      why: `${injection.caughtBy} does not pass with nothing injected: ${baseline.why ?? 'a test in it fails'}`,
    };
  }
  const path = resolve(workspaceRoot, injection.source);
  const original = await readFile(path, 'utf8');
  const occurrences = original.split(injection.find).length - 1;
  assert.equal(
    occurrences,
    1,
    `Injection ${injection.id} no longer matches ${injection.source}. The code moved; update the injection so the invariant stays checked rather than silently unchecked.`,
  );
  try {
    await writeFile(
      path,
      original.split(injection.find).join(injection.replace),
      'utf8',
    );
    return runTests(workspaceRoot, injection.caughtBy);
  } finally {
    await writeFile(path, original, 'utf8');
    assert.equal(
      await readFile(path, 'utf8'),
      original,
      `Failed to restore ${injection.source} after injection ${injection.id}.`,
    );
  }
}
