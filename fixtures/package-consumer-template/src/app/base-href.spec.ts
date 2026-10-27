import { afterEach, describe, expect, it } from 'vitest';

import { APP_BASE_HREF, Location, PlatformLocation } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import {
  LocaleChoice,
  Localization,
  applicationBaseHref,
  withRouting,
  type LocaleSelectorChoice,
  withFormattingContext,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { runtimeExtensions } from './runtime-extensions';
import { routes } from './app.routes';
import { routePolicy, appRouteProjection } from './localization.routes';
import { localeInPath, localeOrigin, pagePath, pageUrl } from './addresses';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

/**
 * An application deployed under a sub-path, which is `https://example.com/app` rather than
 * `https://example.com`.
 *
 * The browser puts that sub-path in front of every address it hands the application, and it is in
 * none of the addresses Equator builds: a locale URL policy addresses routes from the application's
 * own root, and knows nothing about where that root is mounted. So every surface that reads an
 * address has to take the base off first, and every surface that writes one has to put it back.
 *
 * **The Router half always did this and locale resolution did not, which is the worst shape a
 * defect of this kind can have.** `LocalizedLocationStrategy` strips the base before delocalizing,
 * so the route matched, the component rendered and the address bar was correct. The locale was read
 * from `document.location` with the base still on it, `/app/ar-eg/second` begins with a segment
 * no policy names, so it fell back to the default. An Arabic address served an English page, and
 * every signal an application could check said the navigation had gone fine.
 *
 * The group is written as one difference at a time. The same arrival is made three ways (under a
 * `<base href>`, under `APP_BASE_HREF`, and under no base at all) and only the base changes
 * between them. The third is how every other spec in this fixture runs, so it is the control that
 * says these assertions are about the sub-path rather than about the address.
 *
 * The trailing slash is deliberate in the second: `<base href="/app/">` is the spelling Angular's
 * documentation uses, and `provideLocalizedRouter` is given `/app/` there and `/app` here.
 */

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

afterEach(() => {
  history.replaceState(null, '', '/');
});

interface Deployment {
  /** What the Router matched, which is base-free and locale-free. */
  readonly routerUrl: string;
  /** What the address bar says, which carries both. */
  readonly address: string;
  readonly locale: string | undefined;
  readonly view: string | null;
  readonly localization: Localization;
  readonly router: Router;
  readonly platform: PlatformLocation;
  readonly location: Location;
}

/**
 * A browser-supplied arrival at an application mounted under `base`.
 *
 * Both halves of the address are set, and the pair is load-bearing: `MockPlatformLocation` is what
 * the `LocationStrategy` reads, and jsdom's `history` is what Equator's `url` locale source reads.
 * Setting one and not the other leaves the Router and the committed locale disagreeing for a reason
 * that has nothing to do with what is under test.
 */
async function arriveAt(
  startUrl: string,
  base: { readonly dom?: string; readonly token?: string },
): Promise<Deployment> {
  history.replaceState(null, '', new URL(startUrl).pathname);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: {
          startUrl,
          ...(base.dom === undefined ? {} : { appBaseHref: base.dom }),
        },
      },
      ...(base.token === undefined
        ? []
        : [{ provide: APP_BASE_HREF, useValue: base.token }]),
      provideLocalizedRouter(routes, { origin: localeOrigin('ar-EG') }),
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
    ],
  });

  const localization = TestBed.inject(Localization);
  await localization.initialize();
  const router = TestBed.inject(Router);
  const fixture = TestBed.createComponent(RootHost);
  const platform = TestBed.inject(PlatformLocation);

  const settled = firstValueFrom(
    router.events.pipe(
      filter(
        (event) =>
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError,
      ),
    ),
  );
  router.initialNavigation();
  await settled;
  TestBed.tick();

  const rendered: HTMLElement | null =
    fixture.nativeElement.querySelector('[data-route-view]');
  return Object.freeze({
    routerUrl: router.url,
    address: platform.pathname + platform.search + platform.hash,
    locale: localization.snapshot()?.primaryLocale,
    view: rendered === null ? null : rendered.getAttribute('data-route-view'),
    localization,
    router,
    platform,
    location: TestBed.inject(Location),
  });
}

/** A page's address with the application mounted at `/app`. */
const underApp = (page: 'home' | 'second', locale: string): string =>
  `/app${pagePath(page, locale)}`;

/** The same, absolute. */
const urlUnderApp = (page: 'home' | 'second', locale: string): string =>
  new URL(underApp(page, locale), localeOrigin(locale)).href;

// Functions rather than constants, because a policy with no Arabic address skips this file and
// reading the table at load would fail it instead.
const arabicUnderApp = (): string => urlUnderApp('second', 'ar-EG');
const arabic = (): string => pageUrl('second', 'ar-EG');

/** Read out of the document, because that is where a crawler reads it. */
const canonical = (): string | null =>
  document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;

const alternate = (hreflang: string): string | null =>
  document
    .querySelector(`link[rel="alternate"][hreflang="${hreflang}"]`)
    ?.getAttribute('href') ?? null;

/**
 * The two ways an application turns a snapshot address into something clickable.
 *
 * `localeChoice` writes an `href` itself, and `routerLink` hands the address to the Router and
 * lets the `LocationStrategy` prepare it. Both are rendered from the same snapshot so the pair is a
 * check on the contract rather than on one consumer of it: its addresses are application-rooted,
 * each of these mounts one exactly once, and if the snapshot were mounted instead the `routerLink`
 * would come out with the sub-path twice.
 *
 * The `routerLink` is given the address of the locale on screen, because the Router navigates in
 * that locale. Where the default locale's address carries no prefix, the Router reads it as this
 * page in the locale on screen, so a switcher address is not something to hand it.
 */
@Component({
  standalone: true,
  imports: [LocaleChoice, RouterLink],
  template: `<a [localeChoice]="choice()" data-role="choice">switch</a>
    <a [routerLink]="address()" data-role="link">link</a>`,
})
class ChoiceHost {
  readonly address = signal<string>('/');
  readonly choice = signal<LocaleSelectorChoice>({
    locale: 'en-US',
    language: 'en',
    selfName: 'American English',
    direction: 'ltr',
    current: false,
    pending: false,
  });
}

/** The address the snapshot offers for a locale, which is what an application would bind. */
const offered = (
  localization: Localization,
  locale: string,
): string | undefined => localization.snapshot()?.route?.addresses?.[locale];

const hrefs = (
  localization: Localization,
  locale: string,
): {
  readonly snapshot: string | undefined;
  readonly choice: string | null;
  readonly link: string | null;
} => {
  const address = offered(localization, locale);
  const onScreen = localization.snapshot()?.primaryLocale;
  const linked =
    onScreen === undefined ? undefined : offered(localization, onScreen);
  const host = TestBed.createComponent(ChoiceHost);
  host.componentInstance.choice.set({
    locale,
    language: locale.split('-')[0] ?? locale,
    selfName: locale,
    direction: 'ltr',
    current: false,
    pending: false,
  });
  if (linked !== undefined) host.componentInstance.address.set(linked);
  TestBed.tick();
  const read = (role: string): string | null =>
    host.nativeElement
      .querySelector(`[data-role="${role}"]`)
      ?.getAttribute('href') ?? null;
  return { snapshot: address, choice: read('choice'), link: read('link') };
};

// Where the path states the locale. Every arrival here is read through jsdom's own location, whose
// origin cannot be moved, so a policy that states the locale in the origin has nothing to read.
describe.runIf(localeInPath)('an application deployed under a sub-path', () => {
  it('reads the locale out of an address that carries the base, declared in the document', async () => {
    const arrival = await arriveAt(arabicUnderApp(), { dom: '/app' });

    // The locale is the assertion. The three below it can hold while this one fails, which is how
    // the failure hides: the right page, at the right address, in English.
    expect(arrival.locale).toBe('ar-EG');
    expect(arrival.routerUrl).toBe('/second');
    expect(arrival.view).toBe('second');
    expect(arrival.address).toBe(underApp('second', 'ar-EG'));
  });

  it('reads it the same way when the base is declared as a token, with a trailing slash', async () => {
    const arrival = await arriveAt(arabicUnderApp(), { token: '/app/' });

    expect(arrival.locale).toBe('ar-EG');
    expect(arrival.routerUrl).toBe('/second');
    expect(arrival.address).toBe(underApp('second', 'ar-EG'));
  });

  it('reads the same address at the root, which is how every other spec here runs', async () => {
    // The control. One thing differs from the two above, where the application is mounted, so
    // an implementation that ignored the base entirely would pass this and fail those.
    const arrival = await arriveAt(arabic(), {});

    expect(arrival.locale).toBe('ar-EG');
    expect(arrival.routerUrl).toBe('/second');
    expect(arrival.address).toBe(pagePath('second', 'ar-EG'));
  });

  it('writes a switcher option that points inside the deployment', async () => {
    const arrival = await arriveAt(arabicUnderApp(), { dom: '/app' });
    const written = hrefs(arrival.localization, 'en-US');

    // The contract, unmoved. What the snapshot offers is application-rooted, because that is what
    // the Router speaks and what an application binds to `routerLink`.
    expect(written.snapshot).toBe(pagePath('second', 'en-US'));
    // What each way of rendering it puts in the document. The directive composes the mount point
    // where it writes the attribute; `routerLink` gets there through the `LocationStrategy`. Both
    // arrive at one `/app`, and a snapshot that carried the mount point would give the second
    // of these two.
    expect(written.choice).toBe(underApp('second', 'en-US'));
    expect(written.link).toBe(underApp('second', 'ar-EG'));
  });

  it('writes the same option without a sub-path when there is none', async () => {
    // The control. One thing differs from the test above, and the snapshot value is identical in
    // both, which is the point of reading it here as well.
    const arrival = await arriveAt(arabic(), {});
    const written = hrefs(arrival.localization, 'en-US');

    expect(written.snapshot).toBe(pagePath('second', 'en-US'));
    expect(written.choice).toBe(pagePath('second', 'en-US'));
    expect(written.link).toBe(pagePath('second', 'ar-EG'));
  });

  it('writes the base back when a locale switch rewrites the address', async () => {
    const arrival = await arriveAt(arabicUnderApp(), { dom: '/app' });
    const before = arrival.platform.getState();

    await arrival.localization.changeLocale('en-US');
    TestBed.tick();

    expect(arrival.platform.pathname).toBe(underApp('second', 'en-US'));
    // The history entry's own state, which the switch replaces rather than creates. Angular's
    // scroll restoration finds a stored position by the navigation id it keeps in here, so a
    // rewrite that dropped it would restore nothing, and would do it only under a sub-path,
    // where the address being rewritten is longer than the one the entry was made with.
    //
    // This case holds whether or not the read side is correct: the write side is a different
    // path, so what it guards is the composition and the state rather than the locale.
    expect(arrival.platform.getState()).toEqual(before);
  });

  it('advertises itself at the sub-path it is served from', async () => {
    await arriveAt(arabicUnderApp(), { dom: '/app' });

    // A canonical URL is made of three things: the site, the mount point, and the address the
    // policy spells from the application's own root. Without the middle one this page tells every
    // crawler it lives at `https://site.example/ar-eg/second`: a path this deployment does not
    // serve, and one whatever else is on that site may.
    expect(canonical()).toBe(urlUnderApp('second', 'ar-EG'));
    expect(alternate('ar-EG')).toBe(urlUnderApp('second', 'ar-EG'));
    expect(alternate('en-US')).toBe(urlUnderApp('second', 'en-US'));
    // The fallback, which is an address in this application like any other.
    expect(alternate('x-default')).toBe(`${localeOrigin('en-US')}/app/`);
  });

  it('advertises the same page without a sub-path when there is none', async () => {
    // The control, and the only claim being made about a root-mounted deployment: it publishes
    // what it always published. One thing differs from the test above, where the application is
    // mounted, so a head that ignored the base would pass this and fail that.
    await arriveAt(arabic(), {});

    expect(canonical()).toBe(pageUrl('second', 'ar-EG'));
    expect(alternate('ar-EG')).toBe(pageUrl('second', 'ar-EG'));
    expect(alternate('en-US')).toBe(pageUrl('second', 'en-US'));
    expect(
      alternate('x-default'),
      'where the xDefaultPath the policy declares points',
    ).toBe(`${localeOrigin('en-US')}/`);
    claimCapability('declaration:x-default', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it('reads the base href from the one resolution both halves use', async () => {
    // The read side and the head are the same fact, so they are read through the same function
    // rather than through two copies of Angular's precedence. Asserted here because the value it
    // returns is the difference between the two tests above.
    const arrival = await arriveAt(arabicUnderApp(), { token: '/app/' });

    expect(TestBed.runInInjectionContext(() => applicationBaseHref())).toBe(
      '/app/',
    );
    expect(arrival.locale).toBe('ar-EG');
    expect(canonical()).toBe(urlUnderApp('second', 'ar-EG'));
    claimCapability('entry:@neolorn/equator', { policy: routePolicy });
  });

  it('writes the base back on an ordinary in-app navigation', async () => {
    const arrival = await arriveAt(arabicUnderApp(), { dom: '/app' });

    await arrival.router.navigateByUrl('/');
    TestBed.tick();

    // The Router is given a base-free, locale-free address, exactly as an application writes it in
    // a `routerLink`, and what reaches the browser carries both.
    expect(arrival.router.url).toBe('/');
    expect(arrival.platform.pathname).toBe(underApp('home', 'ar-EG'));
  });
});
