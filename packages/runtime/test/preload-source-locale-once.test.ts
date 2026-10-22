import { describe, expect, it } from 'vitest';

import {
  LAZY,
  SHELL,
  observed,
  runtime,
} from './transaction-runtime-harness.js';

describe('preloading a scope in the source locale', () => {
  it('asks the store for the source catalog once', async () => {
    const watched = observed();
    const { localization } = runtime({
      setup: { maximumCachedCatalogs: 1 },
      options: { observability: watched.emitter },
    });
    await localization.initialize();
    await localization.ensureScope(LAZY);
    const full = () =>
      watched.phase('cache').filter(({ status }) => status === 'unavailable')
        .length;
    const before = full();

    await localization.preloadScope(SHELL);

    expect(full() - before).toBe(1);
    localization.dispose();
  });
});
