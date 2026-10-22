import { describe, expect, it } from 'vitest';

import {
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  toExternalPath,
  toInternalPath,
  type LocaleUrlPolicy,
  type LocalizedAddressContext,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * Where the address translation hands an address back, and what it reads one against.
 *
 * `toInternalPath` and `toExternalPath` rewrite an address Equator can place and return any other
 * as it was given, so the application's own routes still answer for it. Only a permanent
 * correction is followed on the way: a redirect that depends on a preference is the server's to
 * answer. Under a host policy the address is read at the origin in the context.
 */

/** Reads any segment as itself, so a slug can spell whatever a case needs. */
const TEXT: RouteParameterCodec<string> = {
  parse: (value: string) => ({ ok: true, value }),
  serialize: (value: string) => value,
};

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-AddressTranslationDeclinesTestIdentity01234',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
      { id: 'page', path: ':slug', parameterNames: ['slug'] },
    ],
  },
  localizedPaths: { second: { 'ar-EG': 'الثاني' } },
  parameters: { page: { slug: TEXT } },
};

const SECOND_IN_ARABIC = '%D8%A7%D9%84%D8%AB%D8%A7%D9%86%D9%8A';

const PREFIXED = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const UNPREFIXED_DEFAULT = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  omitDefaultPrefix: true,
});

const HOSTS = createHostLocalePolicy({
  defaultLocale: 'en-US',
  origins: {
    'en-US': 'https://en.site.example',
    'ar-EG': 'https://ar.site.example',
  },
});

const contextFor = (
  policy: LocaleUrlPolicy,
  origin?: string,
): LocalizedAddressContext => ({
  policy,
  projection: PROJECTION,
  ...(origin === undefined ? {} : { origin }),
});

describe('a redirect that depends on a preference', () => {
  it('is not followed inbound, so the address is handed back as written', () => {
    // `/SECOND` carries no prefix, and the answer to it is a 307 to a locale chosen for the
    // visitor. Following it would turn the address into `/second`, a page nobody asked for by
    // that spelling.
    expect(toInternalPath('/SECOND', contextFor(PREFIXED))).toBe('/SECOND');
    expect(toInternalPath('/Second?page=2', contextFor(PREFIXED))).toBe(
      '/Second?page=2',
    );
  });

  it('leaves a permanent correction followed', () => {
    expect(toInternalPath('/en-us/SECOND', contextFor(PREFIXED))).toBe(
      '/second',
    );
  });
});

describe('an address that is only a query or a fragment', () => {
  it('is written at the root of the locale, with what it carried', () => {
    expect(toExternalPath('?page=2', 'ar-EG', contextFor(PREFIXED))).toBe(
      '/ar-eg?page=2',
    );
    expect(toExternalPath('#top', 'ar-EG', contextFor(PREFIXED))).toBe(
      '/ar-eg#top',
    );
  });
});

describe('a route with no address in the locale asked for', () => {
  it('is handed back inbound where the default locale would spell it as a locale prefix', () => {
    // The Arabic page whose slug is `ar-eg`. Unprefixed, its default-locale address would be
    // `/ar-eg`, which is the Arabic root.
    expect(toInternalPath('/ar-eg/ar-eg', contextFor(UNPREFIXED_DEFAULT))).toBe(
      '/ar-eg/ar-eg',
    );
    expect(
      toInternalPath('/ar-eg/ar-eg?page=2', contextFor(UNPREFIXED_DEFAULT)),
    ).toBe('/ar-eg/ar-eg?page=2');
  });

  it('is handed back outbound where the locale spells it as a locale-neutral root', () => {
    const rooted = createLocaleNeutralPolicy({
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
      localeNeutralRoots: ['help'],
    });
    expect(
      toExternalPath('/guide?page=2', 'ar-EG', contextFor(rooted), {
        slug: { 'ar-EG': 'help' },
      }),
    ).toBe('/guide?page=2');
    // The control: the same call with a spelling the policy has not claimed.
    expect(
      toExternalPath('/guide?page=2', 'ar-EG', contextFor(rooted), {
        slug: { 'ar-EG': 'helpful' },
      }),
    ).toBe('/helpful?page=2');
  });
});

describe('the origin an address is read at under a host policy', () => {
  it('reads a path in the locale of the origin in the context', () => {
    expect(
      toInternalPath(
        `/${SECOND_IN_ARABIC}?page=2`,
        contextFor(HOSTS, 'https://ar.site.example'),
      ),
    ).toBe('/second?page=2');
  });

  it('reads a path at the default locale origin where the context names none', () => {
    // Arabic's spelling is not an address at the English origin, so it is handed back.
    expect(toInternalPath(`/${SECOND_IN_ARABIC}`, contextFor(HOSTS))).toBe(
      `/${SECOND_IN_ARABIC}`,
    );
    expect(toInternalPath('/second', contextFor(HOSTS))).toBe('/second');
  });
});
