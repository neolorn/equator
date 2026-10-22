import { mergeConfig } from 'vitest/config';

import { capabilityClaimsReporters } from './tools/capability-evidence.mjs';
import shared from './vitest.config.ts';

/** The runtime suite. `vitest.toolkit.config.ts` carries the reasoning for the separate cache. */
export default mergeConfig(shared, {
  cacheDir: 'node_modules/.vite/runtime',
  // Here and not in the shared configuration, which the two injecting verifiers use: a run under an
  // injected defect has no claims to record.
  test: { reporters: capabilityClaimsReporters() },
});
