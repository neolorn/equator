/**
 * A rich-slot-kind descriptor and the text projection it declares.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8: every rich contract has a safe text
 * projection, so a custom kind states how its slot becomes text, as its children or as what its
 * trusted binding returns, and a descriptor that states neither is not a kind.
 */
import { describe, expect, it } from 'vitest';

import { defineExtensionRegistry } from '../src/index.js';

function descriptor(
  shape: 'paired' | 'standalone',
  textProjection?: string,
): Record<string, unknown> {
  return {
    kind: 'rich-slot-kind',
    id: 'demo:marker',
    shape,
    interactive: false,
    ...(textProjection === undefined ? {} : { textProjection }),
  };
}

describe('a rich-slot-kind descriptor', () => {
  it.each([
    ['paired', 'children'],
    ['paired', 'binding-required'],
    ['standalone', 'binding-required'],
  ] as const)('is accepted as %s with %s', (shape, projection) => {
    expect(
      defineExtensionRegistry([descriptor(shape, projection)] as never).ok,
    ).toBe(true);
  });

  it.each(['paired', 'standalone'] as const)(
    'is refused as %s without a text projection',
    (shape) => {
      expect(defineExtensionRegistry([descriptor(shape)] as never).ok).toBe(
        false,
      );
    },
  );

  it('is refused with a projection outside the two', () => {
    expect(
      defineExtensionRegistry([descriptor('paired', 'none')] as never).ok,
    ).toBe(false);
  });
});
