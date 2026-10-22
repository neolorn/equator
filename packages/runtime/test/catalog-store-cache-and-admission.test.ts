/**
 * What the catalog store keeps, lets go of, takes from a transfer, and refuses to construct over.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 4 lists what is settled before a catalog
 * is loaded and what a candidate must be to be admitted; section 9 bounds the cache, pins what is
 * in use and evicts the least recently used of the rest; section 10 lets a failure name the
 * provider, the scope and the locale and nothing else. A catalog offered by a transfer is admitted
 * exactly as a loaded one is, and one this application has no entry for is not this store's to
 * judge, so it is passed over without a failure.
 */
import { describe, expect, it } from 'vitest';

import { LocalCatalogStore } from '../src/catalog-runtime.js';
import {
  RUNTIME_EVENT_CODES,
  type LocalizationEventInput,
} from '../src/observability.js';
import { RUNTIME_LIMITS } from '../src/runtime-safety.js';
import {
  PROVIDER,
  catalogKey,
  compileSet,
  diagnosticOf,
  editedSet,
  loadersFor,
  rejectionOf,
  scope,
  type CompiledSet,
} from './catalog-store-harness.js';

// Compiled on first use, so that importing this file runs none of the library.
let fixture: CompiledSet | undefined;
const compiled = (): CompiledSet => (fixture ??= compileSet());

type Loaders = Record<string, () => unknown>;

interface StoreFixture {
  readonly set?: CompiledSet;
  readonly maximumEntries?: number;
  readonly loaders?: Loaders;
  /** False for a store with no emitter at all, which is how most applications run. */
  readonly observed?: boolean;
}

function storeOver(fixture: StoreFixture = {}) {
  const set = fixture.set ?? compiled();
  const events: LocalizationEventInput[] = [];
  const store = new LocalCatalogStore(
    set.configuration,
    set.descriptor,
    fixture.loaders ?? loadersFor(set),
    fixture.maximumEntries,
    false,
    fixture.observed === false
      ? undefined
      : { emit: (event) => events.push(event) },
  );
  return { store, events };
}

/** A copy of one compiled catalog that a case may change freely. */
function catalogOf(scopeId: string, locale: string): Record<string, unknown> {
  const catalog = compiled().catalogs.find(
    ({ key }) => key.scopeId === scopeId && key.catalogLocale === locale,
  );
  if (catalog === undefined) throw new Error('No such catalog in the fixture');
  return structuredClone(catalog) as unknown as Record<string, unknown>;
}

const evicted = (scopeId: string, locale: string, count: number) => ({
  code: RUNTIME_EVENT_CODES.cache,
  phase: 'cache',
  status: 'succeeded',
  providerId: PROVIDER,
  scopeId,
  targetLocale: locale,
  count,
});

const live = (): AbortSignal => new AbortController().signal;

/** Every microtask and timer already due. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** Runs `action` and answers the rejections nothing handled while it ran. */
async function unhandledDuring(
  action: () => Promise<void>,
): Promise<readonly unknown[]> {
  const unhandled: unknown[] = [];
  const record = (error: unknown) => unhandled.push(error);
  process.on('unhandledRejection', record);
  try {
    await action();
    // An unhandled rejection is reported after the microtasks drain, so a timer is past it.
    await settled();
  } finally {
    process.off('unhandledRejection', record);
  }
  return unhandled;
}

describe('a catalog that could not be loaded', () => {
  it('names the provider, the scope and the locale it was for', async () => {
    const { store } = storeOver({
      loaders: {
        ...loadersFor(compiled()),
        [catalogKey('shell', 'ar-EG')]: () => {
          throw new Error('the chunk is gone');
        },
      },
    });

    expect(
      await rejectionOf(() => store.preload(scope('shell'), 'ar-EG', live())),
    ).toMatchObject({
      code: 'catalog-load-failed',
      outcome: 'operational-failure',
      reason: 'module-load-failed',
      providerId: PROVIDER,
      scopeId: 'shell',
      targetLocale: 'ar-EG',
    });
  });

  it('keeps what the loader threw as the cause', async () => {
    const thrown = new Error('the chunk is gone');
    const { store } = storeOver({
      loaders: {
        ...loadersFor(compiled()),
        [catalogKey('shell', 'ar-EG')]: () => {
          throw thrown;
        },
      },
    });

    await expect(
      store.preload(scope('shell'), 'ar-EG', live()),
    ).rejects.toMatchObject({ cause: thrown });
  });
});

describe('a catalog the set has no entry for', () => {
  it('is an unavailable representation and not a failed load', async () => {
    const { store } = storeOver({
      set: editedSet(compiled(), ({ configuration }) => {
        (configuration as Record<string, unknown>)['locales'] = [
          'en-US',
          'ar-EG',
          'fr-FR',
        ];
      }),
    });

    expect(store.has(scope('shell'), 'ar-EG')).toBe(true);
    expect(store.has(scope('shell'), 'fr-FR')).toBe(false);
    expect(
      await rejectionOf(() => store.preload(scope('shell'), 'fr-FR', live())),
    ).toMatchObject({
      code: 'scope-unavailable',
      outcome: 'localized-representation-unavailable',
      providerId: PROVIDER,
      scopeId: 'shell',
      targetLocale: 'fr-FR',
    });
  });
});

describe('how many catalogs the store may keep', () => {
  it('defaults to every catalog in the set', () => {
    expect(storeOver().store.maximumEntries).toBe(4);
  });

  it.each([1, 4])('may be set to %i of the four', (maximumEntries) => {
    expect(storeOver({ maximumEntries }).store.maximumEntries).toBe(
      maximumEntries,
    );
  });

  it.each([0, -1, 1.5, 5, Number.NaN, Number.POSITIVE_INFINITY])(
    'may not be set to %d',
    (maximumEntries) => {
      const diagnostic = diagnosticOf(() => storeOver({ maximumEntries }));

      expect(diagnostic?.code).toBe('invalid-configuration');
      // No catalog is involved, so the diagnostic names none and gives no reason.
      expect(Object.keys(diagnostic ?? {}).sort()).toStrictEqual([
        'code',
        'message',
        'outcome',
      ]);
    },
  );
});

describe('the cache’s bound', () => {
  it('lets go of the least recently used catalog, counting a transfer as a use', async () => {
    const { store, events } = storeOver({ maximumEntries: 2 });

    await store.preload(scope('shell'), 'en-US', live());
    await store.preload(scope('shell'), 'ar-EG', live());
    // Offered again by a transfer, which makes the older of the two the more recently used.
    await store.seed(catalogOf('shell', 'en-US'));
    await store.preload(scope('lazy'), 'en-US', live());

    expect(events).toStrictEqual([evicted('shell', 'ar-EG', 2)]);
  });

  it('counts a transferred catalog as used when it arrived', async () => {
    const { store, events } = storeOver({ maximumEntries: 2 });

    await store.preload(scope('shell'), 'en-US', live());
    await store.seed(catalogOf('shell', 'ar-EG'));
    await store.preload(scope('lazy'), 'en-US', live());

    expect(events).toStrictEqual([evicted('shell', 'en-US', 2)]);
  });

  it('is kept when a transfer takes the cache over it', async () => {
    const { store, events } = storeOver({ maximumEntries: 1 });

    await store.preload(scope('shell'), 'en-US', live());
    await store.seed(catalogOf('shell', 'ar-EG'));

    expect(store.cachedCount).toBe(1);
    expect(events).toStrictEqual([evicted('shell', 'en-US', 1)]);
  });

  it('makes a released catalog the one to let go of', async () => {
    const { store, events } = storeOver({ maximumEntries: 1 });

    const lease = await store.acquire(scope('shell'), 'en-US', live());
    lease.release();
    await store.preload(scope('shell'), 'ar-EG', live());

    expect(events).toStrictEqual([evicted('shell', 'en-US', 1)]);
    expect(store.cachedCount).toBe(1);
  });

  it('counts a catalog asked for again as used again', async () => {
    const { store, events } = storeOver({ maximumEntries: 2 });

    await store.preload(scope('shell'), 'en-US', live());
    await store.preload(scope('shell'), 'ar-EG', live());
    await store.preload(scope('shell'), 'en-US', live());
    await store.preload(scope('lazy'), 'en-US', live());

    expect(events).toStrictEqual([evicted('shell', 'ar-EG', 2)]);
  });

  it('holds a catalog until every lease on it is released, each release counting once', async () => {
    const { store, events } = storeOver({ maximumEntries: 1 });

    const first = await store.acquire(scope('shell'), 'en-US', live());
    const second = await store.acquire(scope('shell'), 'en-US', live());
    first.release();
    first.release();
    await store.preload(scope('shell'), 'ar-EG', live());

    // The second lease still holds it, so the catalog nobody holds is the one let go.
    expect(events.slice(0, 1)).toStrictEqual([evicted('shell', 'ar-EG', 1)]);
    second.release();
  });

  it('holds a leased catalog a transfer offers again, until the lease is released', async () => {
    let loads = 0;
    const { store, events } = storeOver({
      maximumEntries: 1,
      loaders: {
        ...loadersFor(compiled()),
        [catalogKey('shell', 'en-US')]: () => {
          loads += 1;
          return catalogOf('shell', 'en-US');
        },
      },
    });

    const lease = await store.acquire(scope('shell'), 'en-US', live());
    await store.seed(catalogOf('shell', 'en-US'));
    // Past the bound of one: the catalog nobody holds is the one let go.
    await store.preload(scope('shell'), 'ar-EG', live());

    expect(events).toStrictEqual([evicted('shell', 'ar-EG', 1)]);
    const again = await store.acquire(scope('shell'), 'en-US', live());
    expect(loads).toBe(1);
    again.release();

    lease.release();
    await store.preload(scope('shell'), 'ar-EG', live());

    expect(events).toStrictEqual([
      evicted('shell', 'ar-EG', 1),
      evicted('shell', 'en-US', 1),
    ]);
    expect(store.cachedCount).toBe(1);
  });

  it('holds a leased catalog whose own load finishes after a transfer supplied it', async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { store, events } = storeOver({
      maximumEntries: 1,
      loaders: {
        ...loadersFor(compiled()),
        [catalogKey('shell', 'en-US')]: () =>
          held.then(() => catalogOf('shell', 'en-US')),
      },
    });

    const loading = store.preload(scope('shell'), 'en-US', live());
    await store.seed(catalogOf('shell', 'en-US'));
    const lease = await store.acquire(scope('shell'), 'en-US', live());
    finish();
    await loading;
    await store.preload(scope('shell'), 'ar-EG', live());

    expect(events).toStrictEqual([evicted('shell', 'ar-EG', 1)]);
    expect(store.cachedCount).toBe(1);

    lease.release();
    await store.preload(scope('shell'), 'ar-EG', live());

    expect(events.at(-1)).toStrictEqual(evicted('shell', 'en-US', 1));
  });

  it('gives back nothing to a store disposed while the lease was held', async () => {
    const { store, events } = storeOver({ maximumEntries: 1 });

    const lease = await store.acquire(scope('shell'), 'en-US', live());
    store.dispose();
    lease.release();

    expect(store.cachedCount).toBe(0);
    expect(events).toStrictEqual([]);
  });

  /**
   * A signal that runs `between` at the moment the store stops waiting on it.
   *
   * That moment is after the catalog has loaded and before the caller that asked for it has pinned
   * it, which is when another caller's work can land. Hooking it makes that interleaving a state a
   * case sets up, where two racing loads would make it one a case hopes for.
   */
  function signalThat(between: () => void): AbortSignal {
    const { signal } = new AbortController();
    const stopListening = signal.removeEventListener.bind(signal);
    signal.removeEventListener = (
      ...listener: Parameters<AbortSignal['removeEventListener']>
    ) => {
      stopListening(...listener);
      between();
    };
    return signal;
  }

  it('leases a catalog that was let go between its load and its lease', async () => {
    const { store, events } = storeOver({ maximumEntries: 1 });
    const held = await store.acquire(scope('shell'), 'ar-EG', live());

    const lease = await store.acquire(
      scope('shell'),
      'en-US',
      signalThat(() => {
        // The held catalog is asked for again, which makes the fresh one the older of the two,
        // and then released, which lets the cache go back to its bound.
        void store.preload(scope('shell'), 'ar-EG', live());
        held.release();
      }),
    );

    await settled();

    // First the fresh catalog, while nobody held it; then, once it was leased, the other one.
    expect(events).toStrictEqual([
      evicted('shell', 'en-US', 1),
      evicted('shell', 'ar-EG', 1),
    ]);
    expect(lease.catalog).toEqual(catalogOf('shell', 'en-US'));
    expect(store.cachedCount).toBe(1);

    // Given back, it is let go like any other catalog nobody holds.
    lease.release();
    await store.preload(scope('lazy'), 'en-US', live());
    expect(events.at(-1)).toStrictEqual(evicted('shell', 'en-US', 1));
    expect(store.cachedCount).toBe(1);
  });

  it('counts a lease as a use at the moment it is taken', async () => {
    const { store, events } = storeOver({ maximumEntries: 2 });
    const held = await store.acquire(scope('shell'), 'ar-EG', live());

    const lease = await store.acquire(
      scope('shell'),
      'en-US',
      signalThat(() => {
        void store.preload(scope('shell'), 'ar-EG', live());
      }),
    );
    lease.release();
    held.release();
    await store.preload(scope('lazy'), 'en-US', live());

    // The lease was taken after the other catalog was last asked for.
    expect(events).toStrictEqual([evicted('shell', 'ar-EG', 2)]);
  });

  it('is enforced, and exceeded while everything is held, with no emitter configured', async () => {
    const { store } = storeOver({ maximumEntries: 1, observed: false });

    const first = await store.acquire(scope('shell'), 'en-US', live());
    const second = await store.acquire(scope('shell'), 'ar-EG', live());
    await store.preload(scope('lazy'), 'en-US', live());

    // The two held catalogs stay; the one nobody holds was let go.
    expect(store.cachedCount).toBe(2);
    first.release();
    second.release();
    expect(store.cachedCount).toBe(1);
  });
});

describe('a catalog offered by a transfer', () => {
  it('is served without its loader running', async () => {
    let loads = 0;
    const { store, events } = storeOver({
      loaders: {
        ...loadersFor(compiled()),
        [catalogKey('shell', 'ar-EG')]: () => {
          loads += 1;
          return catalogOf('shell', 'ar-EG');
        },
      },
    });

    await store.seed(catalogOf('shell', 'ar-EG'));
    const lease = await store.acquire(scope('shell'), 'ar-EG', live());

    expect(lease.catalog).toEqual(catalogOf('shell', 'ar-EG'));
    expect(loads).toBe(0);
    expect(events).toStrictEqual([]);
    lease.release();
  });

  it.each<[string, unknown]>([
    ['text', 'not a catalog'],
    ['a list', []],
    ['a record with no key', {}],
    ['a record whose key is not a record', { key: PROVIDER }],
    ['something that is not data at all', () => undefined],
  ])('is passed over when it is %s', async (_name, candidate) => {
    const { store, events } = storeOver();

    await expect(store.seed(candidate)).resolves.toBeUndefined();

    expect(store.cachedCount).toBe(0);
    expect(events).toStrictEqual([]);
  });

  it.each(['providerId', 'scopeId', 'catalogLocale'])(
    'is passed over when its %s is not text, whatever that value reads as',
    async (field) => {
      const { store, events } = storeOver();
      const catalog = catalogOf('shell', 'en-US');
      const key = catalog['key'] as Record<string, unknown>;
      // A one-item list reads as its item when it is joined into an identity.
      key[field] = [key[field]];

      await expect(store.seed(catalog)).resolves.toBeUndefined();

      expect(store.cachedCount).toBe(0);
      expect(events).toStrictEqual([]);
    },
  );

  it('is passed over when this application has no entry for it', async () => {
    const { store, events } = storeOver();
    const catalog = catalogOf('shell', 'en-US');
    (catalog['key'] as Record<string, unknown>)['scopeId'] = 'another-scope';

    await expect(store.seed(catalog)).resolves.toBeUndefined();

    expect(store.cachedCount).toBe(0);
    expect(events).toStrictEqual([]);
  });

  it('is refused, and reported, when it names an entry and cannot be admitted for it', async () => {
    const { store, events } = storeOver();
    const catalog = catalogOf('shell', 'en-US');
    // Deeper than any compiled message, and still inside what the store will read.
    let nested: unknown = 'leaf';
    for (let level = 0; level < RUNTIME_LIMITS.jsonDepth - 4; level += 1) {
      nested = [nested];
    }
    catalog['unexpected'] = nested;

    expect(await rejectionOf(() => store.seed(catalog))).toMatchObject({
      code: 'catalog-admission-failed',
      providerId: PROVIDER,
      scopeId: 'shell',
      targetLocale: 'en-US',
    });
    expect(events).toStrictEqual([
      {
        code: RUNTIME_EVENT_CODES.cache,
        phase: 'cache',
        status: 'failed',
        reason: 'catalog-admission-failed',
        providerId: PROVIDER,
        scopeId: 'shell',
        targetLocale: 'en-US',
      },
    ]);
    expect(store.cachedCount).toBe(0);
  });

  it('is refused with no emitter configured, leaving nothing unhandled behind', async () => {
    const { store } = storeOver({ observed: false });
    const catalog = catalogOf('shell', 'en-US');
    catalog['unexpected'] = true;

    const unhandled = await unhandledDuring(async () => {
      expect((await rejectionOf(() => store.seed(catalog)))?.code).toBe(
        'catalog-admission-failed',
      );
    });

    expect(unhandled).toStrictEqual([]);
  });

  it('answers a signal that had already aborted with its reason, whatever was offered', async () => {
    const { store } = storeOver();
    const controller = new AbortController();
    const reason = new Error('the document went away');
    controller.abort(reason);

    await expect(store.seed('not a catalog', controller.signal)).rejects.toBe(
      reason,
    );
  });

  it('is not kept when the signal aborts as the wait for its admission ends', async () => {
    const { store } = storeOver();
    const controller = new AbortController();
    const reason = new Error('the document went away');
    const { signal } = controller;
    // The store stops listening the moment admission settles, which is the last point at which an
    // abort can arrive before the catalog would be kept.
    const stopListening = signal.removeEventListener.bind(signal);
    signal.removeEventListener = (
      ...listener: Parameters<AbortSignal['removeEventListener']>
    ) => {
      stopListening(...listener);
      controller.abort(reason);
    };

    await expect(store.seed(catalogOf('shell', 'en-US'), signal)).rejects.toBe(
      reason,
    );

    expect(store.cachedCount).toBe(0);
  });
});

describe('a disposed store', () => {
  it('holds nothing and loads nothing', async () => {
    const { store } = storeOver();
    await store.preload(scope('shell'), 'en-US', live());
    expect(store.cachedCount).toBe(1);

    store.dispose();

    expect(store.cachedCount).toBe(0);
    expect(
      (await rejectionOf(() => store.preload(scope('shell'), 'en-US', live())))
        ?.code,
    ).toBe('disposed');
    expect(store.cachedCount).toBe(0);
  });

  it('does not run a loader', async () => {
    let loads = 0;
    const { store } = storeOver({
      loaders: {
        ...loadersFor(compiled()),
        [catalogKey('shell', 'en-US')]: () => {
          loads += 1;
          return catalogOf('shell', 'en-US');
        },
      },
    });
    store.dispose();

    expect(
      (await rejectionOf(() => store.acquire(scope('shell'), 'en-US', live())))
        ?.code,
    ).toBe('disposed');
    await settled();
    expect(loads).toBe(0);
  });

  it('fails a lease that was still loading when it was disposed', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store } = storeOver({
      loaders: {
        ...loadersFor(compiled()),
        [catalogKey('shell', 'en-US')]: () =>
          held.then(() => catalogOf('shell', 'en-US')),
      },
    });

    const leasing = rejectionOf(() =>
      store.acquire(scope('shell'), 'en-US', live()),
    );
    store.dispose();
    release();

    expect((await leasing)?.code).toBe('disposed');
    expect(store.cachedCount).toBe(0);
  });

  it('refuses a transfer, whatever was offered', async () => {
    const { store } = storeOver();
    store.dispose();

    expect((await rejectionOf(() => store.seed('not a catalog')))?.code).toBe(
      'disposed',
    );
  });

  it('fails a preload that was still loading when it was disposed', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store } = storeOver({
      loaders: {
        ...loadersFor(compiled()),
        [catalogKey('shell', 'en-US')]: () =>
          held.then(() => catalogOf('shell', 'en-US')),
      },
    });

    const loading = rejectionOf(() =>
      store.preload(scope('shell'), 'en-US', live()),
    );
    store.dispose();
    release();

    expect((await loading)?.code).toBe('disposed');
    expect(store.cachedCount).toBe(0);
  });

  it('fails a transfer that was still being admitted when it was disposed', async () => {
    const { store } = storeOver();

    const seeding = rejectionOf(() => store.seed(catalogOf('shell', 'en-US')));
    store.dispose();

    expect((await seeding)?.code).toBe('disposed');
    expect(store.cachedCount).toBe(0);
  });
});
