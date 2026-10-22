import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, type Routes } from '@angular/router';
import {
  Localization,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  withRouting,
  type LocaleUrlPolicy,
  withFormattingContext,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { configuration } from '#i18n';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { routePolicy, appRouteProjection } from './localization.routes';
import {
  addressedLocales,
  localeOrigin,
  originRequired,
  pageAddress,
  switchInDocument,
} from './addresses';
import { runtimeExtensions } from './runtime-extensions';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * Where this page lives in every other locale, and who is allowed to know.
 *
 * The switcher's addresses and the head's `hreflang` alternates are one derivation with two
 * readers. The head adds the canonical origin, refuses a page no crawler may index, and collapses
 * two locales that resolve to one URL. The switcher adds none of that, and the case that proves
 * they are genuinely separate is an application that configures no origin at all: it publishes no
 * alternates, because it has no absolute address to publish, and its reader still has somewhere to
 * go.
 *
 * The second case is `en-Latn-XA`. This application configures it and does not address it: a
 * pseudo-locale reachable only by a client-side switch, which is what the policy beside these
 * routes says in as many words. So it is an option with no address at all: the switcher offers it,
 * a reader can switch into it, and there is no link to give them. The other case that produces it
 * is a not-yet-declared slug. A `locale-host` policy is *not* one of them: there the address is
 * on another origin and is published like any other, which `host-policy-switching.spec.ts` covers.
 *
 * The last group in this file is the third case, and it is a property of the address rather than
 * of the locale: an address is offered for a locale only where arriving at it would actually be
 * served that locale. Under the prefix policy above every address passes that, which is why the
 * groups before it do not change.
 */

@Component({
  standalone: true,
  template: `route`,
})
class RouteProbe {}

const routes: Routes = [
  { path: '', component: RouteProbe },
  { path: 'second', component: RouteProbe },
  // The route whose slug is spelled per locale. Every other route in this file is spelled the
  // same way in all three, which is the one shape that cannot tell the last group's rule from
  // the absence of a rule.
  {
    path: 'articles/:slug',
    component: RouteProbe,
    data: { equatorRouteId: 'article', equatorIndexing: 'indexable' },
  },
  { path: '**', component: RouteProbe },
];

/** Three locales sharing one address space, which is the whole of what this policy is. */
const NEUTRAL: LocaleUrlPolicy = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG', 'en-Arab-XB'],
  xDefaultPath: '/',
});

/** The same three locales with a prefix each, so the control below does not depend on the row. */
const PATH_PREFIX: LocaleUrlPolicy = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'en-Arab-XB': 'en-arab-xb' },
  xDefaultPath: '/',
});

const configure = async (
  options: Record<string, unknown>,
  policy: LocaleUrlPolicy = routePolicy,
): Promise<Router> => {
  await TestBed.configureTestingModule({
    providers: [
      provideLocalizedRouter(routes, options),
      provideLocalizationTesting(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        withRouting({
          policy,
          projection: appRouteProjection,
        }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  }).compileComponents();
  return TestBed.inject(Router);
};

const alternates = (): readonly (readonly [string, string])[] =>
  [...document.querySelectorAll('link[rel="alternate"]')]
    .filter((node) => node.getAttribute('hreflang') !== 'x-default')
    .map(
      (node) =>
        [
          node.getAttribute('hreflang') ?? '',
          node.getAttribute('href') ?? '',
        ] as const,
    );

const addresses = (): Readonly<Record<string, string>> =>
  TestBed.inject(Localization).snapshot()?.route?.addresses ?? {};

describe('the address a locale switch moves to', () => {
  beforeEach(() => {
    // The head belongs to the file, not to the test. `DocumentLocalization` rewrites the links it
    // owns, and a test asserting that *no* alternates exist would otherwise be reading the previous
    // test's, which is the one way this file could pass while the feature was broken.
    for (const node of document.querySelectorAll('link[rel="alternate"]')) {
      node.remove();
    }
  });

  it('carries one address per configured locale, agreeing with the head', async () => {
    const router = await configure({ origin: localeOrigin('en-US') });
    await router.navigateByUrl('/second');

    const record = addresses();
    // The addressed locales, which is not every configured locale. Read from the address table
    // rather than derived from the policy this application declares: a check that reads its
    // subject's own source agrees with it however wrong both are.
    expect(Object.keys(record).sort()).toEqual(
      [...addressedLocales('second')].sort(),
    );
    expect(record['en-US']).toBe(pageAddress('second', 'en-US'));

    // Offered without an address. `localeChoices` lists what this application was built with and
    // this record lists what the policy can spell, and the difference is a real option that a
    // reader can select and no link can be written for.
    const choices = TestBed.inject(Localization).localeChoices();
    expect(choices.map(({ locale }) => locale)).toContain('en-Latn-XA');
    expect(record['en-Latn-XA']).toBeUndefined();

    // The tie between the two readers, asserted rather than assumed: the head's absolute URL is
    // this same address on the configured origin. If the two ever derived separately, this is what
    // would catch it.
    expect(alternates()).toEqual(
      Object.entries(record).map(([locale, address]) => [
        locale,
        new URL(address, localeOrigin('en-US')).href,
      ]),
    );
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });

  // A host policy refuses to start without an origin.
  it.skipIf(originRequired)(
    'is published by an application that configures no origin, which publishes no alternates',
    async () => {
      const router = await configure({});
      await router.navigateByUrl('/second');

      // No origin means no absolute address, so there is nothing a crawler can be told and Equator
      // tells it nothing. The reader is not a crawler and still has both addresses.
      expect(alternates()).toEqual([]);
      const record = addresses();
      expect(Object.keys(record).sort()).toEqual(
        [...addressedLocales('second')].sort(),
      );
      expect(record['en-US']).toBe(pageAddress('second', 'en-US'));
    },
  );

  // Where a switch stays in this document. Under locale-host it loads the other origin instead.
  it.runIf(switchInDocument)(
    'follows the locale, because the address it moves to is the one it came from',
    async () => {
      const router = await configure({ origin: localeOrigin('en-US') });
      await router.navigateByUrl('/second');
      const before = addresses();

      await TestBed.inject(Localization).changeLocale('ar-EG');
      TestBed.tick();

      // The same set, from the other side. A switcher rendered after the switch has to offer the way
      // back, and the record is rebuilt for the locale that is now current.
      expect(addresses()).toEqual(before);
      claimCapability('entry:@neolorn/equator', { policy: routePolicy });
    },
  );
});

/**
 * A link is a promise about where following it lands, and under one address space most of them
 * cannot be kept.
 *
 * An `href` on a switcher option exists so the reader can open that locale in a new tab, copy its
 * link, or see where it goes before clicking. All three leave this page behind and arrive as a
 * stranger, carrying nothing about the locale they chose. So an option may only carry an address
 * that serves its locale to a stranger: the same test, and the same function, that decides what
 * the head advertises to a crawler.
 *
 * **The article route is why this group is not vacuous.** Its slug is spelled per locale, so the
 * three locales here fail and pass for three different reasons on one navigation. Every other route
 * in this fixture is spelled alike in all of them, and a test written on one of those would pass
 * with or without this rule.
 *
 * The switch itself is unaffected and is covered by the groups above: an option with no address
 * still switches, in place, which under a neutral policy is the only way a locale is ever chosen.
 */
describe('a link the switcher can keep', () => {
  beforeEach(() => {
    for (const node of document.querySelectorAll('link[rel="alternate"]')) {
      node.remove();
    }
  });

  it('offers an address only for the locale that address is served in', async () => {
    const router = await configure({ origin: 'https://site.example' }, NEUTRAL);
    await router.navigateByUrl('/articles/handbook');

    // One route, three locales, and two survive, each for its own reason.
    //   en-US       is what this address serves a visitor who states no preference.
    //   ar-EG       is `/articles/دليل`, a slug only Arabic spells, so it is the Arabic page.
    //   en-Arab-XB  has no slug of its own, so its address *is* this one, which is English.
    expect(addresses()).toEqual({
      'en-US': '/articles/handbook',
      'ar-EG': `/articles/${encodeURIComponent('دليل')}`,
    });
    claimCapability('policy:locale-neutral', { policy: NEUTRAL });
  });

  it('tells a crawler the same thing it tells a reader', async () => {
    const router = await configure({ origin: 'https://site.example' }, NEUTRAL);
    await router.navigateByUrl('/articles/handbook');

    // The head and the switcher are two readers of one rule, so the interesting assertion is that
    // they agree, not that each is right on its own.
    expect(alternates()).toEqual([
      ['en-US', 'https://site.example/articles/handbook'],
      ['ar-EG', `https://site.example/articles/${encodeURIComponent('دليل')}`],
    ]);
    claimCapability('policy:locale-neutral', { policy: NEUTRAL });
  });

  it('keeps all three where the prefix carries the locale', async () => {
    // The control, on the same route and the same fixture: one policy changed, and the absence
    // above becomes a presence. A rule that dropped every pseudo-locale would satisfy both.
    const router = await configure(
      { origin: 'https://site.example' },
      PATH_PREFIX,
    );
    await router.navigateByUrl('/articles/handbook');

    expect(Object.keys(addresses()).sort()).toEqual([
      'ar-EG',
      'en-Arab-XB',
      'en-US',
    ]);
    expect(alternates().map(([hreflang]) => hreflang)).toEqual([
      'en-US',
      'ar-EG',
      'en-Arab-XB',
    ]);
    claimCapability('policy:path-prefix', { policy: PATH_PREFIX });
  });
});
