/**
 * What becomes of the catalogs a progressive scope loaded for a snapshot that is no longer current.
 *
 * `specs/06-runtime-and-angular.spec.md` section 7 invalidates superseded work by transition
 * identity, so the scope is not published. `specs/05-compiled-artifacts-and-trust.spec.md`
 * section 9 pins a catalog only while it is in use, so what the dropped scope loaded is let go of
 * and a cache with no room for it drops it.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';

import { PROVIDER, catalogKey } from './catalog-store-harness.js';
import {
  LAZY,
  SHELL,
  observed,
  runtime,
} from './transaction-runtime-harness.js';

/** Every microtask and timer already due, for a case that states what did not happen. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('a progressive scope whose catalogs arrive after a newer change committed', () => {
  it('is not published, and its catalogs are let go of and dropped by a cache with no room for them', async () => {
    let next: Promise<unknown> | undefined;
    const hook: LocalizationCommitHook = {
      apply: () => undefined,
      // Asked from inside the commit, so the change it supersedes starts its progressive scope
      // after the newer change has already told running work to stop.
      committed: (snapshot) => {
        if (snapshot.primaryLocale === 'ar-EG' && next === undefined) {
          next = made.localization.changeLocale('en-US');
        }
      },
    };
    const watched = observed();
    const made = runtime({
      hold: [catalogKey('lazy', 'ar-EG')],
      setup: { maximumCachedCatalogs: 1 },
      options: { commitHooks: [hook], observability: watched.emitter },
    });
    const { localization, release } = made;
    await localization.initialize();
    await localization.changeLocale('ar-EG', {
      mode: 'progressive',
      progressiveScopes: [LAZY],
    });
    await next;
    const before = watched.phase('cache').length;
    const arrived = (): boolean =>
      watched
        .phase('catalog')
        .some(
          ({ status, scopeId, targetLocale }) =>
            status === 'succeeded' &&
            scopeId === 'lazy' &&
            targetLocale === 'ar-EG',
        );

    release(catalogKey('lazy', 'ar-EG'));
    await expect.poll(arrived).toBe(true);
    await settled();

    expect(localization.snapshot()).toMatchObject({
      primaryLocale: 'en-US',
      loadedScopes: [SHELL],
    });
    // The bound is one catalog and the current snapshot holds one. The scope's own catalog goes as
    // soon as it is let go of, which leaves the cache over its bound with everything in it held
    // until the source catalog the scope fell back on is let go of as well.
    expect(watched.phase('cache').slice(before)).toStrictEqual([
      {
        status: 'succeeded',
        providerId: PROVIDER,
        scopeId: 'lazy',
        targetLocale: 'ar-EG',
        count: 2,
      },
      { status: 'unavailable', count: 2 },
      {
        status: 'succeeded',
        providerId: PROVIDER,
        scopeId: 'lazy',
        targetLocale: 'en-US',
        count: 1,
      },
    ]);
    localization.dispose();
  });
});
