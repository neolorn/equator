import { describe, expect, it } from 'vitest';

import {
  builtLocalePolicy,
  createDefaultLocalePrefixPolicy,
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  LocalizationError,
  type GeneratedConfiguration,
} from '@neolorn/equator/core';

/**
 * The tables a policy constructor hands back, and the entries it refuses to put in them.
 *
 * Every case builds its policy inside the case. A policy built where a file is loaded is built
 * before any case runs, so a constructor that refused everything would stop the file rather than
 * fail a case in it.
 *
 * Refusals are asserted by their diagnostic and each beside the same options accepted, so the
 * refusal is about the one entry that differs.
 */

/** The diagnostic a call refuses with, or `undefined` when it did not refuse. */
const refusal = (call: () => unknown) => {
  try {
    call();
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error;
    throw error;
  }
};

const codeOf = (call: () => unknown) => refusal(call)?.diagnostic.code;

const configurationFor = (
  locales: readonly string[],
): GeneratedConfiguration => ({
  generatedAbi: 'equator-generated/1',
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales,
  aliases: {},
  applicationContractFingerprint: 'sha256-policy-tables-contract',
  semanticRegistryFingerprint: 'sha256-policy-tables-registry',
  scopes: [],
});

describe('a path-prefix policy', () => {
  it('resolves its prefix table in both directions', () => {
    expect(
      createPathPrefixLocalePolicy({
        defaultLocale: 'en-us',
        locales: { 'en-us': 'en', 'AR-eg': 'ar' },
      }),
    ).toStrictEqual({
      kind: 'path-prefix',
      defaultLocale: 'en-US',
      locales: { 'en-US': 'en', 'ar-EG': 'ar' },
      prefixes: { en: 'en-US', ar: 'ar-EG' },
      aliases: {},
      localeNeutralRoots: [],
      omitDefaultPrefix: false,
    });
  });

  it('keeps the roots and aliases it was given', () => {
    const policy = createPathPrefixLocalePolicy({
      defaultLocale: 'en-US',
      locales: { 'en-US': 'en', 'ar-EG': 'ar' },
      localeNeutralRoots: ['assets', 'media'],
      aliases: { english: 'en-us' },
    });
    expect(policy.localeNeutralRoots).toStrictEqual(['assets', 'media']);
    expect(policy.aliases).toStrictEqual({ english: 'en-US' });
  });

  it('refuses one locale given two spellings', () => {
    expect(
      codeOf(() =>
        createPathPrefixLocalePolicy({
          defaultLocale: 'en-US',
          locales: { 'en-US': 'en', 'en-us': 'english' },
        }),
      ),
    ).toBe('invalid-configuration');
  });

  it('refuses a default locale that has no prefix', () => {
    expect(
      codeOf(() =>
        createPathPrefixLocalePolicy({
          defaultLocale: 'de-DE',
          locales: { 'en-US': 'en', 'ar-EG': 'ar' },
        }),
      ),
    ).toBe('invalid-configuration');
  });

  it('refuses a locale-neutral root named twice, and an alias that takes a root', () => {
    const withRoots = (
      localeNeutralRoots: readonly string[],
      aliases: Readonly<Record<string, string>> = {},
    ) =>
      codeOf(() =>
        createPathPrefixLocalePolicy({
          defaultLocale: 'en-US',
          locales: { 'en-US': 'en', 'ar-EG': 'ar' },
          localeNeutralRoots,
          aliases,
        }),
      );

    expect(
      withRoots(['assets', 'media'], { english: 'en-US' }),
    ).toBeUndefined();
    expect(withRoots(['assets', 'assets'])).toBe('invalid-configuration');
    expect(withRoots(['assets'], { assets: 'en-US' })).toBe(
      'invalid-configuration',
    );
  });

  it('refuses an alias that is not a path segment, and one a locale already has', () => {
    const withAlias = (alias: string) =>
      codeOf(() =>
        createPathPrefixLocalePolicy({
          defaultLocale: 'en-US',
          locales: { 'en-US': 'en', 'ar-EG': 'ar' },
          aliases: { [alias]: 'ar-EG' },
        }),
      );

    expect(withAlias('arabic')).toBeUndefined();
    // Each of these fails one condition and no other: the first is free and is not a segment, the
    // second is a segment and is taken.
    expect(withAlias('Arabic Pages')).toBe('invalid-configuration');
    expect(withAlias('ar')).toBe('invalid-configuration');
  });

  it('refuses an alias for a locale the policy does not have', () => {
    expect(
      codeOf(() =>
        createPathPrefixLocalePolicy({
          defaultLocale: 'en-US',
          locales: { 'en-US': 'en', 'ar-EG': 'ar' },
          aliases: { german: 'de-DE' },
        }),
      ),
    ).toBe('invalid-configuration');
  });

  it('is the same policy with the default prefix left out, from the constructor for that', () => {
    expect(
      createDefaultLocalePrefixPolicy({
        defaultLocale: 'en-US',
        locales: { 'en-US': 'en', 'ar-EG': 'ar' },
      }),
    ).toStrictEqual({
      ...createPathPrefixLocalePolicy({
        defaultLocale: 'en-US',
        locales: { 'en-US': 'en', 'ar-EG': 'ar' },
      }),
      omitDefaultPrefix: true,
    });
  });

  it('takes a prefix of one to sixty-three lower-case letters, digits and inner hyphens', () => {
    const withPrefix = (prefix: string) =>
      codeOf(() =>
        createPathPrefixLocalePolicy({
          defaultLocale: 'en-US',
          locales: { 'en-US': prefix },
        }),
      );

    for (const prefix of ['e', 'en', 'en-us', '1', `e${'n'.repeat(62)}`]) {
      expect(withPrefix(prefix), prefix).toBeUndefined();
    }
    // A prefix is one path segment, so each of these fails for one thing a segment may not be.
    for (const prefix of [
      '',
      'EN',
      'en us',
      'en/us',
      'en-',
      '-en',
      'en_us',
      `e${'n'.repeat(63)}`,
    ]) {
      expect(withPrefix(prefix), prefix).toBe('invalid-configuration');
    }
  });

  it('keeps an x-default path with a doubled slash inside it, and refuses one that starts with it', () => {
    const withDefault = (xDefaultPath: string) =>
      createPathPrefixLocalePolicy({
        defaultLocale: 'en-US',
        locales: { 'en-US': 'en' },
        xDefaultPath,
      });

    // Only a leading `//` names another origin. Anywhere else it is an empty segment of this one.
    expect(withDefault('/choose//').xDefaultPath).toBe('/choose//');
    expect(codeOf(() => withDefault('//elsewhere.example//'))).toBe(
      'invalid-configuration',
    );
  });

  it('is narrowed to the locales a build has, in all three of its tables', () => {
    const declared = createPathPrefixLocalePolicy({
      defaultLocale: 'en-US',
      locales: { 'en-US': 'en', 'ar-EG': 'ar', 'de-DE': 'de' },
      aliases: { english: 'en-US', deutsch: 'de-DE' },
    });
    expect(
      builtLocalePolicy(declared, configurationFor(['en-US', 'ar-EG'])),
    ).toStrictEqual({
      kind: 'path-prefix',
      defaultLocale: 'en-US',
      locales: { 'en-US': 'en', 'ar-EG': 'ar' },
      prefixes: { en: 'en-US', ar: 'ar-EG' },
      aliases: { english: 'en-US' },
      localeNeutralRoots: [],
      omitDefaultPrefix: false,
    });
  });
});

describe('a locale-neutral policy', () => {
  it('keeps its locales and the roots it was given', () => {
    expect(
      createLocaleNeutralPolicy({
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
        localeNeutralRoots: ['assets', 'media'],
      }),
    ).toStrictEqual({
      kind: 'locale-neutral',
      defaultLocale: 'en-US',
      locales: { 'en-US': '', 'ar-EG': '' },
      localeNeutralRoots: ['assets', 'media'],
    });
  });

  it('refuses a locale listed twice, in either spelling', () => {
    expect(
      codeOf(() =>
        createLocaleNeutralPolicy({
          defaultLocale: 'en-US',
          locales: ['en-US', 'ar-EG', 'en-us'],
        }),
      ),
    ).toBe('invalid-configuration');
  });

  it('refuses a root that is not a path segment, and one named twice', () => {
    const withRoots = (localeNeutralRoots: readonly string[]) =>
      codeOf(() =>
        createLocaleNeutralPolicy({
          defaultLocale: 'en-US',
          locales: ['en-US', 'ar-EG'],
          localeNeutralRoots,
        }),
      );

    expect(withRoots(['assets', 'media'])).toBeUndefined();
    expect(withRoots(['Shared Assets'])).toBe('invalid-configuration');
    expect(withRoots(['assets', 'assets'])).toBe('invalid-configuration');
  });

  it('refuses a default locale that is not among its locales', () => {
    expect(
      codeOf(() =>
        createLocaleNeutralPolicy({
          defaultLocale: 'de-DE',
          locales: ['en-US', 'ar-EG'],
        }),
      ),
    ).toBe('invalid-configuration');
  });

  it('is narrowed to the locales a build has, and stays locale-neutral', () => {
    const declared = createLocaleNeutralPolicy({
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG', 'de-DE'],
    });
    expect(
      builtLocalePolicy(declared, configurationFor(['en-US', 'ar-EG'])),
    ).toStrictEqual({
      kind: 'locale-neutral',
      defaultLocale: 'en-US',
      locales: { 'en-US': '', 'ar-EG': '' },
      localeNeutralRoots: [],
    });
  });
});

describe('a host policy', () => {
  it('keeps the roots it was given beside its origins, and no x-default it was not given', () => {
    expect(
      createHostLocalePolicy({
        defaultLocale: 'en-US',
        origins: {
          'en-US': 'https://en.site.example',
          'ar-EG': 'https://ar.site.example',
        },
        localeNeutralRoots: ['assets'],
      }),
    ).toStrictEqual({
      kind: 'locale-host',
      defaultLocale: 'en-US',
      locales: {
        'en-US': 'https://en.site.example',
        'ar-EG': 'https://ar.site.example',
      },
      origins: {
        'https://en.site.example': 'en-US',
        'https://ar.site.example': 'ar-EG',
      },
      localeNeutralRoots: ['assets'],
    });
  });

  it('refuses a default locale that has no origin', () => {
    expect(
      codeOf(() =>
        createHostLocalePolicy({
          defaultLocale: 'de-DE',
          origins: { 'en-US': 'https://en.site.example' },
        }),
      ),
    ).toBe('invalid-configuration');
  });

  it('refuses an origin for each thing beyond an origin it carries', () => {
    const withOrigin = (origin: string) =>
      codeOf(() =>
        createHostLocalePolicy({
          defaultLocale: 'en-US',
          origins: { 'en-US': origin },
        }),
      );

    expect(withOrigin('https://site.example')).toBeUndefined();
    expect(withOrigin('http://site.example')).toBeUndefined();
    // One addition each, so that each is refused for itself: a user name, a password with no user
    // name, a path, a query and a fragment.
    for (const origin of [
      'https://user@site.example',
      'https://:secret@site.example',
      'https://site.example/base',
      'https://site.example?a=1',
      'https://site.example#a',
    ]) {
      expect(withOrigin(origin), origin).toBe('invalid-configuration');
    }
  });

  it('is narrowed to the locales a build has, in both of its tables', () => {
    const declared = createHostLocalePolicy({
      defaultLocale: 'en-US',
      origins: {
        'en-US': 'https://en.site.example',
        'de-DE': 'https://de.site.example',
      },
    });
    expect(
      builtLocalePolicy(declared, configurationFor(['en-US', 'ar-EG'])),
    ).toStrictEqual({
      kind: 'locale-host',
      defaultLocale: 'en-US',
      locales: { 'en-US': 'https://en.site.example' },
      origins: { 'https://en.site.example': 'en-US' },
      localeNeutralRoots: [],
    });
  });

  it('resolves its origin table in both directions, each origin in its normal form', () => {
    expect(
      createHostLocalePolicy({
        defaultLocale: 'en-us',
        origins: {
          'en-us': 'https://EN.site.example/',
          'ar-EG': 'http://ar.site.example:8080',
        },
        xDefaultUrl: 'https://site.example/',
      }),
    ).toStrictEqual({
      kind: 'locale-host',
      defaultLocale: 'en-US',
      locales: {
        'en-US': 'https://en.site.example',
        'ar-EG': 'http://ar.site.example:8080',
      },
      origins: {
        'https://en.site.example': 'en-US',
        'http://ar.site.example:8080': 'ar-EG',
      },
      localeNeutralRoots: [],
      xDefaultUrl: 'https://site.example',
    });
  });

  it('refuses one origin given to two locales, and one locale given two origins', () => {
    const withOrigins = (origins: Readonly<Record<string, string>>) =>
      codeOf(() => createHostLocalePolicy({ defaultLocale: 'en-US', origins }));

    expect(
      withOrigins({
        'en-US': 'https://en.site.example',
        'ar-EG': 'https://ar.site.example',
      }),
    ).toBeUndefined();
    // The same origin under two spellings, which is still one origin.
    expect(
      withOrigins({
        'en-US': 'https://site.example',
        'ar-EG': 'https://SITE.example/',
      }),
    ).toBe('invalid-configuration');
    // The same locale under two spellings, each with an origin of its own.
    expect(
      withOrigins({
        'en-US': 'https://en.site.example',
        'en-us': 'https://english.site.example',
      }),
    ).toBe('invalid-configuration');
  });
});

describe('what a refused policy is thrown as', () => {
  it('is an invalid configuration and an operational failure, with nothing it was not given', () => {
    const failure = refusal(() =>
      createPathPrefixLocalePolicy({
        defaultLocale: 'de-DE',
        locales: { 'en-US': 'en' },
      }),
    );
    // Strict, so a `reason` field holding nothing is told apart from no `reason` field: a consumer
    // that lists a diagnostic's fields sees the difference.
    expect(failure?.diagnostic).toStrictEqual({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: expect.any(String) as string,
    });
    expect(failure !== undefined && Object.hasOwn(failure, 'cause')).toBe(
      false,
    );
  });

  it('is refused for having no locales before its default locale is read', () => {
    // The default locale here is not a tag at all, which is refused as malformed input where it is
    // read. A policy with nothing in it is refused for that first, so it carries no such reason.
    const empty = [
      () =>
        createPathPrefixLocalePolicy({
          defaultLocale: 'not a locale',
          locales: {},
        }),
      () =>
        createLocaleNeutralPolicy({
          defaultLocale: 'not a locale',
          locales: [],
        }),
      () =>
        createHostLocalePolicy({ defaultLocale: 'not a locale', origins: {} }),
    ];
    for (const build of empty) {
      expect(refusal(build)?.diagnostic).toStrictEqual({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: expect.any(String) as string,
      });
    }
    // The control: the same default locale beside a locale is refused for the tag.
    expect(
      refusal(() =>
        createLocaleNeutralPolicy({
          defaultLocale: 'not a locale',
          locales: ['en-US'],
        }),
      )?.diagnostic.reason,
    ).toBe('malformed-input');
  });
});
