import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  buildLocalizedRoute,
  createPathPrefixLocalePolicy,
  localizedServerRoutes,
  resolveLocalizedRoute,
  type GeneratedConfiguration,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * A route parameter codec that throws where an address is built or a projection is read.
 *
 * Section 2 of `specs/07-routing-rendering-and-seo.spec.md` makes a throw from a codec a defect in
 * the consumer application wherever the codec is asked: the call fails with a typed failure that
 * names the route, the parameter, and the locale where there is one, and keeps the thrown error as
 * its cause. Each case here asks the codec from a place other than the reading of a request
 * address.
 */

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

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

const projectionWith = (
  codec: RouteParameterCodec,
  historical?: RouteRuntimeProjection['historical'],
): RouteRuntimeProjection => ({
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-RouteCodecThrowsBuildingTestIdentity0123456',
    routes: [
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  parameters: { article: { slug: codec } },
  ...(historical === undefined ? {} : { historical }),
});

const THROWN = new Error('the codec under test threw');

/** Writes every value, and throws where it reads a spelling that is not its own. */
const THROWS_READING: RouteParameterCodec<string> = {
  parse: (text) => {
    if (text.startsWith('known')) return { ok: true, value: text };
    throw THROWN;
  },
  serialize: (value) => value,
};

/** Reads every spelling, and throws where it writes a value that is not its own. */
const THROWS_WRITING: RouteParameterCodec<string> = {
  parse: (text) => ({ ok: true, value: text }),
  serialize: (value) => {
    if (value.startsWith('known')) return value;
    throw THROWN;
  },
};

/** Reads and writes once each, and throws where it writes what it has just read back. */
const throwsWritingBack = (): RouteParameterCodec<string> => {
  let written = 0;
  return {
    parse: (text) => ({ ok: true, value: text }),
    serialize: (value) => {
      written += 1;
      if (written > 1) throw THROWN;
      return value;
    },
  };
};

function failureOf(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function rejectionOf(action: () => unknown): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectCodecFailure(
  failure: unknown,
  locale: string | undefined,
): void {
  expect(failure).toBeInstanceOf(LocalizationError);
  expect(failure).toMatchObject({
    diagnostic: {
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      reason: 'consumer-code-threw',
    },
    cause: THROWN,
  });
  const { diagnostic } = failure as LocalizationError;
  expect(diagnostic.message).toContain('article');
  expect(diagnostic.message).toContain('slug');
  expect(diagnostic.targetLocale).toBe(locale);
  if (locale !== undefined) expect(diagnostic.message).toContain(locale);
}

describe('building an address whose parameter codec throws', () => {
  it('fails with the typed failure where the codec throws writing the value', () => {
    expectCodecFailure(
      failureOf(() =>
        buildLocalizedRoute(
          POLICY,
          projectionWith(THROWS_WRITING),
          'article',
          'ar-EG',
          { slug: 'unwritten' },
        ),
      ),
      'ar-EG',
    );
  });

  it('fails the same way where the codec throws reading its own spelling back', () => {
    expectCodecFailure(
      failureOf(() =>
        buildLocalizedRoute(
          POLICY,
          projectionWith(THROWS_READING),
          'article',
          'ar-EG',
          { slug: 'unread' },
        ),
      ),
      'ar-EG',
    );
  });

  it('fails the same way where the codec throws writing what it read back', () => {
    expectCodecFailure(
      failureOf(() =>
        buildLocalizedRoute(
          POLICY,
          projectionWith(throwsWritingBack()),
          'article',
          'en-US',
          { slug: 'handbook' },
        ),
      ),
      'en-US',
    );
  });

  it('fails the same way where the codec throws reading a declared spelling', () => {
    expectCodecFailure(
      failureOf(() =>
        buildLocalizedRoute(
          POLICY,
          projectionWith(THROWS_READING),
          'article',
          'ar-EG',
          { slug: 'known-one' },
          [],
          undefined,
          { slug: { 'ar-EG': 'declared' } },
        ),
      ),
      'ar-EG',
    );
  });

  it('still builds the address of a value the codec writes and reads', () => {
    expect(
      buildLocalizedRoute(
        POLICY,
        projectionWith(THROWS_READING),
        'article',
        'ar-EG',
        { slug: 'known-one' },
      ),
    ).toBe('/ar-eg/articles/known-one');
  });
});

describe('enumerating prerender values whose parameter codec throws', () => {
  const enumerating = (codec: RouteParameterCodec, slug: string) => () =>
    localizedServerRoutes(
      POLICY,
      projectionWith(codec),
      CONFIGURATION,
      [{ routeId: 'article', renderMode: 'prerender', prerender: [{ slug }] }],
      { canonicalRenderMode: 'server' },
    )[0]?.getPrerenderParams?.();

  it('fails with the typed failure where the codec throws writing the value', async () => {
    expectCodecFailure(
      await rejectionOf(enumerating(THROWS_WRITING, 'unwritten')),
      'en-US',
    );
  });

  it('fails the same way where the codec throws reading its own spelling back', async () => {
    expectCodecFailure(
      await rejectionOf(enumerating(THROWS_READING, 'unread')),
      'en-US',
    );
  });

  it('fails the same way where the codec throws writing what it read back', async () => {
    expectCodecFailure(
      await rejectionOf(enumerating(throwsWritingBack(), 'handbook')),
      'en-US',
    );
  });

  it('still enumerates a value the codec writes and reads', async () => {
    expect(await enumerating(THROWS_READING, 'known-one')()).toEqual([
      { slug: 'known-one' },
    ]);
  });
});

describe('reading a projection whose replacement names a value its codec throws at', () => {
  it('fails with the typed failure, which names no locale because none is asked', () => {
    expectCodecFailure(
      failureOf(() =>
        resolveLocalizedRoute(
          '/en-us/articles/known-one',
          POLICY,
          projectionWith(THROWS_WRITING, {
            legacy: {
              kind: 'replacement',
              routeId: 'article',
              parameters: { slug: 'unwritten' },
            },
          }),
        ),
      ),
      undefined,
    );
  });
});
