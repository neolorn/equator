/**
 * A policy written out by hand with a member of another kind of policy beside its own.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md` refuses such a policy as a
 * configuration error wherever it is read. A policy is read by its kind, so an `origins` table on a
 * path-prefix policy would decide nothing, and the application that wrote it expects it to.
 */
import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  resolveLocalizedRoute,
  toExternalPath,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-PolicyMemberOfAnotherKindTestIdentity012345',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
    ],
  },
};

const PREFIXED = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: [],
  omitDefaultPrefix: false,
};

const NEUTRAL = {
  kind: 'locale-neutral',
  defaultLocale: 'en-US',
  locales: { 'en-US': '', 'ar-EG': '' },
  localeNeutralRoots: [],
};

const HOSTED = {
  kind: 'locale-host',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'https://example.com', 'ar-EG': 'https://example.eg' },
  origins: { 'https://example.com': 'en-US', 'https://example.eg': 'ar-EG' },
  localeNeutralRoots: [],
};

/** One value for each member that belongs to a kind and not to every kind. */
const MEMBERS: Readonly<Record<string, unknown>> = {
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  omitDefaultPrefix: false,
  xDefaultPath: '/choose',
  origins: { 'https://example.com': 'en-US', 'https://example.eg': 'ar-EG' },
  xDefaultUrl: 'https://example.org',
};

const CASES: readonly (readonly [string, object, readonly string[]])[] = [
  ['path-prefix', PREFIXED, ['origins', 'xDefaultUrl']],
  [
    'locale-neutral',
    NEUTRAL,
    ['prefixes', 'aliases', 'omitDefaultPrefix', 'origins', 'xDefaultUrl'],
  ],
  [
    'locale-host',
    HOSTED,
    ['prefixes', 'aliases', 'omitDefaultPrefix', 'xDefaultPath'],
  ],
];

const resolving = (policy: object) => () =>
  resolveLocalizedRoute('/second', policy as LocaleUrlPolicy, PROJECTION);

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

describe.each(CASES)('a written-out %s policy', (_kind, policy, foreign) => {
  it('is read with its own members alone', () => {
    expect(refusal(resolving(policy))).toBeUndefined();
  });

  it.each(foreign)('is refused with %s beside them', (member) => {
    expect(
      refusal(resolving({ ...policy, [member]: MEMBERS[member] })),
    ).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: expect.stringContaining(JSON.stringify(member)) as unknown,
    });
  });

  it.each(foreign)('is read with %s present and undefined', (member) => {
    expect(
      refusal(resolving({ ...policy, [member]: undefined })),
    ).toBeUndefined();
  });
});

it('refuses the policy wherever it is read, an address written as much as one resolved', () => {
  expect(
    refusal(() =>
      toExternalPath('/second', 'en-US', {
        policy: {
          ...PREFIXED,
          origins: MEMBERS['origins'],
        } as unknown as LocaleUrlPolicy,
        projection: PROJECTION,
        origin: 'https://ar.example',
      }),
    ),
  ).toMatchObject({ code: 'invalid-configuration' });
});
