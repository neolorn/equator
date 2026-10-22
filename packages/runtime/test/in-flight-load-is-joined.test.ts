/**
 * A second request for a catalog that is still loading.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 9 joins it to the first. A locale change
 * is joined earlier, at the transaction, so the store's own join is reached only by requests that
 * arrive by different paths: here a preload and an acquire for one catalog identity.
 */
import { describe, expect, it } from 'vitest';

import {
  catalogKey,
  compileSet,
  createStore,
  loadersFor,
  scope,
} from './catalog-store-harness.js';

describe('an in-flight load', () => {
  it('is shared by a preload and an acquire that arrive before it settles', async () => {
    const set = compileSet();
    const loaders = loadersFor(set);
    const key = catalogKey('lazy', 'en-US');
    const original = loaders[key]!;
    let calls = 0;
    let settle!: () => void;
    const gate = new Promise<void>((resolve) => {
      settle = resolve;
    });
    loaders[key] = async () => {
      calls += 1;
      await gate;
      return original();
    };
    const store = createStore(set, loaders);
    const signal = new AbortController().signal;

    const preloaded = store.preload(scope('lazy'), 'en-US', signal);
    const acquired = store.acquire(scope('lazy'), 'en-US', signal);
    await Promise.resolve();
    settle();
    await preloaded;
    const lease = await acquired;

    expect(calls).toBe(1);
    expect(lease.catalog.key.scopeId).toBe('lazy');
    lease.release();
  });
});
