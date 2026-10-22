import { describe, expect, it } from 'vitest';

import { localizedRouteTable } from '../router/src/route-table.js';
import {
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * Which authored entries become addresses, and which spellings a branch may carry.
 *
 * Plain objects and no Angular, for the reason `localized-route-table.test.ts` gives: Angular
 * validates a route config only in a development build, so the shipped path is the one exercised
 * here.
 */

class StubComponent {}
const HOME = () => Promise.resolve(StubComponent);
const PAGE = () => Promise.resolve(StubComponent);

const POLICY: LocaleUrlPolicy = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: [],
  omitDefaultPrefix: false,
};

const NEUTRAL: LocaleUrlPolicy = {
  kind: 'locale-neutral',
  defaultLocale: 'en-US',
  locales: { 'en-US': '', 'ar-EG': '' },
  localeNeutralRoots: [],
};

const projectionOf = (
  routes: RouteRuntimeProjection['generated']['routes'],
  localizedPaths?: RouteRuntimeProjection['localizedPaths'],
): RouteRuntimeProjection => ({
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-RouteTableFlatteningTestIdentity0123456789_',
    routes,
  },
  ...(localizedPaths === undefined ? {} : { localizedPaths }),
});

const HOME_ONLY = projectionOf([
  { id: 'route:_index', path: '', parameterNames: [] },
]);

function childPaths(
  table: ReturnType<typeof localizedRouteTable>,
  prefix: string,
): readonly (string | undefined)[] {
  const branch = table.branches.find((entry) => entry.path === prefix);
  return (branch?.children ?? []).map((entry) => entry.path);
}

describe('the authored entries that name an address', () => {
  it('reads an empty outlet as the primary one', () => {
    // Angular's `getOutlet` answers the primary outlet for an absent or empty name, so this is a
    // page like any other.
    const table = localizedRouteTable(
      [{ path: 'reports', outlet: '', loadComponent: PAGE }],
      POLICY,
      projectionOf([
        { id: 'route:reports', path: 'reports', parameterNames: [] },
      ]),
    );

    expect(table.problems).toEqual([]);
    expect(childPaths(table, 'ar-eg')).toEqual(['reports']);
  });

  it('keeps an empty-path entry that also carries a matcher', () => {
    // An empty path matches before a matcher is asked, so the address is the parent's own.
    const table = localizedRouteTable(
      [{ path: '', matcher: () => null, loadComponent: HOME }],
      POLICY,
      HOME_ONLY,
    );

    expect(table.problems).toEqual([]);
    expect(childPaths(table, 'ar-eg')).toEqual(['']);
  });

  it('reads an entry with no path as answering at its parent', () => {
    // Angular refuses an entry with neither a path nor a matcher, and only in a development build
    // (`@angular/router` 22.2.1, `validateConfig`). In a production build the entry is matched as
    // an empty path is, so that is how its address is read here.
    const table = localizedRouteTable(
      [
        { loadComponent: HOME },
        { path: 'reports', children: [{ loadComponent: PAGE }] },
      ],
      POLICY,
      projectionOf([
        { id: 'route:_index', path: '', parameterNames: [] },
        { id: 'route:reports', path: 'reports', parameterNames: [] },
      ]),
    );

    expect(table.problems).toEqual([]);
    expect(childPaths(table, 'ar-eg')).toEqual(['', 'reports']);
  });

  it('reports an entry whose only target is an empty list of children', () => {
    const table = localizedRouteTable(
      [
        { path: '', pathMatch: 'full', loadComponent: HOME },
        { path: 'empty', children: [] },
      ],
      POLICY,
      HOME_ONLY,
    );

    expect(table.problems.map((problem) => problem.kind)).toEqual([
      'unrenderable-branch-entry',
    ]);
  });
});

describe('a localized spelling and the parameters it carries', () => {
  it('accepts the declared parameters in any order', () => {
    // Which parameters a spelling carries is what the codec round-trips; a language that puts them
    // in another order has renamed nothing.
    const table = localizedRouteTable(
      [{ path: 'shelf/:b/:a', loadComponent: PAGE }],
      POLICY,
      projectionOf(
        [{ id: 'shelf', path: 'shelf/:b/:a', parameterNames: ['b', 'a'] }],
        { shelf: { 'en-US': 'shelf/:b/:a', 'ar-EG': 'raff/:b/:a' } },
      ),
    );

    expect(table.problems).toEqual([]);
    expect(childPaths(table, 'en-us')).toEqual(['shelf/:b/:a']);
    expect(childPaths(table, 'ar-eg')).toEqual(['raff/:b/:a']);
  });
});

describe('a projection that states less than the authored routes', () => {
  it('spells every branch with the canonical path when no locale has its own', () => {
    const table = localizedRouteTable(
      [{ path: 'second', loadComponent: PAGE }],
      POLICY,
      projectionOf([
        { id: 'route:second', path: 'second', parameterNames: [] },
      ]),
    );

    expect(table.problems).toEqual([]);
    expect(childPaths(table, 'en-us')).toEqual(['second']);
    expect(childPaths(table, 'ar-eg')).toEqual(['second']);
  });

  it('names no root spelling for a route no authored entry renders', () => {
    // Without a locale in the path there is no branch to leave a hole in, so the translated
    // spelling of a route nothing renders is left out rather than given a target it does not have.
    const table = localizedRouteTable(
      [{ path: '', pathMatch: 'full', loadComponent: HOME }],
      NEUTRAL,
      projectionOf(
        [
          { id: 'route:_index', path: '', parameterNames: [] },
          { id: 'route:ghost', path: 'ghost', parameterNames: [] },
        ],
        { 'route:ghost': { 'en-US': 'ghost', 'ar-EG': 'shabah' } },
      ),
    );

    expect(table.branches).toEqual([]);
    expect(table.problems).toEqual([]);
  });
});
