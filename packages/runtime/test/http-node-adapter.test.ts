import { describe, expect, it } from 'vitest';

import { createLocaleRequestHandler } from '../http/src/handler.js';
import {
  toNodeListener,
  toWebRequest,
  writeNodeResponse,
  type NodeRequestLike,
  type NodeResponseLike,
} from '../http/src/node.js';
import {
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * The adapter, exercised without a socket.
 *
 * The Node shapes are structural interfaces here, not classes to instantiate, which is
 * the point of the shape: the handler speaks Fetch, so the only Node-aware code is this translation
 * and it can be checked against a plain object. Anything that needed a listening server to test
 * would be a reason to doubt the layering rather than the test.
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
    identity: 'sha256-BuiltLocaleAddressesTestIdentity01234567890',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
    ],
  },
  localizedPaths: { 'route:second': { 'en-US': 'second', 'ar-EG': 'second' } },
};

function incoming(
  url: string,
  headers: Record<string, string | string[]> = {},
): NodeRequestLike {
  return { method: 'GET', url, headers };
}

function recorder(): {
  readonly target: NodeResponseLike;
  readonly headers: Map<string, number | string | readonly string[]>;
  status(): number;
  body(): string;
} {
  const headers = new Map<string, number | string | readonly string[]>();
  const chunks: Uint8Array[] = [];
  let statusCode = 0;
  let ended = false;
  const target = {
    setHeader(name: string, value: number | string | readonly string[]) {
      headers.set(name.toLowerCase(), value);
    },
    write(chunk: Uint8Array) {
      chunks.push(chunk);
      return true;
    },
    end() {
      ended = true;
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
  };
  return {
    target,
    headers,
    status: () => {
      expect(ended).toBe(true);
      return statusCode;
    },
    body: () => chunks.map((chunk) => new TextDecoder().decode(chunk)).join(''),
  };
}

describe('reading a Node request as a Fetch request', () => {
  it('takes the origin from Host when nothing else supplies one', () => {
    const request = toWebRequest(
      incoming('/ar-eg/second?page=2', { host: 'site.example' }),
      'http://site.example',
    );

    expect(request.url).toBe('http://site.example/ar-eg/second?page=2');
    expect(request.method).toBe('GET');
  });

  it('keeps a repeated header as more than one value', () => {
    // Node hands back an array for a header that arrived twice. Setting it would keep the last one.
    const request = toWebRequest(
      incoming('/', { 'accept-language': ['ar-EG', 'en-US;q=0.8'] }),
      'http://site.example',
    );

    expect(request.headers.get('accept-language')).toBe('ar-EG, en-US;q=0.8');
  });
});

describe('writing a Fetch response onto a Node response', () => {
  it('keeps two cookies as two headers rather than one comma-joined one', async () => {
    const headers = new Headers();
    headers.append('set-cookie', 'equator-locale=ar-EG; Path=/');
    headers.append('set-cookie', 'other=1; Path=/');
    headers.set('cache-control', 'private, no-store');
    const sink = recorder();

    await writeNodeResponse(
      new Response('<!doctype html>', { status: 200, headers }),
      sink.target,
    );

    // Joined with a comma this sets neither cookie, which is why `getSetCookie` exists.
    expect(sink.headers.get('set-cookie')).toStrictEqual([
      'equator-locale=ar-EG; Path=/',
      'other=1; Path=/',
    ]);
    expect(sink.headers.get('cache-control')).toBe('private, no-store');
    expect(sink.status()).toBe(200);
    expect(sink.body()).toBe('<!doctype html>');
  });

  it('ends a bodiless response without writing anything', async () => {
    const sink = recorder();

    await writeNodeResponse(
      new Response(null, {
        status: 307,
        headers: { location: '/en-us/second' },
      }),
      sink.target,
    );

    expect(sink.status()).toBe(307);
    expect(sink.headers.get('location')).toBe('/en-us/second');
    expect(sink.body()).toBe('');
  });
});

describe('the handler behind a Node listener', () => {
  it('answers the same thing it answers over Fetch', async () => {
    const handler = createLocaleRequestHandler({
      policy: POLICY,
      projection: PROJECTION,
      cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
      cookie: { name: 'equator-locale' },
      render: ({ locale }) =>
        new Response(`<!doctype html><html lang="${locale}"></html>`, {
          headers: { 'content-type': 'text/html' },
        }),
    });
    const sink = recorder();

    await toNodeListener(handler)(
      incoming('/ar-eg/second', { host: 'site.example' }),
      sink.target,
    );

    expect(sink.status()).toBe(200);
    expect(sink.headers.get('content-language')).toBe('ar-EG');
    // A locale's own address under path-prefix carries one answer, so it is shared-cacheable. The
    // entry addresses are the ones that are not, and those are checked in `http-handler.test.ts`.
    expect(sink.headers.get('cache-control')).toBe(
      'public, max-age=600, must-revalidate',
    );
    expect(sink.headers.get('set-cookie')).toStrictEqual([
      expect.stringContaining('equator-locale=ar-EG') as unknown as string,
    ]);
    expect(sink.body()).toContain('lang="ar-EG"');
  });
});

/**
 * `specs/07-routing-rendering-and-seo.spec.md` section 4: an Equator release MUST NOT repair a
 * structurally unsafe target, and section 5 answers one with 400 before presentation routing.
 *
 * The adapter builds a Fetch `Request`, and a URL resolves dot segments and rewrites a backslash as
 * it is constructed, so `/en-us/%2e%2e/%2e%2e/etc/passwd` arrives at a handler written against one
 * as `/etc/passwd`: the address the traversal was aiming at, repaired, with nothing left to
 * classify. What the classifier is given has to be what arrived.
 */
describe('a structurally unsafe target read through the Node adapter', () => {
  const targets = [
    '/en-us/%2e%2e/%2e%2e/etc/passwd',
    '/en-us/../../etc/passwd',
    '/en-us/./second',
    '/en-us/back\\slash',
  ];

  it('answers 400 and asks no renderer', async () => {
    const seen: { target: string; status: number; renders: number }[] = [];

    for (const target of targets) {
      let renders = 0;
      const handler = createLocaleRequestHandler({
        policy: POLICY,
        projection: PROJECTION,
        cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
        cookie: { name: 'equator-locale' },
        render: () => {
          renders += 1;
          return new Response('<!doctype html>');
        },
      });

      const response = await handler(
        toWebRequest(incoming(target), 'http://site.example'),
      );
      seen.push({ target, status: response.status, renders });
    }

    expect(seen).toStrictEqual(
      targets.map((target) => ({ target, status: 400, renders: 0 })),
    );
  });

  it('does not reflect the address the traversal was aiming at', async () => {
    const handler = createLocaleRequestHandler({
      policy: POLICY,
      projection: PROJECTION,
      cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
      cookie: { name: 'equator-locale' },
    });

    const response = await handler(
      toWebRequest(
        incoming('/en-us/%2e%2e/%2e%2e/etc/passwd'),
        'http://site.example',
      ),
    );

    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toBe('');
  });
});

/**
 * The Host header and the target are the client's to write, and a Node listener that rejects ends
 * the process under Node's default for an unhandled rejection. One bad request must not take down
 * the server that answers everyone else.
 */
describe('a request no URL can be built from, read through the Node listener', () => {
  it('answers 400, unstored and unindexed, and asks no renderer', async () => {
    let renders = 0;
    const handler = createLocaleRequestHandler({
      policy: POLICY,
      projection: PROJECTION,
      cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
      cookie: { name: 'equator-locale' },
      render: () => {
        renders += 1;
        return new Response('');
      },
    });
    for (const [url, host] of [
      ['/second', 'a b'],
      ['/second', 'site.example:99999'],
      ['http://[', 'site.example'],
    ] as const) {
      const sink = recorder();

      await toNodeListener(handler)(incoming(url, { host }), sink.target);

      expect(sink.status(), `${host} ${url}`).toBe(400);
      expect(sink.headers.get('cache-control')).toBe('private, no-store');
      expect(sink.headers.get('x-robots-tag')).toBe('noindex');
    }
    expect(renders).toBe(0);
  });

  it('is cached and indexed as the handler answers a malformed target', async () => {
    const handler = createLocaleRequestHandler({
      policy: POLICY,
      projection: PROJECTION,
      cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
    });
    const malformed = await handler(
      new Request('https://site.example/en-us/%zz'),
    );
    const sink = recorder();

    await toNodeListener(handler)(
      incoming('/second', { host: 'a b' }),
      sink.target,
    );

    expect(malformed.status).toBe(sink.status());
    for (const name of ['cache-control', 'x-robots-tag']) {
      expect(sink.headers.get(name), name).toBe(malformed.headers.get(name));
    }
  });
});
