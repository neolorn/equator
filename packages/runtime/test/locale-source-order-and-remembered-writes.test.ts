/**
 * Which source decides the locale of a first request, and what a committed choice writes.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 7 names the four sources and their
 * default order, and lets an application state another order or leave sources out; a source that
 * has nothing to say declines, and the next one is asked. Section 8 has the stores read in the
 * order they were declared, the first believable answer winning, and a choice written after its
 * commit so that an older write never lands over a newer selection.
 * `specs/06-runtime-and-angular.spec.md` section 11 reports what persistence did without letting
 * it decide anything.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationSnapshot } from '@neolorn/equator/core';

import {
  LocaleResolution,
  type LocaleResolutionContext,
} from '../src/locale-resolution.js';
import {
  RUNTIME_EVENT_CODES,
  type LocalizationEventInput,
} from '../src/observability.js';
import type { LocalizationPersistenceStore } from '../src/persistence.js';

const SUPPORTED = Object.freeze(['en-US', 'ar-EG', 'fr-FR']);

/** A resolution over the given sources, with every event it reports collected. */
function resolutionOver(context: Partial<LocaleResolutionContext> = {}) {
  const events: LocalizationEventInput[] = [];
  const resolution = new LocaleResolution({
    persistence: undefined,
    initialLocale: undefined,
    requestContext: undefined,
    preferredLanguages: undefined,
    localeFromAddress: undefined,
    localeSources: undefined,
    defaultLocale: 'en-US',
    localeList: SUPPORTED,
    supportedLocales: new Set(SUPPORTED),
    seeded: Promise.resolve(),
    canonicalLocale: (locale: string) => {
      const canonical = SUPPORTED.find(
        (supported) => supported.toLowerCase() === locale.toLowerCase(),
      );
      if (canonical !== undefined) return canonical;
      if (!/^[a-z]{2}-[A-Z]{2}$/u.test(locale)) {
        throw new RangeError('not a locale');
      }
      return locale;
    },
    observability: { emit: (event) => events.push(event) },
    ...context,
  });
  return { resolution, events };
}

/** A store holding `remembered`, recording what is written to it. */
function store(id: string, remembered?: string) {
  const writes: string[] = [];
  const port: LocalizationPersistenceStore = {
    id,
    read: () => remembered,
    write: (locale) => {
      writes.push(locale);
    },
  };
  return { port, writes };
}

/** `persistLocale` reads the id and the primary locale, and nothing else on the snapshot. */
const committed = (id: number, primaryLocale: string): LocalizationSnapshot =>
  ({ id, primaryLocale }) as unknown as LocalizationSnapshot;

/** Every microtask and timer already due, for a case that states what was not written. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const signal = (): AbortSignal => new AbortController().signal;

describe('the locale of a first request', () => {
  it('is the one the application stated, canonicalized, whatever the sources say', async () => {
    const { resolution } = resolutionOver({
      initialLocale: 'ar-eg',
      persistence: [store('cookie', 'fr-FR').port],
      localeFromAddress: () => 'fr-FR',
    });

    expect(await resolution.resolveInitialLocale(signal())).toBe('ar-EG');
  });

  it('is the address’s before the stored one, the stored one before the client’s, and the default last', async () => {
    const everything = {
      localeFromAddress: () => 'fr-FR',
      persistence: [store('cookie', 'ar-EG').port],
      preferredLanguages: ['fr-FR'],
    };

    expect(
      await resolutionOver(everything).resolution.resolveInitialLocale(
        signal(),
      ),
    ).toBe('fr-FR');
    expect(
      await resolutionOver({
        ...everything,
        localeFromAddress: () => undefined,
      }).resolution.resolveInitialLocale(signal()),
    ).toBe('ar-EG');
    expect(
      await resolutionOver({
        preferredLanguages: ['fr-FR'],
        persistence: [store('cookie').port],
      }).resolution.resolveInitialLocale(signal()),
    ).toBe('fr-FR');
    expect(
      await resolutionOver().resolution.resolveInitialLocale(signal()),
    ).toBe('en-US');
  });

  it('follows the order the application declared', async () => {
    const { resolution } = resolutionOver({
      localeSources: ['default', 'stored'],
      persistence: [store('cookie', 'ar-EG').port],
    });

    expect(await resolution.resolveInitialLocale(signal())).toBe('en-US');
  });

  it('asks only the sources the application declared', async () => {
    const storedOnly = resolutionOver({
      localeSources: ['stored'],
      persistence: [store('cookie', 'ar-EG').port],
      preferredLanguages: ['fr-FR'],
      localeFromAddress: () => 'fr-FR',
    });
    expect(await storedOnly.resolution.resolveInitialLocale(signal())).toBe(
      'ar-EG',
    );

    // With nothing stored the one declared source declines, and the configured default is what
    // is left: the client's preference was not among the sources.
    const nothingStored = resolutionOver({
      localeSources: ['stored'],
      persistence: [store('cookie').port],
      preferredLanguages: ['fr-FR'],
    });
    expect(await nothingStored.resolution.resolveInitialLocale(signal())).toBe(
      'en-US',
    );
  });

  it('negotiates the client’s preferences in their order, skipping what is not a locale', async () => {
    const { resolution } = resolutionOver({
      localeSources: ['browser'],
      preferredLanguages: ['not a locale', 'de-DE', 'ar-eg', 'fr-FR'],
    });

    expect(await resolution.resolveInitialLocale(signal())).toBe('ar-EG');
  });

  it('prefers the locale the client named to an earlier one of the same language', async () => {
    const served = ['en-US', 'en-GB'];
    const { resolution } = resolutionOver({
      localeSources: ['browser'],
      preferredLanguages: ['en-GB'],
      localeList: served,
      supportedLocales: new Set(served),
    });

    expect(await resolution.resolveInitialLocale(signal())).toBe('en-GB');
  });

  it('lets an address that states an unserved locale decline', async () => {
    const { resolution } = resolutionOver({
      localeFromAddress: () => 'de-DE',
      persistence: [store('cookie', 'ar-EG').port],
    });

    expect(await resolution.resolveInitialLocale(signal())).toBe('ar-EG');
  });
});

describe('reading the remembered locale', () => {
  it('reports nothing where no store is configured', async () => {
    const { resolution, events } = resolutionOver();

    expect(await resolution.readPersistedLocale(signal())).toBeUndefined();
    expect(events).toStrictEqual([]);
  });

  it('passes over a store that holds nothing, without a report', async () => {
    const { resolution, events } = resolutionOver({
      persistence: [store('cookie').port, store('profile', 'ar-EG').port],
    });

    expect(await resolution.readPersistedLocale(signal())).toBe('ar-EG');
    expect(events).toStrictEqual([]);
  });

  it('passes over a locale the application no longer serves, and says so', async () => {
    const { resolution, events } = resolutionOver({
      persistence: [
        store('cookie', 'de-DE').port,
        store('profile', 'ar-EG').port,
      ],
    });

    expect(await resolution.readPersistedLocale(signal())).toBe('ar-EG');
    expect(events).toStrictEqual([
      {
        code: RUNTIME_EVENT_CODES.persistence,
        phase: 'persistence',
        status: 'unavailable',
        reason: 'unsupported-locale',
        targetLocale: 'de-DE',
        correlationId: 'cookie',
      },
    ]);
  });

  it('passes over a store that could not be read, and says so', async () => {
    const failing: LocalizationPersistenceStore = {
      id: 'profile',
      read: () => {
        throw new Error('the preference endpoint is down');
      },
      write: () => undefined,
    };
    const { resolution, events } = resolutionOver({
      persistence: [failing, store('cookie', 'ar-EG').port],
    });

    expect(await resolution.readPersistedLocale(signal())).toBe('ar-EG');
    expect(events).toStrictEqual([
      {
        code: RUNTIME_EVENT_CODES.persistence,
        phase: 'persistence',
        status: 'failed',
        reason: 'internal-invariant',
        correlationId: 'profile',
      },
    ]);
  });

  it('passes over a stored value that is not a locale, without repeating it', async () => {
    const { resolution, events } = resolutionOver({
      persistence: [
        store('cookie', '<script>').port,
        store('profile', 'ar-EG').port,
      ],
    });

    expect(await resolution.readPersistedLocale(signal())).toBe('ar-EG');
    expect(events).toStrictEqual([
      {
        code: RUNTIME_EVENT_CODES.persistence,
        phase: 'persistence',
        status: 'unavailable',
        reason: 'unsupported-locale',
        correlationId: 'cookie',
      },
    ]);
  });

  it('passes over what it cannot use with no emitter configured', async () => {
    const { resolution } = resolutionOver({
      persistence: [
        store('cookie', '<script>').port,
        store('session', 'de-DE').port,
        store('profile', 'ar-EG').port,
      ],
      observability: undefined,
    });

    expect(await resolution.readPersistedLocale(signal())).toBe('ar-EG');
  });

  it('answers nothing when the only stored locale is one it no longer serves', async () => {
    const { resolution } = resolutionOver({
      persistence: [store('cookie', 'de-DE').port],
    });

    expect(await resolution.readPersistedLocale(signal())).toBeUndefined();
  });
});

describe('remembering a committed locale', () => {
  it('writes it to every store in the declared order and reports each write', async () => {
    const cookie = store('cookie');
    const profile = store('profile');
    const { resolution, events } = resolutionOver({
      persistence: [cookie.port, profile.port],
    });

    resolution.persistLocale(committed(1, 'ar-EG'), 'en-US');
    await settled();

    expect(cookie.writes).toStrictEqual(['ar-EG']);
    expect(profile.writes).toStrictEqual(['ar-EG']);
    expect(events).toStrictEqual(
      ['cookie', 'profile'].map((correlationId) => ({
        code: RUNTIME_EVENT_CODES.persistence,
        phase: 'persistence',
        status: 'succeeded',
        targetLocale: 'ar-EG',
        correlationId,
        snapshotId: 1,
      })),
    );
  });

  it('writes with no emitter configured', async () => {
    const cookie = store('cookie');
    const profile = store('profile');
    const { resolution } = resolutionOver({
      persistence: [cookie.port, profile.port],
      observability: undefined,
    });

    resolution.persistLocale(committed(1, 'ar-EG'), 'en-US');
    await settled();

    expect(cookie.writes).toStrictEqual(['ar-EG']);
    expect(profile.writes).toStrictEqual(['ar-EG']);
  });

  it('writes nothing for a commit that left the locale where it was', async () => {
    const cookie = store('cookie');
    const { resolution, events } = resolutionOver({
      persistence: [cookie.port],
    });

    resolution.persistLocale(committed(1, 'ar-EG'), 'ar-EG');
    await settled();

    expect(cookie.writes).toStrictEqual([]);
    expect(events).toStrictEqual([]);
  });

  it('reports nothing where no store is configured', async () => {
    const { resolution, events } = resolutionOver();

    resolution.persistLocale(committed(1, 'ar-EG'), 'en-US');
    await settled();

    expect(events).toStrictEqual([]);
  });

  it('never writes an older commit after a newer one', async () => {
    const cookie = store('cookie');
    const { resolution } = resolutionOver({ persistence: [cookie.port] });

    resolution.persistLocale(committed(2, 'ar-EG'), 'en-US');
    await settled();
    resolution.persistLocale(committed(1, 'fr-FR'), 'en-US');
    await settled();

    expect(cookie.writes).toStrictEqual(['ar-EG']);
  });

  it('remembers one commit once', async () => {
    const cookie = store('cookie');
    const { resolution } = resolutionOver({ persistence: [cookie.port] });

    resolution.persistLocale(committed(2, 'ar-EG'), 'en-US');
    await settled();
    resolution.persistLocale(committed(2, 'ar-EG'), 'en-US');
    await settled();

    expect(cookie.writes).toStrictEqual(['ar-EG']);
  });

  it('skips a write a newer choice overtook, and reports it superseded', async () => {
    const cookie = store('cookie');
    const { resolution, events } = resolutionOver({
      persistence: [cookie.port],
    });

    // Two commits before either write has started: the first is already out of date.
    resolution.persistLocale(committed(1, 'ar-EG'), 'en-US');
    resolution.persistLocale(committed(2, 'fr-FR'), 'ar-EG');
    await settled();

    expect(cookie.writes).toStrictEqual(['fr-FR']);
    expect(events).toStrictEqual([
      {
        code: RUNTIME_EVENT_CODES.persistence,
        phase: 'persistence',
        status: 'superseded',
        targetLocale: 'ar-EG',
        snapshotId: 1,
      },
      {
        code: RUNTIME_EVENT_CODES.persistence,
        phase: 'persistence',
        status: 'succeeded',
        targetLocale: 'fr-FR',
        correlationId: 'cookie',
        snapshotId: 2,
      },
    ]);
  });

  it('still writes the newer choice with no emitter configured', async () => {
    const cookie = store('cookie');
    const { resolution } = resolutionOver({
      persistence: [cookie.port],
      observability: undefined,
    });

    resolution.persistLocale(committed(1, 'ar-EG'), 'en-US');
    resolution.persistLocale(committed(2, 'fr-FR'), 'ar-EG');
    await settled();

    expect(cookie.writes).toStrictEqual(['fr-FR']);
  });
});
