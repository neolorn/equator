import { describe, expect, it } from 'vitest';

import {
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  resolveLocalizedRoute,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * A slash and a question mark inside a query or a fragment.
 *
 * RFC 3986 sections 3.4 and 3.5 let both stand as data there, and a return address is the ordinary
 * case: `?next=/account`. In a path segment a decoded slash stays refused, because there it would
 * turn one segment into two.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-QueryAndFragmentSeparatorsTestIdentity01234',
    routes: [
      { id: 'home', path: '', parameterNames: [] },
      { id: 'second', path: 'second', parameterNames: [] },
    ],
  },
};

const PREFIX = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const answer = (address: string) =>
  resolveLocalizedRoute(address, PREFIX, PROJECTION);

describe('a slash or a question mark in a query or a fragment', () => {
  it('reads a return address in a query value as the value', () => {
    const resolved = answer('/en-us/second?next=/account');

    expect(resolved.status).toBe('success');
    expect(resolved.status === 'success' && resolved.query).toEqual([
      { name: 'next', value: '/account' },
    ]);
  });

  it('reads both characters in a value, a name and a fragment', () => {
    const resolved = answer('/en-us/second?a/b=/c?d#/section?part');

    expect(resolved.status).toBe('success');
    expect(resolved.status === 'success' && resolved.query).toEqual([
      { name: 'a/b', value: '/c?d' },
    ]);
    expect(resolved.status === 'success' && resolved.fragment).toBe(
      '/section?part',
    );
  });

  it('keeps the return address exactly through a canonical correction', () => {
    expect(answer('/EN-US/second?next=/account')).toMatchObject({
      status: 'redirect',
      reason: 'canonical-correction',
      location: '/en-us/second?next=/account',
    });
    expect(answer('/en-us/second/?next=/account#/top')).toMatchObject({
      status: 'redirect',
      reason: 'canonical-correction',
      location: '/en-us/second?next=/account#/top',
    });
  });

  it('keeps the return address exactly through a locale-entry redirect', () => {
    expect(answer('/second?next=/account')).toMatchObject({
      status: 'redirect',
      reason: 'locale-entry',
      location: '/en-us/second?next=/account',
    });
  });

  it('writes one spelling of either character, the literal one', () => {
    expect(answer('/en-us/second?next=%2Faccount%3Ftab')).toMatchObject({
      status: 'redirect',
      reason: 'canonical-correction',
      location: '/en-us/second?next=/account?tab',
    });
    expect(answer('/en-us/second?next=/account?tab').status).toBe('success');
    expect(answer('/en-us/second#%2Ftop')).toMatchObject({
      status: 'redirect',
      location: '/en-us/second#/top',
    });
  });

  it('answers the same under a locale-neutral and a locale-host policy', () => {
    const neutral = createLocaleNeutralPolicy({
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
    });
    const host = createHostLocalePolicy({
      defaultLocale: 'en-US',
      origins: {
        'en-US': 'https://en.site.example',
        'ar-EG': 'https://ar.site.example',
      },
    });

    expect(
      resolveLocalizedRoute('/second?next=/account', neutral, PROJECTION)
        .status,
    ).toBe('success');
    expect(
      resolveLocalizedRoute('/SECOND?next=/account', neutral, PROJECTION),
    ).toMatchObject({
      status: 'redirect',
      location: '/second?next=/account',
    });
    expect(
      resolveLocalizedRoute(
        'https://ar.site.example/second?next=/account',
        host,
        PROJECTION,
      ).status,
    ).toBe('success');
    expect(
      resolveLocalizedRoute(
        'https://ar.site.example/SECOND?next=/account',
        host,
        PROJECTION,
      ),
    ).toMatchObject({
      status: 'redirect',
      location: 'https://ar.site.example/second?next=/account',
    });
  });

  it('still refuses a decoded slash in a path segment', () => {
    expect(answer('/en-us/a%2Fb').status).toBe('malformed');
    expect(answer('/en-us/a%2fb?next=/account').status).toBe('malformed');
  });

  it('still refuses a backslash or a control in a query or a fragment', () => {
    expect(answer('/en-us/second?next=%5Caccount').status).toBe('malformed');
    expect(answer('/en-us/second?next=%00').status).toBe('malformed');
    expect(answer('/en-us/second#%5Ctop').status).toBe('malformed');
    expect(answer('/en-us/second#%0A').status).toBe('malformed');
  });

  it('holds the bounds to the canonical spelling it writes', () => {
    // 512 slashes are 512 characters as written and as corrected, so the value is within its bound.
    expect(answer(`/en-us/second?next=${'/'.repeat(512)}`).status).toBe(
      'success',
    );
    expect(answer(`/en-us/second?next=${'/'.repeat(513)}`).status).toBe(
      'malformed',
    );
  });
});
