/**
 * Which language a page restored from the back-forward cache should now be in.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 5 lets a browser keep a page whose language
 * came from a cookie, and a restored page is the one reuse that does not ask the server. The stored
 * choice is what can have moved; the question is whether the configured sources, run against the
 * address the page is at, would choose it now.
 */

// First, and on its own line, for the reason `locale-cookie-defaults.test.ts` states.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import {
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  localeFromRoute,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

import {
  LocaleResolution,
  type LocalizationLocaleSource,
} from '../src/locale-resolution.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.ts';

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-BuiltLocaleAddressesTestIdentity01234567890',
    routes: [{ id: 'route:second', path: 'second', parameterNames: [] }],
  },
};

const PATH_PREFIX: LocaleUrlPolicy = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: [],
  omitDefaultPrefix: false,
};

const NEUTRAL: LocaleUrlPolicy = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});

const HOST: LocaleUrlPolicy = createHostLocalePolicy({
  defaultLocale: 'en-US',
  origins: { 'en-US': 'https://en.example', 'ar-EG': 'https://ar.example' },
});

interface Environment {
  readonly stored?: string;
  readonly policy?: LocaleUrlPolicy;
  readonly sources?: readonly LocalizationLocaleSource[];
  readonly preferredLanguages?: readonly string[];
}

function resolutionIn(environment: Environment) {
  let reads = 0;
  const resolution = new LocaleResolution({
    persistence: [
      {
        id: 'shared',
        read: () => {
          reads += 1;
          return environment.stored;
        },
        write: () => undefined,
      },
    ],
    initialLocale: undefined,
    requestContext: undefined,
    preferredLanguages: environment.preferredLanguages,
    localeFromAddress: (requestContext) =>
      localeFromRoute(
        requestContext,
        environment.policy ?? NEUTRAL,
        PROJECTION,
      ),
    localeSources: environment.sources,
    defaultLocale: 'en-US',
    localeList: Object.freeze(['en-US', 'ar-EG']),
    supportedLocales: new Set(['en-US', 'ar-EG']),
    seeded: Promise.resolve(),
    canonicalLocale: (locale: string) => locale,
    observability: undefined,
  });
  return {
    restored: (committed: string, address: string, origin?: string) =>
      resolution.restoredLocale(
        committed,
        { url: address, ...(origin === undefined ? {} : { origin }) },
        new AbortController().signal,
      ),
    reads: () => reads,
  };
}

describe('the language a restored page should be in', () => {
  it('is the stored one where the address states none', async () => {
    const at = resolutionIn({ stored: 'ar-EG' });

    expect(await at.restored('en-US', '/second')).toBe('ar-EG');
    // Read once: the stored source in the walk is the value already read, not a second read.
    expect(at.reads()).toBe(1);
  });

  it('is the one the address states, wherever it states one', async () => {
    const at = resolutionIn({ stored: 'ar-EG', policy: PATH_PREFIX });

    expect(await at.restored('en-US', '/en-us/second')).toBeUndefined();
    // The address the page is at now decides, not the one it was set up at.
    expect(await at.restored('en-US', '/ar-eg/second')).toBe('ar-EG');
  });

  it('is the one the origin states, where the origin carries the locale', async () => {
    const at = resolutionIn({ stored: 'en-US', policy: HOST });

    // The path is the same in every locale, so without its origin this page would read as English.
    expect(
      await at.restored('ar-EG', '/second', 'https://ar.example'),
    ).toBeUndefined();
    expect(await at.restored('ar-EG', '/second', 'https://en.example')).toBe(
      'en-US',
    );
  });

  it('is unchanged when nothing was chosen since, or nothing at all', async () => {
    expect(
      await resolutionIn({ stored: 'en-US' }).restored('en-US', '/second'),
    ).toBeUndefined();
    expect(await resolutionIn({}).restored('en-US', '/second')).toBeUndefined();
  });

  it('follows the order the consumer declared', async () => {
    const at = resolutionIn({
      stored: 'ar-EG',
      sources: ['browser', 'stored', 'default'],
      preferredLanguages: ['en-US'],
    });

    // The browser's language comes first here, so the stored choice would not have been used on a
    // fresh load either.
    expect(await at.restored('en-US', '/second')).toBeUndefined();
    claimCapability('source:browser');
  });
});
