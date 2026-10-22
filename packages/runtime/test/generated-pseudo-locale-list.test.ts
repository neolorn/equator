import { describe, expect, it } from 'vitest';

import {
  createLocaleNeutralPolicy,
  LocalizationError,
  localizedServerRoutes,
  type GeneratedConfiguration,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The shape of the pseudo-locale list a generated configuration carries, as the route table reads it.
 *
 * `locale-neutral-addresses.test.ts` holds which tags the list may name. A generated file is read
 * from disk, where no type held it, so the cases here are about a list that is not a list, an entry
 * that is not text, and a build that generated nothing but pseudo-locales.
 */

const projection = (): RouteRuntimeProjection => ({
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-GeneratedPseudoLocaleListTestIdentity012345',
    routes: [{ id: 'second', path: 'second', parameterNames: [] }],
  },
});

const configurationFor = (
  locales: readonly unknown[],
  pseudoLocales: unknown,
): GeneratedConfiguration =>
  ({
    generatedAbi: 'equator-generated/1',
    sourceLocale: 'en-US',
    defaultLocale: 'en-US',
    locales,
    aliases: {},
    pseudoLocales,
    applicationContractFingerprint: 'sha256-pseudo-locale-list-contract',
    semanticRegistryFingerprint: 'sha256-pseudo-locale-list-registry',
    scopes: [],
  }) as GeneratedConfiguration;

/** The diagnostic code the route table refuses a configuration with, or `undefined`. */
const refusedAs = (
  configuration: GeneratedConfiguration,
  declared: readonly string[] = ['en-US', 'en-Arab-XB'],
  defaultLocale = 'en-US',
): string | undefined => {
  try {
    localizedServerRoutes(
      createLocaleNeutralPolicy({ defaultLocale, locales: declared }),
      projection(),
      configuration,
      [{ routeId: 'second', renderMode: 'prerender' }],
      { canonicalRenderMode: 'server' },
    );
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic.code;
    throw error;
  }
};

describe('the shape of a generated pseudo-locale list', () => {
  it('is accepted as a build writes it', () => {
    expect(
      refusedAs(configurationFor(['en-US', 'en-Arab-XB'], ['en-Arab-XB'])),
    ).toBeUndefined();
  });

  it('is accepted where every locale of the build is a pseudo-locale', () => {
    expect(
      refusedAs(
        configurationFor(['en-Latn-XC'], ['en-Latn-XC']),
        ['en-Latn-XC'],
        'en-Latn-XC',
      ),
    ).toBeUndefined();
  });

  it('is refused where it is not a list', () => {
    for (const edited of [{ 0: 'en-Arab-XB' }, { length: 1 }, 1, true, null]) {
      expect(
        refusedAs(configurationFor(['en-US', 'en-Arab-XB'], edited)),
        JSON.stringify(edited),
      ).toBe('invalid-configuration');
    }
  });

  it('is refused for an entry that is not text, even one the locale list holds too', () => {
    // An object that answers every question a tag is asked, listed in both places, so the entry is
    // among the locales and reads as a pseudo-locale and only its type is wrong.
    const tagLike = {
      toLowerCase: () => 'en-latn-xc',
      toString: () => 'en-Latn-XC',
    };
    expect(
      refusedAs(configurationFor(['en-US', tagLike], [tagLike]), [
        'en-US',
        'en-Latn-XC',
      ]),
    ).toBe('invalid-configuration');
  });
});
