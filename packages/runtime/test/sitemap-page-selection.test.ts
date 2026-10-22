import { describe, expect, it } from 'vitest';

import {
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  LocalizationError,
  projectSitemap,
  type GeneratedConfiguration,
  type GeneratedRouteProjectionEntry,
  type LocalizedParameterSpellings,
  type RouteParameterCodec,
  type RouteParameterContext,
  type RouteRuntimeProjection,
  type SitemapRouteDeclaration,
} from '@neolorn/equator/core';

/**
 * Which pages a sitemap lists, and what it writes where there are none.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 11. A page is a route and a set of values,
 * listed once at each address that serves it. A route with nothing to enumerate, a value no locale
 * can spell and a page already listed each add nothing, and a build with no page at all still
 * publishes a document a crawler can read.
 */

/** One entity with a spelling of its own in Arabic. `manual` is read, and never written. */
const SLUG: RouteParameterCodec<string> = {
  parse: (slug: string) =>
    slug === 'handbook' || slug === 'دليل' || slug === 'manual'
      ? { ok: true, value: 'handbook' }
      : { ok: false },
  serialize: (entity: string, context?: RouteParameterContext) =>
    entity !== 'handbook'
      ? undefined
      : context?.locale === 'ar-EG'
        ? 'دليل'
        : 'handbook',
};

const SECOND: GeneratedRouteProjectionEntry = {
  id: 'second',
  path: 'second',
  parameterNames: [],
};

function projectionWith(
  second: GeneratedRouteProjectionEntry = SECOND,
): RouteRuntimeProjection {
  return {
    generated: {
      profile: 'equator-route-projection/1',
      identity: 'sha256-SitemapPageSelectionTestIdentity0123456789a',
      routes: [
        second,
        { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
      ],
    },
    parameters: { article: { slug: SLUG } },
  };
}

const CONFIGURATION: GeneratedConfiguration = {
  generatedAbi: 'equator-generated/1',
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
  aliases: {},
  applicationContractFingerprint: 'sha256-application-contract-fixture',
  semanticRegistryFingerprint: 'sha256-semantic-registry-fixture',
  scopes: [],
};

const PREFIXED = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const NEUTRAL = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});

function sitemap(
  routes: readonly SitemapRouteDeclaration[],
  overrides: {
    readonly projection?: RouteRuntimeProjection;
    readonly spellings?: LocalizedParameterSpellings;
    readonly neutral?: boolean;
  } = {},
) {
  const [file] = projectSitemap({
    policy: overrides.neutral === true ? NEUTRAL : PREFIXED,
    projection: overrides.projection ?? projectionWith(),
    configuration: CONFIGURATION,
    origin: 'https://site.example',
    routes,
    ...(overrides.spellings === undefined
      ? {}
      : { spellings: overrides.spellings }),
  });
  if (file === undefined) throw new Error('no sitemap file was produced');
  return file;
}

const locations = (contents: string): string[] =>
  [...contents.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(([, url]) => url ?? '');

const EMPTY_URLSET = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  '</urlset>',
  '',
].join('\n');

const ARABIC_ARTICLE =
  'https://site.example/ar-eg/articles/%D8%AF%D9%84%D9%8A%D9%84';

describe('a build with no page to list', () => {
  it('publishes an empty urlset rather than an empty file', () => {
    const file = sitemap([]);
    expect(file.contents).toBe(EMPTY_URLSET);
    expect(file).toMatchObject({
      name: 'sitemap.xml',
      kind: 'urlset',
      urls: 0,
      bytes: EMPTY_URLSET.length,
    });
  });
});

describe('a parameterised route', () => {
  it('lists nothing where no values were declared for it', () => {
    // A sitemap lists pages, and a pattern is not one.
    const file = sitemap([{ routeId: 'article' }]);
    expect(file.contents).toBe(EMPTY_URLSET);
  });

  it('lists a page per declared value, at each locale address that serves it', () => {
    const file = sitemap([
      { routeId: 'article', prerender: [{ slug: 'handbook' }] },
    ]);
    expect(locations(file.contents)).toEqual([
      'https://site.example/en-us/articles/handbook',
      ARABIC_ARTICLE,
    ]);
  });

  it('lists nothing for a value no locale can spell, and still lists the rest', () => {
    const file = sitemap([
      { routeId: 'article', prerender: [{ slug: 'withdrawn' }] },
      { routeId: 'second' },
    ]);
    expect(locations(file.contents)).toEqual([
      'https://site.example/en-us/second',
      'https://site.example/ar-eg/second',
    ]);
  });

  it('reads the page from the next locale where the first one has no address that serves it', () => {
    // The English spelling declared here is one the codec corrects to another, so no visitor is
    // served the page there. The page still exists in Arabic, and Arabic is what is listed.
    for (const neutral of [false, true]) {
      const file = sitemap(
        [{ routeId: 'article', prerender: [{ slug: 'handbook' }] }],
        { spellings: { slug: { 'en-US': 'manual' } }, neutral },
      );
      expect(locations(file.contents)).toEqual([
        neutral
          ? 'https://site.example/articles/%D8%AF%D9%84%D9%8A%D9%84'
          : ARABIC_ARTICLE,
      ]);
    }
  });
});

describe('a page declared more than once', () => {
  it('is listed once', () => {
    const file = sitemap([
      { routeId: 'second' },
      { routeId: 'second' },
      {
        routeId: 'article',
        prerender: [{ slug: 'handbook' }, { slug: 'handbook' }],
      },
    ]);
    expect(locations(file.contents)).toEqual([
      'https://site.example/en-us/second',
      'https://site.example/ar-eg/second',
      'https://site.example/en-us/articles/handbook',
      ARABIC_ARTICLE,
    ]);
    expect(file.urls).toBe(4);
  });
});

describe('a declared value the route cannot be built from', () => {
  it('fails the sitemap rather than leaving the page out', () => {
    // A value with no spelling in a locale is a page that locale does not have. A value missing
    // the parameter altogether is a mistake in the declaration, in every locale alike.
    let refused: unknown;
    try {
      sitemap([{ routeId: 'article', prerender: [{}] }]);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(LocalizationError);
    expect((refused as LocalizationError).diagnostic.code).toBe(
      'invalid-configuration',
    );
  });
});

describe('the date a route claims it last changed', () => {
  const withLastmod = (lastmod: string) =>
    sitemap([{ routeId: 'second' }], {
      projection: projectionWith({ ...SECOND, sitemap: { lastmod } }),
    });

  it('is written where it is a W3C date or a date and time', () => {
    expect(withLastmod('2026-09-01').contents).toContain(
      '<lastmod>2026-09-01</lastmod>',
    );
    expect(withLastmod('2026-09-01T10:30:00+02:00').contents).toContain(
      '<lastmod>2026-09-01T10:30:00+02:00</lastmod>',
    );
    expect(withLastmod('2026-09-01T10:30:00.25Z').contents).toContain(
      '<lastmod>2026-09-01T10:30:00.25Z</lastmod>',
    );
  });

  it('is refused where a date is only part of it', () => {
    for (const lastmod of ['since 2026-09-01', '2026-09-01 or so']) {
      let refused: unknown;
      try {
        withLastmod(lastmod);
      } catch (error) {
        refused = error;
      }
      expect(refused).toBeInstanceOf(LocalizationError);
    }
  });
});

describe('the priority a route claims', () => {
  const withPriority = (priority: number) =>
    sitemap([{ routeId: 'second' }], {
      projection: projectionWith({ ...SECOND, sitemap: { priority } }),
    });

  /** The diagnostic code a call refuses with, or `undefined` when it did not refuse. */
  const codeOf = (call: () => unknown): string | undefined => {
    try {
      call();
      return undefined;
    } catch (error) {
      if (error instanceof LocalizationError) return error.diagnostic.code;
      throw error;
    }
  };

  it('is written at both ends of the range, which are inside it', () => {
    expect(withPriority(1).contents).toContain('<priority>1.0</priority>');
    expect(withPriority(0).contents).toContain('<priority>0.0</priority>');
  });

  it('is refused below zero', () => {
    expect(codeOf(() => withPriority(-0.5))).toBe('invalid-configuration');
    expect(codeOf(() => withPriority(-0.0001))).toBe('invalid-configuration');
  });

  it('is refused where it is not a finite number', () => {
    for (const priority of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(codeOf(() => withPriority(priority))).toBe(
        'invalid-configuration',
      );
    }
  });
});
