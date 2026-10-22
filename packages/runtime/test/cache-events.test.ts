/**
 * What the catalog cache reports under its own event code.
 *
 * `specs/11-diagnostics-and-observability.spec.md` section 1 lists caching among the areas a
 * release reports on, and section 7 names what the cache reports: an entry it evicts, a bound it
 * cannot keep because what is over it is pinned, and a transferred catalog it refuses to admit.
 * Each of these happens without any request failing, which is why nothing else reports it.
 */
import { describe, expect, it } from 'vitest';

import { LocalCatalogStore } from '../src/catalog-runtime.js';
import {
  RUNTIME_EVENT_CODES,
  type LocalizationEventInput,
} from '../src/observability.js';
import {
  PROVIDER,
  compileSet,
  loadersFor,
  scope,
  type CompiledSet,
} from './catalog-store-harness.js';

function observedStore(set: CompiledSet, maximumEntries?: number) {
  const events: LocalizationEventInput[] = [];
  const store = new LocalCatalogStore(
    set.configuration,
    set.descriptor,
    loadersFor(set),
    maximumEntries,
    false,
    { emit: (event) => events.push(event) },
  );
  return { store, events };
}

const cacheEvents = (events: readonly LocalizationEventInput[]) =>
  events.filter(({ code }) => code === RUNTIME_EVENT_CODES.cache);

describe('the catalog cache', () => {
  it('reports the entry it evicts', async () => {
    const { store, events } = observedStore(compileSet(), 1);
    const signal = new AbortController().signal;

    await store.preload(scope('shell'), 'en-US', signal);
    expect(cacheEvents(events)).toEqual([]);
    await store.preload(scope('shell'), 'ar-EG', signal);

    expect(cacheEvents(events)).toEqual([
      {
        code: RUNTIME_EVENT_CODES.cache,
        phase: 'cache',
        status: 'succeeded',
        providerId: PROVIDER,
        scopeId: 'shell',
        targetLocale: 'en-US',
        count: 1,
      },
    ]);
  });

  it('reports a bound it cannot keep because what is over it is pinned', async () => {
    const { store, events } = observedStore(compileSet(), 1);
    const signal = new AbortController().signal;

    const first = await store.acquire(scope('shell'), 'en-US', signal);
    const second = await store.acquire(scope('shell'), 'ar-EG', signal);
    // Both are held, so neither was evicted to make room for the other.
    expect(cacheEvents(events)).toEqual([]);

    await store.preload(scope('lazy'), 'en-US', signal);

    expect(cacheEvents(events)).toEqual([
      {
        code: RUNTIME_EVENT_CODES.cache,
        phase: 'cache',
        status: 'succeeded',
        providerId: PROVIDER,
        scopeId: 'lazy',
        targetLocale: 'en-US',
        count: 2,
      },
      {
        code: RUNTIME_EVENT_CODES.cache,
        phase: 'cache',
        status: 'unavailable',
        count: 2,
      },
    ]);
    first.release();
    second.release();
  });

  it('reports a transferred catalog it refuses to admit', async () => {
    const set = compileSet();
    const { store, events } = observedStore(set);
    const tampered = structuredClone(
      set.catalogs.find(
        ({ key }) => key.scopeId === 'shell' && key.catalogLocale === 'ar-EG',
      ),
    ) as unknown as { messages: { id: string }[] };
    tampered.messages[0]!.id = `${tampered.messages[0]!.id}-changed`;

    await expect(store.seed(tampered)).rejects.toBeDefined();

    expect(cacheEvents(events)).toEqual([
      {
        code: RUNTIME_EVENT_CODES.cache,
        phase: 'cache',
        status: 'failed',
        reason: 'catalog-admission-failed',
        providerId: PROVIDER,
        scopeId: 'shell',
        targetLocale: 'ar-EG',
      },
    ]);
  });

  it('reports nothing for a catalog it admits or holds within its bound', async () => {
    const set = compileSet();
    const { store, events } = observedStore(set);
    const signal = new AbortController().signal;

    await store.seed(
      structuredClone(
        set.catalogs.find(
          ({ key }) => key.scopeId === 'shell' && key.catalogLocale === 'en-US',
        ),
      ),
    );
    await store.preload(scope('lazy'), 'en-US', signal);

    expect(store.cachedCount).toBe(2);
    expect(cacheEvents(events)).toEqual([]);
  });
});
