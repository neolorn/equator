import { describe, expect, it } from 'vitest';

import {
  createLocaleRequestHandler,
  type LocaleRequestHandlerOptions,
} from '@neolorn/equator/http';
import { configuration } from '#i18n';

import { expectedPageCaching, pageUrl } from './addresses';
import { localeCookie } from './locale-cookie';
import { appRouteProjection, routePolicy } from './localization.routes';
import { responseCaching } from './response-caching';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

/**
 * The floor this deployment declares for every page, answered by a handler given what `server.ts`
 * gives its own.
 *
 * Runs where the address table says the row declares one. The expectation is the table's and the
 * declaration is `response-caching.ts`'s, so a floor removed from the declaration fails here rather
 * than turning this off.
 */
describe.runIf(expectedPageCaching !== undefined)(
  'the floor this deployment declares for every page',
  () => {
    const answer = createLocaleRequestHandler({
      policy: routePolicy,
      projection: appRouteProjection,
      configuration,
      cache: responseCaching,
      cookie: localeCookie,
      render: () =>
        new Response('<!doctype html>', {
          headers: { 'content-type': 'text/html' },
        }),
    });

    it('raises a page and leaves a redirect as routing classified it', async () => {
      const page = await answer(new Request(pageUrl('second', 'en-US')));
      const replaced = await answer(
        new Request(`${pageUrl('legacy', 'en-US')}?tab=one`),
      );

      // The floor the answers show is the one the declaration makes, so a floor missing from it
      // fails by name rather than as a header.
      expect(responseCaching?.pageCaching).toBe(expectedPageCaching);
      expect(page.status).toBe(200);
      expect(page.headers.get('cache-control')).toBe(
        expectedPageCaching === 'not-stored'
          ? 'private, no-store'
          : 'private, no-cache',
      );
      // A redirect carries no page, so the floor does not reach it.
      expect(replaced.status).toBe(308);
      expect(replaced.headers.get('cache-control')).toBe(
        'public, max-age=86400',
      );
      claimCapability('declaration:host-page-floor', { policy: routePolicy });
    });
  },
);

/**
 * A floor declared here for every row, whatever its deployment declares.
 *
 * `not-stored`, the higher of the two levels, so a page every policy classifies differently on its
 * own is raised to the same answer by each, and a redirect still keeps the one routing gave it.
 */
describe('a floor declared for every page, under any policy', () => {
  it('raises a page and leaves a redirect as routing classified it', async () => {
    const answer = createLocaleRequestHandler({
      policy: routePolicy,
      projection: appRouteProjection,
      configuration,
      cache: { ...responseCaching, pageCaching: 'not-stored' },
      cookie: localeCookie,
      render: () =>
        new Response('<!doctype html>', {
          headers: { 'content-type': 'text/html' },
        }),
    });
    const page = await answer(new Request(pageUrl('second', 'en-US')));
    const replaced = await answer(
      new Request(`${pageUrl('legacy', 'en-US')}?tab=one`),
    );

    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('private, no-store');
    expect(replaced.status).toBe(308);
    expect(replaced.headers.get('cache-control')).toBe('public, max-age=86400');
    claimCapability('declaration:host-page-floor', { policy: routePolicy });
  });
});

/**
 * A deployment that lets a cache serve a stale success without asking again, declared here for
 * every row whatever its deployment declares.
 *
 * No cookie is read, so an address every locale shares is answered per language from
 * `Accept-Language` and a shared cache may keep each variant: every policy has a shared success
 * for the declaration to reach.
 */
describe('a success a cache may serve stale, under any policy', () => {
  it('leaves must-revalidate off a shared success and nothing else', async () => {
    const answerWith = (
      cache: LocaleRequestHandlerOptions['cache'],
    ): ((request: Request) => Promise<Response>) =>
      createLocaleRequestHandler({
        policy: routePolicy,
        projection: appRouteProjection,
        configuration,
        cache,
        cookie: false,
        render: () =>
          new Response('<!doctype html>', {
            headers: { 'content-type': 'text/html' },
          }),
      });
    const durations = { successMaxAge: 600, permanentRedirectMaxAge: 86_400 };
    const asked = await answerWith(durations)(
      new Request(pageUrl('second', 'en-US')),
    );
    const stale = answerWith({ ...durations, revalidateSuccess: false });
    const page = await stale(new Request(pageUrl('second', 'en-US')));
    const replaced = await stale(
      new Request(`${pageUrl('legacy', 'en-US')}?tab=one`),
    );

    expect(asked.status).toBe(200);
    expect(asked.headers.get('cache-control')).toBe(
      'public, max-age=600, must-revalidate',
    );
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('public, max-age=600');
    // A permanent redirect is not a success, so the declaration leaves it as it was.
    expect(replaced.status).toBe(308);
    expect(replaced.headers.get('cache-control')).toBe('public, max-age=86400');
    claimCapability('declaration:RouteCacheDurations.revalidateSuccess', {
      policy: routePolicy,
    });
  });
});
