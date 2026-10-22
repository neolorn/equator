/**
 * Every condition a generated set must meet before one catalog in it is loaded.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 4 lists them. Each case below breaks one
 * and leaves the rest of a set the real compiler produced intact, so a refusal names the condition
 * that case breaks rather than one the edit disturbed on the way.
 */
import { describe, expect, it } from 'vitest';

import {
  catalogKey,
  compileSet,
  createStore,
  diagnosticOf,
  editedSet,
  loadersFor,
} from './catalog-store-harness.js';

type Edit = Parameters<typeof editedSet>[1];

const firstAddress: (
  edit: (address: Record<string, unknown>) => void,
) => Edit =
  (edit) =>
  ({ descriptor }) =>
    edit(descriptor.providers[0]!.artifacts[0]!.address);

const cases: ReadonlyArray<readonly [string, Edit]> = [
  [
    'a descriptor profile this release does not read',
    ({ descriptor }) => {
      (descriptor as { profile: string }).profile = 'equator-catalog-set/2';
    },
  ],
  [
    'a semantic-registry fingerprint the configuration does not carry',
    ({ configuration }) => {
      (configuration as Record<string, unknown>)[
        'semanticRegistryFingerprint'
      ] = `sha256-${'A'.repeat(43)}`;
    },
  ],
  [
    'an artifact for a locale the configuration does not ship',
    ({ configuration }) => {
      (configuration as Record<string, unknown>)['locales'] = ['en-US'];
    },
  ],
  [
    'an artifact for a scope the configuration does not declare',
    ({ configuration }) => {
      (configuration as Record<string, unknown>)['scopes'] =
        configuration.scopes.filter(({ scopeId }) => scopeId !== 'lazy');
    },
  ],
  [
    'a compiled profile this release does not read',
    firstAddress((address) => {
      address['compiledIrProfile'] = 'equator-compiled-ir/2';
    }),
  ],
  [
    'a schema this release does not read',
    firstAddress((address) => {
      address['schema'] = 'equator-compiled-catalog/2';
    }),
  ],
  [
    'a required feature this release does not support',
    firstAddress((address) => {
      address['requiredFeatures'] = ['remote-evaluation'];
    }),
  ],
  [
    "an application-contract fingerprint that is not its scope's",
    firstAddress((address) => {
      address['applicationContractFingerprint'] = `sha256-${'B'.repeat(43)}`;
    }),
  ],
  [
    "required extensions that are not its scope's",
    firstAddress((address) => {
      address['requiredExtensions'] = [
        { kind: 'message-function', id: 'x:upper' },
      ];
    }),
  ],
  [
    'a content digest that is not sha256 and 43 base64url characters',
    firstAddress((address) => {
      address['contentDigest'] = `sha256-${'A'.repeat(42)}=`;
    }),
  ],
  [
    'a resource summary over the fixed ceilings',
    ({ descriptor }) => {
      const artifact = descriptor.providers[0]!.artifacts[0]! as unknown as {
        resources: { decodedBytes: number };
      };
      artifact.resources.decodedBytes = Number.MAX_SAFE_INTEGER;
    },
  ],
  [
    'two artifacts claiming one catalog identity',
    ({ descriptor }) => {
      const provider = descriptor.providers[0]!;
      provider.artifacts.push(structuredClone(provider.artifacts[0]!));
    },
  ],
  [
    'an empty set',
    ({ descriptor }) => {
      (descriptor as { providers: unknown[] }).providers = [];
    },
  ],
];

describe('admission of a generated set', () => {
  it('builds a store over the set as compiled', () => {
    expect(diagnosticOf(() => createStore(compileSet()))).toBeUndefined();
  });

  it.each(cases)('refuses %s', (_label, edit) => {
    const set = editedSet(compileSet(), edit);
    expect(diagnosticOf(() => createStore(set))).toMatchObject({
      code: 'invalid-configuration',
    });
  });

  it('refuses a set with no loader for one of its artifacts', () => {
    const set = compileSet();
    const loaders = loadersFor(set);
    delete loaders[catalogKey('lazy', 'ar-EG')];
    expect(diagnosticOf(() => createStore(set, loaders))).toMatchObject({
      code: 'invalid-configuration',
    });
  });
});
