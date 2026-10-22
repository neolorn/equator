import '@angular/compiler';

import { expect, it } from 'vitest';

import { LocaleResolution } from '../src/locale-resolution.js';
import type { LocalizationPersistenceStore } from '../src/persistence.js';
import type { LocalizationSnapshot } from '@neolorn/equator/core';

const resolutionOver = (
  stores: readonly LocalizationPersistenceStore[] | undefined,
) =>
  new LocaleResolution({
    persistence: stores,
    initialLocale: undefined,
    requestContext: undefined,
    preferredLanguages: undefined,
    localeFromAddress: undefined,
    localeSources: undefined,
    defaultLocale: 'en-US',
    localeList: Object.freeze(['en-US', 'ar-EG']),
    supportedLocales: new Set(['en-US', 'ar-EG']),
    seeded: Promise.resolve(),
    canonicalLocale: (locale: string) => locale,
    observability: undefined,
  });

const committed = (id: number, primaryLocale: string): LocalizationSnapshot =>
  ({ id, primaryLocale }) as unknown as LocalizationSnapshot;

it('writes the stores after one whose write threw, with no emitter configured', async () => {
  const written: string[] = [];
  const failing: LocalizationPersistenceStore = {
    id: 'failing',
    read: () => undefined,
    write: () => {
      throw new Error('the store under test failed');
    },
  };
  const recording: LocalizationPersistenceStore = {
    id: 'recording',
    read: () => undefined,
    write: (locale: string) => {
      written.push(locale);
    },
  };
  const resolution = resolutionOver([failing, recording]);
  resolution.persistLocale(committed(1, 'ar-EG'), 'en-US');
  // Queued behind the write, so it settles after it.
  const report = await resolution
    .forgetPersistedLocale()
    .catch(() => 'rejected');
  expect(written).toEqual(['ar-EG']);
  expect(report).not.toBe('rejected');
});

it('reports a removal over no stores as complete', async () => {
  const report = await resolutionOver(undefined).forgetPersistedLocale();
  expect(report).toEqual({ complete: true, unreached: [] });
});
