import { describe, expect, it } from 'vitest';

import { navigationScopes } from '../router/src/navigation-scopes.js';
import { createLocalizationRuntime } from '../src/localization.js';
import {
  GENERATED_ABI,
  type LocaleChangeMode,
  type LocalizationSetup,
  type MessageHandle,
} from '@neolorn/equator/core';

import {
  PROVIDER,
  compileSet,
  loadersFor,
  scope,
} from './catalog-store-harness.js';

/**
 * In coordinated mode a navigation waits for the scopes its route names as progressive.
 *
 * `specs/06-runtime-and-angular.spec.md` section 9. A coordinated change commits once everything
 * the view renders is ready, so a scope named as progressive is loaded ahead of a coordinated
 * navigation as a required one is, and arrives beside the navigation only in progressive mode,
 * after the first.
 *
 * The cases drive the runtime the way the Router integration does on a navigation: the scopes the
 * rule says to wait for are preloaded and committed as required, and the rest are handed over to
 * arrive alongside. The message read afterwards belongs to the scope the route names as
 * progressive.
 */

const SHELL = scope('shell');
const LAZY = scope('lazy');

const HEADING: MessageHandle & { readonly resultKind: 'plain' } = Object.freeze(
  {
    generatedAbi: GENERATED_ABI,
    providerId: PROVIDER,
    scopeId: 'lazy',
    messageId: 'heading',
    identity: `${PROVIDER}:lazy:heading`,
    resultKind: 'plain',
    inputNames: Object.freeze([]),
    slotNames: Object.freeze([]),
  },
);

/** One navigation after the first, to a route that names the lazy scope as progressive. */
async function laterNavigation(mode: LocaleChangeMode) {
  const set = compileSet();
  const localization = createLocalizationRuntime({
    setup: {
      configuration: set.configuration,
      catalogSet: set.descriptor,
      catalogLoaders: loadersFor(set),
    } as unknown as LocalizationSetup,
    bootstrapScopes: [SHELL],
  });
  await localization.initialize();
  const { held, alongside } = navigationScopes({
    mode,
    landed: true,
    derived: [],
    required: [],
    progressive: [LAZY],
  });
  await Promise.all(
    held.map((each) => localization.preloadScope(each, 'en-US')),
  );
  const result = await localization.changeLocale('en-US', {
    mode,
    ...(held.length === 0 ? {} : { requiredScopes: held }),
    ...(alongside.length === 0 ? {} : { progressiveScopes: alongside }),
  });
  return { localization, result, held, alongside };
}

describe('a navigation to a route that names a progressive scope', () => {
  it('has the scope ready when it completes, in coordinated mode', async () => {
    const { localization, result, held, alongside } =
      await laterNavigation('coordinated');

    expect(result.status).toBe('committed');
    expect(
      localization.scopeReadiness(LAZY)().status,
      'the scope the route names as progressive, once the navigation has completed',
    ).toBe('ready');
    expect(localization.text(HEADING)).toBe('Lazy heading');
    expect(held).toStrictEqual([LAZY]);
    expect(alongside).toStrictEqual([]);
  });

  it('completes before the scope arrives, in progressive mode', async () => {
    const { localization, result, held, alongside } =
      await laterNavigation('progressive');

    expect(result.status).toBe('committed');
    expect(held).toStrictEqual([]);
    expect(alongside).toStrictEqual([LAZY]);
    // The change has committed and the load it started beside itself has not been awaited.
    expect(localization.scopeReadiness(LAZY)().status).not.toBe('ready');
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('ready');
    expect(localization.text(HEADING)).toBe('Lazy heading');
  });

  it('waits for the scope on the first navigation, in either mode', () => {
    for (const mode of ['coordinated', 'progressive'] as const) {
      expect(
        navigationScopes({
          mode,
          landed: false,
          derived: [],
          required: [],
          progressive: [LAZY],
        }),
      ).toStrictEqual({ held: [LAZY], alongside: [] });
    }
  });

  it('waits for the derived and the required scopes whatever the mode', () => {
    for (const mode of ['coordinated', 'progressive'] as const) {
      for (const landed of [false, true]) {
        expect(
          navigationScopes({
            mode,
            landed,
            derived: [SHELL],
            required: [LAZY],
            progressive: [],
          }),
        ).toStrictEqual({ held: [SHELL, LAZY], alongside: [] });
      }
    }
  });
});

/**
 * The same rule where no Router is involved: section 7 of `specs/06-runtime-and-angular.spec.md`.
 * The scope is handed to the change as progressive in both modes, and only the mode differs.
 */
describe('a locale change that names a progressive scope', () => {
  async function change(mode: LocaleChangeMode, locale: string) {
    const set = compileSet();
    const localization = createLocalizationRuntime({
      setup: {
        configuration: set.configuration,
        catalogSet: set.descriptor,
        catalogLoaders: loadersFor(set),
      } as unknown as LocalizationSetup,
      bootstrapScopes: [SHELL],
    });
    await localization.initialize();
    const result = await localization.changeLocale(locale, {
      mode,
      progressiveScopes: [LAZY],
    });
    return { localization, result };
  }

  it('commits with the scope ready, in coordinated mode', async () => {
    for (const [locale, heading] of [
      ['en-US', 'Lazy heading'],
      ['ar-EG', 'عنوان مؤجل'],
    ] as const) {
      const { localization, result } = await change('coordinated', locale);

      expect(result.status).toBe('committed');
      expect(
        localization.scopeReadiness(LAZY)().status,
        `the scope named as progressive, once the coordinated change to ${locale} has committed`,
      ).toBe('ready');
      expect(localization.text(HEADING)).toBe(heading);

      // Named again on the next change, which carries the scope forward as required.
      await expect(
        localization.changeLocale('en-US', {
          mode: 'coordinated',
          progressiveScopes: [LAZY],
        }),
      ).resolves.toMatchObject({ status: 'committed' });
      expect(localization.text(HEADING)).toBe('Lazy heading');
    }
  });

  it('refuses a scope one call names as both, in either mode', async () => {
    for (const mode of ['coordinated', 'progressive'] as const) {
      const set = compileSet();
      const localization = createLocalizationRuntime({
        setup: {
          configuration: set.configuration,
          catalogSet: set.descriptor,
          catalogLoaders: loadersFor(set),
        } as unknown as LocalizationSetup,
        bootstrapScopes: [SHELL],
      });
      await localization.initialize();
      expect(() =>
        localization.changeLocale('en-US', {
          mode,
          requiredScopes: [SHELL, LAZY],
          progressiveScopes: [LAZY],
        }),
      ).toThrow(/cannot overlap/u);
    }
  });

  it('takes a scope the snapshot requires as progressive again, in progressive mode', async () => {
    // The coordinated change leaves the scope required by the snapshot it commits.
    const { localization } = await change('coordinated', 'en-US');
    expect(
      localization.snapshot()?.requiredScopes.map((entry) => entry.scopeId),
    ).toStrictEqual(['shell', 'lazy']);

    const result = await localization.changeLocale('ar-EG', {
      mode: 'progressive',
      progressiveScopes: [LAZY],
    });

    expect(result.status).toBe('committed');
    expect(
      localization.snapshot()?.requiredScopes.map((entry) => entry.scopeId),
      'the scopes the progressive change waited for',
    ).toStrictEqual(['shell']);
    expect(localization.scopeReadiness(LAZY)().status).not.toBe('ready');
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('ready');
    expect(localization.text(HEADING)).toBe('عنوان مؤجل');
  });

  it('waits for a scope a request is still waiting on, though the change names it as progressive', async () => {
    const set = compileSet();
    const localization = createLocalizationRuntime({
      setup: {
        configuration: set.configuration,
        catalogSet: set.descriptor,
        catalogLoaders: loadersFor(set),
      } as unknown as LocalizationSetup,
      bootstrapScopes: [SHELL],
    });
    await localization.initialize();
    const asked = localization.ensureScope(LAZY);

    const result = await localization.changeLocale('ar-EG', {
      mode: 'progressive',
      progressiveScopes: [LAZY],
    });
    await asked;

    expect(result.status).toBe('committed');
    expect(localization.scopeReadiness(LAZY)().status).toBe('ready');
    expect(localization.text(HEADING)).toBe('عنوان مؤجل');
  });

  it('commits before the scope arrives, in progressive mode', async () => {
    const { localization, result } = await change('progressive', 'ar-EG');

    expect(result.status).toBe('committed');
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    expect(localization.scopeReadiness(LAZY)().status).not.toBe('ready');
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('ready');
    expect(localization.text(HEADING)).toBe('عنوان مؤجل');
  });
});
