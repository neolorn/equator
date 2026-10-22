import { describe, expect, it } from 'vitest';

import type { LocaleRequestHandler } from '../http/src/handler.js';
import {
  toNodeListener,
  toWebRequest,
  writeNodeResponse,
  type NodeRequestLike,
  type NodeResponseLike,
} from '../http/src/node.js';
import { rawTargetOf } from '../http/src/raw-target.js';

/**
 * What the Node adapter reads off a request and which headers it sets on a response.
 *
 * The response target is a structural interface, so a host other than Node's own `ServerResponse`
 * sees every call made on it. The calls are what is recorded here, in order, rather than the
 * headers left standing after them.
 */

type HeaderCall = readonly [string, number | string | readonly string[]];

function recorder(): {
  readonly target: NodeResponseLike;
  readonly calls: HeaderCall[];
} {
  const calls: HeaderCall[] = [];
  const target: NodeResponseLike = {
    statusCode: 0,
    setHeader(name, value) {
      calls.push([name, value]);
    },
    write: () => true,
    end: () => undefined,
  };
  return { target, calls };
}

describe('reading a Node request as a Fetch request', () => {
  it('leaves out a header Node reports as absent', () => {
    // Node's header record is typed with `undefined` members, and a host that builds one by hand
    // writes them.
    const message: NodeRequestLike = {
      method: 'GET',
      url: '/',
      headers: { cookie: undefined, 'accept-language': 'ar-EG' },
    };

    const request = toWebRequest(message, 'http://site.example');

    expect(request.headers.has('cookie')).toBe(false);
    expect(request.headers.get('accept-language')).toBe('ar-EG');
  });

  it('keeps the method the request arrived with', () => {
    const request = toWebRequest(
      { method: 'HEAD', url: '/', headers: {} },
      'http://site.example',
    );

    expect(request.method).toBe('HEAD');
  });

  it('reads a request with no method or target as a GET for the root', () => {
    const request = toWebRequest({ headers: {} }, 'http://site.example');

    expect(request.method).toBe('GET');
    expect(request.url).toBe('http://site.example/');
    // The target the handler screens is the one recorded, so an absent one is recorded as the
    // root it was read as.
    expect(rawTargetOf(request)).toBe('/');
  });
});

describe('writing a Fetch response onto a Node response', () => {
  it('sets Set-Cookie once, as the list of cookies', async () => {
    const response = new Response(null, { status: 204 });
    response.headers.append('set-cookie', 'a=1; Path=/');
    response.headers.append('set-cookie', 'b=2; Path=/');
    response.headers.set('content-language', 'ar-EG');
    const { target, calls } = recorder();

    await writeNodeResponse(response, target);

    expect(calls).toEqual([
      ['content-language', 'ar-EG'],
      ['set-cookie', ['a=1; Path=/', 'b=2; Path=/']],
    ]);
    expect(target.statusCode).toBe(204);
  });

  it('sets no Set-Cookie on a response that carries no cookie', async () => {
    const response = new Response(null, {
      status: 204,
      headers: { 'content-language': 'ar-EG' },
    });
    const { target, calls } = recorder();

    await writeNodeResponse(response, target);

    expect(calls).toEqual([['content-language', 'ar-EG']]);
  });
});

describe('the origin a Node listener builds a request on', () => {
  const seen = async (message: NodeRequestLike): Promise<string> => {
    let address = '';
    const handler: LocaleRequestHandler = (request) => {
      address = request.url;
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    await toNodeListener(handler)(message, recorder().target);
    return address;
  };

  it('is the local host when the request names none', async () => {
    expect(await seen({ url: '/second', headers: {} })).toBe(
      'http://localhost/second',
    );
  });

  it('is the local host when Host arrived more than once', async () => {
    expect(
      await seen({
        url: '/second',
        headers: { host: ['a.example', 'b.example'] },
      }),
    ).toBe('http://localhost/second');
  });

  it('is the Host header when it arrived once', async () => {
    expect(
      await seen({ url: '/second', headers: { host: 'site.example' } }),
    ).toBe('http://site.example/second');
  });
});

describe('a request no URL can be built from', () => {
  it('is answered unstored and unindexed, with nothing said about negotiation', async () => {
    const { target, calls } = recorder();
    const handler: LocaleRequestHandler = () =>
      Promise.reject(new Error('the handler was asked'));

    await toNodeListener(handler)(
      { url: '/', headers: { host: 'bad host' } },
      target,
    );

    expect(target.statusCode).toBe(400);
    expect(calls).toEqual([
      ['cache-control', 'private, no-store'],
      ['x-robots-tag', 'noindex'],
    ]);
  });
});
