import { describe, expect, it } from 'vitest';

import { contentPresentation } from '../src/locale-presentation.js';

/**
 * Which subtag after `und` counts as a script.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 10 keeps undetermined content unknown
 * unless its tag names a script, and a script is exactly four letters in the second position. A
 * variant is five to eight characters there and says nothing about direction.
 */

describe('content declared as undetermined with a variant', () => {
  it.each(['und-fonipa', 'und-valencia'])(
    'is unknown for %s, as it was declared',
    (language) => {
      expect(contentPresentation(language)).toStrictEqual({
        language,
        direction: 'auto',
        classification: 'unknown',
      });
    },
  );
});
