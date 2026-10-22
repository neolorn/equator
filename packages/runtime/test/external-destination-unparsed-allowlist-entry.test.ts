/**
 * An allowlist entry that is not an address at all.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 3 gives a refused entry the reason
 * `malformed-input`, because the list was written wrongly. An entry with no scheme is the commonest
 * way to write one wrongly: a host name alone reads as an origin and parses as nothing. It is
 * refused as an entry, with the parser's own error kept as the cause, and it refuses the call
 * whatever the other entries would have admitted.
 */
import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import { externalDestination } from '../src/destinations.js';

const ADDRESS = 'https://example.com/second';

/** The refusal an action raises, or `undefined` when it was admitted. */
function refusalOf(action: () => unknown): LocalizationError | undefined {
  try {
    action();
  } catch (error) {
    // Anything else is a crash in the builder and not a refusal, so it fails the case as itself.
    if (error instanceof LocalizationError) return error;
    throw error;
  }
  return undefined;
}

describe('an allowlist entry that does not parse as an address', () => {
  it('is one the address parser throws on', () => {
    expect(() => new URL('example.com')).toThrow(TypeError);
  });

  it('refuses the call as a malformed entry, with the parser’s error as the cause', () => {
    const refusal = refusalOf(() =>
      externalDestination(ADDRESS, ['example.com']),
    );

    expect(refusal?.diagnostic).toStrictEqual({
      code: 'invalid-rich-message',
      outcome: 'operational-failure',
      message: expect.stringMatching(/\S/u) as unknown as string,
      reason: 'malformed-input',
    });
    expect(refusal?.cause).toBeInstanceOf(TypeError);
  });

  it('refuses the call whatever the other entries allow', () => {
    for (const entries of [
      ['https://example.com', 'example.com'],
      ['example.com', 'https://example.com'],
    ]) {
      expect(
        refusalOf(() => externalDestination(ADDRESS, entries))?.diagnostic
          .reason,
      ).toBe('malformed-input');
    }
  });
});
