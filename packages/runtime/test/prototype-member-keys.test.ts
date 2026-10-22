import { describe, expect, it } from 'vitest';

import {
  createHostLocalePolicy,
  createIdentifierParameterCodec,
  resolveLocalizedRoute,
  toInternalPath,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * Addresses that name a member every plain object inherits.
 *
 * A policy's tables and a projection's history are plain objects, written by the constructors or
 * by the application itself, and a request chooses the key they are read with. Read without
 * asking whose the key is, `/constructor/second` finds `Object` where a locale prefix would be.
 * Each of these must be answered exactly as a key nobody configured is answered.
 */

const MEMBERS = Object.getOwnPropertyNames(Object.prototype);

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-PrototypeMemberKeysTestIdentity0123456789ab',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  localizedPaths: {
    'route:second': { 'en-US': 'second', 'ar-EG': 'thani' },
  },
  parameters: { article: { slug: createIdentifierParameterCodec() } },
  historical: {
    legacy: { kind: 'replacement', routeId: 'route:second' },
  },
} as RouteRuntimeProjection;

const PREFIXED: LocaleUrlPolicy = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: { ar: 'ar-EG' },
  localeNeutralRoots: [],
  omitDefaultPrefix: false,
};

const HOSTS = createHostLocalePolicy({
  defaultLocale: 'en-US',
  origins: {
    'en-US': 'https://en.site.example',
    'ar-EG': 'https://ar.site.example',
  },
});

const UNCONFIGURED = 'nobody';

/** Resolves an address, or names what it threw, so a throw is compared rather than raised. */
const answer = (run: () => unknown): unknown => {
  try {
    return run();
  } catch (error) {
    return `threw ${(error as Error).message}`;
  }
};

describe('an address that names an Object.prototype member', () => {
  it('lists the members, and answers every control, so the cases below are about something', () => {
    expect(MEMBERS).toContain('constructor');
    expect(MEMBERS).toContain('__proto__');
    expect(MEMBERS.length).toBeGreaterThan(5);
    // A control that throws makes every comparison below a throw against a throw.
    for (const control of [
      () =>
        resolveLocalizedRoute(`/${UNCONFIGURED}/second`, PREFIXED, PROJECTION),
      () =>
        resolveLocalizedRoute(`/en-us/${UNCONFIGURED}`, PREFIXED, PROJECTION),
      () =>
        resolveLocalizedRoute('/second', PREFIXED, PROJECTION, {
          locale: UNCONFIGURED,
        }),
      () =>
        resolveLocalizedRoute('/second', HOSTS, PROJECTION, {
          origin: UNCONFIGURED,
        }),
      () =>
        toInternalPath(`/${UNCONFIGURED}/second`, {
          policy: PREFIXED,
          projection: PROJECTION,
        }),
    ]) {
      const result = answer(control);
      expect(
        typeof result === 'string' && result.startsWith('threw '),
        String(result),
      ).toBe(false);
    }
    expect(
      resolveLocalizedRoute('/en-us/legacy', PREFIXED, PROJECTION).status,
    ).toBe('redirect');
  });

  it('is answered as an unconfigured prefix', () => {
    const control = answer(() =>
      resolveLocalizedRoute(`/${UNCONFIGURED}/second`, PREFIXED, PROJECTION),
    );
    for (const member of MEMBERS) {
      expect(
        answer(() =>
          resolveLocalizedRoute(`/${member}/second`, PREFIXED, PROJECTION),
        ),
        member,
      ).toStrictEqual(
        JSON.parse(JSON.stringify(control).replaceAll(UNCONFIGURED, member)),
      );
    }
  });

  it('is answered as an unconfigured retired address', () => {
    const control = answer(() =>
      resolveLocalizedRoute(`/en-us/${UNCONFIGURED}`, PREFIXED, PROJECTION),
    );
    for (const member of MEMBERS) {
      expect(
        answer(() =>
          resolveLocalizedRoute(`/en-us/${member}`, PREFIXED, PROJECTION),
        ),
        member,
      ).toStrictEqual(
        JSON.parse(JSON.stringify(control).replaceAll(UNCONFIGURED, member)),
      );
    }
  });

  it('is answered as an unconfigured preference', () => {
    const control = answer(() =>
      resolveLocalizedRoute('/second', PREFIXED, PROJECTION, {
        locale: UNCONFIGURED,
      }),
    );
    for (const member of MEMBERS) {
      expect(
        answer(() =>
          resolveLocalizedRoute('/second', PREFIXED, PROJECTION, {
            locale: member,
          }),
        ),
        member,
      ).toStrictEqual(control);
    }
  });

  it('is answered as an unconfigured origin', () => {
    const control = answer(() =>
      resolveLocalizedRoute('/second', HOSTS, PROJECTION, {
        origin: UNCONFIGURED,
      }),
    );
    for (const member of MEMBERS) {
      expect(
        answer(() =>
          resolveLocalizedRoute('/second', HOSTS, PROJECTION, {
            origin: member,
          }),
        ),
        member,
      ).toStrictEqual(control);
    }
  });

  it('is translated to an internal path as an unconfigured prefix is', () => {
    const context = { policy: PREFIXED, projection: PROJECTION };
    const control = answer(() =>
      toInternalPath(`/${UNCONFIGURED}/second`, context),
    );
    for (const member of MEMBERS) {
      expect(
        answer(() => toInternalPath(`/${member}/second`, context)),
        member,
      ).toStrictEqual(
        typeof control === 'string'
          ? control.replaceAll(UNCONFIGURED, member)
          : control,
      );
    }
  });
});
