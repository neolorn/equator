import { describe, expect, it } from 'vitest';

import {
  putBackPageLeft,
  type PageLeftLocalization,
} from '../router/src/navigation-scopes.js';
import { createLocalizationRuntime } from '../src/localization.js';
import type {
  LocaleChangeResult,
  LocalizationRouteSnapshot,
  LocalizationScope,
  LocalizationSetup,
  LocalizationSnapshot,
} from '@neolorn/equator/core';

import { compileSet, loadersFor, scope } from './catalog-store-harness.js';

/**
 * The page a navigation left, put back where the navigation ends without its own.
 *
 * Section 7 of `specs/07-routing-rendering-and-seo.spec.md`. A navigation commits its locale before
 * its page is on screen, and three endings leave that commit to undo: the navigation is cancelled,
 * it fails, or it lands and its document cannot be written. The Router integration answers all
 * three with the function called here, against the context it is called with there.
 */

const LEFT: LocalizationRouteSnapshot = Object.freeze({
  routeId: 'route:left',
  projectionIdentity: 'sha256-NavigationPagePutBackTestIdentity0123456789',
  canonicalPath: '/left',
});
const DESTINATION: LocalizationRouteSnapshot = Object.freeze({
  ...LEFT,
  routeId: 'route:destination',
  canonicalPath: '/destination',
});

/** A context on the page a navigation is about to leave, in English. */
async function onPageLeft() {
  const set = compileSet();
  const localization = createLocalizationRuntime({
    setup: {
      configuration: set.configuration,
      catalogSet: set.descriptor,
      catalogLoaders: loadersFor(set),
    } as unknown as LocalizationSetup,
    bootstrapScopes: [scope('shell')],
  });
  await localization.initialize();
  const arrived = await localization.changeLocale('en-US', {
    requiredScopes: [scope('shell')],
    route: LEFT,
  });
  expect(arrived.status).toBe('committed');
  const previousSnapshot = localization.snapshot();
  expect(previousSnapshot?.route?.canonicalPath).toBe('/left');
  return { localization, previousSnapshot };
}

describe('the page a navigation left, where the navigation ends without its own', () => {
  it('is put back in the locale a change made in place committed after the navigation did', async () => {
    const { localization, previousSnapshot } = await onPageLeft();
    // The navigation's own commit, to another page in the locale already on screen.
    await localization.changeLocale('en-US', {
      requiredScopes: [scope('shell'), scope('lazy')],
      route: DESTINATION,
    });
    const inPlace = await localization.changeLocale('ar-EG');
    expect(inPlace.status).toBe('committed');

    const restored = await putBackPageLeft(localization, {
      mode: 'coordinated',
      previousSnapshot,
      navigationLocale: 'en-US',
    });

    expect(restored).toBe(true);
    const snapshot = localization.snapshot();
    // What the caller of the change was told and what the state is are one locale.
    expect(snapshot?.primaryLocale).toBe('ar-EG');
    expect(snapshot?.route?.routeId).toBe('route:left');
    expect(snapshot?.requiredScopes).toStrictEqual([scope('shell')]);
    localization.dispose();
  });

  it('is put back in the locale from before the navigation where no change was made in place', async () => {
    const { localization, previousSnapshot } = await onPageLeft();
    await localization.changeLocale('ar-EG', {
      requiredScopes: [scope('shell')],
      route: DESTINATION,
    });

    const restored = await putBackPageLeft(localization, {
      mode: 'coordinated',
      previousSnapshot,
      navigationLocale: 'ar-EG',
    });

    expect(restored).toBe(true);
    const snapshot = localization.snapshot();
    expect(snapshot?.primaryLocale).toBe('en-US');
    expect(snapshot?.route).toStrictEqual(LEFT);
    localization.dispose();
  });

  it('answers that nothing was put back where the navigation left no page', async () => {
    const { localization } = await onPageLeft();

    const restored = await putBackPageLeft(localization, {
      mode: 'coordinated',
      previousSnapshot: undefined,
      navigationLocale: 'en-US',
    });

    expect(restored).toBe(false);
    expect(localization.snapshot()?.route?.canonicalPath).toBe('/left');
    localization.dispose();
  });
});

/**
 * The two ways a put-back does not finish, with the context stood in for.
 *
 * A real context commits a change to a locale and scopes it already holds, so neither ending can
 * be produced with one. What is asserted is what the function answers and what it asks for.
 */
describe('a put-back that does not finish', () => {
  const SHELL: LocalizationScope = {
    providerId: '@example/app',
    scopeId: 'shell',
  };
  const LAZY: LocalizationScope = {
    providerId: '@example/app',
    scopeId: 'lazy',
  };
  const previousSnapshot = {
    primaryLocale: 'en-US',
    requiredScopes: [SHELL],
    loadedScopes: [SHELL, LAZY],
    route: LEFT,
  } as unknown as LocalizationSnapshot;

  /** A context that answers the change with the status given, and records what it is asked. */
  function standIn(
    status: LocaleChangeResult['status'],
    ensureScope: (scope: LocalizationScope) => Promise<void>,
  ) {
    const asked: string[] = [];
    const localization: PageLeftLocalization = {
      snapshot: () => undefined,
      changeLocale: (locale, options) => {
        asked.push(
          `change:${locale}:${options?.mode}:${options?.route?.routeId}`,
        );
        return Promise.resolve({ status } as LocaleChangeResult);
      },
      ensureScope: (scope) => {
        asked.push(`scope:${scope.scopeId}`);
        return ensureScope(scope);
      },
    };
    return { asked, localization };
  }

  const left = {
    mode: 'progressive',
    previousSnapshot,
    navigationLocale: 'ar-EG',
  } as const;

  it.each(['failed', 'cancelled', 'superseded', 'redirected'] as const)(
    'answers that nothing was put back where the change ends as %s, and asks for no scope',
    async (status) => {
      const { asked, localization } = standIn(status, () => Promise.resolve());

      expect(await putBackPageLeft(localization, left)).toBe(false);
      expect(asked).toStrictEqual(['change:en-US:progressive:route:left']);
    },
  );

  it('answers that nothing was put back where a scope the page had loaded does not load again', async () => {
    const { asked, localization } = standIn('committed', () =>
      Promise.reject(new Error('unavailable')),
    );

    expect(await putBackPageLeft(localization, left)).toBe(false);
    // The required scope came with the change, so only the other one is asked for.
    expect(asked).toStrictEqual([
      'change:en-US:progressive:route:left',
      'scope:lazy',
    ]);
  });

  it('answers that the page was put back once every scope it had loaded is loaded again', async () => {
    const { asked, localization } = standIn('committed', () =>
      Promise.resolve(),
    );

    expect(await putBackPageLeft(localization, left)).toBe(true);
    expect(asked).toStrictEqual([
      'change:en-US:progressive:route:left',
      'scope:lazy',
    ]);
  });
});
