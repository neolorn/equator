import { describe, expect, it, vi } from 'vitest';

import { Injectable, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationEnd,
  Router,
  TitleStrategy,
  type RouterStateSnapshot,
} from '@angular/router';
import {
  Localization,
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
import { routePolicy, appRouteProjection } from './localization.routes';
import { localeInPath, localeOrigin, pagePath } from './addresses';

/**
 * Who writes `document.title` last, in both of the configurations an application can be in.
 *
 * Angular emits `NavigationEnd` and then calls `titleStrategy.updateTitle(...)` synchronously in
 * the same `tap` (`@angular/router` 22.2.1, `NavigationTransitions.setupNavigations`). Equator
 * writes the title from its own subscriber to that event, so Angular's strategy always writes
 * afterwards. `DefaultTitleStrategy` writes whenever the route tree declares a title
 * (`updateTitle`), and `app.routes.ts` declares one, in English, on `second`.
 *
 * So the failure this file is written against is not "Equator's provider is missing". It is
 * "another string replaced the localized title and nothing said so", and every assertion here reads
 * the document rather than the injector for that reason: a check on
 * `inject(TitleStrategy) instanceof LocalizedTitleStrategy` is green for a strategy that is
 * installed and does the wrong thing. What Equator *reports* about the token is the other file,
 * `localized-router-diagnostics.spec.ts`.
 */

/** What Equator projects, per locale. Both differ from the route's declared title. */
const TITLE_EN = 'Equator feature lab';
const TITLE_AR = 'مختبر ميزات Equator';
const DECLARED_TITLE = 'Second route, declared in English';

const OPTIONS = {
  // Named because a host policy refuses to start without one.
  origin: localeOrigin('en-US'),
  document: ({ resolution }: { resolution: { locale: string } }) => ({
    title: resolution.locale === 'ar-EG' ? TITLE_AR : TITLE_EN,
  }),
} as const;

/**
 * The application's providers, with the one line under test present or absent.
 *
 * Absent means absent: no `TitleStrategy` entry at all, which is the configuration a consumer who
 * never read the diagnostic is in. Angular then resolves the token through its own root factory to
 * `DefaultTitleStrategy`, so this is the real omission rather than a substitution standing in for
 * one.
 */
/** The title the strategy under test left in the document, read as each call to it returns. */
const leftByTheStrategy: string[] = [];

/** Equator's strategy, with the document read in the statement after it has written. */
@Injectable()
class ObservedTitleStrategy extends LocalizedTitleStrategy {
  override updateTitle(snapshot: RouterStateSnapshot): void {
    super.updateTitle(snapshot);
    leftByTheStrategy.push(document.title);
  }
}

/** A title per route, so the page a navigation left and the one it reached never share one. */
const BY_ROUTE = {
  origin: OPTIONS.origin,
  document: ({ resolution }: { resolution: { routeId: string } }) => ({
    title: `Projected for ${resolution.routeId}`,
  }),
} as const;

async function bootstrap(
  titleStrategy: 'installed' | 'omitted' | Type<TitleStrategy>,
  address = '/second',
  options: Parameters<typeof provideLocalizedRouter>[1] = OPTIONS,
): Promise<{
  readonly atNavigationEnd: string;
  readonly afterNavigation: string;
}> {
  TestBed.resetTestingModule();
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
        withRouting({ policy: routePolicy, projection: appRouteProjection }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
      ...(titleStrategy === 'omitted'
        ? []
        : [
            {
              provide: TitleStrategy,
              useClass:
                titleStrategy === 'installed'
                  ? LocalizedTitleStrategy
                  : titleStrategy,
            },
          ]),
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  await TestBed.inject(Localization).initialize();

  // One navigation before the one under test, and it is not throat-clearing.
  //
  // `RouteLocalization` subscribes to `router.events` in its constructor, and nothing constructs it
  // until the first navigation's resolver injects it. So on a first navigation a subscriber added
  // here is registered *before* Equator's and runs before it, and the reading below would be the
  // order this test happened to subscribe in rather than the order the application runs in.
  // Measured: without this line the title reads as empty at `NavigationEnd` in every
  // configuration, which says nothing about who wrote it.
  await router.navigateByUrl('/');

  // Read at two points, because which one is read is the difference between seeing this defect and
  // not. A subscriber to `NavigationEnd` runs *before* `updateTitle`: Angular emits the event and
  // calls the strategy in that order inside one `tap`, so at that instant the title is still the
  // one Equator wrote, in every configuration.
  let atNavigationEnd = '';
  const subscription = router.events.subscribe((event) => {
    if (event instanceof NavigationEnd) atNavigationEnd = document.title;
  });
  try {
    await router.navigateByUrl(address);
  } finally {
    subscription.unsubscribe();
  }
  return { atNavigationEnd, afterNavigation: document.title };
}

describe('who writes the document title after a navigation', () => {
  it('keeps the projected title when Equator’s strategy is installed', async () => {
    const { afterNavigation } = await bootstrap('installed');
    expect(afterNavigation).toBe(TITLE_EN);
    expect(afterNavigation).not.toBe(DECLARED_TITLE);
  });

  it('writes the title of the page the navigation reached, not of the one it left', async () => {
    // What pins the order the strategy relies on: Equator's subscriber has applied the incoming
    // page's document by the time Angular calls `updateTitle`. Were the document applied any
    // later, the strategy would read the projection of the page left and write its title here.
    leftByTheStrategy.length = 0;
    const { atNavigationEnd, afterNavigation } = await bootstrap(
      ObservedTitleStrategy,
      '/second',
      BY_ROUTE,
    );

    expect(leftByTheStrategy[0]).toBe('Projected for route:_index');
    expect(atNavigationEnd).toBe('Projected for route:second');
    expect(leftByTheStrategy.at(-1)).toBe('Projected for route:second');
    expect(afterNavigation).toBe('Projected for route:second');

    // And nothing that finishes later moves it.
    expect((await TestBed.inject(RouteLocalization).settled()).status).toBe(
      'committed',
    );
    expect(document.title).toBe('Projected for route:second');
  });

  it('writes the declared title where Equator projects none for the route', async () => {
    // No `document` callback and no declared metadata, so the head Equator projects carries no
    // title and the strategy is left with the one the route declares, as Angular's own would be.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Emptied first, so the title read afterwards is the one this navigation wrote.
    document.title = '';
    try {
      const { afterNavigation } = await bootstrap('installed', '/second', {
        origin: OPTIONS.origin,
      });
      expect(afterNavigation).toBe(DECLARED_TITLE);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('loses the projected title to the declared one when the line is omitted', async () => {
    // The defect, observed rather than inferred. Not "the provider is missing": the page is
    // serving the route's hardcoded string in place of the one Equator resolved for this locale.
    const { afterNavigation } = await bootstrap('omitted');
    expect(afterNavigation).toBe(DECLARED_TITLE);
  });

  it('shows why the assertion point matters', async () => {
    // The first of the two mutations this pair covers. Both configurations agree at
    // `NavigationEnd` and disagree immediately after it, so an assertion placed in a
    // `NavigationEnd` handler is green for the omitted case: a check that exists and proves
    // nothing.
    const omitted = await bootstrap('omitted');
    expect(omitted.atNavigationEnd).toBe(TITLE_EN);
    expect(omitted.afterNavigation).toBe(DECLARED_TITLE);

    const installed = await bootstrap('installed');
    expect(installed.atNavigationEnd).toBe(TITLE_EN);
    expect(installed.afterNavigation).toBe(TITLE_EN);
  });

  /**
   * The same test, against a prefixed address.
   *
   * Without an address-translating strategy, `navigateByUrl('/ar-eg/second')` consults no
   * `LocationStrategy`, so a prefixed address matches against a locale branch: an entry carrying
   * only the route's target, with the declared `title` nowhere on it. `DefaultTitleStrategy` finds
   * nothing to write, and the localized title survives the omitted configuration *by accident*,
   * which is a false green rather than anything good.
   *
   * `LocalizedUrlHandlingStrategy` delocalizes the address before matching, so both addresses reach
   * the same route, carrying the same declared title, and the two configurations diverge here
   * exactly as they do above. The assertion is therefore the same one, and that sameness is the
   * point: the path a caller took is not a variable.
   */
  it.runIf(localeInPath)(
    'is exercised by a prefixed address, which reaches the declared title',
    async () => {
      const prefixed = pagePath('second', 'ar-EG');
      const omitted = await bootstrap('omitted', prefixed);
      expect(omitted.afterNavigation).toBe(DECLARED_TITLE);

      const installed = await bootstrap('installed', prefixed);
      expect(installed.afterNavigation).toBe(TITLE_EN);
    },
  );
});
