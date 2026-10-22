import { describe, expect, it } from 'vitest';

import { contentPresentation } from '../src/locale-presentation.js';

/**
 * The language a consumer declares for its own content comes back as the language it declared.
 *
 * Each tag here is already canonical and carries something likely-subtag data would add or take
 * away: an explicit script, a region whose script is implied, a variant, an extension. Maximizing
 * or minimizing any of them would be Equator deciding what the content's language is.
 */

const DECLARED = [
  'en-Latn-US',
  'zh-TW',
  'sr-Cyrl',
  'de-DE-1901',
  'en-u-nu-arab',
  'ar',
] as const;

describe("a consumer's declared content language", () => {
  it.each(DECLARED)('is kept as %s', (language) => {
    expect(contentPresentation(language)).toMatchObject({
      language,
      classification: 'known',
    });
  });
});
