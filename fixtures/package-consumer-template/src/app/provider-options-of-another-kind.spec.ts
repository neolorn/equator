import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  createPathPrefixLocalePolicy,
  provideLocalizationSetup,
  withExtensions,
  withFormattingContext,
  withLocaleAnnouncement,
  withLocaleSources,
  withLocalizationClock,
  withObservability,
  withOverlayLocale,
  withPersistence,
  withRecoveryMessage,
  withRelativeTimePolicy,
  withRouting,
  type LocalizationSetup,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import {
  createInMemoryCatalogLoaders,
  provideLocalizationTesting,
} from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';

import { routes } from './app.routes';
import { appRouteProjection } from './localization.routes';

/**
 * A provider handed a value of another kind than its declaration names.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md` holds an option declared as an object
 * or as a list to that kind where the configuration is given. Each call here is one an application
 * that is not type-checked can write, and each is refused by the call itself with
 * `invalid-configuration`, before any provider is built. An option declared as a function, or as
 * one of a set of named values, and each feature handed to a provider are held the same way.
 */

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'en-Arab-XB': 'en-arab-xb' },
});

/** The diagnostic code a call refuses with, the name of any other error, or `undefined`. */
const refusal = (call: () => unknown): string | undefined => {
  try {
    call();
    return undefined;
  } catch (error) {
    return error instanceof LocalizationError
      ? error.diagnostic.code
      : `a bare ${(error as Error).constructor.name}`;
  }
};

const NOT_AN_OBJECT: readonly unknown[] = [
  null,
  'text',
  7,
  true,
  ['x'],
  () => undefined,
];
const NOT_A_LIST: readonly unknown[] = [
  null,
  'text',
  7,
  true,
  { a: 1 },
  () => undefined,
];

const NOT_A_FUNCTION: readonly unknown[] = [
  undefined,
  null,
  'text',
  7,
  true,
  ['x'],
  { a: 1 },
];
const NOT_A_NAME: readonly unknown[] = [
  undefined,
  null,
  'cookie',
  'URL',
  7,
  ['url'],
  { url: true },
];

const SETUP: LocalizationSetup = { configuration, catalogSet, catalogLoaders };
const KEY = {
  providerId: '@example/app',
  scopeId: 'shell',
  catalogLocale: 'en-US',
};

const OBJECTS: readonly (readonly [string, (value: never) => unknown])[] = [
  ['withLocalizationClock(clock)', (v) => withLocalizationClock(v)],
  ['withObservability(sink)', (v) => withObservability(v)],
  ['provideLocalizationTesting(setup)', (v) => provideLocalizationTesting(v)],
  [
    'provideLocalizationTesting catalogLoaders',
    (v) => provideLocalizationTesting({ ...SETUP, catalogLoaders: v }),
  ],
  [
    'provideLocalizationSetup, a feature',
    (v) => provideLocalizationSetup(SETUP, v),
  ],
  [
    'provideLocalizationTesting, a feature',
    (v) => provideLocalizationTesting(SETUP, v),
  ],
  [
    'createInMemoryCatalogLoaders, a catalog',
    (v) => createInMemoryCatalogLoaders([v]),
  ],
  [
    'createInMemoryCatalogLoaders, the key of a catalog',
    (v) => createInMemoryCatalogLoaders([{ key: v, catalog: {} }]),
  ],
  ['withRouting(options)', (v) => withRouting(v)],
  [
    'withRouting policy',
    (v) => withRouting({ policy: v, projection: appRouteProjection }),
  ],
  [
    'withRouting projection',
    (v) => withRouting({ policy: POLICY, projection: v }),
  ],
  [
    'withRouting projection.generated',
    (v) =>
      withRouting({
        policy: POLICY,
        projection: { ...appRouteProjection, generated: v },
      }),
  ],
  [
    'withRouting indexing',
    (v) =>
      withRouting({
        policy: POLICY,
        projection: appRouteProjection,
        indexing: v,
      }),
  ],
  [
    'withRouting sitemap',
    (v) =>
      withRouting({
        policy: POLICY,
        projection: appRouteProjection,
        sitemap: v,
      }),
  ],
  [
    'withRouting caching',
    (v) =>
      withRouting({
        policy: POLICY,
        projection: appRouteProjection,
        caching: v,
      }),
  ],
  ['withFormattingContext(context)', (v) => withFormattingContext(v)],
  ['withRelativeTimePolicy(policy)', (v) => withRelativeTimePolicy(v)],
  ['withRecoveryMessage(options)', (v) => withRecoveryMessage(v)],
  ['withRecoveryMessage message', (v) => withRecoveryMessage({ message: v })],
  ['provideLocalizationSetup(setup)', (v) => provideLocalizationSetup(v)],
  ['provideLocalizedRouter(options)', (v) => provideLocalizedRouter(routes, v)],
  [
    'provideLocalizedRouter documentMetadata',
    (v) => provideLocalizedRouter(routes, { documentMetadata: v }),
  ],
  [
    'provideLocalizedRouter outcomeDocuments',
    (v) => provideLocalizedRouter(routes, { outcomeDocuments: v }),
  ],
  [
    'provideLocalizedRouter, a scope',
    (v) => provideLocalizedRouter(routes, { requiredScopes: [v] }),
  ],
];

const NOT_TEXT: readonly unknown[] = [
  undefined,
  null,
  7,
  true,
  ['text'],
  { a: 1 },
];

const TEXTS: readonly (readonly [string, (value: never) => unknown])[] = (
  ['providerId', 'scopeId', 'catalogLocale'] as const
).map((member) => [
  `createInMemoryCatalogLoaders, ${member} of the key of a catalog`,
  (v: never) =>
    createInMemoryCatalogLoaders([
      { key: { ...KEY, [member]: v }, catalog: {} },
    ]),
]);

const FUNCTIONS: readonly (readonly [string, (value: never) => unknown])[] = [
  [
    'withLocalizationClock, now of the clock',
    (v) => withLocalizationClock({ now: v }),
  ],
  [
    'withObservability, emit of the sink',
    (v) => withObservability({ emit: v }),
  ],
  ['withPersistence, a store', (v) => withPersistence(v)],
  ['withLocaleAnnouncement(format)', (v) => withLocaleAnnouncement(v)],
  ['withOverlayLocale(create)', (v) => withOverlayLocale(v)],
  [
    'provideLocalizationTesting, a catalog loader',
    (v) =>
      provideLocalizationTesting({
        ...SETUP,
        catalogLoaders: { '@example/app:shell:en-US': v },
      }),
  ],
];

const NAMES: readonly (readonly [string, (value: never) => unknown])[] = [
  ['withLocaleSources, a source', (v) => withLocaleSources(v)],
  [
    'withLocaleSources, a source after a declared one',
    (v) => withLocaleSources('url', v),
  ],
  [
    'provideLocalizationSetup, the kind of a feature',
    (v) => provideLocalizationSetup(SETUP, { ɵkind: v } as never),
  ],
];

const LISTS: readonly (readonly [string, (value: never) => unknown])[] = [
  [
    'createInMemoryCatalogLoaders(catalogs)',
    (v) => createInMemoryCatalogLoaders(v),
  ],
  ['withExtensions(bindings)', (v) => withExtensions(v)],
  ['provideLocalizedRouter(routes)', (v) => provideLocalizedRouter(v)],
  [
    'provideLocalizedRouter, the scopes of a route',
    (v) => provideLocalizedRouter(routes, { progressiveScopes: { home: v } }),
  ],
];

describe('a provider option declared as an object', () => {
  for (const [option, call] of OBJECTS) {
    it.each(NOT_AN_OBJECT)(`${option} is refused when it is %j`, (value) => {
      expect(refusal(() => call(value as never))).toBe('invalid-configuration');
    });
  }
});

describe('a provider option declared as a list', () => {
  for (const [option, call] of LISTS) {
    it.each(NOT_A_LIST)(`${option} is refused when it is %j`, (value) => {
      expect(refusal(() => call(value as never))).toBe('invalid-configuration');
    });
  }
});

describe('a provider option declared as text', () => {
  for (const [option, call] of TEXTS) {
    it.each(NOT_TEXT)(`${option} is refused when it is %j`, (value) => {
      expect(refusal(() => call(value as never))).toBe('invalid-configuration');
    });
  }
});

describe('a provider option declared as a function', () => {
  for (const [option, call] of FUNCTIONS) {
    it.each(NOT_A_FUNCTION)(`${option} is refused when it is %j`, (value) => {
      expect(refusal(() => call(value as never))).toBe('invalid-configuration');
    });
  }
});

describe('a provider option declared as one of a set of named values', () => {
  for (const [option, call] of NAMES) {
    it.each(NOT_A_NAME)(`${option} is refused when it is %j`, (value) => {
      expect(refusal(() => call(value as never))).toBe('invalid-configuration');
    });
  }
});

describe('a scope option of provideLocalizedRouter', () => {
  it.each([null, 'text', 7, true])(
    'is refused when it is neither a list nor a table: %j',
    (value) => {
      for (const name of ['requiredScopes', 'progressiveScopes']) {
        expect(
          refusal(() =>
            provideLocalizedRouter(routes, { [name]: value as never }),
          ),
        ).toBe('invalid-configuration');
      }
    },
  );
});

describe('provider options of the kind their declaration names', () => {
  it('are taken', () => {
    expect(
      refusal(() =>
        withRouting({ policy: POLICY, projection: appRouteProjection }),
      ),
    ).toBeUndefined();
    expect(
      refusal(() => withFormattingContext({ timeZone: 'UTC' })),
    ).toBeUndefined();
    expect(refusal(() => withExtensions([]))).toBeUndefined();
    expect(refusal(() => provideLocalizedRouter(routes, {}))).toBeUndefined();
  });

  it('are taken by the features that take a function or a named value', () => {
    for (const call of [
      () => withLocalizationClock({ now: () => undefined } as never),
      () => withObservability({ emit: () => undefined }),
      () => withPersistence((() => ({})) as never),
      () => withLocaleSources('url', 'stored', 'browser', 'default'),
      () => withLocaleAnnouncement(() => undefined),
      () => withOverlayLocale((() => ({})) as never),
      () => createInMemoryCatalogLoaders([]),
      () => createInMemoryCatalogLoaders([{ key: KEY, catalog: {} }]),
      () =>
        provideLocalizationSetup(
          SETUP,
          withLocaleSources('url', 'default'),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      () =>
        provideLocalizationTesting(
          SETUP,
          withObservability({ emit: () => undefined }),
        ),
    ]) {
      expect(refusal(call)).toBeUndefined();
    }
  });
});
