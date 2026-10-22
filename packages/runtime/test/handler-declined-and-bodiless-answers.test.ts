import { describe, expect, it } from 'vitest';

import {
  createLocaleRequestHandler,
  declarePageOutcome,
  type LocaleRequestHandlerOptions,
} from '../http/src/handler.js';
import {
  pageAbsent,
  type GeneratedConfiguration,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What the request handler answers on its own, and what it hands on.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 4 orders the steps: the target is validated,
 * then a locale-neutral root reaches its owner, then presentation routing. Section 5 keeps the
 * status Equator's and the body the renderer's, so a deployment with no renderer still gets the
 * status and the headers, and a renderer's own headers travel with its document.
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
    identity: 'sha256-HandlerDeclinedAnswersTestIdentity012345678',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
    ],
  },
  localizedPaths: { 'route:second': { 'en-US': 'second', 'ar-EG': 'second' } },
};

const PAGE = '<!doctype html><html></html>';

const handlerWith = (options: Partial<LocaleRequestHandlerOptions> = {}) =>
  createLocaleRequestHandler({
    policy: POLICY,
    projection: PROJECTION,
    cache: CACHE,
    ...options,
  });

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://site.example${path}`, { headers });

/** What the handler reported deciding, without the two objects it was handed. */
interface Decided {
  readonly status: string;
  readonly locale: string | undefined;
  readonly declared: unknown;
  readonly carried: boolean;
  readonly declined: boolean;
}

const deciding = async (
  path: string,
  options: Partial<LocaleRequestHandlerOptions> = {},
): Promise<{ response: Response; decided: readonly Decided[] }> => {
  const decided: Decided[] = [];
  const response = await handlerWith({
    ...options,
    ɵobserve: ({ resolution, locale, declared, carried, declined }) =>
      decided.push({
        status: resolution.status,
        locale,
        declared,
        carried,
        declined,
      }),
  })(request(path));
  return { response, decided };
};

describe('an address the handler declines to localize', () => {
  it('is handed to the passthrough as the request that arrived, under a neutral root or as a dotted file', async () => {
    for (const path of ['/assets/logo', '/main-A1B2C3.js', '/en-us/site.css']) {
      const arrived = request(path);
      const handed: Request[] = [];
      const response = await handlerWith({
        render: () => new Response(PAGE),
        passthrough: (declined) => {
          handed.push(declined);
          return new Response('file', { status: 203 });
        },
      })(arrived);

      expect(handed, path).toStrictEqual([arrived]);
      expect(handed[0], path).toBe(arrived);
      expect(response.status, path).toBe(203);
      expect(await response.text(), path).toBe('file');
    }
  });

  it('answers 404 with nothing of its own where there is no passthrough', async () => {
    const response = await handlerWith({ render: () => new Response(PAGE) })(
      request('/main-A1B2C3.js'),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-language')).toBeNull();
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it('is not an address whose last segment merely has no dot', async () => {
    const handed: string[] = [];
    const response = await handlerWith({
      render: () => new Response(PAGE),
      passthrough: (declined) => {
        handed.push(declined.url);
        return new Response('file');
      },
    })(request('/en-us/second'));

    expect(handed).toStrictEqual([]);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(PAGE);
  });

  it('is reported as declined, with no locale and nothing carried', async () => {
    const { decided } = await deciding('/assets/logo');

    expect(decided).toStrictEqual([
      {
        status: 'not-found',
        locale: undefined,
        declared: undefined,
        carried: false,
        declined: true,
      },
    ]);
  });

  it('is refused first where its target is malformed, and never reaches the passthrough', async () => {
    for (const path of ['/assets/%zz', '/en-us/%zz.js', '/assets//logo.png']) {
      const handed: string[] = [];
      const response = await handlerWith({
        passthrough: (declined) => {
          handed.push(declined.url);
          return new Response('file');
        },
      })(request(path));

      expect(response.status, path).toBe(400);
      expect(await response.text(), path).toBe('');
      expect(handed, path).toStrictEqual([]);
    }
  });
});

describe('a handler with no renderer', () => {
  it('answers a page address with its status and headers and no body', async () => {
    const response = await handlerWith()(request('/ar-eg/second'));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-language')).toBe('ar-EG');
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=600, must-revalidate',
    );
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it('answers a missing page the same way', async () => {
    const response = await handlerWith()(request('/ar-eg/nothing-here'));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('reports the locale it settled, and nothing declared, carried or declined', async () => {
    const page = await deciding('/ar-eg/second');
    const entry = await deciding('/second');

    expect(page.decided).toStrictEqual([
      {
        status: 'success',
        locale: 'ar-EG',
        declared: undefined,
        carried: false,
        declined: false,
      },
    ]);
    expect(entry.response.status).toBe(307);
    expect(entry.decided).toStrictEqual([
      {
        status: 'redirect',
        locale: 'en-US',
        declared: undefined,
        carried: false,
        declined: false,
      },
    ]);
  });
});

describe('a handler with a renderer', () => {
  it('reports the locale the renderer was told to draw in', async () => {
    const drawn: string[] = [];
    const { decided } = await deciding('/ar-eg/second', {
      render: ({ locale }) => {
        drawn.push(locale);
        return new Response(PAGE);
      },
    });

    expect(drawn).toStrictEqual(['ar-EG']);
    expect(decided).toStrictEqual([
      {
        status: 'success',
        locale: 'ar-EG',
        declared: undefined,
        carried: false,
        declined: false,
      },
    ]);
  });

  it("keeps the renderer's own cookies beside the locale cookie", async () => {
    const response = await handlerWith({
      render: () => {
        const headers = new Headers({ 'content-type': 'text/html' });
        headers.append('set-cookie', 'session=one; Path=/; HttpOnly');
        headers.append('set-cookie', 'cart=two; Path=/');
        return new Response(PAGE, { headers });
      },
    })(request('/ar-eg/second'));

    expect(response.headers.getSetCookie()).toStrictEqual([
      'session=one; Path=/; HttpOnly',
      'cart=two; Path=/',
      'equator-locale=ar-EG; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    ]);
    expect(response.headers.get('content-type')).toBe('text/html');
  });

  it("replaces the renderer's statement of a field Equator decides", async () => {
    const response = await handlerWith({
      render: () =>
        new Response(PAGE, {
          headers: {
            'content-language': 'fr-FR',
            'x-robots-tag': 'all',
            'cache-control': 'max-age=60',
          },
        }),
    })(request('/ar-eg/nothing-here'));

    expect(response.status).toBe(404);
    expect(response.headers.get('content-language')).toBe('ar-EG');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('the request a renderer is handed', () => {
  const handedFor = async (
    path: string,
    headers: Record<string, string>,
  ): Promise<{ arrived: Request; handed: Request | undefined }> => {
    const arrived = request(path, headers);
    let handed: Request | undefined;
    await handlerWith({
      render: (outcome) => {
        handed = outcome.request;
        return new Response(PAGE);
      },
    })(arrived);
    return { arrived, handed };
  };

  it('is the request that arrived, at a page and at a missing page that carried no precondition', async () => {
    for (const path of ['/ar-eg/second', '/ar-eg/nothing-here']) {
      const { arrived, handed } = await handedFor(path, { 'x-trace': 'one' });
      expect(handed, path).toBe(arrived);
    }
  });

  it('carries no precondition at a missing page, whichever single one arrived', async () => {
    const preconditions = {
      'if-match': '"page-1"',
      'if-none-match': '"page-1"',
      'if-modified-since': 'Tue, 01 Sep 2026 00:00:00 GMT',
      'if-unmodified-since': 'Tue, 01 Sep 2026 00:00:00 GMT',
      'if-range': '"page-1"',
    };
    for (const [name, value] of Object.entries(preconditions)) {
      const { handed } = await handedFor('/ar-eg/nothing-here', {
        [name]: value,
        'x-trace': 'one',
      });

      expect(handed?.headers.has(name), name).toBe(false);
      // The rest of the request is what arrived.
      expect(handed?.headers.get('x-trace'), name).toBe('one');
      expect(handed?.url, name).toBe('https://site.example/ar-eg/nothing-here');
    }
  });
});

describe('the build configuration a handler is given', () => {
  const configurationFor = (
    locales: readonly string[],
  ): GeneratedConfiguration => ({
    generatedAbi: 'equator-generated/1',
    sourceLocale: 'en-US',
    defaultLocale: 'en-US',
    locales,
    aliases: {},
    applicationContractFingerprint: 'sha256-application-contract-fixture',
    semanticRegistryFingerprint: 'sha256-semantic-registry-fixture',
    scopes: [],
  });

  const statusWith = async (
    configuration: GeneratedConfiguration | undefined,
  ): Promise<number> =>
    (
      await handlerWith({
        ...(configuration === undefined ? {} : { configuration }),
        render: () => new Response(PAGE),
      })(request('/ar-eg/second'))
    ).status;

  it('withdraws the addresses of a locale the policy names and the build does not have', async () => {
    expect(await statusWith(configurationFor(['en-US']))).toBe(404);
    // The same policy and address with the locale built, and with no configuration to narrow by.
    expect(await statusWith(configurationFor(['en-US', 'ar-EG']))).toBe(200);
    expect(await statusWith(undefined)).toBe(200);
  });

  it('stops a cookie naming such a locale from choosing it', async () => {
    const entry = await handlerWith({
      configuration: configurationFor(['en-US']),
    })(request('/second', { cookie: 'equator-locale=ar-EG' }));

    expect(entry.status).toBe(307);
    expect(entry.headers.get('location')).toBe('/en-us/second');
  });
});

describe('an outcome a renderer declares', () => {
  it('carries a response only where the renderer drew one', () => {
    const absent = pageAbsent();
    const drawn = new Response(PAGE);

    expect(declarePageOutcome(absent)).toStrictEqual({ pageOutcome: absent });
    expect('response' in declarePageOutcome(absent)).toBe(false);
    expect(declarePageOutcome(absent, drawn).response).toBe(drawn);
  });
});
