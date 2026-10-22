/**
 * A catalog set or a configuration written by hand with a member of the wrong shape.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 4 has the runtime establish that a set
 * agrees with its configuration before a catalog is loaded. A set the toolkit wrote has every
 * member the comparison reads. One that was written or edited by hand may not, and the store
 * refuses it as it refuses a set that disagrees: with the configuration failure, not with the
 * error of whichever read met the missing member first.
 */
import { describe, expect, it } from 'vitest';

import { LocalCatalogStore } from '../src/catalog-runtime.js';
import { LocalizationError } from '@neolorn/equator/core';

import {
  compileSet,
  editedSet,
  loadersFor,
  type CompiledSet,
} from './catalog-store-harness.js';

let fixture: CompiledSet | undefined;
const compiled = (): CompiledSet => (fixture ??= compileSet());

type Edited = Parameters<Parameters<typeof editedSet>[1]>[0];
type Loose = Record<string, unknown>;

const provider = (copy: Edited): Loose =>
  (copy.descriptor.providers as unknown as Loose[])[0] as Loose;
const artifact = (copy: Edited): Loose =>
  (provider(copy)['artifacts'] as Loose[])[0] as Loose;

const FAULTS: readonly (readonly [string, (copy: Edited) => void])[] = [
  [
    'no provider list',
    (copy) => delete (copy.descriptor as unknown as Loose)['providers'],
  ],
  [
    'a provider list that is text',
    (copy) =>
      ((copy.descriptor as unknown as Loose)['providers'] = 'providers'),
  ],
  [
    'a provider that is nothing',
    (copy) => ((copy.descriptor.providers as unknown as unknown[])[0] = null),
  ],
  [
    'a provider with no identity',
    (copy) => delete provider(copy)['providerId'],
  ],
  [
    'a provider with no artifact list',
    (copy) => delete provider(copy)['artifacts'],
  ],
  [
    'an artifact that is nothing',
    (copy) => ((provider(copy)['artifacts'] as unknown[])[0] = null),
  ],
  ['an artifact with no address', (copy) => delete artifact(copy)['address']],
  [
    'an address with no key',
    (copy) => delete (artifact(copy)['address'] as Loose)['key'],
  ],
  [
    'an address whose digest is a number',
    (copy) => ((artifact(copy)['address'] as Loose)['contentDigest'] = 7),
  ],
  [
    'a configuration with no scope list',
    (copy) => delete (copy.configuration as unknown as Loose)['scopes'],
  ],
  [
    'a configuration whose scope is nothing',
    (copy) => ((copy.configuration.scopes as unknown as unknown[])[0] = null),
  ],
  [
    'a configuration with no locale list',
    (copy) => delete (copy.configuration as unknown as Loose)['locales'],
  ],
];

describe('a catalog store constructed from a set of the wrong shape', () => {
  it('accepts the set the compiler wrote', () => {
    const set = compiled();
    expect(
      () =>
        new LocalCatalogStore(
          set.configuration,
          set.descriptor,
          loadersFor(set),
        ),
    ).not.toThrow();
  });

  it.each(FAULTS)('refuses %s as a configuration failure', (_, fault) => {
    const set = editedSet(compiled(), fault);
    let thrown: unknown;
    try {
      new LocalCatalogStore(
        set.configuration,
        set.descriptor,
        loadersFor(compiled()),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LocalizationError);
    expect((thrown as LocalizationError).diagnostic.code).toBe(
      'invalid-configuration',
    );
  });
});
