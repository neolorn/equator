import { afterEach, describe, expect, it, vi } from 'vitest';

import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, TitleStrategy } from '@angular/router';
import {
  Localization,
  withRouting,
  withFormattingContext,
} from '@neolorn/equator';
import {
  LocalizedPageOutcome,
  LocalizedTitleStrategy,
  provideLocalizedRouter,
} from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { messages } from '#i18n/shell';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { routes } from './app.routes';
import { runtimeExtensions } from './runtime-extensions';
import { provideDynamicContent } from './dynamic-content';
import { routePolicy, appRouteProjection } from './localization.routes';
import {
  localeInPath,
  localeOrigin,
  pagePath,
  pageUrl,
  switchInDocument,
} from './addresses';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

/**
 * A page that resolved and turned out not to be there, and the head that follows from it.
 *
 * Section 12 of `specs/07-routing-rendering-and-seo.spec.md` derives what the address implies from
 * the outcome in force rather than carrying it over, so a page that has declared its entity absent
 * stops claiming a canonical address and stops offering alternates, and section 5 forbids
 * synthesizing a response for it on a client navigation. Both halves are here because either alone
 * still publishes a claim the page contradicts.
 *
 * The other half of the declaration, the status it produces on a server, is in the package's own
 * `declared-page-outcome.test.ts`: there is no response to read from a client navigation, which is
 * the point of the last case in this file.
 */

const ARABIC = 'ar-EG';

/**
 * A host with an outlet, because the declaration comes from the route's own component.
 *
 * Without a rendered outlet nothing declares and every assertion below reads the head Equator built
 * from the address alone, which is the head this file exists to say is not enough.
 */
@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

const OUTCOME_DOCUMENTS = {
  'not-found': {
    title: messages.document.notFound.title,
    description: messages.document.notFound.description,
  },
  gone: {
    title: messages.document.gone.title,
    description: messages.document.gone.description,
  },
  'unsupported-locale': {
    title: messages.document.unsupportedLocale.title,
    description: messages.document.unsupportedLocale.description,
  },
} as const;

async function configure(
  outcomeDocuments: Partial<typeof OUTCOME_DOCUMENTS> = OUTCOME_DOCUMENTS,
): Promise<Router> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [
      provideLocalizedRouter(routes, {
        origin: localeOrigin('en-US'),
        outcomeDocuments,
        documentMetadata: {
          topic: {
            title: messages.document.topic.title,
            description: messages.document.topic.description,
          },
        },
        document: (context, localization) =>
          context.pageOutcome?.outcome === 'absent'
            ? {
                title: localization.text(messages.document.topicAbsent.title),
                description: localization.text(
                  messages.document.topicAbsent.description,
                ),
              }
            : {},
      }),
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
      provideDynamicContent(),
    ],
  }).compileComponents();
  await TestBed.inject(Localization).initialize();
  TestBed.createComponent(RootHost);
  return TestBed.inject(Router);
}

/** The same interleaving `localized-route-parameters.spec.ts` waits on, for the same reason. */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    TestBed.tick();
    for (let hop = 0; hop < 3; hop += 1) await Promise.resolve();
  }
  TestBed.tick();
}

const canonical = (): string | null =>
  document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;

const alternates = (): number =>
  document.querySelectorAll('link[rel="alternate"]').length;

const robots = (): string | null =>
  document.querySelector('meta[name="robots"]')?.getAttribute('content') ??
  null;

const description = (): string | null =>
  document.querySelector('meta[name="description"]')?.getAttribute('content') ??
  null;

describe('a route whose entity turned out to be absent', () => {
  it('publishes the head of a page that is there before anything says otherwise', async () => {
    // The control, measured rather than argued. A filed topic is an ordinary indexable page, so
    // every assertion below is distinguishable from one that simply found no head at all.
    const router = await configure();
    await router.navigateByUrl('/topics/handbook');
    await settle();

    expect(document.title).toBe('Topic');
    expect(
      canonical(),
      'written against the origin the Router integration was given',
    ).toBe(pageUrl('topic', 'en-US'));
    expect(alternates()).toBeGreaterThan(0);
    expect(robots()).toBeNull();
    claimCapability('declaration:RouteLocalizationOptions.origin', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it('withdraws the canonical address and the alternates when the page declares it is not there', async () => {
    const router = await configure();
    await router.navigateByUrl('/topics/nothing-filed-here');
    await settle();

    // An alternate link states that the same page exists in another language. Left standing on a
    // page that is not there it is a claim the response contradicts, in every other language at
    // once.
    expect(canonical()).toBeNull();
    expect(alternates()).toBe(0);
    expect(robots()).toBe('noindex');
  });

  it('lets the application say what a missing page is called', async () => {
    const router = await configure();
    await router.navigateByUrl('/topics/nothing-filed-here');
    await settle();

    expect(
      document.title,
      'the title the document callback wrote for a page declared absent',
    ).toBe('Topic not found');
    expect(description()).toBe('No topic is filed under this address.');
    claimCapability('declaration:RouteLocalizationOptions.document', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it('does not carry one page’s declaration onto the next', async () => {
    const router = await configure();
    await router.navigateByUrl('/topics/nothing-filed-here');
    await settle();
    expect(canonical()).toBeNull();

    // The trap the navigation stamp exists to prevent: the page after a missing one is an ordinary
    // page, and a declaration held anywhere but on the navigation that made it would answer for
    // both.
    await router.navigateByUrl('/topics/handbook');
    await settle();
    expect(canonical()).toBe(pageUrl('topic', 'en-US'));
    expect(robots()).toBeNull();
    expect(document.title).toBe('Topic');
  });

  it('answers a reader asking for the current outcome with the page on screen', async () => {
    const router = await configure();
    const outcome = TestBed.inject(LocalizedPageOutcome);
    await router.navigateByUrl('/topics/nothing-filed-here');
    await settle();
    expect(
      outcome.current(),
      'the pageAbsent() the topic page declared',
    ).toEqual({ outcome: 'absent' });

    // The arriving page declares nothing, and that replaces the declaration rather than leaving the
    // previous page's standing for a reader who asks what is current rather than about a
    // navigation.
    await router.navigateByUrl('/topics/handbook');
    await settle();
    expect(outcome.current()).toBeUndefined();
    claimCapability('outcome:pageAbsent', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it('keeps the page on screen rather than inventing a response for it', async () => {
    const router = await configure();
    await router.navigateByUrl('/topics/nothing-filed-here');
    await settle();

    // A client navigation has no response to reach, and section 5 forbids synthesizing one. The
    // route stays activated and the address bar stays where the reader put it; what the
    // declaration governs here is the document.
    expect(router.url).toContain('/topics/nothing-filed-here');
    expect(document.querySelector('[data-route-view="topic"]')).not.toBeNull();
  });
});

describe('a route whose entity was removed for good', () => {
  it('withdraws what the address claimed, as it does for an absent one', async () => {
    const router = await configure();
    const outcome = TestBed.inject(LocalizedPageOutcome);
    await router.navigateByUrl('/topics/retired-topic');
    await settle();

    expect(outcome.current(), 'the pageGone() the topic page declared').toEqual(
      { outcome: 'gone' },
    );
    // Section 12 withdraws the canonical address and the alternates for a removal as for an
    // absence: the page is not there in any language.
    expect(canonical()).toBeNull();
    expect(alternates()).toBe(0);
    expect(robots()).toBe('noindex');
    claimCapability('outcome:pageGone', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });
});

describe('a page whose own lookup failed', () => {
  it('keeps the head the address implies, because the failure is not a fact about the address', async () => {
    const router = await configure();
    const outcome = TestBed.inject(LocalizedPageOutcome);
    await router.navigateByUrl('/topics/unavailable-topic');
    await settle();

    expect(
      outcome.current(),
      'the pageOperationalFailure(503) the topic page declared',
    ).toEqual({ outcome: 'operational-failure', status: 503 });
    // Section 12 withdraws the canonical address and the alternates for an absence or a removal
    // only. This render failed to produce the page; the page at this address still exists in every
    // language the projection names, so what the head says of the address stands.
    expect(canonical()).toBe(pageUrl('unavailable topic', 'en-US'));
    expect(alternates()).toBeGreaterThan(0);
    expect(robots()).toBeNull();
    expect(document.title).toBe('Topic');
    // Section 5: a client navigation has no response to reach, so the page stays on screen.
    expect(document.querySelector('[data-route-view="topic"]')).not.toBeNull();
    claimCapability('outcome:pageOperationalFailure', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });
});

describe('a response that reached no route at all', () => {
  it('writes the head of an address this application does not serve', async () => {
    const router = await configure();
    await router.navigateByUrl('/topics/handbook');
    await settle();
    expect(document.title).toBe('Topic');

    await router.navigateByUrl('/nowhere-at-all');
    await settle();

    // Without an outcome document this head is the previous page's, in full: its title, its
    // description, and a canonical link saying this address is that page.
    expect(
      document.title,
      'the not-found title outcomeDocuments declares',
    ).toBe('Page not found');
    expect(description()).toBe(
      'This address does not name a page in this application.',
    );
    expect(canonical()).toBeNull();
    // Kept out of an index by the head as well as by the header the server sends with it.
    expect(robots()).toBe('noindex');
    claimCapability('declaration:outcome-documents', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  // Where the path can name a locale for the Router to be handed.
  it.runIf(localeInPath)(
    'writes it in the locale the address was asked for',
    async () => {
      const router = await configure();
      await router.navigateByUrl(pagePath('missing', ARABIC));
      await settle();

      expect(document.title).toBe('الصفحة غير موجودة');
    },
  );

  // Where a switch stays in this document, which is the head being moved.
  it.runIf(switchInDocument)(
    'moves it when the reader changes language',
    async () => {
      const router = await configure();
      await router.navigateByUrl('/nowhere-at-all');
      await settle();
      expect(document.title).toBe('Page not found');

      // A locale change is not a navigation, and there is no route context to rebuild from here.
      // Without the outcome class being held, the head of a missing page stays in the language the
      // reader has just left.
      await TestBed.inject(Localization).changeLocale(ARABIC);
      await settle();
      expect(document.title).toBe('الصفحة غير موجودة');
      claimCapability('entry:@neolorn/equator', { policy: routePolicy });
    },
  );

  it('writes the head of an address declared permanently removed', async () => {
    const router = await configure();
    await router.navigateByUrl('/removed');
    await settle();

    expect(
      document.title,
      'the gone document, for the address the historical table removed',
    ).toBe('Page removed');
    expect(canonical()).toBeNull();
    expect(robots()).toBe('noindex');
    claimCapability('declaration:historical-route-outcome', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });
});

describe('an outcome class with no document declared for it', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is reported when a response of that class is answered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const router = await configure({
      'not-found': OUTCOME_DOCUMENTS['not-found'],
      'unsupported-locale': OUTCOME_DOCUMENTS['unsupported-locale'],
    });
    await router.navigateByUrl('/removed');
    await settle();

    // Served with no title, the page keeps the previous one's, so the gap is named where a
    // developer sees it rather than left to a reader.
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/classed "gone" was answered with no title/u),
    );
  });

  it('is not reported for a class that has one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const router = await configure();
    await router.navigateByUrl('/removed');
    await settle();

    expect(warn).not.toHaveBeenCalledWith(
      expect.stringMatching(/was answered with no title/u),
    );
  });
});
