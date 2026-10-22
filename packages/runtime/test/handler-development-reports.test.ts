import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLocaleRequestHandler,
  declareOperationalFailure,
  declarePageOutcome,
  type LocaleRenderer,
  type LocaleRequestHandler,
} from '../http/src/handler.js';
import {
  pageAbsent,
  pageGone,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * What the request handler tells a developer, and how often.
 *
 * Two things a renderer does cannot be put right by the response alone: it drew nothing where a
 * page was asked for, or it declared an outcome at an address Equator had already refused, where
 * section 5 of `specs/07-routing-rendering-and-seo.spec.md` lets the refusal stand. Each is said
 * once per handler for each distinct thing there is to say, because the addresses are supplied by
 * whoever is asking, and neither is said in production.
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
    identity: 'sha256-HandlerDevelopmentReportsTestIdentity012345',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
    ],
  },
  localizedPaths: { 'route:second': { 'en-US': 'second', 'ar-EG': 'second' } },
};

const handlerWith = (render: LocaleRenderer): LocaleRequestHandler =>
  createLocaleRequestHandler({
    policy: POLICY,
    projection: PROJECTION,
    cache: CACHE,
    cookie: false,
    render,
  });

const get = (handler: LocaleRequestHandler, path: string): Promise<Response> =>
  handler(new Request(`https://site.example${path}`));

const drawsNothing: LocaleRenderer = () => new Response(null);

const quietly = () =>
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

/** The text of each report, in the order it was written. */
const reports = (warn: ReturnType<typeof quietly>): string[] =>
  warn.mock.calls.map(([message]) => String(message));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a render that drew nothing where a page was asked for', () => {
  it('is reported, naming the address', async () => {
    const warn = quietly();

    const response = await get(handlerWith(drawsNothing), '/ar-eg/second');

    expect(response.status).toBe(500);
    expect(reports(warn)).toHaveLength(1);
    expect(reports(warn)[0]).toContain('"/ar-eg/second"');
  });

  it('is reported once by a handler, however many addresses arrive', async () => {
    const warn = quietly();
    const handler = handlerWith(drawsNothing);

    await get(handler, '/ar-eg/second');
    await get(handler, '/en-us/second');
    await get(handler, '/ar-eg/second');

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is reported by each handler for itself', async () => {
    const warn = quietly();

    await get(handlerWith(drawsNothing), '/ar-eg/second');
    await get(handlerWith(drawsNothing), '/ar-eg/second');

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('is not reported in production, and is still answered 500', async () => {
    const warn = quietly();
    vi.stubEnv('NODE_ENV', 'production');

    const response = await get(handlerWith(drawsNothing), '/ar-eg/second');

    expect(response.status).toBe(500);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is not what a page with content is, or a missing page with none', async () => {
    const warn = quietly();

    await get(
      handlerWith(() => new Response('<!doctype html>')),
      '/ar-eg/second',
    );
    await get(handlerWith(drawsNothing), '/ar-eg/nothing-here');

    expect(warn).not.toHaveBeenCalled();
  });

  it('is reported after a declaration at a refused address has been', async () => {
    // The two reports are remembered apart, so having said one does not stand for the other.
    const warn = quietly();
    const handler = handlerWith(({ resolution }) =>
      resolution.status === 'success'
        ? new Response(null)
        : declarePageOutcome(pageAbsent(), new Response('<!doctype html>')),
    );

    await get(handler, '/ar-eg/nothing-here');
    await get(handler, '/ar-eg/second');
    await get(handler, '/ar-eg/nothing-here');
    await get(handler, '/ar-eg/second');

    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('where the handler runs', () => {
  // The entry point runs on hosts that have no `process`, and on ones whose `process` carries no
  // environment. Either is a host that never said it is production.
  const hosts: readonly [string, unknown][] = [
    ['no process at all', undefined],
    ['a process with no environment', {}],
    ['an environment that names no mode', { env: {} }],
  ];

  it('reports as in development on a host that does not say it is production', async () => {
    for (const [what, host] of hosts) {
      const warn = quietly();
      const handler = handlerWith(drawsNothing);
      const request = new Request('https://site.example/ar-eg/second');

      // Stubbed for the one call and restored before anything is asserted, because the runner
      // reads `process` too.
      vi.stubGlobal('process', host);
      let response: Response;
      try {
        response = await handler(request);
      } finally {
        vi.unstubAllGlobals();
      }

      expect(response.status, what).toBe(500);
      expect(warn, what).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    }
  });
});

describe('a declaration at an address Equator refused', () => {
  const declaring =
    (declared: () => ReturnType<LocaleRenderer>): LocaleRenderer =>
    () =>
      declared();
  const absent = declaring(() => declarePageOutcome(pageAbsent()));
  const gone = declaring(() => declarePageOutcome(pageGone()));
  const failing = (status: number) =>
    declaring(() =>
      declareOperationalFailure(new Response('maintenance', { status })),
    );

  it('is reported once for each outcome declared', async () => {
    const warn = quietly();
    let next: LocaleRenderer = absent;
    const handler = handlerWith((outcome) => next(outcome));

    await get(handler, '/ar-eg/nothing-here');
    await get(handler, '/ar-eg/also-nothing');
    expect(warn).toHaveBeenCalledTimes(1);

    next = gone;
    await get(handler, '/ar-eg/nothing-here');
    await get(handler, '/ar-eg/also-nothing');
    expect(warn).toHaveBeenCalledTimes(2);

    next = absent;
    await get(handler, '/ar-eg/nothing-here');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('is reported once for each status a failure declared', async () => {
    const warn = quietly();
    let next: LocaleRenderer = failing(503);
    const handler = handlerWith((outcome) => next(outcome));

    await get(handler, '/ar-eg/nothing-here');
    await get(handler, '/ar-eg/also-nothing');
    expect(warn).toHaveBeenCalledTimes(1);

    next = failing(500);
    await get(handler, '/ar-eg/nothing-here');
    expect(warn).toHaveBeenCalledTimes(2);

    next = failing(503);
    await get(handler, '/ar-eg/nothing-here');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('says which outcome was declared, differently for each', async () => {
    const said: string[] = [];
    for (const render of [absent, gone, failing(503)]) {
      const warn = quietly();
      await get(handlerWith(render), '/ar-eg/nothing-here');
      said.push(...reports(warn));
      warn.mockRestore();
    }

    expect(said).toHaveLength(3);
    expect(new Set(said).size).toBe(3);
    // Each report names what was declared, the address and the refusal that stood.
    for (const report of said) {
      expect(report).not.toContain('undefined');
      expect(report).toContain('"/ar-eg/nothing-here"');
      expect(report).toContain('"not-found"');
      expect(report).toContain('404');
    }
  });
});
