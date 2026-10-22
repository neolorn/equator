import { describe, expect, it } from 'vitest';

import {
  createPathPrefixLocalePolicy,
  LocalizationError,
  localizedServerRoutes,
  type GeneratedConfiguration,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * A prerender value under a codec that spells every value, a missing one included, the same way.
 *
 * A build writes a file at the spelling a codec gives a value, so the codec has to read that
 * spelling back. A codec that writes one fixed spelling writes it for no value at all, which makes
 * the spelling it writes for what it read the spelling asked about whatever it read. The reading
 * is therefore judged on its own: a spelling the codec does not parse, or parses to nothing, is
 * refused before anything is spelled again.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-PrerenderCodecReadBackTestIdentity012345678',
    routes: [
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
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

/** What asking the entry for its values answers: the values, or the diagnostic it refused with. */
const enumeratedWith = async (parse: (text: string) => unknown) => {
  const codec = {
    parse,
    serialize: () => 'handbook',
  } as unknown as RouteParameterCodec<string>;
  const [entry] = localizedServerRoutes(
    PREFIXED,
    { ...PROJECTION, parameters: { article: { slug: codec } } },
    CONFIGURATION,
    [
      {
        routeId: 'article',
        renderMode: 'prerender',
        prerender: [{ slug: 'handbook' }],
      },
    ],
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

describe('a prerender value under a codec that writes one spelling for everything', () => {
  it('is enumerated where the codec reads the spelling back as a value', async () => {
    expect(
      await enumeratedWith((value) => ({ ok: true, value })),
    ).toStrictEqual([{ slug: 'handbook' }]);
  });

  it('is refused where the codec cannot parse the spelling', async () => {
    expect(await enumeratedWith(() => ({ ok: false }))).toMatchObject(refused);
  });

  it('is refused where the codec parses the spelling to nothing', async () => {
    expect(
      await enumeratedWith(() => ({ ok: true, value: undefined })),
    ).toMatchObject(refused);
  });
});
