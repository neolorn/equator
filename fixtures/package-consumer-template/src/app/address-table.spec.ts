import { describe, expect, it } from 'vitest';

import {
  buildLocalizedRoute,
  resolveLocalizedRoute,
  type RouteResolution,
} from '@neolorn/equator';

import {
  addressedLocales,
  claimRunningPolicy,
  expectedLocaleNeutralRoots,
  expectedXDefault,
  localeOrigin,
  pageAddress,
  tablePolicy,
} from './addresses';
import { appRouteProjection, routePolicy } from './localization.routes';

/**
 * The address table against the application it describes.
 *
 * Every other spec that expects an address reads it from the table, so a wrong entry would be
 * wrong in all of them at once and could be wrong in the same direction as Equator. This is the
 * one place each entry is held to what the running policy does with it, in both directions: an
 * address the table lists resolves to its page in its locale, and a locale the table leaves out
 * has no address that selects it.
 */

const locales = ['en-US', 'ar-EG', 'en-Arab-XB'] as const;

/** The route each page is. */
const routed = {
  home: 'route:_index',
  second: 'route:second',
  lazy: 'route:lazy',
  deferred: 'route:deferred',
  'drawn sheet': 'route:drawn-sheet',
  item: 'item',
  'withdrawn item': 'item',
  'unreachable item': 'item',
  article: 'article',
  topic: 'topic',
  'unfiled topic': 'topic',
  'retired topic': 'topic',
  'unavailable topic': 'topic',
  dossier: 'dossier',
  'withdrawn dossier': 'dossier',
  'unreachable dossier': 'dossier',
} as const;

/**
 * The item each item page names: one the browser draws as it is, and two the server answers for
 * before the browser draws anything.
 */
const items = {
  item: 42,
  'withdrawn item': 410,
  'unreachable item': 503,
} as const;

/**
 * The slug each dossier page names: one the store holds, and two the server answers for before it
 * renders, once it has asked the store.
 */
const dossiers = {
  dossier: 'dossier',
  'withdrawn dossier': 'withdrawn-dossier',
  'unreachable dossier': 'unreachable-dossier',
} as const;

/**
 * The topic each topic page names: one that is filed, and three the page declares an outcome for
 * once it has looked the topic up.
 */
const topics = {
  topic: 'handbook',
  'unfiled topic': 'unfiled-topic',
  'retired topic': 'retired-topic',
  'unavailable topic': 'unavailable-topic',
} as const;

type RoutedPage = keyof typeof routed;

/** Each page built through its own call, so every parameter is checked against its route. */
const build = (page: RoutedPage, locale: string): string => {
  switch (page) {
    case 'home':
      return buildLocalizedRoute(
        routePolicy,
        appRouteProjection,
        'route:_index',
        locale,
      );
    case 'second':
      return buildLocalizedRoute(
        routePolicy,
        appRouteProjection,
        'route:second',
        locale,
      );
    case 'lazy':
      return buildLocalizedRoute(
        routePolicy,
        appRouteProjection,
        'route:lazy',
        locale,
      );
    case 'deferred':
      return buildLocalizedRoute(
        routePolicy,
        appRouteProjection,
        'route:deferred',
        locale,
      );
    case 'drawn sheet':
      return buildLocalizedRoute(
        routePolicy,
        appRouteProjection,
        'route:drawn-sheet',
        locale,
      );
    case 'item':
    case 'withdrawn item':
    case 'unreachable item':
      return buildLocalizedRoute(
        routePolicy,
        appRouteProjection,
        'item',
        locale,
        { id: items[page] },
      );
    case 'article':
      return buildLocalizedRoute(
        routePolicy,
        appRouteProjection,
        'article',
        locale,
        { slug: 'handbook' },
      );
    case 'topic':
    case 'unfiled topic':
    case 'retired topic':
    case 'unavailable topic':
      return buildLocalizedRoute(
        routePolicy,
        appRouteProjection,
        'topic',
        locale,
        { topic: topics[page] },
      );
    case 'dossier':
    case 'withdrawn dossier':
    case 'unreachable dossier':
      return buildLocalizedRoute(
        routePolicy,
        appRouteProjection,
        'dossier',
        locale,
        { slug: dossiers[page] },
      );
  }
};

const resolve = (address: string): RouteResolution =>
  resolveLocalizedRoute(address, routePolicy, appRouteProjection);

describe('the address table', () => {
  it('was written for the policy this application runs', () => {
    const running =
      routePolicy.kind === 'path-prefix' && routePolicy.omitDefaultPrefix
        ? 'default-locale-prefix'
        : routePolicy.kind;
    expect(tablePolicy).toBe(running);
  });

  it.each(Object.keys(routed) as RoutedPage[])(
    'spells %s as Equator writes it, in every locale it lists',
    (page) => {
      const listed = addressedLocales(page);
      expect(listed.length).toBeGreaterThan(0);
      for (const locale of listed) {
        const address = pageAddress(page, locale);
        expect(build(page, locale)).toBe(address);
        expect(resolve(address)).toMatchObject({
          status: 'success',
          locale,
          routeId: routed[page],
        });
      }
      // The other direction. Equator writes an address for every locale, and where that address
      // gives a stranger another locale it is not this locale's address, so the table must not
      // list it and nothing may advertise it.
      for (const locale of locales.filter((each) => !listed.includes(each))) {
        const arrival = resolve(build(page, locale));
        expect(
          arrival.status === 'success' ? arrival.locale : arrival.status,
        ).not.toBe(locale);
      }
      claimRunningPolicy();
    },
  );

  it('sends a retired spelling to its replacement in the same locale', () => {
    for (const locale of addressedLocales('legacy')) {
      expect(resolve(pageAddress('legacy', locale))).toMatchObject({
        status: 'redirect',
        reason: 'replacement',
        location: pageAddress('second', locale),
      });
    }
  });

  it('points x-default where the policy declares it', () => {
    const declared =
      routePolicy.kind === 'locale-host'
        ? routePolicy.xDefaultUrl
        : routePolicy.xDefaultPath;
    expect(
      declared === undefined
        ? undefined
        : new URL(declared, localeOrigin(routePolicy.defaultLocale)).href,
    ).toBe(expectedXDefault);
  });

  it('spells the second page under every alias the policy accepts', () => {
    // An alias names a locale, so the table lists one address for each aliased locale, and a policy
    // without aliases lists none.
    const aliased =
      routePolicy.kind === 'path-prefix'
        ? Object.values(routePolicy.aliases)
        : [];
    expect([...addressedLocales('second under an alias')].sort()).toEqual(
      [...aliased].sort(),
    );
    for (const locale of addressedLocales('second under an alias')) {
      expect(
        resolve(pageAddress('second under an alias', locale)),
      ).toMatchObject({
        status: 'redirect',
        location: pageAddress('second', locale),
      });
    }
  });

  it('leaves the roots the policy declares to whatever serves them', () => {
    expect(routePolicy.localeNeutralRoots).toEqual(expectedLocaleNeutralRoots);
  });

  it('answers a removed page, and a page that never existed, in the locale of the address', () => {
    for (const locale of addressedLocales('removed')) {
      expect(resolve(pageAddress('removed', locale))).toMatchObject({
        status: 'gone',
        presentationLocale: locale,
      });
    }
    for (const locale of addressedLocales('missing')) {
      expect(resolve(pageAddress('missing', locale))).toMatchObject({
        status: 'not-found',
        presentationLocale: locale,
      });
    }
  });
});
