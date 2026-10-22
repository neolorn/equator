import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

/**
 * How a handler recognizes what Equator throws.
 *
 * The class documents its `name` as the way to recognize it without an `instanceof`, which is what
 * a handler on the far side of a serialization boundary, or one holding another copy of the class,
 * has to go on.
 */

describe('a thrown localization error', () => {
  it('is named for its class, and carries its diagnostic', () => {
    const diagnostic = Object.freeze({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: 'The declaration is invalid.',
    } as const);
    const error = new LocalizationError(diagnostic);

    expect(error.name).toBe('LocalizationError');
    expect(error.diagnostic).toBe(diagnostic);
    expect(error.message).toBe(diagnostic.message);
    expect(error).toBeInstanceOf(Error);
  });
});
