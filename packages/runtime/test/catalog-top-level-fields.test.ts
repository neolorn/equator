/**
 * A loaded catalog with one field more than its schema names.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 1 fixes the top level, and section 4 puts
 * that check before the digest. The digest would refuse the same candidate later, so the reason is
 * what shows which door closed: a malformed shape, not an integrity mismatch.
 */
import { describe, expect, it } from 'vitest';

import {
  catalogKey,
  compileSet,
  createStore,
  loadersFor,
  rejectionOf,
  scope,
} from './catalog-store-harness.js';

describe('the top level of a loaded catalog', () => {
  it.each([
    [
      'an extra field',
      (catalog: Record<string, unknown>) => ({ ...catalog, handler: 'x' }),
    ],
    [
      'a missing field',
      (catalog: Record<string, unknown>) => {
        const { semanticRegistryFingerprint: _omitted, ...rest } = catalog;
        return rest;
      },
    ],
  ])('refuses %s as malformed input', async (_label, edit) => {
    const set = compileSet();
    const loaders = loadersFor(set);
    const key = catalogKey('shell', 'en-US');
    const original = loaders[key]!;
    loaders[key] = () => edit(original() as Record<string, unknown>);
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
