import { describe, expect, it } from 'vitest';

import {
  createIdentifierParameterCodec,
  resolveLocalizedRoute,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

import { claimCapability } from '../../../tools/capability-claims-in-tests.ts';

/**
 * A canonical correction lands on the address it names in one hop.
 *
 * Section 6 of `specs/07-routing-rendering-and-seo.spec.md` answers a variant with a 308 only where
 * it is a variant of one final canonical URL, with every correction combined into that one hop. So
 * the location a correction names has to resolve as that route, not as a second correction and
 * not as an address the release refuses. The query is where the two can part: it is bounded as the
 * request spells it and written back in canonical encoding, which can be longer.
 */

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-CanonicalCorrectionSingleHopIdentity0123456',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  localizedPaths: {
    'route:second': { 'en-US': 'second', 'ar-EG': 'الثاني' },
    article: { 'en-US': 'articles/:slug', 'ar-EG': 'مقالات/:slug' },
  },
  parameters: { article: { slug: createIdentifierParameterCodec() } },
};

const policy = (omitDefaultPrefix: boolean): LocaleUrlPolicy => ({
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: [],
  omitDefaultPrefix,
});

// Each spells its query other than canonically. Corrected where the canonical spelling is within
// bounds; refused where it is not, because a correction to it would name an address refused in turn.
const QUERIES: readonly (readonly [string, string, 'corrected' | 'refused'])[] =
  [
    ['a value with an encoded unreserved character', '?a=%7e', 'corrected'],
    ['a name with no value', '?a', 'corrected'],
    ['a value a canonical encoding escapes', '?a=x:y', 'corrected'],
    ['a value in decomposed form', '?a=e%CC%81', 'corrected'],
    [
      'a value that grows past its bound once encoded',
      `?a=${':'.repeat(200)}`,
      'refused',
    ],
    [
      'a query that grows past its bound once encoded',
      `?${Array.from({ length: 30 }, (_, index) => `k${index}=${':'.repeat(60)}`).join('&')}`,
      'refused',
    ],
    ['a fragment a canonical encoding escapes', '?a=1#x:y', 'corrected'],
    [
      'a fragment that grows past its bound once encoded',
      `?a=1#${':'.repeat(200)}`,
      'refused',
    ],
  ];

const PATHS: readonly (readonly [string, boolean, string])[] = [
  ['a prefixed address', false, '/en-us/second'],
  ['a prefixed address with a trailing slash', false, '/en-us/second/'],
  ['an address in another locale spelling', false, '/ar-eg/second'],
  ['the default locale unprefixed', true, '/second'],
  ['the default locale prefixed where it is omitted', true, '/en-us/second'],
];

describe('a canonical correction', () => {
  for (const [pathLabel, omit, path] of PATHS) {
    for (const [queryLabel, query, outcome] of QUERIES) {
      it(`of ${pathLabel} with ${queryLabel} resolves where it points`, () => {
        const first = resolveLocalizedRoute(
          `${path}${query}`,
          policy(omit),
          PROJECTION,
        );
        if (outcome === 'refused') {
          expect(first.status).toBe('malformed');
          return;
        }
        expect(first.status).toBe('redirect');
        if (first.status !== 'redirect') return;
        const second = resolveLocalizedRoute(
          first.location,
          policy(omit),
          PROJECTION,
        );
        expect(
          { status: second.status, location: first.location.length },
          `${path}${query} was corrected to an address that resolves as ${second.status}`,
        ).toMatchObject({ status: 'success' });
        claimCapability('entry:@neolorn/equator/core');
      });
    }
  }
});
