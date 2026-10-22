import { describe, expect, it } from 'vitest';

import type {
  RuntimeExtensionBinding,
  RuntimeIdentifierSegmentDescriptor,
} from '@neolorn/equator/core';
import { defineExtensionRegistry } from '../../toolkit/src/extensions.js';
import {
  RuntimeExtensions,
  defineRuntimeExtensions,
} from '../src/extensions.js';
import { refusalOf } from './compiled-artifact-harness.js';

/**
 * What an identifier-segment binding carries.
 *
 * A family resolves its segments in the generated module, against the syntax and the bound the
 * descriptor declares, and section 10 of `specs/04-message-authoring-and-catalogs.spec.md` has it
 * validate a spelling rather than correct one, with no fuzzy match and no hidden alias. Nothing is
 * left for a handler to do, so the binding is the descriptor, which section 15 of
 * `specs/09-safe-content-and-ux.spec.md` still requires to be installed wherever a catalog needs it.
 */

/** Built through the compiler's own registry, so the fingerprint is the one the compiler derived. */
const segment = (): RuntimeIdentifierSegmentDescriptor => {
  const registry = defineExtensionRegistry([
    {
      kind: 'identifier-segment',
      id: 'test:state',
      syntax: 'lower-kebab',
      maximumLength: 32,
    },
  ]);
  if (!registry.ok) {
    throw new Error(
      `the descriptor under test was refused: ${registry.diagnostics
        .map(({ summary }) => summary)
        .join('; ')}`,
    );
  }
  return registry.value
    .descriptors[0] as unknown as RuntimeIdentifierSegmentDescriptor;
};

describe('an identifier-segment binding', () => {
  it('is its descriptor, and satisfies a catalog that requires it', () => {
    const descriptor = segment();

    const bindings = defineRuntimeExtensions([{ descriptor }]);

    expect(bindings).toHaveLength(1);
    expect(() => new RuntimeExtensions(bindings, [descriptor])).not.toThrow();
  });

  it('refuses a handler, since nothing would ever call it', () => {
    const descriptor = segment();

    expect(
      refusalOf(() =>
        defineRuntimeExtensions([
          {
            descriptor,
            canonicalize: (value: string) => value,
          } as unknown as RuntimeExtensionBinding,
        ]),
      ).diagnostic.code,
    ).toBe('invalid-configuration');
  });

  it('is still required where a catalog names the segment type', () => {
    expect(
      refusalOf(() => new RuntimeExtensions([], [segment()])).diagnostic.code,
    ).toBe('invalid-configuration');
  });
});
