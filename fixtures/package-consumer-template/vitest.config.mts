import { capabilityClaimsReporters } from './tools/capability-evidence.ts';

/**
 * One worker, one file at a time, on every machine that runs this suite.
 *
 * `@angular/build:unit-test` defaults `isolate` to false, so spec files that share a worker share a
 * jsdom, and how many workers there are is decided by the core count. That made this suite's result
 * a property of the machine: green on 32 threads, red on the two a hosted runner has, with the same
 * commit and the same code. Pinning it to the sharing-heaviest arrangement makes the answer the
 * same everywhere, and makes it the strict one: a spec file that leaves state behind is caught by
 * the next file rather than by whichever machine happens to schedule them together.
 *
 * It costs nothing worth counting: the suite is a few seconds of tests inside a build that is not.
 */
export default {
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    // The deadline ends a test that hangs. At the runner's default of five seconds it also ends
    // the first test of a file on a machine busy with something else, where creating the first
    // component and loading its catalogs has taken longer than that.
    testTimeout: 30_000,
    // The builder keeps a runner configuration's reporters only while its own `reporters` option
    // is unset, which `angular.json` leaves it.
    reporters: capabilityClaimsReporters({ consumer: true }),
    // A browser run writes a failed test's screenshot beside its spec by default, which puts a
    // directory named after the spec among the application's sources. The failure's own report
    // says what failed.
    browser: { screenshotFailures: false },
  },
};
