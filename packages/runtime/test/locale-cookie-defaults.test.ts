// First, and on its own line, because it has to be evaluated before anything reaches
// `@angular/common`. The store injects `DOCUMENT` from there, and the same bundle carries
// `PlatformLocation`, whose partially-compiled declaration is linked at class-initialization
// time and needs a compiler. Outside an Angular build there is none, so importing the store
// throws before a single test is collected, which is the finding `vitest.config.ts` records
// as the reason the primary entry point is not aliased. A declared devDependency, and the
// remedy the error itself names.
import '@angular/compiler';

import { DOCUMENT } from '@angular/common';
import { Injector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { createLocaleRequestHandler } from '../http/src/handler.js';
import { type CookieStoreOptions, cookieStore } from '../src/persistence.js';
import {
  LocalizationError,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * One cookie, written by two halves of Equator, asserted once.
 *
 * The browser store and the server handler write the same cookie for the same visitor: the handler
 * sets it on the response of the first request, and the store rewrites it once the application has
 * hydrated. They are in different packages, they serialize it separately, and each writes its
 * defaults down separately, which is a drift waiting to happen. With `Secure` off for the store and
 * on for the handler over `http` on loopback, Chromium and Firefox treat `http://127.0.0.1` as a
 * secure context, so the browser's write replaces the server's and nothing shows; WebKit does not,
 * so a non-secure origin is refused the right to overwrite a `Secure` cookie, `document.cookie`
 * reads empty, and the visitor's locale choice is never remembered: one engine of three, from two
 * settings each defensible on its own.
 *
 * So the assertion is not "the default is `Secure`" twice. It is that the two halves produce the
 * same header for the same options, defaults included, which is the only form of it that fails
 * when one of them changes.
 */

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
    identity: 'sha256-LocaleCookieDefaultsTestIdentity01234567890',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
    ],
  },
  localizedPaths: {
    'route:second': { 'en-US': 'second', 'ar-EG': 'second' },
  },
};

/**
 * What the store writes, taken from the document rather than from a browser.
 *
 * A real jsdom would be the wrong instrument here and not a stricter one: it drops a `Secure`
 * cookie set from a non-secure origin, which is the behaviour under test, so the assertion would
 * read an empty jar and say nothing about the header. The header is the artefact.
 */
async function clientHeader(
  options: CookieStoreOptions,
  locale: string,
): Promise<string> {
  let written: string | undefined;
  const document = {
    get cookie(): string {
      return '';
    },
    set cookie(value: string) {
      written = value;
    },
  };
  const injector = Injector.create({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: DOCUMENT, useValue: document },
    ],
  });

  const store = runInInjectionContext(injector, cookieStore(options));
  // Awaited because the port declares it may be a promise. The cookie store's own write is
  // synchronous, so this reads as ceremony until a store that is not writes nothing and the
  // assertion below reports it as writing nothing at all.
  await store.write(locale);

  expect(written, 'the store wrote no cookie at all').toBeTypeOf('string');
  return written ?? '';
}

/** What the store writes to forget the choice, taken from the document as above. */
async function forgottenHeader(options: CookieStoreOptions): Promise<string> {
  let written: string | undefined;
  const document = {
    get cookie(): string {
      return '';
    },
    set cookie(value: string) {
      written = value;
    },
  };
  const injector = Injector.create({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: DOCUMENT, useValue: document },
    ],
  });

  const store = runInInjectionContext(injector, cookieStore(options));
  await store.forget?.();

  expect(written, 'the store wrote no cookie at all').toBeTypeOf('string');
  return written ?? '';
}

/** What the handler writes, for a visitor arriving in a locale their cookie does not name. */
async function serverHeader(
  cookie: CookieStoreOptions,
  path: string,
): Promise<string> {
  const handler = createLocaleRequestHandler({
    policy: POLICY,
    projection: PROJECTION,
    cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
    cookie,
    render: ({ locale }) =>
      new Response(`<!doctype html><html lang="${locale}"></html>`, {
        headers: { 'content-type': 'text/html' },
      }),
  });

  const response = await handler(
    new Request(`https://site.example${path}`, {
      headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' },
    }),
  );
  const written = response.headers.get('set-cookie');

  expect(written, 'the handler wrote no cookie at all').not.toBeNull();
  return written ?? '';
}

describe('the cookie both halves of Equator write', () => {
  it('is Secure by default, on both of them', async () => {
    expect(await clientHeader({}, 'ar-EG')).toContain('; Secure');
    expect(await serverHeader({}, '/ar-eg/second')).toContain('; Secure');
  });

  it('is the same header from either half, defaults and all', async () => {
    // The assertion the lab's defect needed. Anything either half decides on its own (an
    // attribute, an order, an encoding, a lifetime) shows up here as a difference.
    expect(await clientHeader({}, 'ar-EG')).toBe(
      await serverHeader({}, '/ar-eg/second'),
    );
  });

  it('is the same header when a deployment turns Secure off, which is what a loopback lab does', async () => {
    const options: CookieStoreOptions = {
      name: 'equator-locale',
      secure: false,
    };

    expect(await clientHeader(options, 'ar-EG')).toBe(
      await serverHeader(options, '/ar-eg/second'),
    );
    expect(await clientHeader(options, 'ar-EG')).not.toContain('Secure');
  });
});

describe('a cookie configuration neither half will write', () => {
  const CRLF = String.fromCharCode(13, 10);
  const refused: readonly [string, CookieStoreOptions, RegExp][] = [
    [
      'SameSite=None without Secure',
      { sameSite: 'None', secure: false },
      /SameSite=None/u,
    ],
    [
      'a __Secure- name without Secure',
      { name: '__Secure-locale', secure: false },
      /__Secure-/u,
    ],
    [
      'a __Host- name without Secure',
      { name: '__Host-locale', secure: false },
      /__Host- name requires Secure/u,
    ],
    [
      'a __Host- name with a Domain',
      { name: '__Host-locale', domain: 'site.example' },
      /Domain/u,
    ],
    [
      'a __Host- name off the root',
      { name: '__Host-locale', path: '/app' },
      /Path/u,
    ],
    [
      'a name that is not a token',
      { name: `a;${CRLF}X-Injected: 1` },
      /not a token/u,
    ],
    ['an empty name', { name: '' }, /not a token/u],
    ['a path carrying a ";"', { path: '/;Domain=elsewhere.example' }, /Path/u],
    [
      'a domain carrying a line break',
      { domain: `site.example${CRLF}X: 1` },
      /Domain/u,
    ],
    ['a lifetime of nothing', { maxAgeSeconds: 0 }, /maxAgeSeconds/u],
    [
      'a lifetime that is not a number',
      { maxAgeSeconds: Number.NaN },
      /maxAgeSeconds/u,
    ],
  ];

  /** What a configuration is refused with, or nothing where it is accepted. */
  const refusal = (configure: () => unknown): unknown => {
    try {
      configure();
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('is refused by the browser store where it is configured', () => {
    for (const [what, options, rule] of refused) {
      expect(() => cookieStore(options), what).toThrow(rule);
      expect(() => cookieStore(options), what).toThrow(/Equator cookieStore/u);
    }
  });

  it('is refused by both as a configuration the diagnostic names', () => {
    for (const [what, options] of refused) {
      for (const configure of [
        () => cookieStore(options),
        () =>
          createLocaleRequestHandler({
            policy: POLICY,
            projection: PROJECTION,
            cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
            cookie: options,
          }),
      ]) {
        const error = refusal(configure);
        expect(error, what).toBeInstanceOf(LocalizationError);
        expect(error, what).toMatchObject({
          diagnostic: {
            code: 'invalid-configuration',
            outcome: 'operational-failure',
            reason: 'malformed-input',
          },
        });
      }
    }
  });

  it('is refused by the server handler where it is configured', () => {
    for (const [what, options, rule] of refused) {
      const create = () =>
        createLocaleRequestHandler({
          policy: POLICY,
          projection: PROJECTION,
          cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
          cookie: options,
        });
      expect(create, what).toThrow(rule);
      expect(create, what).toThrow(/Equator createLocaleRequestHandler/u);
    }
  });

  it('leaves an ordinary one alone, so the refusals above are about the attribute', () => {
    const ordinary: CookieStoreOptions = {
      name: '__Host-locale',
      path: '/',
      maxAgeSeconds: 60,
      sameSite: 'Strict',
    };
    expect(() => cookieStore(ordinary)).not.toThrow();
    expect(() =>
      createLocaleRequestHandler({
        policy: POLICY,
        projection: PROJECTION,
        cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
        cookie: ordinary,
      }),
    ).not.toThrow();
  });
});

/**
 * Forgetting is a write of the same cookie, expired.
 *
 * A browser matches a cookie on its name, path and domain, so an expiry written with any of them
 * different leaves the original where it was. The expiry also carries `Secure` where the write
 * did, because a cookie that is not `Secure` cannot overwrite one that is.
 */
describe('the cookie the browser store writes to forget a choice', () => {
  it('names the domain and is Secure where the cookie it expires is', async () => {
    expect(
      await forgottenHeader({
        name: 'site-locale',
        path: '/app',
        domain: 'site.example',
        sameSite: 'Strict',
      }),
    ).toBe(
      'site-locale=; Path=/app; Max-Age=0; SameSite=Strict; Domain=site.example; Secure',
    );
  });

  it('names no domain and is not Secure where the cookie it expires is neither', async () => {
    expect(await forgottenHeader({ name: 'site-locale', secure: false })).toBe(
      'site-locale=; Path=/; Max-Age=0; SameSite=Lax',
    );
  });
});
