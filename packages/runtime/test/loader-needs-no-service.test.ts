/**
 * Loading every catalog of a set with the network and every persistent store taken away.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 8: the standard loader uses generated
 * same-release modules and nothing else. Each host facility a loader could reach for is replaced
 * with one that throws, so a load that touched any of them would fail rather than pass quietly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOCALES,
  compileSet,
  createStore,
  scope,
} from './catalog-store-harness.js';

const FACILITIES = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'indexedDB',
  'caches',
  'localStorage',
  'sessionStorage',
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the standard loader needs no service', () => {
  it('admits every catalog with the network and persistent stores unavailable', async () => {
    const touched: string[] = [];
    for (const name of FACILITIES) {
      vi.stubGlobal(
        name,
        new Proxy(() => undefined, {
          apply() {
            touched.push(name);
            throw new Error(`${name} is unavailable`);
          },
          construct() {
            touched.push(name);
            throw new Error(`${name} is unavailable`);
          },
          get(_target, property) {
            touched.push(`${name}.${String(property)}`);
            throw new Error(`${name} is unavailable`);
          },
        }),
      );
    }
    const store = createStore(compileSet());
    const signal = new AbortController().signal;
    const admitted: string[] = [];
    for (const scopeId of ['shell', 'lazy']) {
      for (const locale of LOCALES) {
        try {
          const lease = await store.acquire(scope(scopeId), locale, signal);
          admitted.push(
            `${lease.catalog.key.scopeId}:${lease.catalog.key.catalogLocale}`,
          );
          lease.release();
        } catch {
          // The facility the load reached for is recorded in `touched`, which is asserted first.
        }
      }
    }
    expect(touched).toEqual([]);
    expect(admitted).toEqual([
      'shell:en-US',
      'shell:ar-EG',
      'lazy:en-US',
      'lazy:ar-EG',
    ]);
  });
});
