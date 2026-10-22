/**
 * A locale change as one transaction: which requests are the same one, what is readable while it
 * is in flight, and what it lets go of once it has committed.
 *
 * `specs/06-runtime-and-angular.spec.md` section 7: equivalent in-flight requests coalesce, the
 * latest distinct intent wins, and a superseded transition does not commit. Two requests are
 * equivalent when they name the same locale, the same scopes in any order, and the same route. A
 * request for the locale already committed, on the same route and with the same required scopes,
 * has nothing to build and answers with the snapshot that is current.
 */
import { describe, expect, it } from 'vitest';

import { createLocalizationRuntime } from '../src/localization.js';
import type {
  LocalizationRouteSnapshot,
  LocalizationSetup,
} from '@neolorn/equator/core';

import {
  PROVIDER,
  catalogKey,
  compileSet,
  editedSet,
  loadersFor,
  scope,
  type CompiledSet,
} from './catalog-store-harness.js';

const SHELL = scope('shell');
const LAZY = scope('lazy');
/**
 * A scope the configuration declares and no catalog was compiled for, named so that its identity
 * is the identities of the other two written one after the other.
 */
const JOINED = scope(`lazy${PROVIDER}:shell`);
/** As `JOINED`, with the comma a list of identities might be written with between the two. */
const LISTED = scope(`lazy,${PROVIDER}:shell`);

// Compiled on first use, so that importing this file runs none of the library.
let fixture: CompiledSet | undefined;
const compiled = (): CompiledSet =>
  (fixture ??= editedSet(compileSet(), ({ configuration }) => {
    const row = configuration.scopes.find(({ scopeId }) => scopeId === 'shell');
    (configuration as Record<string, unknown>)['scopes'] = [
      ...configuration.scopes,
      { ...row, scopeId: JOINED.scopeId },
      { ...row, scopeId: LISTED.scopeId },
    ];
  }));

const route = (canonicalPath: string): LocalizationRouteSnapshot => ({
  routeId: 'home',
  projectionIdentity: 'projection-fixture',
  canonicalPath,
});

interface Fixture {
  /** Replaces the locale list, for the cases about locales the set has no catalog for. */
  readonly locales?: readonly string[];
  readonly maximumCachedCatalogs?: number;
}

/**
 * A runtime over the compiled set, with its Arabic shell catalog held until `release` is called
 * and every load counted.
 */
function runtime({ locales, maximumCachedCatalogs }: Fixture = {}) {
  const set =
    locales === undefined
      ? compiled()
      : editedSet(compiled(), ({ configuration }) => {
          (configuration as Record<string, unknown>)['locales'] = [...locales];
        });
  const loads: Record<string, number> = {};
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arabic = catalogKey('shell', 'ar-EG');
  const loaders = Object.fromEntries(
    Object.entries(loadersFor(set)).map(([key, load]) => [
      key,
      () => {
        loads[key] = (loads[key] ?? 0) + 1;
        return key === arabic ? held.then(load) : load();
      },
    ]),
  );
  const localization = createLocalizationRuntime({
    setup: {
      configuration: set.configuration,
      catalogSet: set.descriptor,
      catalogLoaders: loaders,
      ...(maximumCachedCatalogs === undefined ? {} : { maximumCachedCatalogs }),
    } as unknown as LocalizationSetup,
    bootstrapScopes: [SHELL],
  });
  return { localization, loads, release };
}

/** A runtime that has committed its first snapshot and holds nothing back. */
async function ready(fixtureOptions: Fixture = {}) {
  const made = runtime(fixtureOptions);
  made.release();
  const snapshot = await made.localization.initialize();
  return { ...made, snapshot };
}

describe('two locale changes asked for while the first is in flight', () => {
  it('are one request when they are the same', async () => {
    const { localization } = await ready();
    const first = localization.changeLocale('ar-EG');
    const second = localization.changeLocale('ar-EG');

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ status: 'committed' });
    localization.dispose();
  });

  it('are one request when they name the same scopes in another order', async () => {
    const { localization } = await ready();
    const first = localization.changeLocale('ar-EG', {
      requiredScopes: [SHELL, LAZY],
    });
    const second = localization.changeLocale('ar-EG', {
      requiredScopes: [LAZY, SHELL],
    });

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ status: 'committed' });
    localization.dispose();
  });

  it('are two when they name different locales, and the later one wins', async () => {
    const { localization } = await ready();
    const first = localization.changeLocale('ar-EG');
    const second = localization.changeLocale('en-US');

    expect(second).not.toBe(first);
    await expect(first).resolves.toMatchObject({ status: 'superseded' });
    await expect(second).resolves.toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'en-US' },
    });
    localization.dispose();
  });

  it('are two when the later one requires another scope', async () => {
    const { localization } = await ready();
    const first = localization.changeLocale('ar-EG', {
      requiredScopes: [SHELL],
    });
    const second = localization.changeLocale('ar-EG', {
      requiredScopes: [SHELL, LAZY],
    });

    expect(second).not.toBe(first);
    await expect(first).resolves.toMatchObject({ status: 'superseded' });
    await expect(second).resolves.toMatchObject({
      status: 'committed',
      snapshot: { requiredScopes: [SHELL, LAZY] },
    });
    localization.dispose();
  });

  it('are two when one scope is named like two others run together', async () => {
    const { localization } = await ready();
    const first = localization.changeLocale('ar-EG', {
      requiredScopes: [LAZY, SHELL],
    });
    const second = localization.changeLocale('ar-EG', {
      requiredScopes: [JOINED],
    });

    expect(second).not.toBe(first);
    await expect(first).resolves.toMatchObject({ status: 'superseded' });
    await second;
    localization.dispose();
  });

  it('are two when one scope is named like a list of two others', async () => {
    const { localization } = await ready();
    const first = localization.changeLocale('ar-EG', {
      requiredScopes: [LAZY, SHELL],
    });
    const second = localization.changeLocale('ar-EG', {
      requiredScopes: [LISTED],
    });

    expect(second).not.toBe(first);
    await expect(first).resolves.toMatchObject({ status: 'superseded' });
    await second;
    localization.dispose();
  });

  it('are two when they carry different routes', async () => {
    const { localization } = await ready();
    const first = localization.changeLocale('ar-EG', {
      route: route('/ar-eg/first'),
    });
    const second = localization.changeLocale('ar-EG', {
      route: route('/ar-eg/second'),
    });

    expect(second).not.toBe(first);
    await expect(first).resolves.toMatchObject({ status: 'superseded' });
    await expect(second).resolves.toMatchObject({
      status: 'committed',
      snapshot: { route: { canonicalPath: '/ar-eg/second' } },
    });
    localization.dispose();
  });

  it('are two when one keeps the route and the other clears it', async () => {
    const { localization } = await ready();
    const kept = localization.changeLocale('ar-EG');
    const cleared = localization.changeLocale('ar-EG', { route: null });

    expect(cleared).not.toBe(kept);
    await expect(kept).resolves.toMatchObject({ status: 'superseded' });
    await expect(cleared).resolves.toMatchObject({ status: 'committed' });
    localization.dispose();
  });
});

describe('a change to the locale already committed', () => {
  it('answers with the committed snapshot when nothing else differs', async () => {
    const { localization, snapshot } = await ready();

    const implied = await localization.changeLocale('en-US');
    const stated = await localization.changeLocale('en-US', {
      requiredScopes: [SHELL],
    });

    expect(implied).toMatchObject({ status: 'committed' });
    expect(implied.status === 'committed' && implied.snapshot).toBe(snapshot);
    expect(stated.status === 'committed' && stated.snapshot).toBe(snapshot);
    localization.dispose();
  });

  it('commits a new snapshot when it requires fewer scopes', async () => {
    const { localization } = await ready();
    await localization.changeLocale('en-US', { requiredScopes: [SHELL, LAZY] });

    await expect(
      localization.changeLocale('en-US', { requiredScopes: [SHELL] }),
    ).resolves.toMatchObject({
      status: 'committed',
      snapshot: { requiredScopes: [SHELL] },
    });
    localization.dispose();
  });

  it('keeps the scopes already required when it names none, by an empty list as by no list', async () => {
    const { localization } = await ready();
    const widened = await localization.changeLocale('en-US', {
      requiredScopes: [SHELL, LAZY],
    });

    const unnamed = await localization.changeLocale('en-US', {
      requiredScopes: [],
    });
    const moved = await localization.changeLocale('ar-EG', {
      requiredScopes: [],
    });

    expect(unnamed.status === 'committed' && unnamed.snapshot).toBe(
      widened.status === 'committed' && widened.snapshot,
    );
    expect(moved).toMatchObject({
      status: 'committed',
      snapshot: { requiredScopes: [SHELL, LAZY], loadedScopes: [SHELL, LAZY] },
    });
    localization.dispose();
  });

  it('prepares the scopes again when one of them differs', async () => {
    const { localization } = await ready();
    await localization.changeLocale('en-US', { requiredScopes: [SHELL, LAZY] });

    // The scope that replaces the lazy one has no catalog, so a change that prepares it fails,
    // and one that took the committed snapshot for an answer would not.
    await expect(
      localization.changeLocale('en-US', { requiredScopes: [SHELL, JOINED] }),
    ).resolves.toMatchObject({ status: 'failed' });
    localization.dispose();
  });
});

/**
 * `specs/06-runtime-and-angular.spec.md` section 5 names the five lifecycle states, and section 4
 * keeps the committed locale apart from the one a change is moving towards. A switcher reads both
 * off `localeChoices`: `current` marks the locale on screen and `pending` the one in flight, and
 * until the change commits they are different options. The change here is held open by its
 * catalog loader, so the state in between can be read rather than raced.
 */
describe('the locale options of a switcher', () => {
  const flags = (
    localization: ReturnType<typeof createLocalizationRuntime>,
    flag: 'current' | 'pending',
  ) =>
    Object.fromEntries(
      localization
        .localeChoices()
        .map((choice) => [choice.locale, choice[flag]]),
    );

  it('carry the bare language and the direction of each locale', () => {
    const { localization } = runtime();

    expect(
      localization
        .localeChoices()
        .map(({ locale, language, direction }) => [
          locale,
          language,
          direction,
        ]),
    ).toStrictEqual([
      ['en-US', 'en', 'ltr'],
      ['ar-EG', 'ar', 'rtl'],
    ]);
    localization.dispose();
  });

  it('name a locale the host has no name for by the tag itself', () => {
    const { localization } = runtime({
      locales: ['en-US', 'ar-EG', 'en-x-region'],
    });

    expect(
      localization
        .localeChoices()
        .map(({ locale, language, direction }) => [locale, language, direction])
        .at(-1),
    ).toStrictEqual(['en-x-region', 'en', 'ltr']);
    localization.dispose();
  });

  it('mark nothing before the first snapshot', () => {
    const { localization } = runtime();

    expect(localization.lifecycle()).toBe('uninitialized');
    expect(localization.ready()).toBe(false);
    expect(flags(localization, 'current')).toStrictEqual({
      'en-US': false,
      'ar-EG': false,
    });
    expect(flags(localization, 'pending')).toStrictEqual({
      'en-US': false,
      'ar-EG': false,
    });
    localization.dispose();
  });

  it('mark the committed locale as current once there is one', async () => {
    const { localization } = await ready();

    expect(localization.lifecycle()).toBe('ready');
    expect(localization.ready()).toBe(true);
    expect(flags(localization, 'current')).toStrictEqual({
      'en-US': true,
      'ar-EG': false,
    });
    expect(flags(localization, 'pending')).toStrictEqual({
      'en-US': false,
      'ar-EG': false,
    });
    localization.dispose();
  });

  it('mark the target as pending and leave the committed locale current while a change is in flight', async () => {
    const { localization, release } = runtime();
    await localization.initialize();

    const change = localization.changeLocale('ar-EG');
    await expect.poll(() => localization.targetLocale()).toBe('ar-EG');

    expect(localization.lifecycle()).toBe('transitioning');
    expect(localization.ready()).toBe(false);
    expect(flags(localization, 'current')).toStrictEqual({
      'en-US': true,
      'ar-EG': false,
    });
    expect(flags(localization, 'pending')).toStrictEqual({
      'en-US': false,
      'ar-EG': true,
    });

    release();
    await expect(change).resolves.toMatchObject({ status: 'committed' });

    expect(localization.ready()).toBe(true);
    expect(flags(localization, 'current')).toStrictEqual({
      'en-US': false,
      'ar-EG': true,
    });
    expect(flags(localization, 'pending')).toStrictEqual({
      'en-US': false,
      'ar-EG': false,
    });
    localization.dispose();
  });
});

/**
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 9: an entry acquired for use is pinned
 * while it is held, and eviction takes the least recently used unpinned entry. A locale change
 * replaces the snapshot, so what the replaced snapshot held has to be let go, or a bounded cache
 * would keep every locale a reader has ever visited. The loader count says whether the catalog of
 * a locale that was left is still cached.
 */
describe('the catalog of a locale the reader has left', () => {
  it('leaves a cache that has no room for it, and is loaded again on return', async () => {
    const { localization, loads } = await ready({ maximumCachedCatalogs: 1 });

    await localization.changeLocale('ar-EG');
    await localization.changeLocale('en-US');
    await localization.changeLocale('ar-EG');

    expect(loads[catalogKey('shell', 'ar-EG')]).toBe(2);
    // The source catalog is used by every snapshot, so it was never unpinned.
    expect(loads[catalogKey('shell', 'en-US')]).toBe(1);
    localization.dispose();
  });

  it('stays in a cache that has room for it', async () => {
    const { localization, loads } = await ready({ maximumCachedCatalogs: 2 });

    await localization.changeLocale('ar-EG');
    await localization.changeLocale('en-US');
    await localization.changeLocale('ar-EG');

    expect(loads[catalogKey('shell', 'ar-EG')]).toBe(1);
    localization.dispose();
  });
});
