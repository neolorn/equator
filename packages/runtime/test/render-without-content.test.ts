import { describe, expect, it } from 'vitest';

import {
  createLocaleRequestHandler,
  type LocaleRenderer,
} from '../http/src/handler.js';
import type {
  LocaleUrlPolicy,
  RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The two answers a renderer gives without content, and the one it must never be turned into.
 *
 * A 304 is the conditional-request mechanism saying the client already holds the page, and a
 * redirect is the application's router sending the reader elsewhere. Neither is a routing outcome,
 * so neither takes the status the address resolved to. Composed as the address's 200 they became an
 * empty page, and where the address is shared-cacheable a cache kept that empty page for every
 * later reader. Section 5 of `specs/07-routing-rendering-and-seo.spec.md` states both answers, and
 * RFC 9110 section 15.4.5 states what a 304 repeats from the 200 it stands for.
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
    identity: 'sha256-RenderWithoutContentTestIdentity0123456789a',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
    ],
  },
  localizedPaths: { 'route:second': { 'en-US': 'second', 'ar-EG': 'second' } },
};

const PAGE = '<!doctype html><html lang="ar-EG"></html>';

/** The request every case sends: an Arabic page, a visitor with no cookie yet, and a validator. */
const conditional = (path = '/ar-eg/second') =>
  new Request(`https://site.example${path}`, {
    headers: { 'if-none-match': '"page-1"' },
  });

const summary = async (response: Response) => ({
  status: response.status,
  content: await response.text(),
  cacheControl: response.headers.get('cache-control'),
  vary: response.headers.get('vary'),
  contentLanguage: response.headers.get('content-language'),
  robots: response.headers.get('x-robots-tag'),
  location: response.headers.get('location'),
  etag: response.headers.get('etag'),
  cookies: response.headers.getSetCookie(),
});

describe('a render that answers without content', () => {
  it('keeps a 304, with the cache fields the 200 would carry and nothing else of its own', async () => {
    const answering = (render: LocaleRenderer) =>
      createLocaleRequestHandler({
        policy: POLICY,
        projection: PROJECTION,
        cache: CACHE,
        cookie: { name: 'equator-locale' },
        render,
      })(conditional());

    const page = await summary(
      await answering(
        () => new Response(PAGE, { headers: { etag: '"page-1"' } }),
      ),
    );
    const unchanged = await summary(
      await answering(
        () =>
          new Response(null, { status: 304, headers: { etag: '"page-1"' } }),
      ),
    );

    // What the 200 carries, so the 304 below is measured against it rather than against a literal.
    expect(page.status).toBe(200);
    expect(page.contentLanguage).toBe('ar-EG');
    expect(page.cookies).toHaveLength(1);

    expect(unchanged).toStrictEqual({
      status: 304,
      content: '',
      cacheControl: page.cacheControl,
      vary: page.vary,
      contentLanguage: null,
      robots: null,
      location: null,
      etag: '"page-1"',
      cookies: [],
    });
  });

  it("keeps a redirect the application's router made, and sends none of its content", async () => {
    const redirecting = createLocaleRequestHandler({
      policy: POLICY,
      projection: PROJECTION,
      cache: CACHE,
      cookie: { name: 'equator-locale' },
      render: () =>
        new Response('moved', {
          status: 302,
          headers: { location: '/ar-eg', 'content-type': 'text/plain' },
        }),
    });

    const answered = await summary(await redirecting(conditional()));

    expect(answered).toMatchObject({
      status: 302,
      content: '',
      location: '/ar-eg',
      contentLanguage: 'ar-EG',
    });
    expect(answered.cacheControl).not.toBeNull();
  });

  it('never answers 200 for a render that carried no content, wherever the address resolved', async () => {
    const answers: readonly (() => Response)[] = [
      () => new Response(null),
      () => new Response(null, { status: 304 }),
      ...[301, 302, 303, 307, 308].map(
        (status) => () =>
          new Response(null, { status, headers: { location: '/ar-eg' } }),
      ),
    ];
    const seen: { status: number; cacheControl: string | null }[] = [];

    for (const render of answers) {
      for (const cookie of [{ name: 'equator-locale' }, false] as const) {
        for (const path of ['/ar-eg/second', '/ar-eg/nothing-here']) {
          const response = await createLocaleRequestHandler({
            policy: POLICY,
            projection: PROJECTION,
            cache: CACHE,
            cookie,
            render,
          })(conditional(path));
          if ((await response.text()) === '') {
            seen.push({
              status: response.status,
              cacheControl: response.headers.get('cache-control'),
            });
          }
        }
      }
    }

    // Every case above answered without content, or this proves nothing about those answers.
    expect(seen).toHaveLength(answers.length * 4);
    expect(seen.filter(({ status }) => status === 200)).toStrictEqual([]);
    // A render that should have drawn a page and drew nothing failed, and a failed render is not
    // the address's representation.
    expect(
      seen
        .filter(({ status }) => status === 500)
        .map((each) => each.cacheControl),
    ).toStrictEqual(Array.from({ length: 2 }, () => 'private, no-store'));
  });
});

describe('a render that answers with an error it did not declare', () => {
  // What an application's server engine does with a request it refuses, such as a Host it does not
  // allow: an error page of its own, with nothing declared.
  const refusing = (status: number) => () =>
    new Response('<!doctype html><title>Bad Request</title>', {
      status,
      headers: { 'content-type': 'text/html' },
    });

  it('keeps its status, out of every cache and not indexed, and is not a declaration', async () => {
    for (const status of [400, 403, 404, 500, 503]) {
      const observed: { declared: unknown; carried: boolean }[] = [];
      const answered = await summary(
        await createLocaleRequestHandler({
          policy: POLICY,
          projection: PROJECTION,
          cache: CACHE,
          cookie: { name: 'equator-locale' },
          render: refusing(status),
          ɵobserve: ({ declared, carried }) =>
            observed.push({ declared, carried }),
        })(new Request('https://site.example/ar-eg/second')),
      );
      expect(answered).toMatchObject({
        status,
        content: '<!doctype html><title>Bad Request</title>',
        cacheControl: 'private, no-store',
        robots: 'noindex',
        contentLanguage: 'ar-EG',
      });
      expect(observed).toStrictEqual([{ declared: undefined, carried: false }]);
    }
  });

  it('leaves the status the table gives an address that resolved to anything else', async () => {
    const answered = await summary(
      await createLocaleRequestHandler({
        policy: POLICY,
        projection: PROJECTION,
        cache: CACHE,
        render: refusing(400),
      })(new Request('https://site.example/ar-eg/nothing-here')),
    );
    expect(answered.status).toBe(404);
  });
});

describe('the preconditions a renderer is handed', () => {
  const PRECONDITIONS = {
    'if-match': '"page-1"',
    'if-none-match': '"page-1"',
    'if-modified-since': 'Tue, 01 Sep 2026 00:00:00 GMT',
    'if-unmodified-since': 'Tue, 01 Sep 2026 00:00:00 GMT',
    'if-range': '"page-1"',
  };

  const handed = async (path: string): Promise<Record<string, string>> => {
    let seen: Record<string, string> = {};
    await createLocaleRequestHandler({
      policy: POLICY,
      projection: PROJECTION,
      cache: CACHE,
      render: ({ request }) => {
        seen = Object.fromEntries(
          Object.keys(PRECONDITIONS).flatMap((name) => {
            const value = request.headers.get(name);
            return value === null ? [] : [[name, value]];
          }),
        );
        return new Response(PAGE);
      },
    })(
      new Request(`https://site.example${path}`, {
        headers: PRECONDITIONS,
      }),
    );
    return seen;
  };

  it('are all of them where the address resolved to a page', async () => {
    expect(await handed('/ar-eg/second')).toStrictEqual(PRECONDITIONS);
  });

  it('are none of them where it resolved to anything else', async () => {
    // RFC 9110 section 13.2.1: a server ignores the preconditions where its answer without them
    // would not have been successful, so a missing page is never answered 304.
    expect(await handed('/ar-eg/nothing-here')).toStrictEqual({});
  });
});
