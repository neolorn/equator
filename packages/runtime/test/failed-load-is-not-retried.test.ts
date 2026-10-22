/**
 * A loader that fails once, and what the store does about it.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 8 defines no retry and forbids one
 * behind the loader contract, and section 9 forbids turning a failed load into a cache entry. So
 * one request is one call, its failure is reported as a load failure, and the next request calls
 * the loader again rather than replaying the failure.
 */
import { describe, expect, it } from 'vitest';

import {
  catalogKey,
  compileSet,
  createStore,
  loadersFor,
  rejectionOf,
  scope,
} from './catalog-store-harness.js';

describe('a failed load', () => {
  it('is reported after one call, and the next request loads afresh', async () => {
    const set = compileSet();
    const loaders = loadersFor(set);
    const key = catalogKey('shell', 'en-US');
    const original = loaders[key]!;
    let calls = 0;
    loaders[key] = () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('chunk unavailable'));
      return original();
    };
    const store = createStore(set, loaders);
    const signal = new AbortController().signal;

    expect(
      await rejectionOf(() => store.preload(scope('shell'), 'en-US', signal)),
    ).toMatchObject({
      code: 'catalog-load-failed',
      reason: 'module-load-failed',
    });
    expect(calls).toBe(1);
    expect(store.cachedCount).toBe(0);

    await expect(
      store.preload(scope('shell'), 'en-US', signal),
    ).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
