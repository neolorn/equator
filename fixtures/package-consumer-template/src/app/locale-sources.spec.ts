import { describe, expect, it } from 'vitest';

import { PLATFORM_ID, REQUEST } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlatformLocation } from '@angular/common';
import {
  MOCK_PLATFORM_LOCATION_CONFIG,
  MockPlatformLocation,
} from '@angular/common/testing';
import {
  Localization,
  createHostLocalePolicy,
  withRouting,
  provideLocalizationSetup,
  withLocaleSources,
  withPersistence,
  cookieStore,
  localStorageStore,
  memoryStore,
  profileStore,
  type LocaleUrlPolicy,
  type LocalizationLocaleSource,
  type LocalizationPersistenceStoreFactory,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { runtimeExtensions } from './runtime-extensions';
import { routePolicy, appRouteProjection } from './localization.routes';
import {
  addressCanStateNone,
  localeInAddress,
  pageUrl,
  unstatedAddress,
} from './addresses';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * Who decides the locale of a first request.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 7 lists the sources, "authoritative locale URL, configured
 * persistence adapters, request or browser language preferences, and the configured default",
 * and says consumers "may omit or explicitly order optional sources". An option that takes a
 * function and leaves the consumer to write the chain implements none of them: the function this
 * fixture would carry is the `url` source, and four applications would write it four times.
 *
 * The rule that makes an order mean anything is that a source may decline. A URL with no locale
 * prefix has stated nothing; answering the default there would make every later source
 * unreachable, and the consumer's declared order would be decoration.
 */

interface Environment {
  readonly sources?: readonly LocalizationLocaleSource[];
  readonly stores?: readonly LocalizationPersistenceStoreFactory[];
  /** An absolute URL, because under locale-host the origin is what states the locale. */
  readonly url?: string;
  readonly acceptLanguage?: string;
  /** The request's cookie header, where a store reads one. */
  readonly cookie?: string;
  readonly withPolicy?: boolean;
  /** A policy of the test's own, where the row's cannot say what the test needs said. */
  readonly policy?: LocaleUrlPolicy;
  /** In the browser, where the address is the document's own and nothing supplies one. */
  readonly browser?: boolean;
}

function setup(environment: Environment): Localization {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      // A server platform with a real request is the only place both the URL and the client's
      // language preferences can be supplied deterministically, and it is the render that matters
      // most: it is the one the visitor sees first.
      ...(environment.browser === true
        ? []
        : [
            { provide: PLATFORM_ID, useValue: 'server' },
            {
              provide: REQUEST,
              useValue: new Request(environment.url ?? unstatedAddress, {
                headers: {
                  ...(environment.acceptLanguage === undefined
                    ? {}
                    : { 'accept-language': environment.acceptLanguage }),
                  ...(environment.cookie === undefined
                    ? {}
                    : { cookie: environment.cookie }),
                },
              }),
            },
          ]),
      // The address, supplied the way Equator reads it on the server.
      //
      // Not `REQUEST_CONTEXT`. `@angular/ssr` provides that token only when the render mode is
      // `Server`, so a prerendered page has no address at all and resolves to the default locale:
      // Arabic addresses rendered in English and written to disk. Equator derives the address from
      // `PlatformLocation`, which the server platform initializes from the address being rendered
      // under both prerendering and SSR.
      //
      // Absent when the environment names no URL, so the `url` source has nothing to read and
      // declines, which is the case the ordering tests below depend on.
      ...(environment.url === undefined
        ? []
        : [
            {
              provide: MOCK_PLATFORM_LOCATION_CONFIG,
              useValue: { startUrl: environment.url },
            },
            { provide: PlatformLocation, useClass: MockPlatformLocation },
          ]),
      provideLocalizationSetup(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        // One declaration of the locale URL policy, wherever it is read from.
        ...(environment.withPolicy === false
          ? []
          : [
              withRouting({
                policy: environment.policy ?? routePolicy,
                projection: appRouteProjection,
              }),
            ]),
        ...(environment.sources === undefined
          ? []
          : [withLocaleSources(...environment.sources)]),
        ...(environment.stores === undefined
          ? []
          : [withPersistence(...environment.stores)]),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  return TestBed.inject(Localization);
}

function storeReturning(
  locale: string | undefined,
): LocalizationPersistenceStoreFactory {
  return () => ({
    id: 'test',
    read: () => locale,
    write: () => undefined,
  });
}

describe('the declared order', () => {
  it.runIf(localeInAddress)(
    'takes the URL when the URL states a locale',
    async () => {
      const localization = setup({
        sources: ['url', 'stored', 'default'],
        stores: [storeReturning('en-US')],
        url: pageUrl('second', 'ar-EG'),
      });

      expect((await localization.initialize()).primaryLocale).toBe('ar-EG');
      claimCapability('source:url', { policy: routePolicy });
    },
  );

  it('takes the origin the document is at, in the browser', async () => {
    // This document's own origin, named as the Arabic one, so the origin is the only thing here
    // that states Arabic: the path is the same in every locale.
    const policy = createHostLocalePolicy({
      defaultLocale: 'en-US',
      origins: { 'en-US': 'http://en-us.localhost', 'ar-EG': location.origin },
    });
    const localization = setup({
      sources: ['url', 'stored', 'default'],
      stores: [storeReturning('en-US')],
      policy,
      browser: true,
    });

    expect((await localization.initialize()).primaryLocale).toBe('ar-EG');
    claimCapability('source:url', {
      policy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it.runIf(addressCanStateNone)(
    'steps past the URL when the URL states none',
    async () => {
      // The rule the whole ordering rests on. `/` carries no prefix, so it has stated nothing, and
      // the stored preference answers instead of being pre-empted by a default.
      const localization = setup({
        sources: ['url', 'stored', 'default'],
        stores: [storeReturning('ar-EG')],
        url: unstatedAddress,
      });

      expect((await localization.initialize()).primaryLocale).toBe('ar-EG');
      claimCapability('source:url', { policy: routePolicy });
      claimCapability('source:stored', { policy: routePolicy });
    },
  );

  it('takes what this visitor chose before, in the browser', async () => {
    // Stored ahead of the URL, so the document's own address, which is the test runner's, decides
    // nothing here whatever the row's policy reads from it.
    const localization = setup({
      sources: ['stored', 'url', 'default'],
      stores: [storeReturning('ar-EG')],
      browser: true,
    });

    expect((await localization.initialize()).primaryLocale).toBe('ar-EG');
    claimCapability('source:stored', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it.runIf(addressCanStateNone)(
    'falls through to what the client asked for',
    async () => {
      const localization = setup({
        sources: ['url', 'stored', 'browser', 'default'],
        stores: [storeReturning(undefined)],
        url: unstatedAddress,
        acceptLanguage: 'ar-SA,en;q=0.5',
      });

      expect((await localization.initialize()).primaryLocale).toBe('ar-EG');
      claimCapability('source:browser', { policy: routePolicy });
    },
  );

  it.runIf(addressCanStateNone)(
    'reaches the default when every earlier source declines',
    async () => {
      const localization = setup({
        sources: ['url', 'stored', 'browser', 'default'],
        url: unstatedAddress,
        acceptLanguage: 'ja-JP',
      });

      expect((await localization.initialize()).primaryLocale).toBe('en-US');
      claimCapability('source:default', { policy: routePolicy });
    },
  );

  it("honours the order, not Equator's opinion of it", async () => {
    // Storage ahead of the URL is unusual and legitimate: an application that deliberately pins a
    // signed-in user's language regardless of the link they followed.
    const localization = setup({
      sources: ['stored', 'url', 'default'],
      stores: [storeReturning('ar-EG')],
      url: pageUrl('second', 'en-US'),
    });

    expect(
      (await localization.initialize()).primaryLocale,
      'withLocaleSources put the LocalizationPersistenceStore of withPersistence first',
    ).toBe('ar-EG');
    const platform = TestBed.inject(PLATFORM_ID) as string;
    claimCapability('source:stored', { policy: routePolicy, platform });
    claimCapability('feature:withLocaleSources', {
      policy: routePolicy,
      platform,
    });
    claimCapability('feature:withPersistence', {
      policy: routePolicy,
      platform,
    });
    claimCapability('extension:persistence-store', {
      policy: routePolicy,
      platform,
    });
  });

  it("asks for the reader's languages where the order puts them first", async () => {
    // Under every policy, including those where every address states a locale: the order is the
    // application's, and one that ranks the reader's languages over a link is honoured as written.
    const localization = setup({
      sources: ['browser', 'url', 'default'],
      url: pageUrl('second', 'en-US'),
      acceptLanguage: 'ar-SA,en;q=0.5',
    });

    expect(
      (await localization.initialize()).primaryLocale,
      'the order withLocaleSources declared',
    ).toBe('ar-EG');
    claimCapability('source:browser', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it('reaches the default when the only source before it declines', async () => {
    const localization = setup({
      sources: ['stored', 'default'],
      stores: [storeReturning(undefined)],
      url: localeInAddress ? pageUrl('second', 'ar-EG') : unstatedAddress,
      acceptLanguage: 'ar-EG',
    });

    // The reader says Arabic, and so does the address where one can, and neither is a source this
    // order asks.
    expect(
      (await localization.initialize()).primaryLocale,
      'the order withLocaleSources declared',
    ).toBe('en-US');
    claimCapability('source:default', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it('reads the cookie a cookieStore names from the request', async () => {
    const localization = setup({
      sources: ['stored', 'url', 'default'],
      stores: [cookieStore()],
      url: pageUrl('second', 'en-US'),
      cookie: 'equator-locale=ar-EG',
    });

    expect(
      (await localization.initialize()).primaryLocale,
      'the cookie cookieStore reads for withPersistence',
    ).toBe('ar-EG');
    const platform = TestBed.inject(PLATFORM_ID) as string;
    claimCapability('store:cookieStore', { policy: routePolicy, platform });
    claimCapability('feature:withPersistence', {
      policy: routePolicy,
      platform,
    });
  });

  it('waits for a profileStore transport before the server renders', async () => {
    // A transport that can answer while the server renders, such as one that reads the signed-in
    // account behind the request, decides the language of the first response like a cookie does.
    const localization = setup({
      sources: ['stored', 'url', 'default'],
      stores: [
        profileStore({ read: async () => 'ar-EG', write: () => undefined }),
      ],
      url: pageUrl('second', 'en-US'),
    });

    expect(
      (await localization.initialize()).primaryLocale,
      'the profileStore transport withPersistence installed',
    ).toBe('ar-EG');
    const platform = TestBed.inject(PLATFORM_ID) as string;
    claimCapability('store:profileStore', { policy: routePolicy, platform });
    claimCapability('feature:withPersistence', {
      policy: routePolicy,
      platform,
    });
  });

  it('keeps a memoryStore choice to the request that made it', async () => {
    // Memory is built per injector and a server builds one per request, so a store declared once in
    // shared configuration cannot hand one request's choice to the next.
    const declared = memoryStore();
    const thisRequest = declared();
    const first = setup({
      sources: ['stored', 'default'],
      stores: [() => thisRequest],
      url: pageUrl('second', 'en-US'),
    });
    await first.initialize();
    await first.changeLocale('ar-EG');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      await thisRequest.read(),
      'what the memoryStore withPersistence installed kept',
    ).toBe('ar-EG');

    const next = setup({
      sources: ['stored', 'default'],
      stores: [declared],
      url: pageUrl('second', 'en-US'),
    });
    expect((await next.initialize()).primaryLocale).toBe('en-US');
    claimCapability('store:memoryStore', {
      policy: routePolicy,
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it('finds nothing in a localStorageStore while the server renders', async () => {
    // The test's process has a storage holding a choice, as a browser would. A server render
    // belongs to no reader, so the store must not read the process's storage as though it were
    // theirs, and the choice the request carries in a cookie is not this store's to read either.
    localStorage.setItem('equator-locale', 'ar-EG');
    try {
      const localization = setup({
        sources: ['stored', 'default'],
        stores: [localStorageStore()],
        url: pageUrl('second', 'en-US'),
        cookie: 'equator-locale=ar-EG',
      });

      expect(
        (await localization.initialize()).primaryLocale,
        'the localStorageStore withPersistence installed declined',
      ).toBe('en-US');
      claimCapability('store:localStorageStore', {
        policy: routePolicy,
        platform: TestBed.inject(PLATFORM_ID) as string,
      });
    } finally {
      localStorage.removeItem('equator-locale');
    }
  });

  it('disables a source by leaving it out', async () => {
    const localization = setup({
      sources: ['url', 'default'],
      stores: [storeReturning('ar-EG')],
      url: unstatedAddress,
    });

    // The store is installed and holds a usable value. It is simply not consulted, which is what
    // omitting a source has to mean if declaring one is to mean anything.
    expect((await localization.initialize()).primaryLocale).toBe('en-US');
  });

  it.runIf(localeInAddress)(
    'declines the URL source when no policy was supplied',
    async () => {
      const localization = setup({
        sources: ['url', 'stored', 'default'],
        stores: [storeReturning('ar-EG')],
        url: pageUrl('second', 'ar-EG'),
        withPolicy: false,
      });

      expect((await localization.initialize()).primaryLocale).toBe('ar-EG');
    },
  );
});

/**
 * The order an application gets when it declares none.
 *
 * `app.config.ts` declares no sources. Writing `withLocaleSources('url', 'stored', 'browser',
 * 'default')` there restates Equator's default, which says nothing and creates a second place to
 * maintain; leaving it out puts this application's behaviour on a constant, and every test above
 * passes an explicit `sources` rather than exercising it.
 *
 * So these four pin the default, and they pin it **by behaviour rather than by reading
 * `DEFAULT_LOCALE_SOURCES`**. Comparing the negotiated order against the constant that produces it
 * would agree whether or not either is right. Each test instead puts two sources in conflict and
 * asserts which one answers, which is the only thing that distinguishes one order from another.
 *
 * Together they fix all four ranks: url > stored > browser > default. Reordering any adjacent pair
 * fails at least one of them, and dropping a source from the default fails the test that depends on
 * it answering.
 */
describe('the order an application gets without declaring one', () => {
  it.runIf(localeInAddress)(
    'takes the URL over a stored preference',
    async () => {
      const localization = setup({
        stores: [storeReturning('en-US')],
        url: pageUrl('second', 'ar-EG'),
      });

      // Both sources have an answer and they disagree. Only the URL being ranked first explains
      // Arabic here.
      expect((await localization.initialize()).primaryLocale).toBe('ar-EG');
    },
  );

  it.runIf(addressCanStateNone)(
    'takes a stored preference over what the client asked for',
    async () => {
      const localization = setup({
        stores: [storeReturning('ar-EG')],
        url: unstatedAddress,
        acceptLanguage: 'en-US',
      });

      expect((await localization.initialize()).primaryLocale).toBe('ar-EG');
    },
  );

  it.runIf(addressCanStateNone)(
    'takes what the client asked for over the configured default',
    async () => {
      const localization = setup({
        stores: [storeReturning(undefined)],
        url: unstatedAddress,
        acceptLanguage: 'ar-SA,en;q=0.5',
      });

      // `en-US` is the configured default, so anything other than `ar-EG` here means the browser
      // source is either ranked below the default or absent from it.
      expect((await localization.initialize()).primaryLocale).toBe('ar-EG');
    },
  );

  it.runIf(addressCanStateNone)(
    'reaches the configured default when nothing earlier answers',
    async () => {
      const localization = setup({
        url: unstatedAddress,
        acceptLanguage: 'ja-JP',
      });

      expect((await localization.initialize()).primaryLocale).toBe('en-US');
    },
  );
});

describe('a configuration that cannot mean anything', () => {
  it('refuses an empty source list', () => {
    expect(() => withLocaleSources()).toThrow();
    claimCapability('feature:withLocaleSources');
    claimCapability('entry:@neolorn/equator');
  });

  it('refuses a source declared twice', () => {
    // Two positions for one source is two different answers to "when is this consulted", and the
    // second is unreachable. Silently keeping the first would hide the contradiction.
    expect(() => withLocaleSources('url', 'stored', 'url')).toThrow();
    claimCapability('feature:withLocaleSources');
    claimCapability('entry:@neolorn/equator');
  });
});
