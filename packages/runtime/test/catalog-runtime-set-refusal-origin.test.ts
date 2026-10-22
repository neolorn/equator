/**
 * Which of its two refusals a catalog store gives a set, and what each carries.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 4 has the runtime establish that a set
 * agrees with its configuration before a catalog is loaded. A set that is missing a member the
 * comparison reads was not written by the toolkit, and the refusal keeps the error of the read
 * that met it as its cause, which is what tells a developer where the set is broken. An entry for
 * a scope the configuration does not declare is a well formed set that disagrees, so it is refused
 * by the comparison itself: the entry is named and there is no underlying error.
 */
import { describe, expect, it } from 'vitest';

import { LocalCatalogStore } from '../src/catalog-runtime.js';
import { LocalizationError } from '@neolorn/equator/core';

import {
  PROVIDER,
  compileSet,
  editedSet,
  loadersFor,
  type CompiledSet,
} from './catalog-store-harness.js';

let fixture: CompiledSet | undefined;
const compiled = (): CompiledSet => (fixture ??= compileSet());

type Edited = Parameters<Parameters<typeof editedSet>[1]>[0];

/** What the store throws when it is constructed from the edited set. */
function thrownFor(edit: (copy: Edited) => void): unknown {
  const set = editedSet(compiled(), edit);
  try {
    new LocalCatalogStore(
      set.configuration,
      set.descriptor,
      loadersFor(compiled()),
    );
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('the refusal of a catalog set', () => {
  it('keeps the failed read as its cause when the set is missing a member', () => {
    const thrown = thrownFor((copy) => {
      (copy.descriptor.providers as unknown as unknown[])[0] = null;
    });

    expect(thrown).toBeInstanceOf(LocalizationError);
    expect((thrown as LocalizationError).diagnostic.code).toBe(
      'invalid-configuration',
    );
    expect((thrown as LocalizationError).cause).toBeInstanceOf(TypeError);
  });

  it('names an entry whose scope the configuration does not declare, and has no cause', () => {
    const thrown = thrownFor((copy) => {
      const [first] =
        (
          copy.descriptor as unknown as {
            providers: {
              artifacts: { address: { key: Record<string, string> } }[];
            }[];
          }
        ).providers[0]?.artifacts ?? [];
      if (first !== undefined) first.address.key['scopeId'] = 'undeclared';
    });

    expect(thrown).toBeInstanceOf(LocalizationError);
    expect((thrown as LocalizationError).diagnostic).toMatchObject({
      code: 'invalid-configuration',
      providerId: PROVIDER,
      scopeId: 'undeclared',
    });
    expect((thrown as LocalizationError).cause).toBeUndefined();
  });
});
