/**
 * What a context reports when it is asked to forget a remembered locale.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 8 has a removal say where it did not
 * land, and a store whose removal throws is one of those places. The caller is told in the answer.
 * An operator is told by the event the context emits for each store it asked: which store, and
 * whether the removal succeeded, failed, or was never offered. A failure carries a reason and the
 * other two carry none, and the stores after a failing one are still asked.
 */
import { expect, it } from 'vitest';

import type {
  LocalizationEventEmitter,
  LocalizationEventInput,
} from '../src/observability.js';
import type { LocalizationPersistenceStore } from '../src/persistence.js';

import { runtime } from './transaction-runtime-harness.js';

it('reports the removal of a store that threw as failed, and asks the stores after it', async () => {
  const forgotten: string[] = [];
  const failing: LocalizationPersistenceStore = {
    id: 'failing',
    read: () => undefined,
    write: () => undefined,
    forget: () => {
      throw new Error('the store under test failed');
    },
  };
  const withoutRemoval: LocalizationPersistenceStore = {
    id: 'without-removal',
    read: () => undefined,
    write: () => undefined,
  };
  const recording: LocalizationPersistenceStore = {
    id: 'recording',
    read: () => undefined,
    write: () => undefined,
    forget: () => void forgotten.push('recording'),
  };
  const events: LocalizationEventInput[] = [];
  const emitter: LocalizationEventEmitter = {
    emit: (input) => void events.push(input),
  };
  const { localization } = runtime({
    options: {
      persistence: [failing, withoutRemoval, recording],
      observability: emitter,
    },
  });
  await localization.initialize();
  events.length = 0;

  const report = await localization.forgetRememberedLocale();

  expect(report).toStrictEqual({
    complete: false,
    unreached: [
      { storeId: 'failing', reason: 'failed' },
      { storeId: 'without-removal', reason: 'no-removal' },
    ],
  });
  expect(forgotten).toStrictEqual(['recording']);
  expect(events).toStrictEqual([
    {
      code: 'EQ-E2008',
      phase: 'persistence',
      status: 'failed',
      reason: 'internal-invariant',
      correlationId: 'failing',
    },
    {
      code: 'EQ-E2008',
      phase: 'persistence',
      status: 'unavailable',
      correlationId: 'without-removal',
    },
    {
      code: 'EQ-E2008',
      phase: 'persistence',
      status: 'succeeded',
      correlationId: 'recording',
    },
  ]);
  localization.dispose();
});
