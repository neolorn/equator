/**
 * A scope with no artifact in one locale, asked for in that locale.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 8: that is a typed unavailable outcome
 * and never a load failure, so a caller can tell an untranslated scope from a broken one. The set
 * is the compiled one with the lazy scope's Arabic artifact and loader taken out, the shape a build
 * that shipped the scope in one locale only has.
 */
import { describe, expect, it } from 'vitest';

import {
  catalogKey,
  compileSet,
  createStore,
  editedSet,
  loadersFor,
  rejectionOf,
  scope,
} from './catalog-store-harness.js';

describe('an untranslated scope', () => {
  it('is reported unavailable, not as a load that failed', async () => {
    const compiled = compileSet();
    const set = editedSet(compiled, ({ descriptor }) => {
      for (const provider of descriptor.providers) {
        provider.artifacts = provider.artifacts.filter(
          ({ address }) =>
            !(
              address.key['scopeId'] === 'lazy' &&
              address.key['catalogLocale'] === 'ar-EG'
            ),
        ) as unknown as typeof provider.artifacts;
      }
    });
    const loaders = loadersFor(compiled);
    delete loaders[catalogKey('lazy', 'ar-EG')];
    const store = createStore(set, loaders);
    const signal = new AbortController().signal;

    expect(store.has(scope('lazy'), 'ar-EG')).toBe(false);
    expect(
      await rejectionOf(() => store.preload(scope('lazy'), 'ar-EG', signal)),
    ).toMatchObject({
      code: 'scope-unavailable',
      outcome: 'localized-representation-unavailable',
      scopeId: 'lazy',
      targetLocale: 'ar-EG',
    });
    await expect(
      store.preload(scope('lazy'), 'en-US', signal),
    ).resolves.toBeUndefined();
  });
});
