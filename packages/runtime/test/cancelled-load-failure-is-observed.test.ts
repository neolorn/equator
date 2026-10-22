/**
 * A load whose caller has already cancelled still has its failure observed.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 9: the load is shared by catalog
 * identity and outlives any one caller's signal. When every caller has gone, its failure still has
 * to be observed, because Node ends the process on a rejection nobody handles, and a server render
 * cancels its loads whenever the response is abandoned.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  catalogKey,
  compileSet,
  createStore,
  loadersFor,
  scope,
} from './catalog-store-harness.js';

const unhandled: unknown[] = [];
const record = (reason: unknown) => unhandled.push(reason);

afterEach(() => {
  process.off('unhandledRejection', record);
  unhandled.length = 0;
});

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('a failed load whose caller cancelled first', () => {
  for (const operation of ['acquire', 'preload'] as const) {
    it(`leaves no unhandled rejection through ${operation}`, async () => {
      process.on('unhandledRejection', record);
      const set = compileSet();
      const loaders = loadersFor(set);
      loaders[catalogKey('shell', 'ar-EG')] = () =>
        Promise.reject(
          new TypeError('Failed to fetch dynamically imported module'),
        );
      const store = createStore(set, loaders);
      const controller = new AbortController();
      controller.abort();

      await expect(
        store[operation](scope('shell'), 'ar-EG', controller.signal),
      ).rejects.toBeDefined();
      await settle();

      expect(unhandled).toEqual([]);
    });
  }
});
