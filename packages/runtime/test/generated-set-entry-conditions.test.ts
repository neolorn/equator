/**
 * What each entry of a generated set, and the loader map beside it, must be before a store exists.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 4 has the set agree with the
 * configuration and each entry agree with its scope; section 7 holds every count in an entry's
 * resource summary to a fixed ceiling; section 8 has the loader map copied and refuses anything in
 * it that is not a plain function. `generated-set-admission.test.ts` breaks each condition once.
 * These cases break them in the ways that leave a neighbouring condition satisfied, so the refusal
 * can only be the one the case names, and they stand on each bound.
 */
import { describe, expect, it } from 'vitest';

import { RUNTIME_LIMITS } from '../src/runtime-safety.js';
import {
  PROVIDER,
  catalogKey,
  compileSet,
  createStore,
  diagnosticOf,
  editedSet,
  loadersFor,
  type CompiledSet,
} from './catalog-store-harness.js';

// Compiled on first use, so that importing this file runs none of the library.
let fixture: CompiledSet | undefined;
const compiled = (): CompiledSet => (fixture ??= compileSet());

type SetEdit = Parameters<typeof editedSet>[1];
type Editable = Parameters<SetEdit>[0];

interface Entry {
  address: Record<string, unknown> & { key: Record<string, string> };
  resources: Record<string, unknown> & {
    maximumMessage: Record<string, unknown>;
  };
}

const entries = ({ descriptor }: Editable): Entry[] =>
  descriptor.providers.flatMap(
    ({ artifacts }) => artifacts as unknown as Entry[],
  );

const onEntry =
  (edit: (entry: Entry) => void): SetEdit =>
  (copy) =>
    edit(entries(copy)[0]!);

const FINGERPRINT = `sha256-${'A'.repeat(43)}`;

const refusal = (edit: SetEdit, loaders?: Record<string, () => unknown>) =>
  diagnosticOf(() => createStore(editedSet(compiled(), edit), loaders));

describe('a generated set', () => {
  it('is accepted as the compiler wrote it', () => {
    expect(createStore(compiled()).artifactCount).toBe(4);
  });

  it.each<[string, SetEdit]>([
    [
      'it and its configuration agree on a generated ABI this release does not read',
      (copy) => {
        const abi = 'equator-generated/0';
        (copy.configuration as Record<string, unknown>)['generatedAbi'] = abi;
        (copy.descriptor as unknown as Record<string, unknown>)[
          'generatedAbi'
        ] = abi;
        for (const { address } of entries(copy)) address['generatedAbi'] = abi;
      },
    ],
    [
      'its generated ABI is not the configuration’s',
      ({ descriptor }) => {
        (descriptor as unknown as Record<string, unknown>)['generatedAbi'] =
          'equator-generated/0';
      },
    ],
    [
      'its application contract is not the configuration’s',
      ({ descriptor }) => {
        (descriptor as unknown as Record<string, unknown>)[
          'applicationContractFingerprint'
        ] = FINGERPRINT;
      },
    ],
    [
      'its semantic registry is not the configuration’s',
      ({ descriptor }) => {
        (descriptor as unknown as Record<string, unknown>)[
          'semanticRegistryFingerprint'
        ] = FINGERPRINT;
      },
    ],
    [
      'a provider in it has no identity, even one with no catalogs',
      ({ descriptor }) => {
        (descriptor.providers as unknown[]).push({
          providerId: '',
          catalogSetId: 'unnamed',
          artifacts: [],
        });
      },
    ],
    [
      'a provider in it has no catalog-set identity',
      ({ descriptor }) => {
        (descriptor.providers[0] as unknown as Record<string, unknown>)[
          'catalogSetId'
        ] = '';
      },
    ],
    [
      'a provider in it lists another provider’s catalogs',
      ({ descriptor }) => {
        (descriptor.providers[0] as unknown as Record<string, unknown>)[
          'providerId'
        ] = '@example/another-provider';
      },
    ],
  ])('is refused when %s', (_name, edit) => {
    expect(refusal(edit)?.code).toBe('invalid-configuration');
  });
});

describe('an entry of a generated set', () => {
  it.each<[string, (address: Entry['address']) => void]>([
    [
      'a generated ABI that is not the configuration’s',
      (address) => {
        address['generatedAbi'] = 'equator-generated/0';
      },
    ],
    [
      'an application contract that is not its scope’s',
      (address) => {
        address['applicationContractFingerprint'] = FINGERPRINT;
      },
    ],
    [
      'a semantic registry that is not its scope’s',
      (address) => {
        address['semanticRegistryFingerprint'] = FINGERPRINT;
      },
    ],
    [
      'an extension its scope does not require',
      (address) => {
        address['requiredExtensions'] = [{ kind: 'function', id: 'extra' }];
      },
    ],
    [
      'no list of required extensions',
      (address) => {
        delete address['requiredExtensions'];
      },
    ],
    [
      'no list of required features',
      (address) => {
        delete address['requiredFeatures'];
      },
    ],
    [
      'required features that are text rather than a list',
      (address) => {
        address['requiredFeatures'] = 'selection';
      },
    ],
    [
      'a digest with something before it',
      (address) => {
        address['contentDigest'] = `x${FINGERPRINT}`;
      },
    ],
    [
      'a digest with something after it',
      (address) => {
        address['contentDigest'] = `${FINGERPRINT}x`;
      },
    ],
    [
      'a digest one character short',
      (address) => {
        address['contentDigest'] = FINGERPRINT.slice(0, -1);
      },
    ],
  ])('is refused when it states %s', (_name, edit) => {
    const diagnostic = refusal(onEntry(({ address }) => edit(address)));

    expect(diagnostic?.code).toBe('invalid-configuration');
    // The entry is named, and no reason is given: the configuration is wrong, not an input.
    expect(Object.keys(diagnostic ?? {}).sort()).toStrictEqual([
      'code',
      'message',
      'outcome',
      'providerId',
      'scopeId',
      'targetLocale',
    ]);
    expect(diagnostic?.providerId).toBe(PROVIDER);
  });

  it('is refused when it states no list of required extensions and its scope states none either', () => {
    // Two absent lists agree with each other, so only asking for a list refuses this one.
    expect(
      refusal((copy) => {
        for (const scope of copy.configuration.scopes) {
          delete (scope as unknown as Record<string, unknown>)[
            'requiredExtensions'
          ];
        }
        for (const { address } of entries(copy)) {
          delete address['requiredExtensions'];
        }
      })?.code,
    ).toBe('invalid-configuration');
  });

  it('is refused when the set lists it twice', () => {
    expect(
      refusal(({ descriptor }) => {
        const { artifacts } = descriptor.providers[0]!;
        (artifacts as unknown[]).push(structuredClone(artifacts[0]));
      })?.code,
    ).toBe('invalid-configuration');
  });

  it('is refused when the loader map has nothing for it', () => {
    const { [catalogKey('lazy', 'ar-EG')]: _dropped, ...loaders } =
      loadersFor(compiled());

    expect(refusal(() => undefined, loaders)?.code).toBe(
      'invalid-configuration',
    );
  });
});

const CATALOG_CEILINGS: readonly (readonly [string, number])[] = [
  ['decodedBytes', RUNTIME_LIMITS.catalogBytes],
  ['messages', RUNTIME_LIMITS.messagesPerCatalog],
  ['identifiers', RUNTIME_LIMITS.identifiersPerCatalog],
  ['literals', RUNTIME_LIMITS.literalsPerCatalog],
  ['irNodes', RUNTIME_LIMITS.irNodesPerCatalog],
  ['depth', RUNTIME_LIMITS.jsonDepth],
  ['selectors', RUNTIME_LIMITS.selectorsPerCatalog],
  ['variants', RUNTIME_LIMITS.variantsPerCatalog],
  ['inputs', RUNTIME_LIMITS.inputsPerCatalog],
  ['slots', RUNTIME_LIMITS.slotsPerCatalog],
  ['references', RUNTIME_LIMITS.referencesPerCatalog],
  ['functions', RUNTIME_LIMITS.functionsPerCatalog],
  ['outputParts', RUNTIME_LIMITS.outputPartsPerCatalog],
];

const MESSAGE_CEILINGS: readonly (readonly [string, number])[] = [
  ['irNodes', RUNTIME_LIMITS.irNodesPerCatalog],
  ['depth', RUNTIME_LIMITS.jsonDepth],
  ['selectors', RUNTIME_LIMITS.selectorsPerMessage],
  ['variants', RUNTIME_LIMITS.variantsPerMessage],
  ['inputs', RUNTIME_LIMITS.inputsPerMessage],
  ['slots', RUNTIME_LIMITS.slotsPerMessage],
  ['outputParts', RUNTIME_LIMITS.outputPartsPerMessage],
];

/** Values no count may take, each of which a looser comparison would let through. */
const NOT_A_COUNT: readonly (readonly [string, unknown])[] = [
  ['negative', -1],
  ['fractional', 1.5],
  ['text that reads as a number', '5'],
  ['absent', undefined],
];

describe('an entry’s resource summary', () => {
  const withSummary = (edit: (resources: Entry['resources']) => void) =>
    refusal(onEntry(({ resources }) => edit(resources)));

  it.each<[string, (entry: Entry) => void]>([
    [
      'is not a record',
      (entry) => {
        (entry as unknown as Record<string, unknown>)['resources'] = [];
      },
    ],
    [
      'is null',
      (entry) => {
        (entry as unknown as Record<string, unknown>)['resources'] = null;
      },
    ],
    [
      'states a profile this release does not read',
      ({ resources }) => {
        resources['profile'] = 'equator-resource-summary/0';
      },
    ],
    [
      'carries a count the profile does not name',
      ({ resources }) => {
        resources['bytes'] = 1;
      },
    ],
    [
      'gives its largest message as a list',
      ({ resources }) => {
        (resources as Record<string, unknown>)['maximumMessage'] = [];
      },
    ],
    [
      'gives its largest message as null',
      ({ resources }) => {
        (resources as Record<string, unknown>)['maximumMessage'] = null;
      },
    ],
    [
      'gives its largest message a count the profile does not name',
      ({ resources }) => {
        resources.maximumMessage['bytes'] = 1;
      },
    ],
  ])('is refused when it %s', (_name, edit) => {
    expect(refusal(onEntry(edit))?.code).toBe('invalid-configuration');
  });

  describe.each(CATALOG_CEILINGS)('its %s', (count, ceiling) => {
    it('may be exactly at the ceiling', () => {
      expect(
        withSummary((resources) => {
          resources[count] = ceiling;
        }),
      ).toBeUndefined();
    });

    it('may not be one past the ceiling', () => {
      expect(
        withSummary((resources) => {
          resources[count] = ceiling + 1;
        })?.code,
      ).toBe('invalid-configuration');
    });

    it.each(NOT_A_COUNT)('may not be %s', (_name, value) => {
      expect(
        withSummary((resources) => {
          if (value === undefined) delete resources[count];
          else resources[count] = value;
        })?.code,
      ).toBe('invalid-configuration');
    });
  });

  describe.each(MESSAGE_CEILINGS)(
    'its largest message’s %s',
    (count, ceiling) => {
      it('may be exactly at the ceiling', () => {
        expect(
          withSummary(({ maximumMessage }) => {
            maximumMessage[count] = ceiling;
          }),
        ).toBeUndefined();
      });

      it('may not be one past the ceiling', () => {
        expect(
          withSummary(({ maximumMessage }) => {
            maximumMessage[count] = ceiling + 1;
          })?.code,
        ).toBe('invalid-configuration');
      });

      it.each(NOT_A_COUNT)('may not be %s', (_name, value) => {
        expect(
          withSummary(({ maximumMessage }) => {
            if (value === undefined) delete maximumMessage[count];
            else maximumMessage[count] = value;
          })?.code,
        ).toBe('invalid-configuration');
      });
    },
  );
});

describe('the loader map', () => {
  const withLoaders = (loaders: unknown) =>
    diagnosticOf(() =>
      createStore(compiled(), loaders as Record<string, () => unknown>),
    );

  it.each<[string, () => unknown]>([
    ['a list', () => Object.values(loadersFor(compiled()))],
    ['null', () => null],
    [
      'an instance of a class',
      () => Object.assign(new (class Loaders {})(), loadersFor(compiled())),
    ],
    ['a map', () => new Map(Object.entries(loadersFor(compiled())))],
  ])('is refused when it is %s', (_name, loaders) => {
    expect(withLoaders(loaders())?.code).toBe('invalid-configuration');
  });

  it('is refused when it has a key that is not text', () => {
    const loaders = {
      ...loadersFor(compiled()),
      [Symbol('extra')]: () => undefined,
    };

    expect(withLoaders(loaders)?.code).toBe('invalid-configuration');
  });

  it.each<[string, PropertyDescriptor]>([
    ['text', { value: 'catalogs/extra.js' }],
    ['a getter that answers a loader', { get: () => () => undefined }],
    ['a setter with nothing to read', { set: () => undefined }],
  ])('is refused when an entry no catalog uses is %s', (_name, descriptor) => {
    const loaders = Object.defineProperty(
      loadersFor(compiled()),
      `${PROVIDER}:extra:en-US`,
      { enumerable: true, configurable: true, ...descriptor },
    );

    expect(withLoaders(loaders)?.code).toBe('invalid-configuration');
  });

  it('is accepted with a loader no catalog uses, and with no prototype', () => {
    const loaders = Object.assign(
      Object.create(null) as Record<string, () => unknown>,
      loadersFor(compiled()),
      { [`${PROVIDER}:extra:en-US`]: () => undefined },
    );

    expect(withLoaders(loaders)).toBeUndefined();
  });
});
