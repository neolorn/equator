import { describe, expect, it } from 'vitest';

import {
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  LocalizationError,
  localizedServerRoutes,
  type GeneratedConfiguration,
  type LocaleUrlPolicy,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The spelling a codec writes for a value a build is told to render ahead of time.
 *
 * A prerendered value becomes a segment of an address the build writes a file at, so it is held to
 * the rule every other address the library builds is held to: one safe path segment. A spelling
 * that carries a separator, names the directory above or hides a mark would write the file
 * somewhere the address does not say.
 */

/** Writes the value as it is, so a case chooses the spelling and nothing else. */
const TEXT: RouteParameterCodec<string> = {
  parse: (value: string) => ({ ok: true, value }),
  serialize: (value: string) => value,
};

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-PrerenderParameterSegmentsTestIdentity01234',
    routes: [
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  parameters: { article: { slug: TEXT } },
};

const CONFIGURATION: GeneratedConfiguration = {
  generatedAbi: 'equator-generated/1',
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
  aliases: {},
  applicationContractFingerprint: 'sha256-application-contract-fixture',
  semanticRegistryFingerprint: 'sha256-semantic-registry-fixture',
  scopes: [],
};

const PREFIXED = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const NEUTRAL = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});

/** What asking an entry for its values answers: the values, or the diagnostic it refused with. */
const enumerated = async (policy: LocaleUrlPolicy, slug: string) => {
  const [entry] = localizedServerRoutes(
    policy,
    PROJECTION,
    CONFIGURATION,
    [{ routeId: 'article', renderMode: 'prerender', prerender: [{ slug }] }],
    { canonicalRenderMode: 'server' },
  );
  try {
    return await entry?.getPrerenderParams?.();
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic;
    throw error;
  }
};

describe('a prerender value a codec spells as something other than one safe segment', () => {
  it('is enumerated where the spelling is a safe segment', async () => {
    expect(await enumerated(PREFIXED, 'handbook')).toEqual([
      { slug: 'handbook' },
    ]);
    expect(await enumerated(NEUTRAL, 'handbook')).toEqual([
      { slug: 'handbook' },
    ]);
  });

  it.each([
    ['a separator', 'guides/handbook'],
    ['a backslash', 'guides\\handbook'],
    ['the directory above', '..'],
    ['the directory itself', '.'],
    ['nothing', ''],
    ['an invisible mark', `hand${String.fromCharCode(0x200b)}book`],
    ['a decomposed letter', `cafe${String.fromCharCode(0x301)}`],
    ['more than 1024 characters', 'x'.repeat(1025)],
  ])(
    'refuses %s, under a prefix and a locale-neutral policy',
    async (_, slug) => {
      for (const policy of [PREFIXED, NEUTRAL]) {
        expect(await enumerated(policy, slug)).toMatchObject({
          code: 'invalid-configuration',
          message: expect.stringContaining('article') as unknown,
        });
      }
    },
  );
});

describe('a prerender value whose spelling the codec does not read back', () => {
  /** What asking an entry for its values answers under a codec of the case's own. */
  const enumeratedWith = async (
    codec: RouteParameterCodec<string>,
    slug: string,
  ) => {
    const [entry] = localizedServerRoutes(
      PREFIXED,
      { ...PROJECTION, parameters: { article: { slug: codec } } },
      CONFIGURATION,
      [{ routeId: 'article', renderMode: 'prerender', prerender: [{ slug }] }],
      { canonicalRenderMode: 'server' },
    );
    try {
      return await entry?.getPrerenderParams?.();
    } catch (error) {
      if (error instanceof LocalizationError) return error.diagnostic;
      throw error;
    }
  };

  const refused = {
    code: 'invalid-configuration',
    message: expect.stringMatching(/article.*slug.*en-US/su) as unknown,
  };

  it('is refused where the codec cannot parse what it wrote', async () => {
    const writesOnly: RouteParameterCodec<string> = {
      parse: () => ({ ok: false }),
      serialize: (value: string) => value,
    };
    expect(await enumeratedWith(writesOnly, 'handbook')).toMatchObject(refused);
  });

  it('is refused where the codec parses it to nothing', async () => {
    const readsNothing = {
      parse: () => ({ ok: true, value: undefined }),
      serialize: (value: string) => value,
    } as unknown as RouteParameterCodec<string>;
    expect(await enumeratedWith(readsNothing, 'handbook')).toMatchObject(
      refused,
    );
  });

  it('is refused where the codec reads it back as another spelling', async () => {
    const lowers: RouteParameterCodec<string> = {
      parse: (value: string) => ({ ok: true, value: value.toLowerCase() }),
      serialize: (value: string) => value,
    };
    expect(await enumeratedWith(lowers, 'handbook')).toEqual([
      { slug: 'handbook' },
    ]);
    expect(await enumeratedWith(lowers, 'Handbook')).toMatchObject(refused);
  });
});
