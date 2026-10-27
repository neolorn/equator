/**
 * Does the runtime's suite still fail when the runtime stops doing something?
 *
 * `verify-assurance.ts` asks that question by injecting into a source file and running the
 * workspace vitest file named for the invariant, in seconds. The runtime's pure modules have such
 * tests, and their injections live in that file because they cost seconds there.
 *
 * What stays here is everything a workspace test cannot see: wiring, hydration, providers, the
 * document, the URL. Proving those means the built package inside the materialized consumer, so an
 * injection here has to rebuild the package, refresh the consumer's copy of it, and run the
 * consumer's own suite. That needs the consumer to exist, so this runs after `verify:consumer`
 * rather than as more rows in the other file's list.
 *
 * What the reach is worth is `route-scopes-not-derived` below. `derivedScopes` returning an empty
 * list disables scope loading on activation outright, and nothing a workspace test can reach moves:
 * the defect shows only in a consumer that renders. A guard nobody has watched fail is a claim
 * about the guard.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withOfflineStoreRemedy } from './offline-store.ts';
import {
  refreshCommand,
  refreshConsumerPackages,
} from './refresh-consumer-packages.ts';

import { gateVerdict, verdictOf, type Verdict } from './assurance-runner.ts';
import { consumerSpecsEnvironment } from './consumer-specs-environment.ts';
import {
  injections,
  type RuntimeInjection,
} from './assurance-runtime-injections.ts';
import { steps } from './verify-stages.ts';
import { type SpawnedText, spawnedOutput } from './spawned-text.ts';

/** The part of an injection read here. */

/** The part of the consumer suite's JSON report read here. */
interface ConsumerReport {
  readonly testResults?: readonly {
    readonly name: string;
    readonly status: string;
    readonly message?: string;
  }[];
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumerRoot = resolve(
  workspaceRoot,
  'tmp/package-consumer-verification/package-consumer',
);

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>> = {},
): SpawnedText {
  const windows = process.platform === 'win32';
  return spawnSync(
    windows ? (process.env['ComSpec'] ?? 'cmd.exe') : command,
    windows ? ['/d', '/s', '/c', command, ...args] : args,
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', NO_COLOR: '1', ...environment },
      maxBuffer: 16_777_216,
      timeout: 600_000,
    },
  );
}

/**
 * A step this gate depends on rather than measures, asserted with what the child actually said.
 *
 * A suite is *expected* to fail, and the failing is the measurement. These are the other kind (a
 * build, an install, a materialization) where a non-zero exit ends the run and the only useful
 * thing left on the screen is the reason, so it is printed with what the child said.
 */
function required(
  command: string,
  args: readonly string[],
  cwd: string,
  why: string,
): void {
  requireOk(run(command, args, cwd), `${command} ${args.join(' ')}`, cwd, why);
}

/** The same report for a step that is defined, and so run, somewhere else. */
function requireOk(
  result: SpawnedText,
  description: string,
  cwd: string,
  why: string,
): void {
  if (result.status === 0) return;
  const tail = (stream: string | null | undefined) => {
    const text = String(stream ?? '').trimEnd();
    return text === '' ? '(nothing)' : text.split('\n').slice(-20).join('\n');
  };
  assert.fail(
    withOfflineStoreRemedy(
      `${why}\n` +
        `  ran: ${description}\n` +
        `  in: ${cwd}\n` +
        `  exit ${result.status ?? 'null'}` +
        `${result.signal === null ? '' : `, killed by ${result.signal}`}` +
        `${result.error === undefined ? '' : `, ${String(result.error)}`}\n` +
        `--- its last 20 lines of stdout ---\n${tail(result.stdout)}\n` +
        `--- its last 20 lines of stderr ---\n${tail(result.stderr)}`,
    ),
  );
}

/** Hand the consumer the package that was just built. */
function refreshConsumer(why: string): void {
  requireOk(
    refreshConsumerPackages(consumerRoot),
    refreshCommand,
    consumerRoot,
    why,
  );
}

/**
 * The suite that can observe the invariant, which is not always the same suite.
 *
 * Most of these are visible to the consumer's own tests. One the consumer's tests cannot see needs
 * a real browser moving a real page, names the browser gate as its suite, and names the assertion
 * there that fails without it. It costs a browser run per injection, which is why it is named
 * rather than assumed.
 *
 * Others are visible only to a stage that builds something the consumer's tests do not: the
 * negative compilation files, a consumer under another URL policy, or the minimal consumers whose
 * graphs prove an absence. Such an injection names that stage and the assertion it fails with, and
 * costs one run of the stage.
 */
function suiteVerdict(suite: string | undefined, caughtWhen?: RegExp): Verdict {
  required(
    'pnpm',
    ['run', 'build'],
    workspaceRoot,
    'The workspace did not build with the injection applied, so nothing was proven. A `TS6133 ' +
      'is declared but its value is never read` here is this file to fix, not the runtime: ' +
      'Equator compiles with `noUnusedLocals` and `noUnusedParameters`, so an injection that ' +
      'removes the only reader of a local or a parameter cannot compile. Reference it with ' +
      '`void`, the way the injections above do, or widen the replacement to take the reader ' +
      'out with it.',
  );
  refreshConsumer(
    'The materialized consumer did not take the rebuilt package.',
  );
  if (suite === undefined) {
    // Read from the suite's own report rather than its exit status: a consumer that no longer
    // compiles against the injected package fails exactly as a caught one does, and ran nothing.
    const reportPath = resolve(
      consumerRoot,
      'node_modules/.vite/assurance-report.json',
    );
    rmSync(reportPath, { force: true });
    // The consumer's own runner configuration, stopping at the first failed test. One failure is a
    // catch, and an injection that leaves every locale change waiting fails each test only at its
    // deadline: run to the end, that suite outlasts the bound on this run and is reported as
    // unmeasured. Written after the refresh, which removes `node_modules`.
    const runnerConfigPath = resolve(
      consumerRoot,
      'node_modules/.vite/assurance.vitest.config.mts',
    );
    mkdirSync(dirname(runnerConfigPath), { recursive: true });
    const measured = (bail: number) => {
      rmSync(reportPath, { force: true });
      writeFileSync(
        runnerConfigPath,
        "import base from '../../vitest.config.mts';\n\n" +
          `export default { ...base, test: { ...base.test, bail: ${bail} } };\n`,
      );
      const result = run(
        'pnpm',
        [
          'test',
          '--reporters=json',
          `--output-file=${reportPath}`,
          `--runner-config=${runnerConfigPath}`,
        ],
        consumerRoot,
        consumerSpecsEnvironment(),
      );
      return {
        result,
        verdict: verdictOf({ reportPath, status: result.status }),
      };
    };
    const stopped = measured(1);
    // Stopping at the first failure can stop the worker before it has reported that failure, and
    // the report then holds unfinished tests and no failed one. Run to its end, the suite reports
    // every test it ran, so that run is measured again without the stop.
    const { result, verdict } = stopped.verdict.interrupted
      ? measured(0)
      : stopped;
    if (verdict.verdict !== 'unmeasured') return verdict;
    // The report says no test failed and the exit status says the run did. Only how the process
    // ended, what the report counted and what the suite printed say which of the two to believe.
    const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`
      .trimEnd()
      .split('\n')
      .slice(-40)
      .join('\n');
    const counted = existsSync(reportPath)
      ? (({ testResults = [], ...totals }: ConsumerReport) =>
          `${JSON.stringify(totals)}\n` +
          testResults
            .filter(({ status }) => status !== 'passed')
            .map(
              ({ name, status, message }) =>
                `  ${status} ${name}${message ? `: ${message}` : ''}`,
            )
            .slice(0, 20)
            .join('\n'))(
          JSON.parse(readFileSync(reportPath, 'utf8')) as ConsumerReport,
        )
      : '(no report)';
    return {
      ...verdict,
      why:
        `${verdict.why}` +
        `${result.signal === null ? '' : `, killed by ${result.signal}`}` +
        `${result.error === undefined ? '' : `, ${String(result.error)}`}\n` +
        `--- what the report counted ---\n${counted}\n` +
        `--- the suite's last 40 lines ---\n${tail}`,
    };
  }
  if (suite !== 'browser') {
    const staged = run('pnpm', ['run', suite], workspaceRoot);
    return gateVerdict({
      gate: suite,
      status: staged.status,
      output: spawnedOutput(staged),
      caughtWhen,
    });
  }

  // The browser gate serves the consumer's already-built Angular bundle. Refreshing the package in
  // `node_modules` does not rebuild that bundle, so without this the browser would run the old
  // Equator and every browser-named injection would report itself unguarded. Re-materializing
  // installs the injected build and rebuilds the application.
  //
  // Materializing is asserted rather than folded into the `&&` chain, and the reason is a false
  // result this gate actually produced. `verify:consumer` materializes *and* runs the suite, so a
  // `pnpm run verify:consumer` that dies in `rmdir` (which it does on Windows whenever
  // anything still holds the consumer directory) returns non-zero, and a non-zero suite is
  // what this function calls a catch. One run reported `deferred-content-hydrates-in-the-stale-locale`,
  // an injection since removed along with the directive it targeted, as caught on that basis;
  // run again with the two steps separated it was MISSED, which was the true answer and the finding
  // that ended the directive. A gate that cannot tell "the suite failed" from "the suite could not run" reports
  // coverage it does not have, which is the one thing it exists not to do.
  required(
    'pnpm',
    ['run', 'materialize:consumer'],
    workspaceRoot,
    'Materializing the consumer failed. That is an infrastructure failure, not a caught mutation, and it must stop the run rather than be counted as coverage.',
  );
  // The consumer gate initializes and builds what the browser serves. A browser-named injection is
  // one its suite cannot see, so a failure here is a consumer that could not be prepared.
  const prepared = run(
    'node',
    ['./tools/verify-package-consumer.ts'],
    workspaceRoot,
  );
  if (prepared.status !== 0) {
    return {
      verdict: 'unmeasured',
      why: `The consumer could not be prepared for the browser (exit ${prepared.status ?? 'null'}):\n${spawnedOutput(prepared).trim().split('\n').slice(-6).join('\n')}`,
    };
  }
  const browsed = run(
    'pnpm',
    ['run', 'verify:browser-assurance'],
    workspaceRoot,
  );
  return gateVerdict({
    gate: 'verify:browser-assurance',
    status: browsed.status,
    output: spawnedOutput(browsed),
    caughtWhen,
  });
}

/**
 * The consumer has to exist before the first injection, and this stage is the only thing that can
 * be sure it does.
 *
 * Sharing a tree with `verify:consumer` makes it sure by accident, on the gate graph happening to
 * order them. Running in a tree of its own means nothing is here that this file did not put here,
 * which is the property that makes mutating tracked source safe, and it cuts both ways. So the
 * preparation is explicit: build, then the consumer gate itself, once, before the first injection
 * rather than per injection. It runs unconditionally, because a consumer already in the tree may be
 * one nobody initialized.
 */
required(
  'pnpm',
  ['run', 'build'],
  workspaceRoot,
  'The workspace did not build, so there is nothing to hand a consumer.',
);
// Prepared the way `verify:consumer` prepares it, by running it: a materialized consumer has no
// configuration until `equator init` writes one, and its suite fails on every injection without
// one, for a reason that has nothing to do with the injection.
required(
  'pnpm',
  ['run', 'verify:consumer'],
  workspaceRoot,
  'The consumer could not be prepared before any injection was applied. That is an infrastructure failure and it must stop the run rather than be reported as coverage.',
);
// And the suite must pass with nothing injected. A suite that fails already fails with every
// injection too, which is no catch.
const baseline = suiteVerdict(undefined);
assert.equal(
  baseline.verdict,
  'passed',
  `The consumer suite does not pass with nothing injected (${baseline.verdict}${baseline.why === undefined ? '' : `: ${baseline.why}`}${baseline.failed === undefined ? '' : `: ${baseline.failed.join('; ')}`}), so no injection could be measured against it.`,
);

/** Guarded by nothing and not known to be: the failure this gate exists to report. */
const missed: RuntimeInjection[] = [];
/** Guarded by nothing, recorded as such, and said out loud on every run. */
const known: RuntimeInjection[] = [];
/** Recorded as a gap and no longer one, which means the record is what needs correcting. */
const closed: RuntimeInjection[] = [];
/** The suite did not run to a verdict, so nothing was learned either way. */
const unmeasured: (RuntimeInjection & { readonly why: string | undefined })[] =
  [];

// Browser-named injections last. Each re-materializes the consumer, and whatever state that leaves
// is what every later injection's suite would run in.
const stageIds = new Set(steps.map(({ id }) => id));
for (const { id, suite, caughtWhen } of injections) {
  assert.ok(
    suite === undefined || suite === 'browser' || stageIds.has(suite),
    `Injection ${id} names ${suite} as its suite, which is no gate stage.`,
  );
  assert.ok(
    suite === undefined || caughtWhen instanceof RegExp,
    `Injection ${id} names ${suite} and no \`caughtWhen\`, so no failure of that stage could count as its catch.`,
  );
}
// A stage-named injection runs after the consumer's own, because a consumer stage re-materializes
// the consumer the others run in.
const ordered = [
  ...injections.filter(({ suite }) => suite === undefined),
  ...injections.filter(
    ({ suite }) => suite !== undefined && suite !== 'browser',
  ),
  ...injections.filter(({ suite }) => suite === 'browser'),
];
for (const injection of ordered) {
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
    const outcome = suiteVerdict(injection.suite, injection.caughtWhen);
    if (outcome.verdict === 'unmeasured') {
      process.stdout.write(
        `NOT RUN ${injection.id}\n          ${injection.invariant}\n          ${outcome.why}\n`,
      );
      unmeasured.push({ ...injection, why: outcome.why });
      continue;
    }
    const caught = outcome.verdict === 'caught';
    const label = caught
      ? injection.knownGap === undefined
        ? 'caught '
        : 'CLOSED '
      : injection.knownGap === undefined
        ? 'MISSED '
        : 'known  ';
    process.stdout.write(
      `${label} ${injection.id}\n          ${injection.invariant}\n`,
    );
    // A recorded gap that starts being caught is a marker to delete, and saying so is the only
    // thing that stops the list becoming a place where findings go to be forgotten.
    if (caught && injection.knownGap !== undefined) closed.push(injection);
    if (!caught && injection.knownGap === undefined) missed.push(injection);
    if (!caught && injection.knownGap !== undefined) known.push(injection);
  } finally {
    await writeFile(path, original, 'utf8');
    assert.equal(
      await readFile(path, 'utf8'),
      original,
      `Failed to restore ${injection.source} after injection ${injection.id}.`,
    );
  }
}

// The consumer is left holding whichever build ran last, which is an injected one whenever this
// gate fails. Restored unconditionally so a later gate cannot inherit a package nobody meant to
// publish.
required(
  'pnpm',
  ['run', 'build'],
  workspaceRoot,
  'The workspace did not rebuild after the injections were restored.',
);
refreshConsumer(
  'The materialized consumer was left holding an injected build.',
);

if (known.length > 0) {
  process.stdout.write(
    `\n${known.length} recorded gap(s), guarded by nothing and known to be:\n${known
      .map(({ id, knownGap }) => `  ${id}\n    ${knownGap}\n`)
      .join('')}`,
  );
}

// A recorded gap that starts being caught is a marker to delete. Failing on it is what stops the
// list turning into a place findings go to be forgotten.
if (closed.length > 0) {
  process.stderr.write(
    `\n${closed.length} recorded gap(s) are now guarded. Delete the knownGap marker so the guard is required from here:\n${closed
      .map(({ id }) => `  ${id}\n`)
      .join('')}`,
  );
  process.exitCode = 1;
}

if (unmeasured.length > 0) {
  process.stderr.write(
    `\n${unmeasured.length} runtime invariant(s) could not be measured, because the suite did not run to a failure:\n${unmeasured
      .map(({ id, why }) => `  ${id}\n    ${why}\n`)
      .join('')}`,
  );
  process.exitCode = 1;
}

if (missed.length > 0) {
  process.stderr.write(
    `\n${missed.length} runtime invariant(s) are guarded by nothing:\n${missed
      .map(
        ({ id, invariant }) =>
          `  ${id}\n    ${invariant}\n    The consumer suite passed with the behaviour removed.\n`,
      )
      .join('')}`,
  );
  process.exitCode = 1;
} else if (closed.length === 0 && unmeasured.length === 0) {
  process.stdout.write(
    `\n${injections.length - known.length} of ${injections.length} runtime invariants are guarded by a suite that notices when they stop holding.\n`,
  );
}
