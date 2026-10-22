/**
 * A compiled catalog under another standards profile, refused at both doors.
 *
 * `specs/01-standards-profile.spec.md` section 1 binds every part of a release to one profile, and
 * the compiled artifact is the part that crosses from one build into another's runtime. The
 * descriptor is checked when the store is built and the catalog again when it is loaded, because a
 * catalog can disagree with a descriptor that is itself correct.
 */
import { describe, expect, it } from 'vitest';

import {
  catalogKey,
  compileSet,
  createStore,
  diagnosticOf,
  editedSet,
  loadersFor,
  rejectionOf,
  scope,
} from './catalog-store-harness.js';

describe('the standards profile of a compiled artifact', () => {
  it('admits a set compiled under equator-1', async () => {
    const set = compileSet();
    const store = createStore(set);
    await expect(
      store.preload(scope('shell'), 'en-US', new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it('refuses a descriptor entry that names another profile', () => {
    const set = editedSet(compileSet(), ({ descriptor }) => {
      (
        descriptor.providers[0]!.artifacts[0]!.address as Record<
          string,
          unknown
        >
      )['standardsProfile'] = 'equator-2';
    });
    expect(diagnosticOf(() => createStore(set))).toMatchObject({
      code: 'invalid-configuration',
    });
  });

  it('refuses a loaded catalog that names another profile than its address', async () => {
    const set = compileSet();
    const loaders = loadersFor(set);
    const key = catalogKey('shell', 'en-US');
    const original = loaders[key]!;
    loaders[key] = () => ({
      ...(original() as object),
      standardsProfile: 'equator-2',
    });
    const store = createStore(set, loaders);
    expect(
      await rejectionOf(() =>
        store.preload(scope('shell'), 'en-US', new AbortController().signal),
      ),
    ).toMatchObject({
      code: 'catalog-admission-failed',
      reason: 'malformed-input',
    });
  });
});
