import { describe, expect, it } from 'vitest';

import { resolveLocalizedRoute, routeHttpDescriptor } from '@neolorn/equator';

import { routePolicy, appRouteProjection } from './localization.routes';
import { entryRedirects } from './addresses';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

/**
 * The one place a path-prefix policy has to decide a locale for itself.
 *
 * Under `/en-us` and `/ar-eg` prefixes the URL says which locale it wants, and Equator obeys it.
 * The exception is a URL with no prefix: `/`, or a link someone typed without one. That request
 * states no locale, so something has to choose, and `resolveLocalizedRoute` already accepted a
 * resolution context for exactly that purpose.
 *
 * It then dropped it. `resolveLocalizedRoute` passed the context to the locale-neutral branch and
 * not to the prefix branch, so a request resolved to `ar-EG` produced the byte-identical redirect
 * to `/en-us` as a request that resolved to nothing at all. Every visitor landed in English and
 * then had to switch by hand.
 *
 * The second half is cacheability, which follows from the first. One address carries every
 * locale's answer under one cache key, so every answer is this visitor's alone, and a browser that
 * keeps one asks again before reusing it, so a preference that has changed is followed.
 */

describe.runIf(entryRedirects)('a URL that states no locale', () => {
  it('sends the visitor to the locale the request resolved to', () => {
    expect(
      resolveLocalizedRoute('/', routePolicy, appRouteProjection, {
        locale: 'ar-EG',
      }),
    ).toEqual({
      status: 'redirect',
      reason: 'locale-entry',
      httpStatus: 307,
      cache: 'private-no-cache',
      locale: 'ar-EG',
      routeId: 'route:_index',
      location: '/ar-eg',
    });
    claimCapability('policy:path-prefix', { policy: routePolicy });
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });

  it('builds the destination in that locale, not merely under its prefix', () => {
    // The article slug is locale-specific: `handbook` in English, `دليل` in Arabic.
    // Prefixing the English segments would produce `/ar-eg/articles/handbook`, which is not
    // that route's Arabic URL, so the visitor would arrive and be redirected a second time, or land
    // on a 404. The destination has to be built in the destination's own locale.
    const resolution = resolveLocalizedRoute(
      '/articles/handbook',
      routePolicy,
      appRouteProjection,
      { locale: 'ar-EG' },
    );

    expect(resolution).toMatchObject({
      status: 'redirect',
      reason: 'locale-entry',
      locale: 'ar-EG',
      routeId: 'article',
    });
    if (resolution.status !== 'redirect') return;
    expect(resolution.location).toBe(
      `/ar-eg/articles/${encodeURIComponent('دليل')}`,
    );
    claimCapability('policy:path-prefix', { policy: routePolicy });
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });

  it('keeps query and fragment across the redirect', () => {
    const resolution = resolveLocalizedRoute(
      '/second?tab=one#details',
      routePolicy,
      appRouteProjection,
      { locale: 'ar-EG' },
    );

    if (resolution.status !== 'redirect')
      throw new Error('expected a redirect');
    expect(resolution.location).toBe('/ar-eg/second?tab=one#details');
    claimCapability('policy:path-prefix', { policy: routePolicy });
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });

  it('falls back to the default locale when the preference is not supported', () => {
    // A preference is not a request. The URL `/` is perfectly valid, and answering 404 for a
    // site's home page because somebody's language tag was unusable is the worse failure by a
    // wide margin; the locale-neutral policy 404s here because there the tag *is* the request.
    const resolution = resolveLocalizedRoute(
      '/',
      routePolicy,
      appRouteProjection,
      {
        locale: 'xx-ZZ',
      },
    );

    expect(resolution).toMatchObject({
      status: 'redirect',
      locale: 'en-US',
      location: '/en-us',
    });
    claimCapability('policy:path-prefix', { policy: routePolicy });
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });
});

describe.runIf(entryRedirects)('a URL that states its locale', () => {
  it('ignores the preference entirely', () => {
    // The prefix is the visitor's stated intent: a shared link, a bookmark, a search result. A
    // preference must never override it, or nobody can send anybody a link.
    expect(
      resolveLocalizedRoute('/en-us/second', routePolicy, appRouteProjection, {
        locale: 'ar-EG',
      }),
    ).toMatchObject({
      status: 'success',
      locale: 'en-US',
      routeId: 'route:second',
    });
    claimCapability('policy:path-prefix', { policy: routePolicy });
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });
});

describe.runIf(entryRedirects)('what the redirect may be cached as', () => {
  /**
   * One address, two answers, one cache key.
   *
   * `/` states no locale. Which locale it sends a visitor to depends on a preference the cache
   * cannot see, and a cache key is the target URI unless the stored response names a varying
   * header. So the answer a preference produced and the answer it did not are one entry as far as
   * any shared cache is concerned. Marking either of them public authorises handing one visitor's
   * language to the next; marking only the other one private prevents nothing, because that request
   * is answered from the cache and never reaches this function.
   *
   * `Vary` is not the way out. Equator is never given the request, the host reads the preference
   * and passes a locale in, so Equator cannot name the header that varied. For a cookie-borne
   * preference `private` is the right answer regardless.
   *
   * `no-cache` rather than `no-store`: nothing in a locale redirect is sensitive, and a browser
   * that must revalidate before every reuse already follows a changed preference.
   *
   * These pinned the opposite until 6.1, on the argument that a redirect that consulted nothing is
   * the same answer for every visitor. It is. That was never the question: it shares an address
   * with the redirects that are not.
   */
  it('is never publicly cacheable, with or without a preference', () => {
    expect(
      resolveLocalizedRoute('/', routePolicy, appRouteProjection),
    ).toMatchObject({ cache: 'private-no-cache', locale: 'en-US' });

    // Including the case that looks safest: `en-US` in, `en-US` out, an answer byte-identical to
    // the one above, and still not one a shared cache may hand to somebody else.
    expect(
      resolveLocalizedRoute('/', routePolicy, appRouteProjection, {
        locale: 'en-US',
      }),
    ).toMatchObject({ cache: 'private-no-cache', locale: 'en-US' });
    claimCapability('policy:path-prefix', { policy: routePolicy });
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });

  it('carries the directive through to the HTTP descriptor', () => {
    const constant = resolveLocalizedRoute(
      '/',
      routePolicy,
      appRouteProjection,
    );
    const negotiated = resolveLocalizedRoute(
      '/',
      routePolicy,
      appRouteProjection,
      { locale: 'ar-EG' },
    );

    expect(routeHttpDescriptor(constant)).toMatchObject({
      status: 307,
      location: '/en-us',
      cache: 'private-no-cache',
    });
    expect(routeHttpDescriptor(negotiated)).toMatchObject({
      status: 307,
      location: '/ar-eg',
      cache: 'private-no-cache',
    });

    // The control, so this pins locale entry rather than the descriptor being private about
    // everything. A canonical correction is the same answer for every request that reaches it
    // (the address is what is wrong, and no preference can change that) so it stays cacheable, and
    // for as long as the deployment says.
    expect(
      routeHttpDescriptor(
        resolveLocalizedRoute('/EN-US/second', routePolicy, appRouteProjection),
      ),
    ).toMatchObject({ status: 308, cache: 'consumer-defined-permanent' });
    claimCapability('policy:path-prefix', { policy: routePolicy });
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });

  /**
   * Every case above uses an address this application serves. Locale entry is for those: the page
   * exists in some locale and the address has not said which.
   *
   * An address that no locale serves has no page to send the visitor to, and spec 07 section 15
   * answers it with a 404 where it stands, in the default locale, whatever the request prefers.
   * The application's own `**` route renders it, because an address Equator cannot place is handed
   * to the router unchanged.
   */
  it('answers an address with no page where it stands, in the default locale', () => {
    for (const context of [undefined, { locale: 'ar-EG' }]) {
      expect(
        resolveLocalizedRoute(
          '/nothing-is-mounted-here',
          routePolicy,
          appRouteProjection,
          context,
        ),
      ).toEqual({
        status: 'not-found',
        httpStatus: 404,
        presentationLocale: 'en-US',
      });
    }
    claimCapability('policy:path-prefix', { policy: routePolicy });
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });

  it('leaves a prefixed address that has no page to answer as a not-found', () => {
    // The counterpart. Once the address states its locale, it is answered in that locale.
    expect(
      resolveLocalizedRoute(
        '/ar-eg/nothing-is-mounted-here',
        routePolicy,
        appRouteProjection,
      ),
    ).toMatchObject({
      status: 'not-found',
      httpStatus: 404,
      presentationLocale: 'ar-EG',
    });
    claimCapability('policy:path-prefix', { policy: routePolicy });
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });
});
