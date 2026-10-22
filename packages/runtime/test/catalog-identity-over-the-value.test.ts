/**
 * What a transport wrapper can and cannot do to a catalog.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 2: identity is computed over the catalog
 * value, not over the module carrying it. A loader that hands back the module rather than its
 * export, and a catalog whose text was changed after compilation without changing its measured
 * size, are both refused, the second by the digest alone.
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

interface Candidate {
  messages: Array<{ messageId: string; body: { pattern?: unknown[] } }>;
}

async function refusalFor(edit: (catalog: Candidate) => unknown) {
  const set = compileSet();
  const loaders = loadersFor(set);
  const key = catalogKey('shell', 'en-US');
  const original = loaders[key]!;
  loaders[key] = () => edit(original() as Candidate);
  const store = createStore(set, loaders);
  return rejectionOf(() =>
    store.preload(scope('shell'), 'en-US', new AbortController().signal),
  );
}

describe('catalog identity is the value, not its wrapper', () => {
  it('refuses a module namespace in place of the catalog it exports', async () => {
    expect(
      await refusalFor((catalog) => ({ catalog, chunk: 'shell-en-US' })),
    ).toMatchObject({ code: 'catalog-admission-failed' });
  });

  it('refuses content edited after compilation when its size is unchanged', async () => {
    expect(
      await refusalFor((catalog) => {
        const title = catalog.messages.find(
          ({ messageId }) => messageId === 'title',
        );
        if (title?.body.pattern?.[0] !== 'Catalog store') {
          throw new Error(
            'The fixture title is not where this case expects it.',
          );
        }
        title.body.pattern[0] = 'Catalog STORE';
        return catalog;
      }),
    ).toMatchObject({
      code: 'catalog-admission-failed',
      reason: 'integrity-mismatch',
    });
  });
});
