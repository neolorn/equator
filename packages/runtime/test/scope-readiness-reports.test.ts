/**
 * What a scope reports about itself while it is loaded for a locale, and how that load ends.
 *
 * `specs/06-runtime-and-angular.spec.md` section 9: each scope reports the scope, the target
 * locale, whether it is idle, loading, ready or failed, which locales supplied it, and the
 * transition it belongs to, and a catalog from an unrelated locale is never presented as the
 * committed target. `specs/03-locale-identity-and-resolution.spec.md` section 9 decides what a
 * scope with no catalog in the target locale does: the default policy serves it from the source
 * locale and says so, and a strict policy refuses exactly that and nothing else.
 */
import { describe, expect, it } from 'vitest';

import { PROVIDER, catalogKey } from './catalog-store-harness.js';
import {
  HEADING,
  LAZY,
  SHELL,
  UNCOMPILED,
  runtime,
  withUncompiledScope,
  withUntranslatedLocale,
  withoutCatalog,
} from './transaction-runtime-harness.js';

describe('the readiness a scope reports', () => {
  it('names the locale that supplied a startup scope, under the first transition', async () => {
    const { localization } = runtime();
    await localization.initialize();

    expect(localization.scopeReadiness(SHELL)()).toStrictEqual({
      scope: SHELL,
      targetLocale: 'en-US',
      status: 'ready',
      supplyingLocales: ['en-US'],
      transitionId: 0,
    });
    localization.dispose();
  });

  it('names the target locale first and the source locale after it', async () => {
    const { localization } = runtime();
    await localization.initialize();
    await localization.changeLocale('ar-EG');

    expect(localization.scopeReadiness(SHELL)()).toStrictEqual({
      scope: SHELL,
      targetLocale: 'ar-EG',
      status: 'ready',
      supplyingLocales: ['ar-EG', 'en-US'],
      transitionId: 1,
    });
    localization.dispose();
  });

  it('is loading, with no supplying locale yet, while a catalog is on its way', async () => {
    const { localization, release } = runtime({
      hold: [catalogKey('lazy', 'ar-EG')],
    });
    await localization.initialize();

    const change = localization.changeLocale('ar-EG', {
      requiredScopes: [SHELL, LAZY],
    });
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('loading');

    expect(localization.scopeReadiness(LAZY)()).toStrictEqual({
      scope: LAZY,
      targetLocale: 'ar-EG',
      status: 'loading',
      supplyingLocales: [],
      transitionId: 1,
    });
    release(catalogKey('lazy', 'ar-EG'));
    await expect(change).resolves.toMatchObject({ status: 'committed' });
    localization.dispose();
  });

  it('keeps the newer transition when a load asked for under an older one lands late', async () => {
    const { localization, release } = runtime({
      hold: [catalogKey('lazy', 'ar-EG')],
    });
    await localization.initialize();
    await localization.changeLocale('ar-EG');

    // Asked for in Arabic and held open, then overtaken by a change back to English that loads
    // the same scope and commits before the Arabic catalog arrives.
    const ensured = localization.ensureScope(LAZY);
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('loading');
    const back = await localization.changeLocale('en-US');
    release(catalogKey('lazy', 'ar-EG'));
    await ensured;

    expect(back).toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'en-US', requiredScopes: [SHELL, LAZY] },
    });
    expect(localization.scopeReadiness(LAZY)()).toStrictEqual({
      scope: LAZY,
      targetLocale: 'en-US',
      status: 'ready',
      supplyingLocales: ['en-US'],
      transitionId: 2,
    });
    expect(localization.text(HEADING)).toBe('Lazy heading');
    localization.dispose();
  });
});

describe('a scope with no catalog in the target locale', () => {
  it('is served from the source locale, and the snapshot says it is degraded', async () => {
    const { localization } = runtime({ set: withUntranslatedLocale() });
    await localization.initialize();

    const result = await localization.changeLocale('fr-FR');

    expect(result).toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'fr-FR', degraded: true },
    });
    expect(localization.scopeReadiness(SHELL)()).toMatchObject({
      targetLocale: 'fr-FR',
      status: 'ready',
      supplyingLocales: ['en-US'],
    });
    localization.dispose();
  });

  it('degrades the snapshot when it is one scope among translated ones', async () => {
    const { localization } = runtime({ set: withoutCatalog('lazy', 'ar-EG') });
    await localization.initialize();

    const result = await localization.changeLocale('ar-EG', {
      requiredScopes: [SHELL, LAZY],
    });

    expect(result).toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'ar-EG', degraded: true },
    });
    localization.dispose();
  });

  it('is refused under a strict policy, with the scope and the locale named', async () => {
    const { localization } = runtime({
      set: withUntranslatedLocale(),
      setup: { fallbackPolicy: 'strict' },
    });
    const committed = await localization.initialize();

    const result = await localization.changeLocale('fr-FR');

    const refused = {
      code: 'scope-unavailable',
      outcome: 'localized-representation-unavailable',
      targetLocale: 'fr-FR',
      providerId: PROVIDER,
      scopeId: 'shell',
      transitionId: 1,
    };
    expect(result).toMatchObject({ status: 'failed', diagnostic: refused });
    expect(localization.scopeReadiness(SHELL)()).toMatchObject({
      scope: SHELL,
      targetLocale: 'fr-FR',
      status: 'failed',
      supplyingLocales: [],
      transitionId: 1,
      diagnostic: refused,
    });
    expect(localization.snapshot()).toBe(committed);
    localization.dispose();
  });
});

describe('a strict policy', () => {
  it('commits a locale every scope is translated into, and does not call it degraded', async () => {
    const { localization } = runtime({ setup: { fallbackPolicy: 'strict' } });
    const first = await localization.initialize();

    const result = await localization.changeLocale('ar-EG');

    expect(first).toMatchObject({ primaryLocale: 'en-US', degraded: false });
    expect(result).toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'ar-EG', degraded: false },
    });
    localization.dispose();
  });

  it('reports a scope with no source catalog as a broken configuration, not as untranslated', async () => {
    const { localization } = runtime({
      set: withUncompiledScope(),
      setup: { fallbackPolicy: 'strict' },
    });
    await localization.initialize();

    await expect(
      localization.changeLocale('en-US', {
        requiredScopes: [SHELL, UNCOMPILED],
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      diagnostic: { code: 'invalid-configuration' },
    });
    localization.dispose();
  });
});

describe('a scope with no catalog in the source locale', () => {
  it('fails the change as a broken configuration, with the scope and the locale named', async () => {
    const { localization } = runtime({ set: withUncompiledScope() });
    await localization.initialize();

    const result = await localization.changeLocale('ar-EG', {
      requiredScopes: [SHELL, UNCOMPILED],
    });

    const broken = {
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      targetLocale: 'ar-EG',
      providerId: PROVIDER,
      scopeId: 'uncompiled',
      transitionId: 1,
    };
    expect(result).toMatchObject({ status: 'failed', diagnostic: broken });
    expect(localization.scopeReadiness(UNCOMPILED)()).toMatchObject({
      scope: UNCOMPILED,
      targetLocale: 'ar-EG',
      status: 'failed',
      supplyingLocales: [],
      transitionId: 1,
      diagnostic: broken,
    });
    localization.dispose();
  });
});

describe('a scope whose catalog fails to load', () => {
  const failing = () =>
    runtime({
      fail: { [catalogKey('lazy', 'ar-EG')]: 1 },
      setup: { maximumCachedCatalogs: 1 },
    });

  it('fails the change with the load failure, and reports itself failed', async () => {
    const { localization } = failing();
    const committed = await localization.initialize();

    const result = await localization.changeLocale('ar-EG', {
      requiredScopes: [SHELL, LAZY],
    });

    const failed = {
      code: 'catalog-load-failed',
      providerId: PROVIDER,
      scopeId: 'lazy',
    };
    expect(result).toMatchObject({ status: 'failed', diagnostic: failed });
    expect(localization.scopeReadiness(LAZY)()).toMatchObject({
      scope: LAZY,
      targetLocale: 'ar-EG',
      status: 'failed',
      supplyingLocales: [],
      transitionId: 1,
      diagnostic: failed,
    });
    expect(localization.snapshot()).toBe(committed);
    localization.dispose();
  });

  it('lets go of the catalogs that did load for the change that failed', async () => {
    const { localization, loads } = failing();
    await localization.initialize();
    await localization.changeLocale('ar-EG', { requiredScopes: [SHELL, LAZY] });

    // The cache has room for one catalog nobody holds. A catalog the failed change had let go of
    // was evicted and is loaded again when it is next needed; one still held would be served from
    // the cache.
    await localization.ensureScope(LAZY);
    expect(loads[catalogKey('lazy', 'en-US')]).toBe(2);
    await localization.changeLocale('ar-EG', { requiredScopes: [SHELL] });
    expect(loads[catalogKey('shell', 'ar-EG')]).toBe(2);
    localization.dispose();
  });
});

describe('a scope somebody is still waiting for when the locale changes', () => {
  it('is carried into the change once, when the change names it as well', async () => {
    const { localization, release } = runtime({
      hold: [catalogKey('lazy', 'en-US')],
    });
    await localization.initialize();

    const ensured = localization.ensureScope(LAZY);
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('loading');
    const change = localization.changeLocale('ar-EG', {
      requiredScopes: [SHELL, LAZY],
    });
    release(catalogKey('lazy', 'en-US'));

    await expect(change).resolves.toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'ar-EG', requiredScopes: [SHELL, LAZY] },
    });
    await ensured;
    expect(localization.text(HEADING)).toBe('عنوان مؤجل');
    localization.dispose();
  });
});

describe('a scope loading beside a progressive change when the locale changes again', () => {
  it('reports its load as superseded, without waiting for the catalog', async () => {
    const { localization, release } = runtime({
      hold: [catalogKey('lazy', 'ar-EG')],
    });
    await localization.initialize();
    await localization.changeLocale('ar-EG', {
      mode: 'progressive',
      progressiveScopes: [LAZY],
    });
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('loading');

    await localization.changeLocale('en-US');

    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('failed');
    expect(localization.scopeReadiness(LAZY)()).toMatchObject({
      targetLocale: 'ar-EG',
      status: 'failed',
      supplyingLocales: [],
      transitionId: 1,
      diagnostic: { code: 'superseded' },
    });
    release(catalogKey('lazy', 'ar-EG'));
    localization.dispose();
  });
});
