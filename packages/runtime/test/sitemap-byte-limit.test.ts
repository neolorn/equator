import { describe, expect, it } from 'vitest';

import {
  createLocaleNeutralPolicy,
  projectSitemap,
  type GeneratedConfiguration,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
  type SitemapDocument,
} from '@neolorn/equator/core';

/**
 * The size limit of one sitemap file, to the byte, and what the parts are called past it.
 *
 * The sitemap protocol allows 52,428,800 bytes uncompressed in one file, and the size is the whole
 * document: the declaration and the root element count with the entries. A set that is exactly
 * that size is one file, and one byte more is two files and an index. The parts are numbered
 * after the published name, ahead of its extension where it has one.
 */

// A case that builds a sitemap at the byte limit takes many times longer where the source is
// instrumented, so it carries its own bound in place of the default one.
const CEILING_CASE_MS = 300_000;

const LIMIT = 52_428_800;

/** Reads any segment as itself, so a page is as long as its values. */
const TEXT: RouteParameterCodec<string> = {
  parse: (value: string) => ({ ok: true, value }),
  serialize: (value: string) => value,
};

const BODY_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;

/** The longest segment an address holds, so the fewest pages reach the limit. */
const SEGMENT = 1024;
const IDENTIFIER = 6;
const SHORTEST = IDENTIFIER + BODY_NAMES.length;
const LONGEST = IDENTIFIER + BODY_NAMES.length * SEGMENT;

/**
 * A long archive route and one dated page.
 *
 * The archive's address appears twice in its entry, so its size moves two bytes at a time. The
 * dated page's fractional seconds move it one byte at a time, which is what lands a total on an
 * exact figure.
 */
function projectionWith(fraction: string): RouteRuntimeProjection {
  return {
    generated: {
      profile: 'equator-route-projection/1',
      identity: 'sha256-SitemapByteLimitTestIdentity0123456789abcde',
      routes: [
        {
          id: 'archive',
          path: 'archive/:id/:a/:b/:c/:d/:e/:f/:g',
          parameterNames: ['id', ...BODY_NAMES],
        },
        {
          id: 'dated',
          path: 'dated',
          parameterNames: [],
          sitemap: { lastmod: `2026-09-01T00:00:00.${fraction}Z` },
        },
      ],
    },
    parameters: {
      archive: Object.fromEntries(
        ['id', ...BODY_NAMES].map((name) => [name, TEXT]),
      ),
    },
  };
}

const POLICY = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US'],
});

const CONFIGURATION: GeneratedConfiguration = {
  generatedAbi: 'equator-generated/1',
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales: ['en-US'],
  aliases: {},
  applicationContractFingerprint: 'sha256-application-contract-fixture',
  semanticRegistryFingerprint: 'sha256-semantic-registry-fixture',
  scopes: [],
};

/** One archive page whose values are `characters` long in all. */
function page(index: number, characters: number): Record<string, string> {
  const shared = characters - IDENTIFIER;
  const each = Math.floor(shared / BODY_NAMES.length);
  const extra = shared - each * BODY_NAMES.length;
  return {
    id: `p${String(index).padStart(IDENTIFIER - 1, '0')}`,
    ...Object.fromEntries(
      BODY_NAMES.map((name, position) => [
        name,
        'a'.repeat(each + (position < extra ? 1 : 0)),
      ]),
    ),
  };
}

function build(
  pages: readonly number[],
  fraction: string | undefined,
  fileName?: string,
): readonly SitemapDocument[] {
  return projectSitemap({
    policy: POLICY,
    projection: projectionWith(fraction ?? '0'),
    configuration: CONFIGURATION,
    origin: 'https://site.example',
    routes: [
      {
        routeId: 'archive',
        prerender: pages.map((characters, index) => page(index, characters)),
      },
      ...(fraction === undefined ? [] : [{ routeId: 'dated' }]),
    ],
    ...(fileName === undefined ? {} : { fileName }),
  });
}

const bytesOf = (files: readonly SitemapDocument[]): number =>
  files[0]?.bytes ?? 0;

/**
 * The bytes of an empty document, of the dated entry before its fraction, and of an archive entry
 * before its two addresses.
 *
 * Measured from small documents rather than written down, and inside the case that asks, so a
 * document that cannot be built fails that case.
 */
function measured(): {
  readonly envelope: number;
  readonly dated: number;
  readonly archived: number;
} {
  const envelope = bytesOf(build([], undefined));
  return {
    envelope,
    dated: bytesOf(build([], '0')) - envelope - 1,
    archived: bytesOf(build([SHORTEST], undefined)) - envelope - 2 * SHORTEST,
  };
}

/** Page lengths and a fraction that make the whole document exactly `total` bytes. */
function sized(total: number): {
  readonly pages: readonly number[];
  readonly fraction: string;
  readonly envelope: number;
} {
  const { envelope, dated, archived } = measured();
  const entries = total - envelope;
  // One digit or two, whichever leaves the archive an even number of bytes to fill.
  const digits = (entries - dated - 1) % 2 === 0 ? 1 : 2;
  let left = entries - dated - digits;
  const pages: number[] = [];
  const longest = archived + 2 * LONGEST;
  const shortest = archived + 2 * SHORTEST;
  while (left > longest) {
    // A page that would leave less than the shortest one behind it is cut in half instead.
    const next =
      left - longest < shortest ? archived + 2 * (LONGEST / 2) : longest;
    pages.push((next - archived) / 2);
    left -= next;
  }
  pages.push((left - archived) / 2);
  return { pages, fraction: '0'.repeat(digits), envelope };
}

describe('a set of pages at the size limit', () => {
  it(
    'is one file at exactly the limit',
    () => {
      const { pages, fraction } = sized(LIMIT);
      const files = build(pages, fraction);
      expect(
        files.map(({ name, kind, urls, bytes }) => ({
          name,
          kind,
          urls,
          bytes,
        })),
      ).toStrictEqual([
        {
          name: 'sitemap.xml',
          kind: 'urlset',
          urls: pages.length + 1,
          bytes: LIMIT,
        },
      ]);
    },
    CEILING_CASE_MS,
  );

  it(
    'is two files and an index at one byte more',
    () => {
      const { pages, fraction, envelope } = sized(LIMIT + 1);
      // A name whose only dot is its first character has no extension, so the parts are numbered at
      // its end.
      const files = build(pages, fraction, '.sitemap');
      expect(
        files.map(({ name, kind, urls }) => ({ name, kind, urls })),
      ).toEqual([
        { name: '.sitemap-1', kind: 'urlset', urls: pages.length },
        { name: '.sitemap-2', kind: 'urlset', urls: 1 },
        { name: '.sitemap', kind: 'index', urls: 2 },
      ]);
      const [first, second] = files;
      expect(first?.bytes).toBeLessThanOrEqual(LIMIT);
      // The two parts hold the same entries as the one document would have, and each carries the
      // declaration and the root element again.
      expect((first?.bytes ?? 0) + (second?.bytes ?? 0)).toBe(
        LIMIT + 1 + envelope,
      );
    },
    CEILING_CASE_MS,
  );
});
