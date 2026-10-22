import { describe, expect, it } from 'vitest';

import { createLocaleRequestHandler } from '../http/src/handler.js';
import {
  addressSelectsLocale,
  allowedLocaleHosts,
  buildLocalizedRoute,
  builtLocalePolicy,
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  LocalizationError,
  localeFromRoute,
  localizedRouteAddresses,
  localizedServerRoutes,
  projectRouteSeo,
  projectSitemap,
  resolveInitialRouteLocale,
  resolveLocalizedRoute,
  toExternalPath,
  toInternalPath,
  type GeneratedConfiguration,
  type HostLocalePolicy,
  type LocaleNeutralPolicy,
  type LocaleUrlPolicy,
  type PathPrefixLocalePolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * A policy written out as an object instead of built by a constructor.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md` holds such a policy to the tables a
 * constructor writes, wherever a policy is read. Each refusal stands beside the same tables
 * accepted, so it is about the one entry that differs.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-WrittenOutLocalePoliciesTestIdentity0123456',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
    ],
  },
};

const CONFIGURATION: GeneratedConfiguration = {
  generatedAbi: 'equator-generated/1',
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
  aliases: {},
  applicationContractFingerprint: 'sha256-written-out-policies-contract',
  semanticRegistryFingerprint: 'sha256-written-out-policies-registry',
  scopes: [],
};

const PREFIXED: PathPrefixLocalePolicy = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: { ar: 'ar-EG' },
  localeNeutralRoots: ['assets'],
  omitDefaultPrefix: false,
  xDefaultPath: '/choose',
};

const NEUTRAL: LocaleNeutralPolicy = {
  kind: 'locale-neutral',
  defaultLocale: 'en-US',
  locales: { 'en-US': '', 'ar-EG': '' },
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/choose',
};

const HOSTED: HostLocalePolicy = {
  kind: 'locale-host',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'https://example.com', 'ar-EG': 'https://example.eg' },
  origins: { 'https://example.com': 'en-US', 'https://example.eg': 'ar-EG' },
  localeNeutralRoots: ['assets'],
  xDefaultUrl: 'https://example.org',
};

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

/** A copy with some members replaced, typed as the policy it stands in for. */
const written = <Policy extends LocaleUrlPolicy>(
  policy: Policy,
  replaced: Readonly<Record<string, unknown>>,
): Policy => ({ ...policy, ...replaced }) as Policy;

/** A copy with one member left out. */
const without = <Policy extends LocaleUrlPolicy>(
  policy: Policy,
  member: string,
): Policy =>
  Object.fromEntries(
    Object.entries(policy).filter(([name]) => name !== member),
  ) as unknown as Policy;

const resolving = (policy: LocaleUrlPolicy) => () =>
  resolveLocalizedRoute('/second', policy, PROJECTION);

describe('a written-out policy with the tables a constructor writes', () => {
  it('is read as the constructed one is', () => {
    expect(PREFIXED).toStrictEqual(
      createPathPrefixLocalePolicy({
        defaultLocale: 'en-US',
        locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
        aliases: { ar: 'ar-EG' },
        localeNeutralRoots: ['assets'],
        xDefaultPath: '/choose',
      }),
    );
    expect(NEUTRAL).toStrictEqual(
      createLocaleNeutralPolicy({
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
        localeNeutralRoots: ['assets'],
        xDefaultPath: '/choose',
      }),
    );
    expect(HOSTED).toStrictEqual(
      createHostLocalePolicy({
        defaultLocale: 'en-US',
        origins: {
          'en-US': 'https://example.com',
          'ar-EG': 'https://example.eg',
        },
        localeNeutralRoots: ['assets'],
        xDefaultUrl: 'https://example.org',
      }),
    );
    expect(resolving(PREFIXED)()).toMatchObject({
      status: 'redirect',
      location: '/en-us/second',
    });
    expect(resolving(NEUTRAL)()).toMatchObject({ status: 'success' });
    expect(resolving(HOSTED)()).toMatchObject({
      status: 'success',
      canonicalUrl: 'https://example.com/second',
    });
  });

  it('is read without the members a constructor leaves out', () => {
    for (const policy of [
      without(PREFIXED, 'xDefaultPath'),
      without(NEUTRAL, 'xDefaultPath'),
      without(HOSTED, 'xDefaultUrl'),
      written(PREFIXED, { omitDefaultPrefix: true, aliases: {} }),
      written(PREFIXED, { localeNeutralRoots: [] }),
    ]) {
      expect(refusal(resolving(policy))).toBeUndefined();
    }
  });
});

describe('a written-out policy of any kind', () => {
  it.each([
    [
      'of a kind that is not served',
      { kind: 'cookie' },
      'does not serve a "cookie"',
    ],
    [
      'with a locale table that is nothing',
      { locales: null },
      'names no locales',
    ],
    [
      'with a default locale that is not text',
      { defaultLocale: ['en-US'] },
      'default',
    ],
    ['with no roots', { localeNeutralRoots: undefined }, 'roots'],
    ['with roots that are text', { localeNeutralRoots: 'abc' }, 'roots'],
    ['with no locale table', { locales: undefined }, 'names no locales'],
    ['with a locale table that is a list', { locales: ['en-US'] }, 'no loc'],
    ['with an empty locale table', { locales: {} }, 'names no locales'],
    ['with no default locale', { defaultLocale: undefined }, 'default'],
    [
      'with a default locale it does not name',
      { defaultLocale: 'fr-FR' },
      '"fr-FR"',
    ],
    [
      'with a default locale its table inherits',
      { defaultLocale: 'constructor' },
      'default',
    ],
    [
      'with roots that are not a list',
      { localeNeutralRoots: 'assets' },
      'roots',
    ],
    [
      'with a root listed twice',
      { localeNeutralRoots: ['assets', 'assets'] },
      'roots',
    ],
    [
      'with a root that is not a segment',
      { localeNeutralRoots: ['Assets'] },
      'roots',
    ],
    ['with a root that is not text', { localeNeutralRoots: [7] }, 'roots'],
  ])('is refused %s', (_, replaced, named) => {
    for (const policy of [PREFIXED, NEUTRAL, HOSTED]) {
      expect(refusal(resolving(policy))).toBeUndefined();
      expect(refusal(resolving(written(policy, replaced)))).toMatchObject({
        code: 'invalid-configuration',
        message: expect.stringContaining(named) as unknown,
      });
    }
  });

  it('is refused with a locale in a spelling that is not canonical', () => {
    expect(
      refusal(
        resolving(
          written(PREFIXED, {
            defaultLocale: 'en-us',
            locales: { 'en-us': 'en-us', 'ar-EG': 'ar-eg' },
            prefixes: { 'en-us': 'en-us', 'ar-eg': 'ar-EG' },
          }),
        ),
      ),
    ).toMatchObject({
      code: 'invalid-configuration',
      message: expect.stringContaining('"en-us"') as unknown,
    });
    expect(
      refusal(
        resolving(written(NEUTRAL, { locales: { 'en-US': '', iw: '' } })),
      ),
    ).toMatchObject({ message: expect.stringContaining('"iw"') as unknown });
  });

  it('is read once, so a policy changed after it was accepted is not read again', () => {
    const policy = { ...NEUTRAL, locales: { ...NEUTRAL.locales } };
    expect(refusal(resolving(policy))).toBeUndefined();
    (policy.locales as Record<string, string>)['ar-EG'] = 'ar';
    expect(refusal(resolving(policy))).toBeUndefined();
    expect(refusal(resolving({ ...policy }))).toMatchObject({
      code: 'invalid-configuration',
    });
  });
});

describe('a written-out path-prefix policy', () => {
  it.each([
    [
      'a prefix that is not a path segment',
      {
        locales: { 'en-US': 'en-us', 'ar-EG': 'AR' },
        prefixes: { 'en-us': 'en-US', AR: 'ar-EG' },
      },
      '"AR"',
    ],
    [
      'an empty prefix',
      {
        locales: { 'en-US': '', 'ar-EG': 'ar-eg' },
        prefixes: { '': 'en-US', 'ar-eg': 'ar-EG' },
      },
      '""',
    ],
    [
      'a prefix that is not text',
      { locales: { 'en-US': 'en-us', 'ar-EG': 7 } },
      'names no locales',
    ],
    [
      'a prefix that is one of its roots',
      {
        locales: { 'en-US': 'en-us', 'ar-EG': 'assets' },
        prefixes: { 'en-us': 'en-US', assets: 'ar-EG' },
      },
      '"assets"',
    ],
    [
      'a prefix its prefix table reads as another locale',
      { prefixes: { 'en-us': 'en-US', 'ar-eg': 'en-US' } },
      'ar-EG',
    ],
    [
      'a prefix its prefix table does not hold',
      { prefixes: { 'en-us': 'en-US' } },
      'ar-EG',
    ],
    [
      'a prefix its prefix table only inherits',
      {
        locales: { 'en-US': 'en-us', 'ar-EG': 'constructor' },
        prefixes: { 'en-us': 'en-US' },
      },
      '"constructor"',
    ],
    ['no prefix table', { prefixes: undefined }, 'en-US'],
    [
      'a prefix table that holds something that is not text',
      { prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG', other: 7 } },
      'no locale is spelled with',
    ],
    [
      'a prefix table that reads a prefix no locale is spelled with',
      { prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG', 'fr-fr': 'fr-FR' } },
      'no locale is spelled with',
    ],
    [
      'two locales spelled with one prefix',
      {
        locales: { 'en-US': 'en-us', 'ar-EG': 'en-us' },
        prefixes: { 'en-us': 'en-US' },
      },
      'ar-EG',
    ],
    ['no alias table', { aliases: undefined }, 'alias table'],
    ['an alias that is not text', { aliases: { ar: 7 } }, 'alias table'],
    [
      'an alias that is not a path segment',
      { aliases: { AR: 'ar-EG' } },
      '"AR"',
    ],
    [
      'an alias that is one of its roots',
      { aliases: { assets: 'ar-EG' } },
      '"assets"',
    ],
    [
      'an alias that is one of its prefixes',
      { aliases: { 'en-us': 'ar-EG' } },
      '"en-us"',
    ],
    [
      'an alias for a locale it does not name',
      { aliases: { fr: 'fr-FR' } },
      '"fr-FR"',
    ],
    [
      'an alias for a locale its table inherits',
      { aliases: { ar: 'constructor' } },
      '"ar"',
    ],
    [
      'no statement about the default prefix',
      { omitDefaultPrefix: undefined },
      'default locale',
    ],
    ['an x-default that is not text', { xDefaultPath: 7 }, 'x-default'],
    [
      'an x-default on another origin',
      { xDefaultPath: '//other.example' },
      'x-default',
    ],
    [
      'an x-default that is not a path',
      { xDefaultPath: 'choose' },
      'x-default',
    ],
  ])('is refused with %s', (_, replaced, named) => {
    expect(refusal(resolving(written(PREFIXED, replaced)))).toMatchObject({
      code: 'invalid-configuration',
      message: expect.stringContaining(named) as unknown,
    });
  });
});

describe('a written-out locale-neutral policy', () => {
  it.each([
    [
      'a locale spelled in the address',
      { locales: { 'en-US': '', 'ar-EG': 'ar' } },
      'spelling',
    ],
    ['an x-default that is not text', { xDefaultPath: 7 }, 'x-default'],
    [
      'an x-default with a backslash',
      { xDefaultPath: '/\\other.example' },
      'x-default',
    ],
  ])('is refused with %s', (_, replaced, named) => {
    expect(refusal(resolving(written(NEUTRAL, replaced)))).toMatchObject({
      code: 'invalid-configuration',
      message: expect.stringContaining(named) as unknown,
    });
  });
});

describe('a written-out host policy', () => {
  it.each([
    [
      'a host name where an origin belongs',
      {
        locales: { 'en-US': 'example.com', 'ar-EG': 'https://example.eg' },
        origins: { 'example.com': 'en-US', 'https://example.eg': 'ar-EG' },
      },
      'en-US',
    ],
    [
      'an origin that is not normalized',
      {
        locales: {
          'en-US': 'https://EXAMPLE.com/',
          'ar-EG': 'https://example.eg',
        },
        origins: {
          'https://EXAMPLE.com/': 'en-US',
          'https://example.eg': 'ar-EG',
        },
      },
      'en-US',
    ],
    [
      'an origin its origin table reads as another locale',
      {
        origins: {
          'https://example.com': 'ar-EG',
          'https://example.eg': 'ar-EG',
        },
      },
      'en-US',
    ],
    [
      'an origin its origin table does not hold',
      { origins: { 'https://example.com': 'en-US' } },
      'ar-EG',
    ],
    ['no origin table', { origins: undefined }, 'en-US'],
    [
      'an origin table that holds something that is not text',
      {
        origins: {
          'https://example.com': 'en-US',
          'https://example.eg': 'ar-EG',
          other: 7,
        },
      },
      'no locale is served at',
    ],
    [
      'an origin table that reads an origin no locale is served at',
      {
        origins: {
          'https://example.com': 'en-US',
          'https://example.eg': 'ar-EG',
          'https://example.fr': 'fr-FR',
        },
      },
      'no locale is served at',
    ],
    [
      'an x-default that is not text',
      { xDefaultUrl: 7 },
      'not a normalized origin',
    ],
    [
      'an x-default that is not normalized',
      { xDefaultUrl: 'https://example.org/' },
      'not a normalized origin',
    ],
    [
      'an x-default with a path',
      { xDefaultUrl: 'https://example.org/choose' },
      'x-default',
    ],
  ])('is refused with %s', (_, replaced, named) => {
    expect(refusal(resolving(written(HOSTED, replaced)))).toMatchObject({
      code: 'invalid-configuration',
      message: expect.stringContaining(named) as unknown,
    });
  });
});

describe('every reading of a policy', () => {
  const broken = (): PathPrefixLocalePolicy =>
    written(PREFIXED, { prefixes: { 'en-us': 'en-US', 'ar-eg': 'en-US' } });
  const resolved = () => {
    const resolution = resolveLocalizedRoute(
      '/en-us/second',
      PREFIXED,
      PROJECTION,
    );
    if (resolution.status !== 'success') throw new Error('not resolved');
    return resolution;
  };

  it.each<[string, (policy: LocaleUrlPolicy) => unknown]>([
    [
      'resolving an address',
      (policy) => resolveLocalizedRoute('/en-us/second', policy, PROJECTION),
    ],
    [
      'building an address',
      (policy) => buildLocalizedRoute(policy, PROJECTION, 'second', 'en-US'),
    ],
    [
      'narrowing it to a build',
      (policy) => builtLocalePolicy(policy, CONFIGURATION),
    ],
    ['listing its hosts', (policy) => allowedLocaleHosts(policy)],
    [
      'reading the locale an address states',
      (policy) => localeFromRoute('/en-us/second', policy, PROJECTION),
    ],
    [
      'reading a locale from a context with no address',
      (policy) => localeFromRoute({}, policy, PROJECTION),
    ],
    [
      'reading the locale a request starts in',
      (policy) =>
        resolveInitialRouteLocale('/en-us/second', policy, PROJECTION),
    ],
    [
      'reading a starting locale from a context with no address',
      (policy) => resolveInitialRouteLocale({}, policy, PROJECTION),
    ],
    [
      'listing the addresses of a page',
      (policy) => localizedRouteAddresses(resolved(), policy, PROJECTION),
    ],
    [
      'asking whether an address selects a locale',
      (policy) =>
        addressSelectsLocale('/en-us/second', 'en-US', policy, PROJECTION),
    ],
    [
      'projecting the links of a page',
      (policy) =>
        projectRouteSeo(
          resolved(),
          policy,
          PROJECTION,
          CONFIGURATION,
          'https://site.example',
        ),
    ],
    [
      'projecting the links of a page that is not indexed',
      (policy) =>
        projectRouteSeo(
          { ...resolved(), indexing: 'private' },
          policy,
          PROJECTION,
          CONFIGURATION,
          'https://site.example',
        ),
    ],
    [
      'projecting a sitemap',
      (policy) =>
        projectSitemap({
          policy,
          projection: PROJECTION,
          configuration: CONFIGURATION,
          origin: 'https://site.example',
          routes: [{ routeId: 'second' }],
        }),
    ],
    [
      'projecting a sitemap of no routes',
      (policy) =>
        projectSitemap({
          policy,
          projection: PROJECTION,
          configuration: CONFIGURATION,
          origin: 'https://site.example',
          routes: [],
        }),
    ],
    [
      'declaring server routes',
      (policy) =>
        localizedServerRoutes(
          policy,
          PROJECTION,
          CONFIGURATION,
          [{ routeId: 'second', renderMode: 'server' }],
          { canonicalRenderMode: 'server' },
        ),
    ],
    [
      'reading a visible address',
      (policy) =>
        toInternalPath('/en-us/second', { policy, projection: PROJECTION }),
    ],
    [
      'writing a visible address',
      (policy) =>
        toExternalPath('/en-us/second', 'ar-EG', {
          policy,
          projection: PROJECTION,
        }),
    ],
  ])('refuses a broken table when %s', (_, read) => {
    expect(refusal(() => read(PREFIXED))).toBeUndefined();
    expect(refusal(() => read(broken()))).toMatchObject({
      code: 'invalid-configuration',
      message: expect.stringContaining('ar-EG') as unknown,
    });
  });
});

describe('a request handler given a written-out policy', () => {
  it('refuses a broken table where the handler is made, with or without a configuration', () => {
    const broken = written(PREFIXED, {
      prefixes: { 'en-us': 'en-US', 'ar-eg': 'en-US' },
    });
    const cache = { successMaxAge: 600, permanentRedirectMaxAge: 86_400 };
    for (const configuration of [undefined, CONFIGURATION]) {
      const made = (policy: LocaleUrlPolicy) => () =>
        createLocaleRequestHandler({
          policy,
          projection: PROJECTION,
          cache,
          ...(configuration === undefined ? {} : { configuration }),
        });
      expect(refusal(made(PREFIXED))).toBeUndefined();
      expect(refusal(made(broken))).toMatchObject({
        code: 'invalid-configuration',
        message: expect.stringContaining('ar-EG') as unknown,
      });
      expect(
        refusal(made(written(PREFIXED, { locales: undefined }))),
      ).toMatchObject({ code: 'invalid-configuration' });
    }
  });
});
