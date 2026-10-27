import { describe, expect, it } from 'vitest';

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, TitleStrategy } from '@angular/router';
import {
  Localization,
  withRouting,
  withFormattingContext,
} from '@neolorn/equator';
import { pageGone } from '@neolorn/equator/core';
import {
  declareOperationalFailure,
  declarePageOutcome,
  type LocaleRenderer,
  type LocaleRequestOutcome,
} from '@neolorn/equator/http';
import {
  LocalizedTitleStrategy,
  provideLocalizedRouter,
} from '@neolorn/equator/router';
import {
  createLocalizedServerSeat,
  provideLocalizationTesting,
} from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { messages } from '#i18n/shell';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { routes } from './app.routes';
import { runtimeExtensions } from './runtime-extensions';
import { provideDynamicContent } from './dynamic-content';
import {
  routePolicy,
  appRouteProjection,
  SITE_ORIGIN,
} from './localization.routes';
import {
  entryRedirects,
  localeInAddress,
  pageAddress,
  pageUrl,
} from './addresses';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

/**
 * The seat a consumer asserts a response from, exercised against the built packages.
 *
 * Section 12 of `specs/06-runtime-and-angular.spec.md` puts it in `@neolorn/equator/testing` and
 * requires it to answer through the request handler a deployment uses, with no socket, no built
 * bundle and no browser. This file is the half the package's own unit suite cannot reach: whether
 * `@neolorn/equator/testing` resolves `@neolorn/equator/http` once it is installed as a package,
 * and whether the head it reads is the head Equator actually writes rather than one written here.
 *
 * The renderer below is the component seat: it commits the locale the handler resolved, navigates
 * to the address it resolved, and hands back the document. That is what makes the canonical link
 * and the `hreflang` cluster in the assertions Equator's own output.
 */

const CACHE = { successMaxAge: 300, permanentRedirectMaxAge: 86_400 } as const;

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

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class RootHost {}

async function configure(origin: string): Promise<Router> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [
      provideLocalizedRouter(routes, {
        origin,
        outcomeDocuments: OUTCOME_DOCUMENTS,
        documentMetadata: {
          'route:second': {
            title: messages.document.second.title,
            description: messages.document.second.description,
          },
        },
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

/** The same interleaving `declared-page-outcome.spec.ts` waits on, for the same reason. */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    TestBed.tick();
    for (let hop = 0; hop < 3; hop += 1) await Promise.resolve();
  }
  TestBed.tick();
}

/** Renders the address the handler resolved, in the locale it resolved, through the component seat. */
async function renderThroughTestBed({
  request,
  locale,
}: LocaleRequestOutcome): Promise<Response> {
  // Rendered for the origin it was asked on, because under a locale-host policy each origin is a
  // build of its own.
  const router = await configure(new URL(request.url).origin);
  await TestBed.inject(Localization).changeLocale(locale);
  await router.navigateByUrl(new URL(request.url).pathname);
  await settle();
  return new Response(`<!doctype html>${document.documentElement.outerHTML}`, {
    headers: { 'content-type': 'text/html' },
  });
}

const seat = (render: LocaleRenderer = renderThroughTestBed) =>
  createLocalizedServerSeat({
    policy: routePolicy,
    projection: appRouteProjection,
    configuration,
    cache: CACHE,
    cookie: false,
    origin: SITE_ORIGIN,
    render,
  });

describe('an address answered through the server seat', () => {
  it('answers a localized address with its status, language and cacheability', async () => {
    const answered = await seat().request(pageUrl('second', 'en-US'));

    expect(answered.status).toBe(200);
    expect(answered.headers.get('content-language')).toBe('en-US');
    expect(answered.headers.get('cache-control')).toBe(
      'public, max-age=300, must-revalidate',
    );
  });

  // Where an address states its locale, so one can be asked for in Arabic.
  it.runIf(localeInAddress)(
    'hands back the head Equator wrote, rather than one the test wrote',
    async () => {
      const answered = await seat().request(pageUrl('second', 'ar-EG'));

      // The handler's own reading of the address, before the renderer draws anything.
      expect(answered.locale).toBe('ar-EG');
      expect(answered.headers.get('content-language')).toBe('ar-EG');
      expect(answered.head.lang).toBe('ar-EG');
      expect(answered.head.dir).toBe('rtl');
      expect(answered.head.title).toBe('العنوان الثاني');
      expect(answered.head.canonical).toBe(pageUrl('second', 'ar-EG'));
      // One canonical, and a reciprocal cluster beside it. Both are what a consumer building its own
      // harness was checking by parsing HTML off a socket.
      expect(
        answered.head.links.filter((link) => link.rel === 'canonical'),
      ).toHaveLength(1);
      expect(answered.head.alternates.map((link) => link.hreflang)).toContain(
        'en-US',
      );
    },
  );

  // Only a policy that prefixes every locale has an address that names none and is sent to one.
  it.runIf(entryRedirects)(
    'sends an entry address to the language that was asked for',
    async () => {
      const answered = await seat().request('/second', {
        headers: { 'accept-language': 'ar-EG,en;q=0.8' },
      });

      expect(answered.status).toBe(307);
      expect(answered.headers.get('location')).toBe(
        pageAddress('second', 'ar-EG'),
      );
      expect(answered.resolution.status).toBe('redirect');
    },
  );

  it('writes a head for an address that reached no route', async () => {
    // The outcome document, read back off the response rather than off the test's own DOM. Without
    // one the head here is whatever the previous page left in it.
    const answered = await seat().request(pageUrl('missing', 'en-US'));

    expect(answered.status).toBe(404);
    expect(
      answered.head.title,
      'the title answeredHead read off the answer createLocalizedServerSeat gave',
    ).toBe('Page not found');
    expect(answered.head.canonical).toBeUndefined();
    claimCapability('testing:createLocalizedServerSeat', {
      policy: routePolicy,
      document: answered.body,
    });
    claimCapability('testing:answeredHead', {
      policy: routePolicy,
      document: answered.body,
    });
  });

  it('carries an outcome the renderer declared, and says that it carried', async () => {
    const answered = await seat(() => declarePageOutcome(pageGone())).request(
      pageUrl('second', 'en-US'),
    );

    expect(answered.status).toBe(410);
    expect(answered.pageOutcome?.declared.outcome).toBe('gone');
    expect(answered.pageOutcome?.carried).toBe(true);
    expect(answered.headers.get('cache-control')).toBe('private, no-store');
    claimCapability('outcome:declarePageOutcome', {
      policy: routePolicy,
      document: answered.body,
    });
    claimCapability('outcome:pageGone', {
      policy: routePolicy,
      document: answered.body,
    });
    claimCapability('entry:@neolorn/equator/http', {
      policy: routePolicy,
      document: answered.body,
    });
    claimCapability('entry:@neolorn/equator/core', {
      policy: routePolicy,
      document: answered.body,
    });
  });

  it('carries an operational failure the renderer declared, with its own status', async () => {
    const answered = await seat(() =>
      declareOperationalFailure(
        new Response('<!doctype html><title>Down for maintenance</title>', {
          status: 503,
          headers: { 'retry-after': '600', 'content-type': 'text/html' },
        }),
      ),
    ).request(pageUrl('second', 'en-US'));

    expect(answered.status).toBe(503);
    expect(answered.headers.get('retry-after')).toBe('600');
    expect(answered.pageOutcome?.declared.outcome).toBe('operational-failure');
    expect(answered.pageOutcome?.carried).toBe(true);
    expect(answered.headers.get('cache-control')).toBe('private, no-store');
    claimCapability('outcome:declareOperationalFailure', {
      policy: routePolicy,
      document: answered.body,
    });
  });
});
