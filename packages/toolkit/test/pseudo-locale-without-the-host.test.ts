import { afterEach, describe, expect, it } from 'vitest';

import { parseConfiguration } from '../src/configuration.js';

/**
 * A pseudo-locale declaration gets one answer on every machine that reads it.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 16 judges a pseudo-locale by its language, its
 * script and its region, and the tag is already in the canonical form the pinned CLDR release gives
 * it. Reading the subtags through the host's `Intl.Locale` canonicalizes the tag a second time with
 * the host's own alias data (`specs/01-standards-profile.spec.md` section 3), so the host is replaced
 * here by one that answers every tag with another language and no script, and each declaration must
 * be judged exactly as it is on the real host.
 */

const realLocale = Intl.Locale;

afterEach(() => {
  Object.defineProperty(Intl, 'Locale', {
    value: realLocale,
    writable: true,
    configurable: true,
  });
});

class AnotherLanguage {
  readonly language = 'tlh';
  readonly script = undefined;
  readonly region = undefined;
}

const DECLARATIONS = [
  ['en-XA', 'en-US'],
  ['en-Latn-XA', 'en-US'],
  ['en-Arab-XB', 'en-US'],
  ['en-Latn-XB', 'en-US'],
  ['en-Arab-XA', 'en-US'],
  ['en-Latn-GB', 'en-US'],
  ['en-Latn-XC', 'en-US'],
  ['de-Latn-XA', 'de-DE'],
  ['de-Latn-XJ', 'de-DE'],
  ['ar-Arab-XB', 'en-US'],
  ['sr-Cyrl-XC', 'sr-Latn-RS'],
] as const;

function diagnostics(tag: string, sourceLocale: string): readonly string[] {
  return parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale,
      defaultLocale: sourceLocale,
      locales: [sourceLocale],
      pseudoLocales: { [tag]: { lengthFactor: 0.4 } },
    }),
  ).diagnostics.map(({ code, summary }) => `${code} ${summary}`);
}

describe('a pseudo-locale declaration', () => {
  const onTheRealHost = DECLARATIONS.map(
    ([tag, source]) => [tag, source, diagnostics(tag, source)] as const,
  );

  it('is refused for its own subtags on the real host', () => {
    const accepted = onTheRealHost
      .filter(([, , reported]) => reported.length === 0)
      .map(([tag]) => tag);
    expect(accepted).toEqual([
      'en-Latn-XA',
      'en-Arab-XB',
      'en-Latn-XC',
      'de-Latn-XJ',
      'sr-Cyrl-XC',
    ]);
  });

  it('gets the same answer from a host that canonicalizes every tag to another language', () => {
    Object.defineProperty(Intl, 'Locale', {
      value: AnotherLanguage,
      writable: true,
      configurable: true,
    });
    for (const [tag, source, expected] of onTheRealHost) {
      expect(diagnostics(tag, source), tag).toEqual(expected);
    }
  });
});
