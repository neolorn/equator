/**
 * A candidate catalog that tries to bring a function with it.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 1: catalog data names a descriptor
 * identity and never supplies the implementation behind one. The inert snapshot is the door that
 * refuses code, so it is asserted directly as well as through the store, where later checks would
 * also refuse the candidate and hide a snapshot that let a function through.
 */
import { describe, expect, it } from 'vitest';

import { snapshotInertJson } from '../src/runtime-safety.js';
import {
  catalogKey,
  compileSet,
  createStore,
  loadersFor,
  rejectionOf,
  scope,
} from './catalog-store-harness.js';

const LIMITS = {
  maximumDepth: 32,
  maximumNodes: 1_000,
  maximumCodeUnits: 10_000,
};
const handler = () => 'executed';

describe('a catalog carries no code', () => {
  it.each([
    ['at the top level', handler],
    ['inside a record', { format: handler }],
    ['inside an array', [{ id: 'x:upper', implementation: handler }]],
  ])('the inert snapshot refuses a function %s', (_label, candidate) => {
    expect(() => snapshotInertJson(candidate, LIMITS)).toThrow(
      /Only inert JSON data is admitted/u,
    );
  });

  it('refuses a loaded catalog whose required extension carries an implementation', async () => {
    const set = compileSet();
    const loaders = loadersFor(set);
    const key = catalogKey('shell', 'en-US');
    const original = loaders[key]!;
    let called = false;
    loaders[key] = () => ({
      ...(original() as object),
      requiredExtensions: [
        {
          kind: 'message-function',
          id: 'x:upper',
          format: () => {
            called = true;
            return 'executed';
          },
        },
      ],
    });
    const store = createStore(set, loaders);
    expect(
      await rejectionOf(() =>
        store.preload(scope('shell'), 'en-US', new AbortController().signal),
      ),
    ).toMatchObject({ code: 'catalog-admission-failed' });
    expect(called).toBe(false);
  });
});
