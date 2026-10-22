/**
 * An extension names its functions under a namespace, or it is not an extension.
 *
 * `specs/01-standards-profile.spec.md` section 9: a namespace is what keeps an extension's function
 * from colliding with Unicode's or with another extension's. A bare name is where a standard
 * function lives, so it is refused whatever it spells, including a name the standard already uses.
 * Whether the provider owns the namespace it wrote is not something a descriptor can show.
 *
 * The refusal is required at the identity field of the registry schema, which is the published
 * rule a registry file is read against. `descriptorError` repeats the rule after the schema, so a
 * schema that lost it would still refuse, somewhere else, and a check on `ok` alone would pass.
 */
import { describe, expect, it } from 'vitest';

import { defineExtensionRegistry } from '../src/index.js';

function withId(id: string) {
  return defineExtensionRegistry([
    {
      kind: 'message-function',
      id,
      operandType: 'string',
      resultType: 'string',
      selector: 'none',
      maximumOutputLength: 64,
    },
  ]);
}

describe('the namespace of an extension function', () => {
  it('accepts a function named under a namespace', () => {
    expect(withId('demo:uppercase').ok).toBe(true);
  });

  it.each([
    ['a bare name', 'uppercase'],
    ['the name of a standard function', 'number'],
    ['an empty namespace', ':uppercase'],
    ['an empty name', 'demo:'],
  ])('refuses %s at its identity', (_label, id) => {
    const result = withId(id);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(({ path }) => path)).toContainEqual([
      'descriptors',
      0,
      'id',
    ]);
  });
});
