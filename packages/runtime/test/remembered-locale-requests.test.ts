/**
 * What a context remembers of the locale it was moved to, forgets on request, and takes back from
 * its stores for a page shown without reading them.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 8: a deliberate change is written to
 * the configured stores after it commits, removal drops it from them and says where it did not
 * land, and a page restored from memory moves to the stored choice only where nothing newer was
 * asked for while the stores were being read. A restore is the stores speaking, so it moves the
 * reader and writes nothing back. `specs/06-runtime-and-angular.spec.md` section 11 keeps
 * persistence outside the commit: none of this decides whether a change commits.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationPersistenceStore } from '../src/persistence.js';

import { catalogKey, diagnosticOf } from './catalog-store-harness.js';
import { observed, runtime, until } from './transaction-runtime-harness.js';

/** Every microtask and timer already due, for a case that states what was not written. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * A store a case can read from the outside, write to as another tab would, and hold open.
 *
 * `holdReads` makes every read after it wait for `releaseReads`, which is what puts a case between
 * the moment the stores are asked and the moment they answer.
 */
function memory() {
  let remembered: string | undefined;
  const writes: string[] = [];
  let pending = 0;
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  const store: LocalizationPersistenceStore = {
    id: 'memory-under-test',
    read: () => {
      if (gate === undefined) return remembered;
      pending += 1;
      return gate.then(() => remembered);
    },
    write: (locale) => {
      writes.push(locale);
      remembered = locale;
    },
    forget: () => {
      remembered = undefined;
    },
  };
  return {
    store,
    writes,
    remembered: () => remembered,
    /** A choice made elsewhere, which the context under test did not write. */
    chooseElsewhere: (locale: string) => {
      remembered = locale;
    },
    holdReads: () => {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    reading: () => pending > 0,
    releaseReads: () => open?.(),
  };
}

async function ready(fixture: Parameters<typeof runtime>[0] = {}) {
  const remembered = memory();
  const made = runtime({
    ...fixture,
    options: { ...fixture.options, persistence: [remembered.store] },
  });
  await made.localization.initialize();
  return { ...made, remembered };
}

const HERE = { url: '/second' };

describe('the locale a change commits', () => {
  it('is written to the stores once the change has committed', async () => {
    const { localization, remembered } = await ready();

    await localization.changeLocale('ar-EG');
    await settled();

    expect(remembered.writes).toStrictEqual(['ar-EG']);
    localization.dispose();
  });

  it('is written when the request says to remember it', async () => {
    const { localization, remembered } = await ready();

    await localization.changeLocale('ar-EG', { remember: true });
    await settled();

    expect(remembered.writes).toStrictEqual(['ar-EG']);
    localization.dispose();
  });

  it('is committed and not written when the request says not to remember it', async () => {
    const { localization, remembered } = await ready();

    const result = await localization.changeLocale('ar-EG', {
      remember: false,
    });
    await settled();

    expect(result).toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'ar-EG' },
    });
    expect(remembered.writes).toStrictEqual([]);
    localization.dispose();
  });

  it('is not written when the locale negotiated at startup is the one committed', async () => {
    const { localization, remembered } = await ready();
    await settled();

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(remembered.writes).toStrictEqual([]);
    localization.dispose();
  });
});

describe('forgetting the remembered locale', () => {
  it('drops it from the stores and reports that it reached them', async () => {
    const { localization, remembered } = await ready();
    await localization.changeLocale('ar-EG');
    await settled();

    const report = await localization.forgetRememberedLocale();

    expect(report).toStrictEqual({ complete: true, unreached: [] });
    expect(remembered.remembered()).toBeUndefined();
    // The page is where it was: forgetting drops the record and moves nothing.
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    localization.dispose();
  });

  it('is refused once the context is disposed', async () => {
    const { localization } = await ready();
    localization.dispose();

    expect(
      diagnosticOf(() => localization.forgetRememberedLocale()),
    ).toMatchObject({ code: 'disposed' });
  });
});

describe('a page restored without its stores having been read', () => {
  it('moves to the stored locale, and writes nothing back', async () => {
    const { localization, remembered } = await ready();
    remembered.chooseElsewhere('ar-EG');

    const result = await localization.ɵrestoreLocale(HERE);
    await settled();

    expect(result).toMatchObject({
      status: 'committed',
      targetLocale: 'ar-EG',
      snapshot: { primaryLocale: 'ar-EG' },
    });
    expect(remembered.writes).toStrictEqual([]);
    localization.dispose();
  });

  it('stays where it is when nothing is stored', async () => {
    const { localization } = await ready();

    await expect(localization.ɵrestoreLocale(HERE)).resolves.toBeUndefined();

    expect(localization.lastResult()).toBeUndefined();
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    localization.dispose();
  });

  it('is left alone before there is a committed locale to restore over', async () => {
    const remembered = memory();
    remembered.chooseElsewhere('ar-EG');
    const { localization } = runtime({
      options: { persistence: [remembered.store] },
    });

    await expect(localization.ɵrestoreLocale(HERE)).resolves.toBeUndefined();

    expect(localization.lifecycle()).toBe('uninitialized');
    expect(localization.lastResult()).toBeUndefined();
    localization.dispose();
  });

  it('is left alone while a change is in flight', async () => {
    const { localization, remembered, release } = await ready({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    const change = localization.changeLocale('ar-EG');
    await until(() => localization.targetLocale() === 'ar-EG');
    remembered.chooseElsewhere('ar-EG');

    const restored = localization.ɵrestoreLocale(HERE);
    release(catalogKey('shell', 'ar-EG'));

    await expect(restored).resolves.toBeUndefined();
    await expect(change).resolves.toMatchObject({ status: 'committed' });
    localization.dispose();
  });

  it('gives way to a change asked for while the stores were being read', async () => {
    const { localization, remembered } = await ready();
    remembered.chooseElsewhere('ar-EG');
    remembered.holdReads();

    const restored = localization.ɵrestoreLocale(HERE);
    await until(remembered.reading);
    const asked = await localization.changeLocale('en-US');
    remembered.releaseReads();

    await expect(restored).resolves.toBeUndefined();
    expect(localization.lastResult()).toBe(asked);
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    localization.dispose();
  });

  it('gives way to a removal asked for while the stores were being read', async () => {
    const { localization, remembered } = await ready();
    remembered.chooseElsewhere('ar-EG');
    remembered.holdReads();

    const restored = localization.ɵrestoreLocale(HERE);
    await until(remembered.reading);
    const removal = localization.forgetRememberedLocale();
    remembered.releaseReads();

    await expect(restored).resolves.toBeUndefined();
    await expect(removal).resolves.toMatchObject({ complete: true });
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    localization.dispose();
  });

  it('ends without a move, and without an error, when the context is disposed while the stores are read', async () => {
    const { localization, remembered } = await ready();
    remembered.chooseElsewhere('ar-EG');
    remembered.holdReads();

    const restored = localization.ɵrestoreLocale(HERE);
    await until(remembered.reading);
    localization.dispose();
    remembered.releaseReads();

    await expect(restored).resolves.toBeUndefined();
  });
});

/**
 * A restore has no caller to answer, so each way it ends is an event of the `persistence` phase,
 * and no two ways report the same event.
 */
describe('how a restore ended, as its events say', () => {
  const watching = async (fixture: Parameters<typeof runtime>[0] = {}) => {
    const watched = observed();
    const made = await ready({
      ...fixture,
      options: { ...fixture.options, observability: watched.emitter },
    });
    const first = made.localization.snapshot()?.id;
    // The events of the restore alone: a store's own events name the store.
    const restores = () =>
      watched
        .phase('persistence')
        .filter((event) => event.correlationId === undefined);
    return { ...made, first, restores };
  };

  it('started, then succeeded with the stored locale, where the page moves', async () => {
    const { localization, remembered, first, restores } = await watching();
    remembered.chooseElsewhere('ar-EG');

    await localization.ɵrestoreLocale(HERE);

    expect(restores()).toStrictEqual([
      { status: 'started', snapshotId: first },
      { status: 'succeeded', targetLocale: 'ar-EG', snapshotId: first },
    ]);
    localization.dispose();
  });

  it('started, then unavailable, where the stores hold nothing that moves the page', async () => {
    const { localization, first, restores } = await watching();

    await localization.ɵrestoreLocale(HERE);

    expect(restores()).toStrictEqual([
      { status: 'started', snapshotId: first },
      { status: 'unavailable', snapshotId: first },
    ]);
    localization.dispose();
  });

  it('unavailable with no snapshot, and no start, before a locale is committed', async () => {
    const watched = observed();
    const remembered = memory();
    remembered.chooseElsewhere('ar-EG');
    const { localization } = runtime({
      options: {
        persistence: [remembered.store],
        observability: watched.emitter,
      },
    });

    await localization.ɵrestoreLocale(HERE);

    expect(watched.phase('persistence')).toStrictEqual([
      { status: 'unavailable' },
    ]);
    localization.dispose();
  });

  it('cancelled as superseded, naming the change in flight, and no start', async () => {
    const { localization, remembered, release, first, restores } =
      await watching({ hold: [catalogKey('shell', 'ar-EG')] });
    const change = localization.changeLocale('ar-EG');
    await until(() => localization.targetLocale() === 'ar-EG');
    remembered.chooseElsewhere('ar-EG');

    await localization.ɵrestoreLocale(HERE);

    expect(restores()).toStrictEqual([
      {
        status: 'cancelled',
        reason: 'superseded',
        targetLocale: 'ar-EG',
        snapshotId: first,
      },
    ]);
    release(catalogKey('shell', 'ar-EG'));
    await change;
    localization.dispose();
  });

  it('started, then superseded, where a change was asked for while the stores were read', async () => {
    const { localization, remembered, first, restores } = await watching();
    remembered.chooseElsewhere('ar-EG');
    remembered.holdReads();

    const restored = localization.ɵrestoreLocale(HERE);
    await until(remembered.reading);
    await localization.changeLocale('en-US');
    remembered.releaseReads();
    await restored;

    expect(restores()).toStrictEqual([
      { status: 'started', snapshotId: first },
      { status: 'superseded', reason: 'superseded', snapshotId: first },
    ]);
    localization.dispose();
  });

  it('started, then cancelled as disposed, where the context is disposed while the stores are read', async () => {
    const { localization, remembered, first, restores } = await watching();
    remembered.chooseElsewhere('ar-EG');
    remembered.holdReads();

    const restored = localization.ɵrestoreLocale(HERE);
    await until(remembered.reading);
    localization.dispose();
    remembered.releaseReads();
    await restored;

    expect(restores()).toStrictEqual([
      { status: 'started', snapshotId: first },
      { status: 'cancelled', reason: 'disposed', snapshotId: first },
    ]);
  });

  it('cancelled as disposed with no snapshot, and no start, once the context is disposed', async () => {
    const { localization, remembered, restores } = await watching();
    remembered.chooseElsewhere('ar-EG');
    localization.dispose();

    await localization.ɵrestoreLocale(HERE);

    expect(restores()).toStrictEqual([
      { status: 'cancelled', reason: 'disposed' },
    ]);
  });

  it('builds no event where no sink is configured', async () => {
    const { localization, remembered } = await ready();
    remembered.chooseElsewhere('ar-EG');

    await expect(localization.ɵrestoreLocale(HERE)).resolves.toMatchObject({
      status: 'committed',
    });
    localization.dispose();
  });
});

/**
 * The restore a page drawn by a server is owed once it is adopted. It asks the stores only where
 * a server's decision was transferred and the application is still there when hydration ends, and
 * says so under the `ssr-hydration` phase where it does not.
 */
describe('the restore after hydration', () => {
  const adopted = async (initialLocale: string | undefined) => {
    const watched = observed();
    const remembered = memory();
    remembered.chooseElsewhere('ar-EG');
    const made = runtime({
      options: {
        persistence: [remembered.store],
        observability: watched.emitter,
        ...(initialLocale === undefined ? {} : { initialLocale }),
      },
    });
    await made.localization.initialize();
    return { ...made, watched };
  };
  const page = (destroyed = false) => {
    let hydrate: () => void = () => undefined;
    const hydrated = new Promise<void>((resolve) => {
      hydrate = resolve;
    });
    let asked = 0;
    return {
      hydrate,
      asked: () => asked,
      value: {
        hydrated,
        destroyed: () => destroyed,
        address: () => {
          asked += 1;
          return HERE;
        },
      },
    };
  };

  it('moves a page a server drew to the stored locale, once hydration is over', async () => {
    const { localization, watched } = await adopted('en-US');
    const shown = page();

    const restored = localization.ɵrestoreAfterHydration(shown.value);
    await settled();
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(shown.asked()).toBe(0);
    shown.hydrate();

    await expect(restored).resolves.toMatchObject({
      status: 'committed',
      targetLocale: 'ar-EG',
    });
    expect(watched.phase('ssr-hydration')).toStrictEqual([]);
    localization.dispose();
  });

  it('asks no store, and says unavailable, where the browser drew the page itself', async () => {
    const { localization, watched } = await adopted(undefined);
    const shown = page();
    shown.hydrate();

    await expect(
      localization.ɵrestoreAfterHydration(shown.value),
    ).resolves.toBeUndefined();

    expect(watched.phase('ssr-hydration')).toStrictEqual([
      { status: 'unavailable' },
    ]);
    expect(shown.asked()).toBe(0);
    expect(
      watched
        .phase('persistence')
        .filter((event) => event.status === 'started'),
    ).toStrictEqual([]);
    localization.dispose();
  });

  it('asks no store, and says cancelled as disposed, where the application was destroyed first', async () => {
    const { localization, watched } = await adopted('en-US');
    const shown = page(true);
    shown.hydrate();

    await expect(
      localization.ɵrestoreAfterHydration(shown.value),
    ).resolves.toBeUndefined();

    expect(watched.phase('ssr-hydration')).toStrictEqual([
      { status: 'cancelled', reason: 'disposed' },
    ]);
    expect(shown.asked()).toBe(0);
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    localization.dispose();
  });
});
