import { describe, expect, it } from 'vitest';

import { LocationStrategy } from '@angular/common';
import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, TitleStrategy } from '@angular/router';
import {
  Localization,
  buildLocalizedRoute,
  withRouting,
  withFormattingContext,
} from '@neolorn/equator';
import {
  LocalizedTitleStrategy,
  RouteLocalization,
  provideLocalizedRouter,
} from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { routes } from './app.routes';
import { runtimeExtensions } from './runtime-extensions';
import { provideDynamicContent } from './dynamic-content';
import { routePolicy, appRouteProjection } from './localization.routes';
import {
  localeInAddress,
  localeOrigin,
  pageAddress,
  pagePath,
  pageUrl,
  switchInDocument,
} from './addresses';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * A slug the codec cannot translate, supplied by the page that loaded it.
 *
 * `RouteParameterCodec.serialize` is synchronous, so it can answer for a slug that is a function of
 * its value and cannot answer for one held in a database. `dossiers/:slug` is the second kind: its
 * codec is identity, so left alone Equator advertises the English slug under the Arabic prefix. An
 * address that resolves and is not Arabic. The route's component loads the record and declares the
 * per-locale spellings, and Equator uses them for the canonical URL, the alternates and the address
 * a locale switch moves to.
 *
 * **Two parameterised routes sharing a parameter name, deliberately.** `articles/:slug` is answered
 * by a codec and `dossiers/:slug` by a declaration. With only one of them, "the declaration was
 * read" and "the codec was read" produce the same output on every assertion here.
 */

const ARABIC = 'ar-EG';

/**
 * A host with an outlet, because this file needs the page's own code to run.
 *
 * The other document specs never render anything: they assert what Equator writes to the head, and
 * Equator writes it from the resolver. Here the declaration comes from the route's component, and a
 * component is constructed by change detection rather than by navigation. Without a rendered
 * outlet nothing declares and every assertion below reads the codec's answer.
 */
@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

async function configure(): Promise<Router> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [
      provideLocalizedRouter(routes, { origin: localeOrigin('en-US') }),
      provideLocalizationTesting(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        withRouting({ policy: routePolicy, projection: appRouteProjection }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
      { provide: TitleStrategy, useClass: LocalizedTitleStrategy },
      // The article route's component needs it. This file renders pages rather than only reading
      // the head, so the application's own providers have to be here too.
      provideDynamicContent(),
    ],
  }).compileComponents();
  await TestBed.inject(Localization).initialize();
  TestBed.createComponent(RootHost);
  return TestBed.inject(Router);
}

/**
 * Let the page render, the record load, and the head follow it.
 *
 * Three things have to interleave and they alternate: change detection constructs the component,
 * the component's load resolves on a microtask, and the head is rebuilt by an effect that needs
 * another change detection. Ticking once and awaiting once covers none of it.
 *
 * Microtasks and ticks only, no timers and no wall-clock, so this waits for work that is
 * already queued rather than for an amount of time. The counts are loose on purpose: pinning the
 * exact number of hops would make this file a measurement of the harness rather than of Equator.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    TestBed.tick();
    for (let hop = 0; hop < 3; hop += 1) await Promise.resolve();
  }
  TestBed.tick();
}

const alternate = (hreflang: string): string | null =>
  document
    .querySelector(`link[rel="alternate"][hreflang="${hreflang}"]`)
    ?.getAttribute('href') ?? null;

const canonical = (): string | null =>
  document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;

// Where an address states its locale, so the Arabic spelling is an address of its own.
describe.runIf(localeInAddress)(
  'a route parameter whose spelling only the page knows',
  () => {
    it('advertises the declared spelling, which the codec could not have produced', async () => {
      // The control, measured rather than argued. This is what Equator emits for the Arabic address
      // of this route with nothing declared: the English slug, because identity is all the codec has.
      expect(
        buildLocalizedRoute(
          routePolicy,
          appRouteProjection,
          'dossier',
          ARABIC,
          {
            slug: 'dossier',
          },
        ),
      ).toBe(pageAddress('dossier', ARABIC));

      const router = await configure();
      await router.navigateByUrl('/dossiers/dossier');
      await settle();

      expect(alternate(ARABIC)).toBe(pageUrl('declared dossier', ARABIC));
      expect(alternate('en-US')).toBe(pageUrl('declared dossier', 'en-US'));
      expect(canonical()).toBe(pageUrl('declared dossier', 'en-US'));
      claimCapability('entry:@neolorn/equator', { policy: routePolicy });
    });

    it('does not carry one page’s declaration onto the next', async () => {
      // The trap this design prevents, in its exact documented shape: two routes with the same
      // parameter name, visited in sequence. A declaration held in one mutable record keyed by
      // parameter name would spell the article's Arabic address with the dossier's slug, and tell a
      // crawler the two are translations of each other.
      const router = await configure();
      await router.navigateByUrl('/dossiers/dossier');
      await settle();
      expect(alternate(ARABIC)).toBe(pageUrl('declared dossier', ARABIC));

      await router.navigateByUrl('/articles/handbook');
      await settle();
      expect(canonical()).toBe(pageUrl('article', 'en-US'));
      expect(alternate(ARABIC)).toBe(pageUrl('article', ARABIC));
    });

    it('does not carry a declaration onto a page of the same route that has none', async () => {
      // Sharper than the case above, because everything else is held constant: same route, same
      // parameter, same codec. The only difference is that this record is not in the store, so
      // nothing declares, and the answer has to fall back to the codec rather than to whatever was
      // declared last.
      const router = await configure();
      await router.navigateByUrl('/dossiers/dossier');
      await settle();

      await router.navigateByUrl('/dossiers/unlisted-dossier');
      await settle();
      expect(canonical()).toBe(pageUrl('unlisted dossier', 'en-US'));
      expect(alternate(ARABIC)).toBe(pageUrl('unlisted dossier', ARABIC));

      // And the address bar, which has its own path to the declaration and so its own way to serve
      // a stale one. `prepareExternalUrl` is what `Location.replaceState` funnels through when the
      // locale switch moves the address, and this page has no declaration to move it to. Only where
      // the switch stays in this document.
      if (switchInDocument) {
        await TestBed.inject(Localization).changeLocale(ARABIC);
        await settle();
        expect(
          TestBed.inject(LocationStrategy).prepareExternalUrl(router.url),
        ).toBe(pagePath('unlisted dossier', ARABIC));
      }
      claimCapability('entry:@neolorn/equator', { policy: routePolicy });
    });

    // Where the switch stays in this document. Under locale-host it loads the other origin instead.
    it.runIf(switchInDocument)(
      'moves the locale switch to the declared address',
      async () => {
        // The reason a sitemap is not an answer. A crawler can be told about the Arabic address in a
        // file; a reader pressing العربية has to arrive at it, and a locale switch is not a navigation:
        // Equator rebuilds the address for the target locale, and that rebuild is where the
        // declaration has to be read.
        const router = await configure();
        await router.navigateByUrl('/dossiers/dossier');
        await settle();

        await TestBed.inject(Localization).changeLocale(ARABIC);
        await settle();
        expect(canonical()).toBe(pageUrl('declared dossier', ARABIC));
        expect(alternate('en-US')).toBe(pageUrl('declared dossier', 'en-US'));
        // The address the reader is actually taken to, not only the one the head claims.
        expect(
          TestBed.inject(LocationStrategy).prepareExternalUrl(router.url),
        ).toBe(pagePath('declared dossier', ARABIC));
        // And the page is now holding the Arabic spelling, which is the same thing it would hold had
        // the reader arrived at the Arabic address directly. A switched page that kept the previous
        // language's parameter would be in a state no fresh visit can produce, and the next thing to
        // read the parameter, a component looking the record up, would get an answer that depends
        // on how the reader got here.
        expect(
          TestBed.inject(RouteLocalization).context()?.resolution.parameters,
        ).toEqual({ slug: 'ملف' });
        claimCapability('entry:@neolorn/equator', { policy: routePolicy });
        claimCapability('entry:@neolorn/equator/router', {
          policy: routePolicy,
        });
      },
    );
  },
);

describe('an internal address spelled with another locale’s parameter', () => {
  it('arrives at the canonical address, as a document request for it does', async () => {
    // The home page links the Arabic sheet by its Arabic spelling. A server reads that address as
    // the canonical one and says so with a correction; a navigation that kept the spelling would
    // show the page a parameter no document request for it can produce.
    const router = await configure();
    await router.navigateByUrl('/exercise/مباشر');
    await settle();

    expect(router.url).toBe('/exercise/live');
    expect(
      TestBed.inject(RouteLocalization).context()?.resolution.parameters,
    ).toEqual({ sheet: 'live' });
    const platform = TestBed.inject(PLATFORM_ID) as string;
    claimCapability('entry:@neolorn/equator/router', {
      policy: routePolicy,
      platform,
    });
    claimCapability('declaration:route-parameter-codec', {
      policy: routePolicy,
      platform,
    });
  });
});
