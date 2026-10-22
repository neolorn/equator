import { describe, expect, it } from 'vitest';

import type { LocalizationEventEmitter } from '../src/observability.js';

import { catalogKey, rejectionOf } from './catalog-store-harness.js';
import { LAZY, runtime } from './transaction-runtime-harness.js';

describe('a store disposed with its context', () => {
  it('asks no loader for a scope whose request the disposal interrupted', async () => {
    let made: ReturnType<typeof runtime> | undefined;
    const emitter: LocalizationEventEmitter = {
      emit: (event) => {
        if (
          event.phase === 'catalog' &&
          event.status === 'started' &&
          event.scopeId === 'lazy'
        ) {
          made?.localization.dispose();
        }
      },
    };
    made = runtime({ options: { observability: emitter } });
    const { localization, loads } = made;
    await localization.initialize();

    const diagnostic = await rejectionOf(() => localization.ensureScope(LAZY));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(diagnostic).toMatchObject({ code: 'disposed' });
    expect(loads[catalogKey('lazy', 'en-US')] ?? 0).toBe(0);
  });
});
