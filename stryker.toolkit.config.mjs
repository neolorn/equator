import base from './stryker.config.mjs';

/**
 * The toolkit's compiler, its parser and its number option rules, and nothing else.
 *
 * The toolkit is not excluded from mutation testing on principle, and it never was. It is excluded
 * by arithmetic: all 15,662 of its mutants do not finish, and the reason is not the count, which is
 * comparable to the runtime's. It is that a large share of the toolkit's 531-test suite is related
 * to any one mutant, so a mutant that hangs costs the full timeout before it is scored, and the
 * suite it is timed against runs for nineteen seconds.
 *
 * So the slice is the part of the toolkit where a surviving mutant means the most and the covering
 * tests are cheapest: the semantic model and the compiler that drives it, the message parser, and
 * the rules a numeric function's options are judged by. Four files, all pure. The I/O-bound modules stay out, which is where the project host, the
 * output host, and the file watching live.
 *
 * Two files a mutation run must never touch are absent by being unnamed rather than by exclusion:
 * `message-format-syntax.ts` and `message-function-options.ts` exist once in each package, and a
 * test reads both copies and asserts they are the same bytes. Instrumenting either copy changes its
 * bytes, so mutating one fails that test in the dry run and nothing is measured at all.
 *
 * ## The reading on the runner
 *
 * Four workers, three jobs, 2,735 mutants: 1,525 killed, 343 timed out, 463 survived, 404 with no
 * coverage, no errors. Per file, total then covered: `message-format.ts` 90.02 and 92.84,
 * `compiler.ts` 74.74 and 80.10, `semantic-model.ts` 56.63 and 73.72. The jobs are 1h37m, 2h15m
 * and 2h08m, six hours of job time inside 2h15m of wall because they run beside each other.
 *
 * **Prefer this one, and it is the lower one.** 343 timed out here against 538 locally, and a
 * timeout is scored as a kill, so the local figures were holding an unknown number of survivors
 * behind the clock. Releasing them moves every module down and `compiler.ts` furthest, 85.80
 * covered locally against 80.10 here. The 463 survivors are 54 more than the local run found, and
 * the mutants with no coverage are unchanged at 404 against 403, which is the half of the reading
 * that does not depend on the machine.
 *
 * `semantic-model.ts` is still where the next pass goes: 341 of the uncovered mutants and 297 of
 * the survivors are in it.
 *
 * ## The reading taken locally
 *
 * Kept because the analysis under it was derived by reading those survivors rather than counting
 * them, and because the pair is what shows the timeout effect.
 *
 * Measured locally, at the 24 workers the base configuration caps this machine to: 2,744 mutants
 * across the three files, 43 minutes 32 seconds, 1,394 killed, 538 timed out, 409 survived, 403
 * with no coverage, no errors. 70.41 percent total and 82.53 percent covered. Per file, total then
 * covered: `message-format.ts` 90.23 and 93.00, `compiler.ts` 80.24 and 85.80, `semantic-model.ts`
 * 57.66 and 75.20.
 *
 * **Read that score downward.** A timeout is scored as a kill, and 538 of the 2,744 timed out, so
 * the covered figure is a ceiling rather than a measurement: an unknown share of those is a
 * survivor the clock reached first. The 403 mutants with no coverage are the machine-independent
 * half of the reading, and 341 of them are in `semantic-model.ts`, which is also where 278 of the
 * 409 survivors are. That file is where the next pass goes.
 *
 * A second reading exists now, above, and the two together are what the timeout caveat rests on
 * rather than one measurement and an argument.
 */
export default {
  ...base,

  mutate: [
    'packages/toolkit/src/semantic-model.ts',
    'packages/toolkit/src/compiler.ts',
    'packages/toolkit/src/message-format.ts',
    'packages/toolkit/src/number-format-rules.ts',
  ],

  htmlReporter: { fileName: 'tmp/mutation-toolkit/index.html' },
  jsonReporter: { fileName: 'tmp/mutation-toolkit/report.json' },
  tempDirName: 'tmp/mutation-toolkit-sandbox',
};
