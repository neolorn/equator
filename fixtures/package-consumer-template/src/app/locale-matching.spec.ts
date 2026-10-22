import { describe, expect, it } from 'vitest';

import { negotiateLocale, parseAcceptLanguage } from '@neolorn/equator';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * Which locale a request is answered in, from what it asked for and what exists.
 *
 * A file of its own because it is the one behavior here an engine supplies: matching a region the
 * application does not have reads CLDR likely subtags through `Intl.Locale.prototype.maximize`,
 * and `specs/01-standards-profile.spec.md` section 6 requires the answer not to vary between the
 * supported browsers. So these run in every engine as well as in jsdom, and need nothing an
 * engine lacks: no platform, no request and no storage.
 */

describe('reading what the client asked for', () => {
  it('orders ranges by quality, keeping header order within a tie', () => {
    expect(parseAcceptLanguage('en;q=0.7,ar-EG,fr;q=0.7,de;q=0.9')).toEqual([
      'ar-EG',
      'de',
      'en',
      'fr',
    ]);
    claimCapability('entry:@neolorn/equator');
  });

  it('drops a range that expresses no preference', () => {
    // `*` means "anything else will do", which is what the configured default already says. Taking
    // it as a match would let a header that asked for nothing outrank the source placed after it.
    expect(parseAcceptLanguage('*')).toEqual([]);
    expect(parseAcceptLanguage('ar,*;q=0.1')).toEqual(['ar']);
    claimCapability('entry:@neolorn/equator');
  });

  it('drops a range that is refused outright or malformed', () => {
    expect(parseAcceptLanguage('en;q=0')).toEqual([]);
    expect(parseAcceptLanguage('../etc/passwd')).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
    claimCapability('entry:@neolorn/equator');
  });
});

describe('matching a request against what exists', () => {
  const supported = ['en-US', 'ar-EG'];
  const canonicalize = (value: string) => {
    try {
      return Intl.getCanonicalLocales(value)[0];
    } catch {
      return undefined;
    }
  };

  it('matches a different region of the same language', () => {
    // The case plain RFC 4647 lookup leaves unmatched. Answering English to an Arabic speaker
    // because the region differs is the wrong answer by a wide margin.
    expect(negotiateLocale(['ar-SA'], supported, canonicalize)).toBe('ar-EG');
    expect(negotiateLocale(['en-GB'], supported, canonicalize)).toBe('en-US');
    claimCapability('entry:@neolorn/equator');
  });

  it('resolves each range fully before considering the next', () => {
    // A client that prefers Arabic and accepts English must not be handed English because its
    // Arabic tag needed one more step to match.
    expect(negotiateLocale(['ar-SA', 'en-US'], supported, canonicalize)).toBe(
      'ar-EG',
    );
    claimCapability('entry:@neolorn/equator');
  });

  it('drops trailing subtags one at a time', () => {
    expect(negotiateLocale(['ar-EG-u-nu-arab'], supported, canonicalize)).toBe(
      'ar-EG',
    );
    claimCapability('entry:@neolorn/equator');
  });

  it('answers nothing when no range is related to anything supported', () => {
    expect(negotiateLocale(['ja-JP'], supported, canonicalize)).toBeUndefined();
    expect(negotiateLocale([], supported, canonicalize)).toBeUndefined();
    claimCapability('entry:@neolorn/equator');
  });
});
