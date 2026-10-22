import { mergeConfig } from 'vitest/config';

import { capabilityClaimsReporters } from './tools/capability-evidence.mjs';
import shared from './vitest.config.ts';

/** Also the base of `WAIT_BOUND_MS` in `packages/toolkit/test/fixtures.ts`. */
export const TOOLKIT_TEST_BOUND_MS = 120_000;

/**
 * The toolkit suite, which is the shared configuration plus a cache directory of its own.
 *
 * Vitest resolves its results cache to `<cacheDir>/vitest/<sha1 of the project name>`, and a suite
 * with no project name hashes the empty string, so two of them share one `results.json`. Each run
 * then replaces the other's record of which tests failed, which is the input to the ordering vitest
 * applies on the next run. The gate runs the two suites at the same time, so without a cache
 * directory here two processes write one file, and a wrong cache costs ordering rather than
 * results, which is to say it costs nothing anyone would see.
 *
 * The shared configuration is imported rather than copied, so the reasoning behind the one alias it
 * carries stays in one place. The two injecting verifiers use that file directly and keep the
 * unnamed cache; they run alone, so nothing else is writing it while they do.
 */
export default mergeConfig(shared, {
  cacheDir: 'node_modules/.vite/toolkit',
  // Here and not in the shared configuration, which the two injecting verifiers use: a run under an
  // injected defect has no claims to record.
  test: {
    reporters: capabilityClaimsReporters(),
    /**
     * The shared bound is sized for the slowest test under the suite's own load. The toolkit's
     * slowest write a project tree, generate into it and watch it, and what they cost follows what
     * else the machine is running, so here the bound is sized for a hang alone: a test that
     * reaches it was never going to finish.
     */
    testTimeout: TOOLKIT_TEST_BOUND_MS,
  },
});
