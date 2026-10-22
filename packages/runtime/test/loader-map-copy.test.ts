/**
 * The loader map as the store holds it.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 8: the map is copied into a frozen
 * null-prototype map before use, and an accessor or a non-function entry is refused. A getter is
 * consumer code that would run at every lookup, so the case also records whether it ran.
 */
import { describe, expect, it } from 'vitest';

import {
  catalogKey,
  compileSet,
  createStore,
  diagnosticOf,
  loadersFor,
  scope,
} from './catalog-store-harness.js';

describe('the loader map', () => {
  it('refuses an accessor entry without calling it', () => {
    const set = compileSet();
    const loaders = loadersFor(set);
    const key = catalogKey('shell', 'en-US');
    const original = loaders[key]!;
    let reads = 0;
    delete loaders[key];
    Object.defineProperty(loaders, key, {
      enumerable: true,
      get: () => {
        reads += 1;
        return original;
      },
    });
    expect(diagnosticOf(() => createStore(set, loaders))).toMatchObject({
      code: 'invalid-configuration',
    });
    expect(reads).toBe(0);
  });

  it('refuses an entry that is not a function', () => {
    const set = compileSet();
    const loaders = loadersFor(set) as Record<string, unknown>;
    loaders[catalogKey('shell', 'en-US')] = 'catalogs/shell/en-US.js';
    expect(
      diagnosticOf(() => createStore(set, loaders as never)),
    ).toMatchObject({ code: 'invalid-configuration' });
  });

  it('keeps the loaders it was given when the map changes afterwards', async () => {
    const set = compileSet();
    const loaders = loadersFor(set);
    const store = createStore(set, loaders);
    const key = catalogKey('shell', 'en-US');
    loaders[key] = () => {
      throw new Error('A replaced loader ran.');
    };
    await expect(
      store.preload(scope('shell'), 'en-US', new AbortController().signal),
    ).resolves.toBeUndefined();
  });
});
