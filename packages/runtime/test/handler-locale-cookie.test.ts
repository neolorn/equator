import { describe, expect, it } from 'vitest';

import {
  createLocaleRequestHandler,
  type LocaleCookiePolicy,
} from '../http/src/handler.js';
import type {
  LocaleUrlPolicy,
  RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The locale cookie as the request handler reads it from a request and writes it on a response.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 7 makes a remembered choice the first
 * source of a first request's locale. A `Cookie` header is anyone's to write, so what counts as
 * that choice is one entry of it, by name, and nothing beside it.
 */

const CACHE = { successMaxAge: 600, permanentRedirectMaxAge: 86_400 } as const;

const POLICY: LocaleUrlPolicy = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: ['assets'],
  omitDefaultPrefix: false,
};

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-HandlerLocaleCookieTestIdentity0123456789ab',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
    ],
  },
  localizedPaths: { 'route:second': { 'en-US': 'second', 'ar-EG': 'second' } },
};

const answer = (
  path: string,
  headers: Record<string, string> = {},
  cookie: LocaleCookiePolicy = { name: 'equator-locale' },
): Promise<Response> =>
  createLocaleRequestHandler({
    policy: POLICY,
    projection: PROJECTION,
    cache: CACHE,
    cookie,
    render: ({ locale }) =>
      new Response(`<!doctype html><html lang="${locale}"></html>`, {
        headers: { 'content-type': 'text/html' },
      }),
  })(new Request(`https://site.example${path}`, { headers }));

/** Where an address that names no locale is sent for a visitor carrying this `Cookie` header. */
const entryFor = async (cookieHeader: string): Promise<string | null> => {
  const response = await answer('/second', { cookie: cookieHeader });
  expect(response.status).toBe(307);
  return response.headers.get('location');
};

describe('the locale cookie a request carries', () => {
  it('decides the locale of an address that names none', async () => {
    expect(await entryFor('equator-locale=ar-EG')).toBe('/ar-eg/second');
  });

  it('is read whatever the casing of the tag it carries', async () => {
    expect(await entryFor('equator-locale=AR-eg')).toBe('/ar-eg/second');
  });

  it('is found among other cookies, with the spacing a header may carry', async () => {
    expect(
      await entryFor('theme=dark;  equator-locale = ar-EG ; consent=yes'),
    ).toBe('/ar-eg/second');
  });

  it('is the entry of that name and no other, whatever another entry carries', async () => {
    expect(await entryFor('theme=ar-EG')).toBe('/en-us/second');
    expect(await entryFor('equator-locale-old=ar-EG')).toBe('/en-us/second');
  });

  it('is still read behind an entry that has no value', async () => {
    // The first entry is one character longer than the cookie's name and has no `=`, which is the
    // shape a reader that cuts a name off an entry by position would take for the cookie.
    expect(await entryFor('equator-localeX; equator-locale=ar-EG')).toBe(
      '/ar-eg/second',
    );
    expect(await entryFor('flag; equator-locale=ar-EG')).toBe('/ar-eg/second');
  });

  it('says nothing when it is empty or names a locale that is not served', async () => {
    expect(await entryFor('equator-locale=')).toBe('/en-us/second');
    expect(await entryFor('equator-locale=fr-FR')).toBe('/en-us/second');
    expect(await entryFor('equator-locale=not a tag')).toBe('/en-us/second');
  });
});

describe('the locale cookie a response carries', () => {
  it('remembers the locale an entry redirect chose', async () => {
    const entry = await answer('/second', { 'accept-language': 'ar-EG' });

    expect(entry.status).toBe(307);
    expect(entry.headers.getSetCookie()).toStrictEqual([
      'equator-locale=ar-EG; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    ]);
  });

  it('is not written where the address resolved to no page', async () => {
    const missing = await answer('/ar-eg/nothing-here');

    expect(missing.status).toBe(404);
    expect(missing.headers.getSetCookie()).toStrictEqual([]);
  });

  it('is not written again for a visitor who already carries it', async () => {
    const page = await answer('/ar-eg/second', {
      cookie: 'equator-locale=ar-EG',
    });

    expect(page.status).toBe(200);
    expect(page.headers.getSetCookie()).toStrictEqual([]);
  });

  it('carries the Domain a deployment configured, between SameSite and Secure', async () => {
    const page = await answer(
      '/ar-eg/second',
      {},
      { name: 'site-locale', domain: 'site.example' },
    );

    expect(page.headers.getSetCookie()).toStrictEqual([
      'site-locale=ar-EG; Path=/; Max-Age=31536000; SameSite=Lax; Domain=site.example; Secure',
    ]);
  });

  it('carries no Domain where none was configured', async () => {
    const page = await answer('/ar-eg/second');

    expect(page.headers.getSetCookie()).toStrictEqual([
      'equator-locale=ar-EG; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    ]);
  });

  it('is neither read nor written by a deployment that remembers nothing', async () => {
    const entry = await answer(
      '/second',
      { cookie: 'equator-locale=ar-EG' },
      false,
    );
    const page = await answer('/ar-eg/second', {}, false);

    expect(entry.headers.get('location')).toBe('/en-us/second');
    expect(entry.headers.getSetCookie()).toStrictEqual([]);
    expect(page.headers.getSetCookie()).toStrictEqual([]);
  });
});
