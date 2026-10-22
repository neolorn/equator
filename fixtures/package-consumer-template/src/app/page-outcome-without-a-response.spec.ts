import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationRef, PLATFORM_ID, REQUEST } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { pageAbsent, pageOperationalFailure } from '@neolorn/equator/core';
import { createLocaleRequestHandler } from '@neolorn/equator/http';
import { LocalizedPageOutcome } from '@neolorn/equator/router';
import { configuration } from '#i18n';

import { pageUrl } from './addresses';
import { appRouteProjection, routePolicy } from './localization.routes';
import { responseCaching } from './response-caching';

/**
 * A page declaring what it turned out to be, on a server render its declaration cannot reach.
 *
 * Section 5 of `specs/07-routing-rendering-and-seo.spec.md` has two such renders. One answers a
 * request the handler never opened a channel for, which is a wiring fault that produces exactly the
 * response a page declaring nothing produces, so it is reported rather than left to look correct.
 * The other answers no request at all, because it is rendering ahead of one, and a page it wrote
 * would be served afterwards as a successful one: the build fails and the render ends as failed.
 *
 * The service is taken on its own, with the server's platform and the request a render is given,
 * because what is asserted is what it does with a declaration and not how a page arrives at one.
 */

function onServer(request: Request | null): LocalizedPageOutcome {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: REQUEST, useValue: request },
    ],
  });
  return TestBed.inject(LocalizedPageOutcome);
}

const DETACHED = /is not the one the Equator request handler is answering/u;

describe('a declaration against a request the handler is not holding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is reported during development, once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const outcome = onServer(new Request('https://site.example/topics/x'));

    outcome.declare(pageAbsent());
    outcome.declare(pageAbsent());

    expect(
      warn.mock.calls.filter(([message]) => DETACHED.test(String(message))),
    ).toHaveLength(1);
  });

  it('is not reported where the handler opened the channel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The render is handed the request the handler opened a channel for, which is the request a
    // server render's page receives.
    const answer = createLocaleRequestHandler({
      policy: routePolicy,
      projection: appRouteProjection,
      configuration,
      cache: responseCaching,
      render: ({ request }) => {
        onServer(request).declare(pageAbsent());
        return new Response('<!doctype html>', {
          headers: { 'content-type': 'text/html' },
        });
      },
    });

    const response = await answer(new Request(pageUrl('second', 'en-US')));

    expect(response.status).toBe(404);
    expect(
      warn.mock.calls.filter(([message]) => DETACHED.test(String(message))),
    ).toHaveLength(0);
  });
});

describe('a declaration while rendering ahead of a request', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails the build for either arm, and ends the render as one that failed', () => {
    for (const declaration of [pageAbsent(), pageOperationalFailure(503)]) {
      const outcome = onServer(null);
      // Held, because what is asserted is that the render is ended, and a destroyed test
      // application cannot be torn down after it.
      const destroy = vi
        .spyOn(TestBed.inject(ApplicationRef), 'destroy')
        .mockImplementation(() => undefined);

      expect(() => outcome.declare(declaration)).toThrow(
        /while rendering ahead of a request/u,
      );
      expect(destroy).toHaveBeenCalledTimes(1);
    }
  });
});
