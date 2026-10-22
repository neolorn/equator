import { describe, expect, it } from 'vitest';

import { contentPresentation } from '../src/locale-presentation.js';
import { LocalizationError } from '@neolorn/equator/core';

/**
 * Content whose language is not known, or that has none.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 10 gives such a value an explicit
 * unknown state in place of a direction nothing supports. A customer name stored without a tag and
 * an order reference both defer to the text; a tag that names a script does not.
 */

describe('content with no declared language', () => {
  it('is unknown, and leaves the direction to the text', () => {
    expect(contentPresentation()).toStrictEqual({
      direction: 'auto',
      classification: 'unknown',
    });
  });
});

describe('content declared as having no language', () => {
  it.each(['zxx', 'ZXX', 'zxx-Latn', 'Zxx-x-sku'])(
    'is language-independent for %s, as it was declared',
    (language) => {
      expect(contentPresentation(language)).toStrictEqual({
        language,
        direction: 'auto',
        classification: 'language-independent',
      });
    },
  );
});

describe('content declared as undetermined', () => {
  // Four letters make a script only as the whole of the second subtag.
  it.each(['und', 'UND', 'und-EG', 'und-EG-Arab', 'und-Arabs'])(
    'is unknown for %s, as it was declared',
    (language) => {
      expect(contentPresentation(language)).toStrictEqual({
        language,
        direction: 'auto',
        classification: 'unknown',
      });
    },
  );

  it('takes its direction from a script the tag names', () => {
    expect(contentPresentation('und-Arab')).toStrictEqual({
      language: 'und-Arab',
      direction: 'rtl',
      classification: 'known',
    });
    expect(contentPresentation('und-Latn-EG')).toMatchObject({
      direction: 'ltr',
      classification: 'known',
    });
  });
});

describe('content declared in a language', () => {
  it('is known, with the direction that language is written in', () => {
    expect(contentPresentation('ar')).toStrictEqual({
      language: 'ar',
      direction: 'rtl',
      classification: 'known',
    });
    expect(contentPresentation('en-US')).toStrictEqual({
      language: 'en-US',
      direction: 'ltr',
      classification: 'known',
    });
  });

  it('throws for a tag that cannot be parsed', () => {
    expect(() => contentPresentation('not a tag')).toThrow(LocalizationError);
  });
});
