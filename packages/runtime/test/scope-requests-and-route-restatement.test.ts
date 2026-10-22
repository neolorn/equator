/**
 * The two small transactions beside a locale change: a scope that finished loading, and a route
 * restated for the locale that is current.
 *
 * `specs/06-runtime-and-angular.spec.md` section 4 makes the snapshot the one thing published, so
 * each of them supersedes the current snapshot with one that differs in exactly what changed, and
 * publishes nothing when nothing did. Section 9 lets application code ask for a scope ahead of the
 * view that reads it: `preloadScope` warms the catalogs and commits nothing, `ensureScope` commits
 * the scope into the current snapshot, and a request that a locale change overtakes is answered in
 * the locale the reader ends up in. `specs/05-compiled-artifacts-and-trust.spec.md` section 9 pins
 * a catalog only while something holds it, which is how a case here tells a released catalog from
 * a held one: a cache with room for one unheld catalog loads a released one again.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';
import type { LocalizationEventEmitter } from '../src/observability.js';

import {
  PROVIDER,
  catalogKey,
  loadersFor,
  rejectionOf,
  scope,
} from './catalog-store-harness.js';
import {
  HEADING,
  LAZY,
  SHELL,
  UNCOMPILED,
  compiled,
  configured,
  participant,
  route,
  runtime,
  until,
  withUncompiledScope,
  withUntranslatedLocale,
  withoutCatalog,
  type Runtime,
} from './transaction-runtime-harness.js';

const NOWHERE = scope('nowhere');

/** Every microtask and timer already due, for a case that states what did not happen. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** Resolves once the lazy scope reports its catalogs in hand for `locale`. */
const arrived = (localization: Runtime, locale: string): Promise<void> =>
  expect
    .poll(() => {
      const { status, targetLocale } = localization.scopeReadiness(LAZY)();
      return `${status} ${targetLocale}`;
    })
    .toBe(`ready ${locale}`);

/**
 * An observer that acts once, in the turn the lazy scope's catalog is reported loaded.
 *
 * A load is reported before the runtime does anything with it, so this names the last point at
 * which a request has not landed, where a count of turns would only happen to fall on it.
 */
const whenLazyLoaded = (act: () => void): LocalizationEventEmitter => {
  let acted = false;
  return {
    emit: (input) => {
      if (
        acted ||
        input.phase !== 'catalog' ||
        input.status !== 'succeeded' ||
        input.scopeId !== 'lazy'
      ) {
        return;
      }
      acted = true;
      act();
    },
  };
};

async function ready(fixture: Parameters<typeof runtime>[0] = {}) {
  const made = runtime(fixture);
  const snapshot = await made.localization.initialize();
  return { ...made, snapshot };
}

describe('a route restated for the current locale', () => {
  it('is ignored before there is a snapshot to restate it on', () => {
    const { localization } = runtime();

    expect(() => localization.ɵrestateRoute(route('/en-us'))).not.toThrow();

    expect(localization.snapshot()).toBeUndefined();
    localization.dispose();
  });

  it('is ignored while the context is being disposed', async () => {
    // An adapter is released before the snapshot is withdrawn, so one that restates an address
    // as it goes would otherwise be handed a snapshot by a context that is on its way out.
    const applied: (string | undefined)[] = [];
    const made = runtime({
      options: {
        commitHooks: [
          {
            apply: () => undefined,
            committed: (snapshot) =>
              void applied.push(snapshot.route?.canonicalPath),
            dispose: () =>
              made.localization.ɵrestateRoute(route('/en-us/late')),
          },
        ],
      },
    });
    await made.localization.initialize();
    made.localization.ɵrestateRoute(route('/en-us'));

    made.localization.dispose();

    expect(applied).toStrictEqual([undefined, '/en-us']);
  });

  it('publishes nothing when it is the route already committed', async () => {
    const { localization } = await ready();
    const addresses = { 'en-US': '/en-us/about', 'ar-EG': '/ar-eg/about' };
    localization.ɵrestateRoute(route('/en-us/about', { addresses }));
    const committed = localization.snapshot();

    localization.ɵrestateRoute(
      route('/en-us/about', { addresses: { ...addresses } }),
    );

    expect(localization.snapshot()).toBe(committed);
    localization.dispose();
  });

  it('publishes a new snapshot when any one part of the route differs', async () => {
    const { localization } = await ready();
    const addresses = { 'en-US': '/en-us/about', 'ar-EG': '/ar-eg/about' };
    const restated = route('/en-us/about', { addresses });
    localization.ɵrestateRoute(restated);

    for (const changed of [
      { ...restated, routeId: 'about' },
      { ...restated, projectionIdentity: 'projection-rebuilt' },
      { ...restated, canonicalPath: '/en-us/contact' },
      { ...restated, addresses: { ...addresses, 'ar-EG': '/ar-eg/contact' } },
    ]) {
      localization.ɵrestateRoute(restated);
      const before = localization.snapshot();

      localization.ɵrestateRoute(changed);

      expect(localization.snapshot()).not.toBe(before);
      expect(localization.snapshot()?.id).toBe((before?.id ?? 0) + 1);
      expect(localization.snapshot()?.route).toStrictEqual(changed);
    }
    localization.dispose();
  });

  it('carries its own frozen copy of the addresses it was given', async () => {
    const { localization } = await ready();
    const addresses = { 'en-US': '/en-us/about', 'ar-EG': '/ar-eg/about' };

    localization.ɵrestateRoute(route('/en-us/about', { addresses }));
    const restated = localization.snapshot()?.route;

    expect(restated?.addresses).toStrictEqual(addresses);
    expect(restated?.addresses).not.toBe(addresses);
    expect(Object.isFrozen(restated)).toBe(true);
    expect(Object.isFrozen(restated?.addresses)).toBe(true);
    localization.dispose();
  });

  it('carries no addresses when it was given none', async () => {
    const { localization } = await ready();

    localization.ɵrestateRoute(route('/en-us/about'));

    expect(localization.snapshot()?.route).toStrictEqual(route('/en-us/about'));
    expect(Object.keys(localization.snapshot()?.route ?? {})).not.toContain(
      'addresses',
    );
    localization.dispose();
  });
});

describe('a scope nobody has asked for yet', () => {
  const idleIn = (targetLocale: string) => ({
    scope: LAZY,
    targetLocale,
    status: 'idle',
    supplyingLocales: [],
  });

  it('reports itself idle for the default locale before the first snapshot', () => {
    const { localization } = runtime({
      set: configured('defaultLocale', 'ar-EG'),
    });

    expect(localization.scopeReadiness(LAZY)()).toStrictEqual(idleIn('ar-EG'));
    localization.dispose();
  });

  it('reports itself idle for the committed locale', async () => {
    const { localization } = await ready();
    await localization.changeLocale('ar-EG');

    expect(localization.scopeReadiness(LAZY)()).toStrictEqual(idleIn('ar-EG'));
    localization.dispose();
  });

  it('reports itself idle for the locale a change is moving to', async () => {
    const { localization, release } = await ready({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    const change = localization.changeLocale('ar-EG');
    await until(() => localization.targetLocale() === 'ar-EG');

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(localization.scopeReadiness(LAZY)()).toStrictEqual(idleIn('ar-EG'));
    release(catalogKey('shell', 'ar-EG'));
    await change;
    localization.dispose();
  });
});

describe('a scope asked for outside a locale change', () => {
  it('joins the loaded scopes under the next snapshot identity', async () => {
    const { localization, snapshot } = await ready();

    await localization.ensureScope(LAZY);

    expect(localization.snapshot()).toMatchObject({
      id: snapshot.id + 1,
      primaryLocale: 'en-US',
      requiredScopes: [SHELL],
      loadedScopes: [SHELL, LAZY],
      degraded: false,
    });
    expect(localization.snapshot()?.loadedScopes).toStrictEqual([SHELL, LAZY]);
    expect(localization.text(HEADING)).toBe('Lazy heading');
    localization.dispose();
  });

  it('leaves a translated locale undegraded', async () => {
    const { localization } = await ready();
    await localization.changeLocale('ar-EG');

    await localization.ensureScope(LAZY);

    expect(localization.snapshot()).toMatchObject({
      primaryLocale: 'ar-EG',
      loadedScopes: [SHELL, LAZY],
      degraded: false,
    });
    expect(localization.text(HEADING)).toBe('عنوان مؤجل');
    localization.dispose();
  });

  it('degrades the snapshot when the locale has no catalog for it', async () => {
    const { localization } = await ready({
      set: withoutCatalog('lazy', 'ar-EG'),
    });
    const changed = await localization.changeLocale('ar-EG');

    await localization.ensureScope(LAZY);

    expect(changed).toMatchObject({ snapshot: { degraded: false } });
    expect(localization.snapshot()).toMatchObject({
      primaryLocale: 'ar-EG',
      degraded: true,
    });
    expect(localization.text(HEADING)).toBe('Lazy heading');
    localization.dispose();
  });

  it('publishes nothing when the scope is already loaded', async () => {
    const { localization, snapshot, loads } = await ready();

    await localization.ensureScope(SHELL);

    expect(localization.snapshot()).toBe(snapshot);
    expect(loads[catalogKey('shell', 'en-US')]).toBe(1);
    localization.dispose();
  });

  it('initializes the context first when there is no snapshot yet', async () => {
    const { localization } = runtime();

    await localization.ensureScope(LAZY);

    expect(localization.snapshot()).toMatchObject({
      primaryLocale: 'en-US',
      loadedScopes: [SHELL, LAZY],
    });
    localization.dispose();
  });

  it('is not carried into a later change once it has landed', async () => {
    const { localization } = await ready();
    await localization.ensureScope(LAZY);

    await expect(localization.changeLocale('ar-EG')).resolves.toMatchObject({
      status: 'committed',
      snapshot: { requiredScopes: [SHELL], loadedScopes: [SHELL] },
    });
    localization.dispose();
  });

  it('is not carried into a later change once it has failed', async () => {
    const { localization } = await ready({ set: withUncompiledScope() });

    await expect(
      rejectionOf(() => localization.ensureScope(UNCOMPILED)),
    ).resolves.toMatchObject({ code: 'invalid-configuration' });

    // A change that still carried the scope would fail on it the same way.
    await expect(localization.changeLocale('ar-EG')).resolves.toMatchObject({
      status: 'committed',
      snapshot: { requiredScopes: [SHELL] },
    });
    localization.dispose();
  });

  it('lets go of the earlier load when two requests for one scope both land', async () => {
    const { localization, loads } = await ready({
      setup: { maximumCachedCatalogs: 1 },
    });

    await Promise.all([
      localization.ensureScope(LAZY),
      localization.ensureScope(LAZY),
    ]);
    await localization.changeLocale('ar-EG');
    await localization.ensureScope(LAZY);

    // The change left the scope behind, so nothing holds its source catalog unless the first of
    // the two loads was never let go of, and a catalog nobody holds has no room in this cache.
    expect(loads[catalogKey('lazy', 'en-US')]).toBe(2);
    localization.dispose();
  });

  it('is refused as disposed, whatever it names, once the context is disposed', async () => {
    const { localization } = await ready();
    localization.dispose();

    await expect(
      rejectionOf(() => localization.preloadScope(NOWHERE, 'ar-EG')),
    ).resolves.toMatchObject({ code: 'disposed' });
    await expect(
      rejectionOf(() => localization.ensureScope(NOWHERE)),
    ).resolves.toMatchObject({ code: 'disposed' });
  });

  it('is refused as disposed while the context is being disposed', async () => {
    let localization!: Runtime;
    let asked: ReturnType<typeof rejectionOf> | undefined;
    const asking: LocalizationCommitHook = {
      apply: () => undefined,
      dispose: () => {
        // The snapshot is still the current one here, and the scope is loaded in it.
        asked = rejectionOf(() => localization.ensureScope(SHELL));
      },
    };
    ({ localization } = runtime({ options: { commitHooks: [asking] } }));
    await localization.initialize();

    localization.dispose();

    await expect(asked).resolves.toMatchObject({ code: 'disposed' });
  });

  it('is refused as disposed when the context is disposed before it lands', async () => {
    const held = await ready({ hold: [catalogKey('lazy', 'en-US')] });
    const loading = rejectionOf(() => held.localization.ensureScope(LAZY));
    held.localization.dispose();
    await expect(loading).resolves.toMatchObject({ code: 'disposed' });
  });

  it('is refused as disposed when the context is disposed in the turn its catalog is reported loaded', async () => {
    const made = await ready({
      options: {
        observability: whenLazyLoaded(() => made.localization.dispose()),
      },
    });

    await expect(
      rejectionOf(() => made.localization.ensureScope(LAZY)),
    ).resolves.toMatchObject({ code: 'disposed' });
  });

  it('has landed when the context is disposed once the scope was committed', async () => {
    const landed: number[] = [];
    const leaving: LocalizationCommitHook = {
      apply: () => undefined,
      committed: (snapshot) => {
        landed.push(snapshot.loadedScopes.length);
        if (snapshot.loadedScopes.length === 2) made.localization.dispose();
      },
    };
    const made = await ready({ options: { commitHooks: [leaving] } });

    await expect(made.localization.ensureScope(LAZY)).resolves.toBeUndefined();

    expect(landed).toStrictEqual([1, 2]);
    expect(made.localization.snapshot()).toBeUndefined();
  });
});

describe('a scope request that a locale change overtakes', () => {
  it('lets go of what it loaded for the locale that was left', async () => {
    const { localization, loads, release } = await ready({
      hold: [catalogKey('lazy', 'ar-EG')],
      setup: { maximumCachedCatalogs: 1 },
    });
    await localization.changeLocale('ar-EG');

    const ensured = localization.ensureScope(LAZY);
    await until(() => localization.scopeReadiness(LAZY)().status === 'loading');
    await localization.changeLocale('en-US');
    release(catalogKey('lazy', 'ar-EG'));
    await ensured;
    await localization.changeLocale('ar-EG');

    // Nothing held the Arabic catalog once the overtaken request had let go of it, so the change
    // back to Arabic found no room had been kept for it.
    expect(loads[catalogKey('lazy', 'ar-EG')]).toBe(2);
    expect(localization.text(HEADING)).toBe('عنوان مؤجل');
    localization.dispose();
  });

  it('waits for a change still in flight before it answers', async () => {
    const { localization, release } = await ready({
      hold: [catalogKey('lazy', 'ar-EG')],
    });
    await localization.changeLocale('ar-EG');
    const region = participant('region', { hold: ['ar-EG'] });
    localization.registerParticipant(region.value);

    let answered = false;
    const ensured = localization.ensureScope(LAZY).then(() => {
      answered = true;
    });
    await until(() => localization.scopeReadiness(LAZY)().status === 'loading');
    await localization.changeLocale('en-US');
    // Back to Arabic, and held open by the participant after its catalogs have arrived.
    const back = localization.changeLocale('ar-EG');
    release(catalogKey('lazy', 'ar-EG'));
    await arrived(localization, 'ar-EG');
    await settled();

    expect(answered).toBe(false);
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');

    region.release('ar-EG');
    await expect(back).resolves.toMatchObject({ status: 'committed' });
    await ensured;
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    expect(localization.text(HEADING)).toBe('عنوان مؤجل');
    localization.dispose();
  });

  it('is answered as superseded when the change was asked for first and so did not carry it', async () => {
    const { localization, release } = await ready({
      hold: [catalogKey('shell', 'ar-EG'), catalogKey('lazy', 'en-US')],
    });

    const change = localization.changeLocale('ar-EG');
    const ensured = rejectionOf(() => localization.ensureScope(LAZY));
    release(catalogKey('shell', 'ar-EG'));
    await expect(change).resolves.toMatchObject({
      status: 'committed',
      snapshot: { requiredScopes: [SHELL], loadedScopes: [SHELL] },
    });
    release(catalogKey('lazy', 'en-US'));

    await expect(ensured).resolves.toMatchObject({
      code: 'superseded',
      outcome: 'operational-failure',
    });
    expect(localization.snapshot()?.loadedScopes).toStrictEqual([SHELL]);
    localization.dispose();
  });

  it('is answered as disposed, not as superseded, when the context is disposed while it waits', async () => {
    const { localization, release } = await ready({
      hold: [catalogKey('lazy', 'ar-EG')],
    });
    await localization.changeLocale('ar-EG');
    const region = participant('region', { hold: ['ar-EG'] });
    localization.registerParticipant(region.value);

    const ensured = rejectionOf(() => localization.ensureScope(LAZY));
    await until(() => localization.scopeReadiness(LAZY)().status === 'loading');
    await localization.changeLocale('en-US');
    const back = localization.changeLocale('ar-EG');
    release(catalogKey('lazy', 'ar-EG'));
    await arrived(localization, 'ar-EG');
    await settled();
    localization.dispose();

    await expect(back).resolves.toMatchObject({ status: 'cancelled' });
    await expect(ensured).resolves.toMatchObject({ code: 'disposed' });
  });
});

describe('a scope warmed ahead of the view that reads it', () => {
  it('loads the source catalog and the catalog of the locale named, and commits neither', async () => {
    const { localization, snapshot, loads } = await ready();

    await localization.preloadScope(LAZY, 'ar-EG');

    expect(loads[catalogKey('lazy', 'en-US')]).toBe(1);
    expect(loads[catalogKey('lazy', 'ar-EG')]).toBe(1);
    expect(localization.snapshot()).toBe(snapshot);
    expect(localization.scopeReadiness(LAZY)().status).toBe('idle');
    localization.dispose();
  });

  it('loads the source catalog alone when the source locale is named', async () => {
    const { localization, loads } = await ready();

    await localization.preloadScope(LAZY, 'en-US');

    expect(loads[catalogKey('lazy', 'en-US')]).toBe(1);
    expect(loads[catalogKey('lazy', 'ar-EG')]).toBeUndefined();
    localization.dispose();
  });

  it('loads the source catalog alone when the locale named has no catalog for the scope', async () => {
    const { localization, loads } = await ready({
      set: withUntranslatedLocale(),
    });

    await expect(
      localization.preloadScope(LAZY, 'fr-FR'),
    ).resolves.toBeUndefined();

    expect(loads[catalogKey('lazy', 'en-US')]).toBe(1);
    expect(loads[catalogKey('lazy', 'ar-EG')]).toBeUndefined();
    localization.dispose();
  });

  it('is for the locale a change is moving to, when none is named', async () => {
    const { localization, loads, release } = await ready({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    const change = localization.changeLocale('ar-EG');
    await until(() => localization.targetLocale() === 'ar-EG');

    await localization.preloadScope(LAZY);

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(loads[catalogKey('lazy', 'ar-EG')]).toBe(1);
    release(catalogKey('shell', 'ar-EG'));
    await change;
    localization.dispose();
  });

  it('is for the committed locale, when none is named and no change is in flight', async () => {
    const { localization, loads } = await ready();
    await localization.changeLocale('ar-EG');

    await localization.preloadScope(LAZY);

    expect(loads[catalogKey('lazy', 'ar-EG')]).toBe(1);
    localization.dispose();
  });

  it('is for the default locale, when none is named and nothing is committed', async () => {
    const { localization, loads } = runtime({
      set: configured('defaultLocale', 'ar-EG'),
    });

    await localization.preloadScope(LAZY);

    expect(localization.snapshot()).toBeUndefined();
    expect(loads[catalogKey('lazy', 'en-US')]).toBe(1);
    expect(loads[catalogKey('lazy', 'ar-EG')]).toBe(1);
    localization.dispose();
  });

  it('is refused as disposed when the context is disposed while its catalog is loading', async () => {
    const { localization, loads, release } = await ready({
      hold: [catalogKey('lazy', 'ar-EG')],
    });
    const asked = rejectionOf(() => localization.preloadScope(LAZY, 'ar-EG'));
    await until(() => loads[catalogKey('lazy', 'ar-EG')] === 1);

    localization.dispose();
    release(catalogKey('lazy', 'ar-EG'));

    await expect(asked).resolves.toMatchObject({ code: 'disposed' });
  });

  it('is refused as disposed when the context is disposed in the turn its loader answers', async () => {
    // A preload reports nothing to an observer, so the last point before it finishes is named by
    // the loader: it disposes the context and then hands over the catalog it was asked for.
    const key = catalogKey('lazy', 'ar-EG');
    const loaders = loadersFor(compiled());
    const made = await ready({
      setup: {
        catalogLoaders: {
          ...loaders,
          [key]: async () => {
            const artifact = await loaders[key]?.();
            made.localization.dispose();
            return artifact;
          },
        },
      },
    });

    await expect(
      rejectionOf(() => made.localization.preloadScope(LAZY, 'ar-EG')),
    ).resolves.toMatchObject({ code: 'disposed' });
  });

  it('is refused as disposed when the context is disposed in the turn the store has taken its catalog in', async () => {
    // With no room in the cache, the store reports what it does with a catalog nothing holds as
    // the last thing it does for a preload. Disposed there, the context is gone with nothing
    // left of the preload to interrupt, and the preload still does not answer as if it stood.
    let asked = false;
    const made = await ready({
      setup: { maximumCachedCatalogs: 1 },
      options: {
        observability: {
          emit: (input) => {
            if (!asked || input.phase !== 'cache') return;
            asked = false;
            made.localization.dispose();
          },
        },
      },
    });
    asked = true;

    await expect(
      rejectionOf(() => made.localization.preloadScope(LAZY, 'en-US')),
    ).resolves.toMatchObject({ code: 'disposed' });
    expect(asked).toBe(false);
  });

  it('has finished when the context is disposed after it answered', async () => {
    const { localization } = await ready();

    await expect(
      localization.preloadScope(LAZY, 'ar-EG'),
    ).resolves.toBeUndefined();
    localization.dispose();
  });

  it('names the scope it refuses when the scope was never generated', async () => {
    const { localization } = await ready();

    await expect(
      rejectionOf(() => localization.preloadScope(NOWHERE, 'ar-EG')),
    ).resolves.toMatchObject({
      code: 'scope-unavailable',
      providerId: PROVIDER,
      scopeId: 'nowhere',
    });
    localization.dispose();
  });
});
