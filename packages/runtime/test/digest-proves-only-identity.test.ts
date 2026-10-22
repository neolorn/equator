/**
 * A catalog whose recorded digest is right for it, and which is still not a catalog.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 3: a matching digest proves byte
 * identity and nothing else. The candidate here is re-digested after the edit and its address
 * carries that digest, so only the structural checks stand between it and admission.
 */
import { describe, expect, it } from 'vitest';

import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from '../../toolkit/src/canonical-json.js';
import {
  catalogKey,
  compileSet,
  createStore,
  editedSet,
  loadersFor,
  rejectionOf,
  scope,
} from './catalog-store-harness.js';

describe('a matching digest is not admission', () => {
  it('refuses a structurally invalid catalog whose digest matches its address', async () => {
    const compiled = compileSet();
    const source = compiled.catalogs.find(
      ({ key }) => key.scopeId === 'shell' && key.catalogLocale === 'en-US',
    )!;
    const hostile = structuredClone(source) as unknown as {
      messages: Array<{ body: Record<string, unknown> }>;
    };
    hostile.messages[0]!.body['kind'] = 'script';
    const digest = digestCanonicalJson(
      'equator-compiled-catalog/1',
      hostile as unknown as CanonicalJsonValue,
    );
    const set = editedSet(compiled, ({ descriptor }) => {
      for (const provider of descriptor.providers) {
        for (const artifact of provider.artifacts) {
          const { scopeId, catalogLocale } = artifact.address.key;
          if (scopeId === 'shell' && catalogLocale === 'en-US') {
            (artifact.address as Record<string, unknown>)['contentDigest'] =
              digest;
          }
        }
      }
    });
    const loaders = loadersFor(compiled);
    loaders[catalogKey('shell', 'en-US')] = () => structuredClone(hostile);
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
