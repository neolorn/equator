import { describe, expect, it } from 'vitest';

import {
  createHostLocalePolicy,
  LocalizationError,
  localizedServerRoutes,
  type GeneratedConfiguration,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The origin a build under a host policy is told it answers at, when it is not an origin at all.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 3 has such a build render the locale of
 * its own origin, so the route table has to be told which origin that is. The value usually comes
 * from the environment, where a bare host name is an easy thing to write. Text that does not parse
 * as an address is refused as a configuration error, the same refusal an origin the policy does
 * not name gets, and the parser's own error does not reach the caller.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-HostBuildOriginUnparsedTestIdentity01234567',
    routes: [{ id: 'second', path: 'second', parameterNames: [] }],
  },
};

const CONFIGURATION = {
  generatedAbi: 'equator-generated/1',
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
  aliases: {},
  applicationContractFingerprint: 'sha256-host-build-origin-contract',
  semanticRegistryFingerprint: 'sha256-host-build-origin-registry',
  scopes: [],
} as GeneratedConfiguration;

/** The refusal `run` raises, or `undefined`. Anything else thrown fails the case as itself. */
const refusalOf = (run: () => unknown): LocalizationError | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof LocalizationError) return error;
    throw error;
  }
  return undefined;
};

describe('the origin a build under a host policy answers at', () => {
  const HOSTS = createHostLocalePolicy({
    defaultLocale: 'en-US',
    origins: {
      'en-US': 'https://example.com',
      'ar-EG': 'https://example.eg',
    },
  });

  const at = (origin: string) =>
    refusalOf(() =>
      localizedServerRoutes(
        HOSTS,
        PROJECTION,
        CONFIGURATION,
        [{ routeId: 'second', renderMode: 'prerender' }],
        { origin, canonicalRenderMode: 'server' },
      ),
    );

  it('is accepted where the policy names it', () => {
    expect(at('https://example.com')).toBeUndefined();
  });

  it('is refused as a configuration error where it does not parse as an address', () => {
    expect(() => new URL('example.com')).toThrow(TypeError);

    for (const origin of ['example.com', 'not an origin', '']) {
      expect(at(origin)?.diagnostic, JSON.stringify(origin)).toMatchObject({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
      });
    }
  });

  it('is refused the same way where it parses and the policy does not name it', () => {
    expect(at('https://other.example')?.diagnostic).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
  });
});
