/**
 * What a context reports when a store fails to remember a committed locale.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 8 writes a deliberate change to the
 * configured stores after it commits, and `specs/06-runtime-and-angular.spec.md` section 11 has a
 * persistence failure reported and never roll back a valid commit. A store that throws therefore
 * cannot fail the change, and the report of the write is the only place the failure shows: it
 * names the store and the locale, and the stores after it are still written.
 */
import { expect, it } from 'vitest';

import type { LocalizationPersistenceStore } from '../src/persistence.js';

import { observed, runtime } from './transaction-runtime-harness.js';

/** Every microtask and timer already due, so the queued writes have run. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

it('reports the write of a store that threw as failed, and writes the store after it', async () => {
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
    write: (locale) => void written.push(locale),
  };
  const watched = observed();
  const { localization } = runtime({
    options: {
      persistence: [failing, recording],
      observability: watched.emitter,
    },
  });
  await localization.initialize();

  const result = await localization.changeLocale('ar-EG');
  await settled();

  expect(result.status).toBe('committed');
  expect(
    watched
      .phase('persistence')
      .map(({ status, correlationId, targetLocale }) => [
        status,
        correlationId,
        targetLocale,
      ]),
  ).toStrictEqual([
    ['failed', 'failing', 'ar-EG'],
    ['succeeded', 'recording', 'ar-EG'],
  ]);
  expect(written).toStrictEqual(['ar-EG']);
  localization.dispose();
});
