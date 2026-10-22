// First, and on its own line, for the reason `locale-cookie-defaults.test.ts` states: the stores
// reach `@angular/common`, whose bundle needs a compiler that no plain Node process has.
import '@angular/compiler';

import { Injector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  localStorageStore,
  type LocalStorageStoreOptions,
} from '../src/persistence.js';

/**
 * The local-storage store, read in a browser whose storage cannot be read.
 *
 * A browser can refuse storage outright: with site data blocked, reading it throws instead of
 * answering with nothing. A remembered locale nobody can read is one that is absent, and the
 * sources after this one are how an absent one is handled, so the store answers with nothing and
 * the throw goes no further.
 */

function storeOver(
  storage: Partial<Storage>,
  platform = 'browser',
  options?: LocalStorageStoreOptions,
) {
  vi.stubGlobal('localStorage', storage);
  const injector = Injector.create({
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  return runInInjectionContext(injector, localStorageStore(options));
}

describe('the local-storage store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads what the storage holds under its key', async () => {
    const asked: string[] = [];
    const store = storeOver({
      getItem: (key) => {
        asked.push(key);
        return 'ar-EG';
      },
    });

    expect(store.id).toBe('local-storage');
    expect(await store.read()).toBe('ar-EG');
    expect(asked).toStrictEqual(['equator-locale']);
  });

  it('reads under the key it is handed, where it is handed one', async () => {
    const asked: string[] = [];
    const store = storeOver(
      {
        getItem: (key) => {
          asked.push(key);
          return 'ar-EG';
        },
      },
      'browser',
      { key: 'chosen-locale' },
    );

    expect(await store.read()).toBe('ar-EG');
    expect(asked).toStrictEqual(['chosen-locale']);
  });

  it('reads nothing, and asks the storage nothing, outside a browser', async () => {
    let asked = 0;
    const store = storeOver(
      {
        getItem: () => {
          asked += 1;
          return 'ar-EG';
        },
      },
      'server',
    );

    expect(await store.read()).toBeUndefined();
    expect(asked).toBe(0);
  });

  it('reads nothing, and does not throw, where reading the storage throws', async () => {
    let asked = 0;
    const store = storeOver({
      getItem: () => {
        asked += 1;
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });

    expect(await store.read()).toBeUndefined();
    expect(asked).toBe(1);
  });
});
