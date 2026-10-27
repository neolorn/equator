/**
 * What a page discovers about itself, and whether it reaches the response.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 5 gives two of its three outcome classes
 * facts an address cannot supply: whether the entity an address names is absent, and whether it was
 * permanently removed. Resolution answers neither, so a page that loaded the record declares it, and
 * the declaration travels from the render to the response over the request the two already share.
 *
 * The cases here are the half below Angular: what the channel does, what the handler composes from
 * it, and what it refuses. The declaration is written here the way the Angular service writes it,
 * through `ɵrememberPageOutcome` against the render's own request, so these cases exercise the same
 * channel rather than a stand-in for it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLocaleRequestHandler,
  declarePageOutcome,
  declareOperationalFailure,
  type LocaleRenderer,
} from '../http/src/handler.js';
import {
  pageAbsent,
  pageGone,
  pageOperationalFailure,
  pageOutcomeHttpDescriptor,
  routeHttpDescriptor,
  ɵopenPageOutcomeChannel,
  ɵrememberPageOutcome,
  ɵtakePageOutcome,
  LocalizationError,
  type LocaleUrlPolicy,
  type PageOutcomeDeclaration,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

import { claimCapability } from '../../../tools/capability-claims-in-tests.ts';

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
    identity: 'sha256-DeclaredPageOutcomeTestIdentity012345678901',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
    ],
  },
  localizedPaths: { 'route:second': { 'en-US': 'second', 'ar-EG': 'second' } },
};

const handlerWith = (render: LocaleRenderer) =>
  createLocaleRequestHandler({
    policy: POLICY,
    projection: PROJECTION,
    cache: CACHE,
    cookie: { name: 'equator-locale' },
    render,
  });

/** A page that discovers its own outcome mid-render, which is what the Angular service does. */
const pageDeclares =
  (declaration: PageOutcomeDeclaration): LocaleRenderer =>
  ({ request, locale }) => {
    ɵrememberPageOutcome(request, declaration);
    return new Response(`<!doctype html><html lang="${locale}">page</html>`, {
      headers: { 'content-type': 'text/html' },
    });
  };

/** The control: a render that declares nothing, which is every page that found what it wanted. */
const rendersPage: LocaleRenderer = ({ locale }) =>
  new Response(`<!doctype html><html lang="${locale}">page</html>`, {
    headers: { 'content-type': 'text/html' },
  });

/** What a server answers for a route it leaves to the browser: a document with no page in it. */
const SHELL =
  '<!doctype html><html><head><title>Application</title></head><body><app-root></app-root></body></html>';

const get = (handler: ReturnType<typeof handlerWith>, path: string) =>
  handler(new Request(`https://site.example${path}`));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the channel a declaration travels over', () => {
  it('carries nothing until the handler has opened it', () => {
    const request = new Request('https://site.example/en-us/second');

    // The distinction the whole diagnostic rests on. A render handed a request the handler is not
    // holding declares into nothing, and the response it produces is identical to the response of
    // a render that declared nothing at all.
    expect(ɵrememberPageOutcome(request, pageAbsent())).toBe(false);
    expect(ɵtakePageOutcome(request)).toBeUndefined();
  });

  it('carries a declaration made against the request the handler opened', () => {
    const request = new Request('https://site.example/en-us/second');
    ɵopenPageOutcomeChannel(request);

    expect(ɵrememberPageOutcome(request, pageGone())).toBe(true);
    expect(ɵtakePageOutcome(request)).toEqual({ outcome: 'gone' });
  });

  it('carries a declaration made by another copy of the core entry point', async () => {
    // A server holds two copies: Angular's builder bundles the server entry, where the handler
    // opens and takes, apart from the application, where the page declares. The query gives this
    // import a module instance of its own, as the second bundle does.
    const otherCopy = '../core/src/page-outcome.js?application-bundle';
    const application = (await import(
      /* @vite-ignore */ otherCopy
    )) as typeof import('../core/src/page-outcome.js');
    const request = new Request('https://site.example/en-us/second');
    ɵopenPageOutcomeChannel(request);

    expect(application.ɵrememberPageOutcome(request, pageAbsent())).toBe(true);
    expect(ɵtakePageOutcome(request)).toEqual({ outcome: 'absent' });
  });

  it('gives the declaration to one read and closes', () => {
    const request = new Request('https://site.example/en-us/second');
    ɵopenPageOutcomeChannel(request);
    ɵrememberPageOutcome(request, pageAbsent());

    expect(ɵtakePageOutcome(request)).toEqual({ outcome: 'absent' });
    // Section 5 gives a declaration the render that made it and nothing else, so a second read at
    // the same address finds nothing and a declaration cannot be answered twice.
    expect(ɵtakePageOutcome(request)).toBeUndefined();
  });

  it('refuses a status no response could carry', () => {
    // Refused where it is named rather than where the response is built, so the call that is wrong
    // is the call that fails.
    for (const status of [0, 199, 600, 503.5, Number.NaN, '503', undefined]) {
      let refused: unknown;
      try {
        pageOperationalFailure(status as number);
      } catch (error) {
        refused = error;
      }
      expect(refused, String(status)).toBeInstanceOf(LocalizationError);
      expect(refused, String(status)).toMatchObject({
        diagnostic: {
          code: 'invalid-configuration',
          outcome: 'operational-failure',
          reason: 'malformed-input',
        },
      });
    }
    expect(pageOperationalFailure(503)).toEqual({
      outcome: 'operational-failure',
      status: 503,
    });
  });

  it.each<readonly [unknown, string]>([
    [199, '199'],
    [600, '600'],
    [503.5, '503.5'],
    [Number.NaN, 'NaN'],
    ['503', 'a value of type string'],
    [true, 'a value of type boolean'],
    [null, 'a value of type object'],
    [undefined, 'a value of type undefined'],
  ])(
    'names a number it refuses, and only the kind of anything else: %j',
    (status, said) => {
      let refused: unknown;
      try {
        pageOperationalFailure(status as number);
      } catch (error) {
        refused = error;
      }
      expect((refused as LocalizationError).diagnostic).toStrictEqual({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: `A declared operational failure carries an HTTP status between 200 and 599; received ${said}.`,
        reason: 'malformed-input',
      });
      claimCapability('outcome:pageOperationalFailure');
    },
  );
});

describe('the response a declared outcome produces', () => {
  it('answers an absence with the status the table gives an absent entity', async () => {
    const response = await get(
      handlerWith(pageDeclares(pageAbsent())),
      '/en-us/second',
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('page');
    claimCapability('outcome:pageAbsent', { policy: POLICY });
  });

  it('answers a removal with the status the table gives a permanent removal', async () => {
    const response = await get(
      handlerWith(pageDeclares(pageGone())),
      '/en-us/second',
    );

    expect(response.status).toBe(410);
    claimCapability('outcome:pageGone', { policy: POLICY });
  });

  it('answers an operational failure with the status the application named', async () => {
    const response = await get(
      handlerWith(pageDeclares(pageOperationalFailure(503))),
      '/en-us/second',
    );

    expect(response.status).toBe(503);
    claimCapability('outcome:pageOperationalFailure', { policy: POLICY });
  });

  it('leaves a render that declared nothing exactly as it was', async () => {
    const response = await get(handlerWith(rendersPage), '/en-us/second');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=600, must-revalidate',
    );
    expect(response.headers.get('x-robots-tag')).toBeNull();
  });

  it('keeps the locale the address resolved to', async () => {
    const response = await get(
      handlerWith(pageDeclares(pageAbsent())),
      '/ar-eg/second',
    );

    // The page is missing, not the language. A reader who asked in Arabic is told in Arabic.
    expect(response.headers.get('content-language')).toBe('ar-EG');
    claimCapability('outcome:pageAbsent', { policy: POLICY });
  });

  it('withdraws a missing page from indexing and from shared caches', async () => {
    const served = await get(handlerWith(rendersPage), '/en-us/second');
    const declared = await get(
      handlerWith(pageDeclares(pageAbsent())),
      '/en-us/second',
    );

    expect(served.headers.get('cache-control')).toBe(
      'public, max-age=600, must-revalidate',
    );
    expect(declared.headers.get('cache-control')).toBe('private, no-store');
    expect(declared.headers.get('x-robots-tag')).toBe('noindex');
    claimCapability('outcome:pageAbsent', { policy: POLICY });
  });

  it('does not reach the next request to the same address', async () => {
    const handler = handlerWith(
      (() => {
        let first = true;
        return ({ request, locale }) => {
          if (first) {
            first = false;
            ɵrememberPageOutcome(request, pageAbsent());
          }
          return new Response(`<html lang="${locale}"></html>`, {
            headers: { 'content-type': 'text/html' },
          });
        };
      })(),
    );

    expect((await get(handler, '/en-us/second')).status).toBe(404);
    // A new request is a new key, and the entry the first one used was taken when it was read.
    expect((await get(handler, '/en-us/second')).status).toBe(200);
    claimCapability('outcome:pageAbsent', { policy: POLICY });
  });
});

describe('a declaration at an address Equator did not serve', () => {
  it('leaves the refusal standing and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = handlerWith(pageDeclares(pageOperationalFailure(503)));

    // `/en-us/missing` resolves to `not-found`, which is Equator's own answer about the address.
    // An application declaring maintenance does not know which addresses Equator refused, so the
    // narrower rule holds and the refusal is what the reader gets.
    const first = await handler(
      new Request('https://site.example/en-us/missing'),
    );
    const second = await handler(
      new Request('https://site.example/en-us/other'),
    );

    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('operational failure');
    claimCapability('outcome:pageOperationalFailure', { policy: POLICY });
  });
});

describe('a renderer that states the outcome instead of the page', () => {
  it('declares an absence with a document of its own', async () => {
    const response = await get(
      handlerWith(() =>
        declarePageOutcome(
          pageAbsent(),
          new Response('<html>gone missing</html>', {
            headers: { 'content-type': 'text/html' },
          }),
        ),
      ),
      '/en-us/second',
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('gone missing');
    claimCapability('outcome:declarePageOutcome', { policy: POLICY });
    claimCapability('outcome:pageAbsent', { policy: POLICY });
  });

  /**
   * A route drawn in the browser has no page on the server to declare from, so its renderer
   * declares and sends the application shell. Section 5 of
   * `specs/07-routing-rendering-and-seo.spec.md` has the response carry the declared outcome and
   * the shell arrive as the renderer gave it.
   */
  it('sends the application shell a removal was declared with, as the renderer gave it', async () => {
    const response = await get(
      handlerWith(() =>
        declarePageOutcome(
          pageGone(),
          new Response(SHELL, { headers: { 'content-type': 'text/html' } }),
        ),
      ),
      '/en-us/second',
    );

    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(await response.text()).toBe(SHELL);
    claimCapability('outcome:declarePageOutcome', { policy: POLICY });
  });

  it('sends the application shell a failure was declared with, as the renderer gave it', async () => {
    const response = await get(
      handlerWith(() =>
        declareOperationalFailure(
          new Response(SHELL, {
            status: 503,
            headers: { 'content-type': 'text/html', 'retry-after': '120' },
          }),
        ),
      ),
      '/en-us/second',
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('retry-after')).toBe('120');
    expect(await response.text()).toBe(SHELL);
    claimCapability('outcome:declareOperationalFailure', { policy: POLICY });
  });

  it('declares an outcome with nothing to draw', async () => {
    const response = await get(
      handlerWith(() => declarePageOutcome(pageGone())),
      '/en-us/second',
    );

    expect(response.status).toBe(410);
    expect(await response.text()).toBe('');
    claimCapability('outcome:declarePageOutcome', { policy: POLICY });
    claimCapability('outcome:pageGone', { policy: POLICY });
  });

  it('replaces what the page declared from inside the render', async () => {
    const response = await get(
      handlerWith(({ request }) => {
        ɵrememberPageOutcome(request, pageAbsent());
        return declarePageOutcome(pageOperationalFailure(503));
      }),
      '/en-us/second',
    );

    // The renderer saw the render finish; the component in the middle of it did not.
    expect(response.status).toBe(503);
    claimCapability('outcome:declarePageOutcome', { policy: POLICY });
    claimCapability('outcome:pageOperationalFailure', { policy: POLICY });
  });

  it('declares a plain 503 response as an operational failure', () => {
    const declaration = declareOperationalFailure(
      new Response('maintenance', { status: 503 }),
    );

    expect(declaration.operationalFailure.status).toBe(503);
    expect(declaration.pageOutcome).toEqual({
      outcome: 'operational-failure',
      status: 503,
    });
    claimCapability('outcome:declareOperationalFailure');
  });
});

describe('the descriptor a declaration produces', () => {
  const resolved = routeHttpDescriptor({
    status: 'success',
    locale: 'ar-EG',
    direction: 'rtl',
    routeId: 'route:second',
    parameters: {},
    canonicalPath: 'second',
    query: [],
    indexing: 'indexable',
  });

  it('gives an absence the same classification the table gives a 404', () => {
    const declared = pageOutcomeHttpDescriptor(pageAbsent(), resolved);
    const resolvedMissing = routeHttpDescriptor({
      status: 'not-found',
      httpStatus: 404,
      presentationLocale: 'ar-EG',
    });

    // Asserted against the descriptor rather than restated, so a declared absence and a resolved
    // one cannot drift into two answers for one status.
    expect(declared.status).toBe(resolvedMissing.status);
    expect(declared.cache).toBe(resolvedMissing.cache);
    expect(declared.robots).toBe(resolvedMissing.robots);
    expect(declared.contentLanguage).toBe('ar-EG');
    claimCapability('outcome:pageOutcomeHttpDescriptor');
    claimCapability('outcome:pageAbsent');
  });

  it('leaves the indexing of the address alone for an operational failure', () => {
    const declared = pageOutcomeHttpDescriptor(
      pageOperationalFailure(503),
      resolved,
    );

    // Section 12 lets a declaration narrow an indexing class and not widen one, and a failure
    // states nothing about whether the address should be indexed: it states that this render did
    // not produce the page.
    expect(declared.status).toBe(503);
    expect(declared.cache).toBe('private-no-store');
    expect(declared.robots).toBeUndefined();
    claimCapability('outcome:pageOutcomeHttpDescriptor');
    claimCapability('outcome:pageOperationalFailure');
  });

  // Section 12 lets a declaration narrow an indexing class and never widen one. The class is a
  // property of the address, so a page that could raise it could publish an address, or links from
  // one, that the application withheld.
  const closed = (indexing: 'non-indexable' | 'private') =>
    routeHttpDescriptor({
      status: 'success',
      locale: 'ar-EG',
      direction: 'rtl',
      routeId: 'route:second',
      parameters: {},
      canonicalPath: 'second',
      query: [],
      indexing,
    });
  const declarations = [
    pageAbsent(),
    pageGone(),
    pageOperationalFailure(503),
  ] as const;
  const robotsDeclared = (indexing: 'non-indexable' | 'private') =>
    declarations.map(
      (declaration) =>
        pageOutcomeHttpDescriptor(declaration, closed(indexing)).robots,
    );

  it('makes no address indexable that its route keeps out of indexing', () => {
    for (const indexing of ['non-indexable', 'private'] as const) {
      expect(robotsDeclared(indexing)).not.toContain(undefined);
    }
  });

  it('keeps a private route private whatever its page declares', () => {
    expect(robotsDeclared('private')).toStrictEqual([
      'noindex, nofollow',
      'noindex, nofollow',
      'noindex, nofollow',
    ]);
    expect(robotsDeclared('non-indexable')).toStrictEqual([
      'noindex',
      'noindex',
      'noindex',
    ]);
  });

  it('keeps how the language was chosen, which the status does not change', () => {
    const negotiated = routeHttpDescriptor({
      status: 'success',
      locale: 'ar-EG',
      direction: 'rtl',
      routeId: 'route:second',
      parameters: {},
      canonicalPath: 'second',
      query: [],
      indexing: 'indexable',
      variesBy: 'locale-preference',
    });

    for (const declaration of [pageAbsent(), pageOperationalFailure(503)]) {
      const declared = pageOutcomeHttpDescriptor(declaration, negotiated);
      expect(declared).toMatchObject({
        cache: 'private-no-store',
        contentLanguage: 'ar-EG',
        variesBy: 'locale-preference',
      });
      expect(pageOutcomeHttpDescriptor(declaration, resolved).variesBy).toBe(
        undefined,
      );
    }
    claimCapability('outcome:pageOutcomeHttpDescriptor');
  });
});
