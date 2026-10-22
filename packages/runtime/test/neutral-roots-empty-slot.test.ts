import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  createDefaultLocalePrefixPolicy,
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  resolveLocalizedRoute,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * A list of locale-neutral roots with an empty slot in it.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md` takes a root that is a path segment,
 * and a slot with nothing in it is not one. A list built by index, with one index skipped, is how
 * such a slot arrives, and it is refused by every constructor and wherever a written-out policy is
 * read, where reading the slot as text would reserve the segment `undefined`.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-NeutralRootsEmptySlotTestIdentity0123456789',
    routes: [{ id: 'route:_index', path: '', parameterNames: [] }],
  },
};

/** One slot, nothing in it. */
const holed = (): string[] => new Array<string>(1);
/** A root, an empty slot, and a root. */
const holedBetween = (): string[] => {
  const roots = ['assets'];
  roots[2] = 'media';
  return roots;
};

const LISTS: readonly (readonly [string, () => string[]])[] = [
  ['one empty slot', holed],
  ['an empty slot between two roots', holedBetween],
];

const CONSTRUCTORS: readonly (readonly [
  string,
  (roots: readonly string[]) => LocaleUrlPolicy,
])[] = [
  [
    'createPathPrefixLocalePolicy',
    (localeNeutralRoots) =>
      createPathPrefixLocalePolicy({
        defaultLocale: 'en-US',
        locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
        localeNeutralRoots,
      }),
  ],
  [
    'createDefaultLocalePrefixPolicy',
    (localeNeutralRoots) =>
      createDefaultLocalePrefixPolicy({
        defaultLocale: 'en-US',
        locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
        localeNeutralRoots,
      }),
  ],
  [
    'createLocaleNeutralPolicy',
    (localeNeutralRoots) =>
      createLocaleNeutralPolicy({
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
        localeNeutralRoots,
      }),
  ],
  [
    'createHostLocalePolicy',
    (localeNeutralRoots) =>
      createHostLocalePolicy({
        defaultLocale: 'en-US',
        origins: {
          'en-US': 'https://example.com',
          'ar-EG': 'https://example.eg',
        },
        localeNeutralRoots,
      }),
  ],
];

/** The diagnostic a call refuses with, or `undefined` when it did not refuse. */
const refusal = (call: () => unknown) => {
  try {
    call();
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic;
    throw error;
  }
};

describe.each(CONSTRUCTORS)('%s', (_name, construct) => {
  it('builds a policy from a list with every slot filled', () => {
    expect(construct(['assets', 'media']).localeNeutralRoots).toStrictEqual([
      'assets',
      'media',
    ]);
  });

  it('takes the word undefined as a root, which is a path segment', () => {
    expect(construct(['undefined']).localeNeutralRoots).toStrictEqual([
      'undefined',
    ]);
  });

  it.each(LISTS)('refuses a list with %s', (_label, roots) => {
    expect(refusal(() => construct(roots()))).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
  });
});

describe('a written-out policy', () => {
  const written = (roots: readonly string[]): LocaleUrlPolicy => ({
    kind: 'path-prefix',
    defaultLocale: 'en-US',
    locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
    prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
    aliases: {},
    localeNeutralRoots: roots,
    omitDefaultPrefix: false,
  });
  const resolving = (roots: readonly string[]) => () =>
    resolveLocalizedRoute('/', written(roots), PROJECTION);

  it('is read with a list with every slot filled', () => {
    expect(refusal(resolving(['assets', 'media']))).toBeUndefined();
  });

  it.each(LISTS)('is refused with %s in its roots', (_label, roots) => {
    expect(refusal(resolving(roots()))).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
  });
});
