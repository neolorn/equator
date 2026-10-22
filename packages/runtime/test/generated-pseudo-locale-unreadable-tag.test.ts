import { describe, expect, it } from 'vitest';

import { ɵisGeneratedPseudoLocales } from '@neolorn/equator/core';

/**
 * A pseudo-locale list naming a tag the platform cannot read.
 *
 * Generated code hands this check the list a build wrote beside the locales it wrote. A list that
 * was edited afterwards can name anything, and so can the locales it is held against, so an entry
 * the platform refuses as a language tag is answered as every other entry no build writes is: the
 * list is not a generated one. The check answers and does not throw, because its caller is what
 * decides how a refused list is reported.
 */

/** An underscore where a hyphen belongs, which the platform refuses as a language tag. */
const UNREADABLE = 'en_XA';

describe('a pseudo-locale list naming a tag the platform cannot read', () => {
  it('names a tag the platform refuses', () => {
    expect(() => new Intl.Locale(UNREADABLE)).toThrow(RangeError);
  });

  it('is not a list a build writes, though the tag is one of the locales', () => {
    expect(ɵisGeneratedPseudoLocales([UNREADABLE], [UNREADABLE])).toBe(false);
  });

  it('is not a list a build writes where an entry is a list of one such tag', () => {
    // The platform reads a list of one tag as that tag, so only its kind tells it from the text.
    const entry = ['en-Latn-XA'];
    expect(new Intl.Locale(entry as never).toString()).toBe('en-Latn-XA');
    expect(ɵisGeneratedPseudoLocales([entry], [entry])).toBe(false);
  });

  it('is told apart from the same list with the tag a build writes', () => {
    expect(ɵisGeneratedPseudoLocales(['en-Latn-XA'], ['en-Latn-XA'])).toBe(
      true,
    );
  });
});
