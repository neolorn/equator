/**
 * `verify:assurance:self-test`: the assurance runners' verdicts, shown telling a catch from
 * everything that only looks like one.
 *
 * Five planted injections go through the runner `verify:assurance` uses (`assurance-runner.mjs`):
 *
 * - a real one, whose test must fail: `caught`;
 * - one that changes nothing the test observes: `passed`, which the stage reports as unguarded;
 * - one that makes the module throw as it loads, so the test file fails with no test run;
 * - one naming a test file that does not exist;
 * - one named against a planted test file that already fails with nothing injected.
 *
 * The last three exit non-zero exactly as a catch does, and must come back `unmeasured`. A runner
 * that read the exit status alone would call all three caught, and every entry in the normative
 * map resting on an injection would then rest on a guard nobody had seen run.
 *
 * The whole-suite reading `verify:assurance:runtime` takes of a consumer's report is planted too,
 * as reports: none at all, which is what a consumer that did not compile leaves; a file that failed
 * without running a test; a failing test; and a passing run. So is its reading of the browser gate,
 * which writes no report: a failure counts as a catch only when it carries the assertion the
 * injection names, and a browser that never started carries none.
 */
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { injections } from './assurance-injections.mjs';
import {
  gateVerdict,
  measureInjection,
  verdictOf,
} from './assurance-runner.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const real = injections.find(({ id }) => id === 'consumer-paths-discarded');
assert.ok(
  real !== undefined,
  'The injection this self-test plants beside is gone; plant beside another.',
);
const LOAD_ANCHOR = "import { readFileSync } from 'node:fs';";
const FAILING_TEST =
  'packages/toolkit/test/planted-by-the-assurance-self-test-failing.test.ts';

const planted = [
  { expect: 'caught', injection: real },
  {
    expect: 'passed',
    injection: {
      ...real,
      id: 'planted-comment',
      replace: `${real.find}\n    // Planted by the self-test; changes nothing a test can see.`,
    },
  },
  {
    expect: 'unmeasured',
    injection: {
      ...real,
      id: 'planted-load-failure',
      find: LOAD_ANCHOR,
      replace: `${LOAD_ANCHOR}\nthrow new Error('Planted by the self-test: the module fails to load.');`,
    },
  },
  {
    expect: 'unmeasured',
    injection: {
      ...real,
      id: 'planted-missing-test',
      caughtBy:
        'packages/toolkit/test/planted-by-the-assurance-self-test.test.ts',
    },
  },
  {
    expect: 'unmeasured',
    injection: {
      ...real,
      id: 'planted-failing-baseline',
      caughtBy: FAILING_TEST,
    },
  },
];

const wrong = [];
const failingPath = resolve(workspaceRoot, FAILING_TEST);
writeFileSync(
  failingPath,
  "import { expect, it } from 'vitest';\n\nit('fails with nothing injected', () => {\n  expect(1).toBe(2);\n});\n",
);
try {
  for (const { expect, injection } of planted) {
    const outcome = await measureInjection(workspaceRoot, injection);
    process.stdout.write(
      `${injection.id}: ${outcome.verdict}${outcome.why === undefined ? '' : ` (${outcome.why})`}\n`,
    );
    if (outcome.verdict !== expect) {
      wrong.push(`${injection.id} came back ${outcome.verdict}, not ${expect}`);
    }
  }
} finally {
  rmSync(failingPath, { force: true });
}

// Inside the Vitest cache directory, which this stage already writes.
const reportDirectory = resolve(
  workspaceRoot,
  'node_modules/.vite/assurance-self-test',
);
mkdirSync(reportDirectory, { recursive: true });
const plantReport = (name, testResults) => {
  const path = resolve(reportDirectory, `${name}.json`);
  if (testResults !== undefined) {
    writeFileSync(path, JSON.stringify({ testResults }));
  } else {
    rmSync(path, { force: true });
  }
  return path;
};
const test = (status) => ({ status, title: 'planted' });
const reports = [
  {
    name: 'no-report',
    status: 1,
    expect: 'unmeasured',
    testResults: undefined,
  },
  {
    name: 'load-failure',
    status: 1,
    expect: 'unmeasured',
    testResults: [
      {
        name: 'a.spec.ts',
        status: 'failed',
        message: 'planted',
        assertionResults: [],
      },
      {
        name: 'b.spec.ts',
        status: 'passed',
        message: '',
        assertionResults: [test('passed')],
      },
    ],
  },
  {
    name: 'stopped-before-the-failure-was-reported',
    status: 1,
    expect: 'unmeasured',
    interrupted: true,
    testResults: [
      {
        name: 'a.spec.ts',
        status: 'passed',
        message: '',
        assertionResults: [test('passed'), test('pending')],
      },
    ],
  },
  {
    name: 'failed-test',
    status: 1,
    expect: 'caught',
    testResults: [
      {
        name: 'a.spec.ts',
        status: 'failed',
        message: '',
        assertionResults: [test('failed')],
      },
    ],
  },
  {
    name: 'passing',
    status: 0,
    expect: 'passed',
    testResults: [
      {
        name: 'a.spec.ts',
        status: 'passed',
        message: '',
        assertionResults: [test('passed')],
      },
    ],
  },
];
for (const { name, status, expect, testResults, ...rest } of reports) {
  const { verdict, interrupted = false } = verdictOf({
    reportPath: plantReport(name, testResults),
    status,
  });
  process.stdout.write(`suite report ${name}: ${verdict}\n`);
  if (verdict !== expect) {
    wrong.push(`the suite report ${name} read ${verdict}, not ${expect}`);
  }
  if (interrupted !== (rest.interrupted ?? false)) {
    wrong.push(
      `the suite report ${name} read ${interrupted ? 'interrupted' : 'not interrupted'}`,
    );
  }
}
rmSync(reportDirectory, { force: true, recursive: true });

const named = /lost focus during the locale commit/u;
const browserRuns = [
  { name: 'passing', status: 0, output: '', expect: 'passed' },
  {
    name: 'the named assertion',
    status: 1,
    output:
      'AssertionError [ERR_ASSERTION]: [data-locale-choice="ar-EG"] lost focus during the locale commit',
    expect: 'caught',
  },
  {
    name: 'a browser that did not start',
    status: 1,
    output: 'browserType.launch: Executable does not exist',
    expect: 'unmeasured',
  },
  {
    name: 'a failure with nothing named',
    status: 1,
    output:
      'AssertionError [ERR_ASSERTION]: lost focus during the locale commit',
    caughtWhen: undefined,
    expect: 'unmeasured',
  },
];
for (const { name, status, output, expect, ...rest } of browserRuns) {
  const { verdict } = gateVerdict({
    gate: 'verify:browser-assurance',
    status,
    output,
    caughtWhen: 'caughtWhen' in rest ? rest.caughtWhen : named,
  });
  process.stdout.write(`browser run ${name}: ${verdict}\n`);
  if (verdict !== expect) {
    wrong.push(`the browser run ${name} read ${verdict}, not ${expect}`);
  }
}

assert.deepEqual(
  wrong,
  [],
  `The assurance runners misclassified planted cases:\n  ${wrong.join('\n  ')}`,
);
process.stdout.write(
  `\nverify:assurance:self-test GREEN: a real injection was caught, an inert one reported unguarded, and a module that never loaded, a missing test, a test failing with nothing injected, and a suite that left no report or ran nothing, and a browser run failing without the named assertion, were none of them counted as a catch.\n`,
);
