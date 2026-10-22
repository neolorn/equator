/**
 * An initialization asked for again from inside the one that is starting.
 *
 * `specs/06-runtime-and-angular.spec.md` section 5 has concurrent initialization coalesced. An
 * observability sink is told that an initialization started while `initialize()` is still on the
 * stack, so a sink that asks for the context there asks before the first call has returned. It is
 * answered with the attempt in flight, as a caller a turn later is.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationSnapshot } from '@neolorn/equator/core';

import type { LocalizationEventEmitter } from '../src/observability.js';
import { catalogKey } from './catalog-store-harness.js';
import { runtime } from './transaction-runtime-harness.js';

describe('initialize() called from a sink that is told an initialization started', () => {
  const reentered = () => {
    const holder: {
      localization?: ReturnType<typeof runtime>['localization'];
    } = {};
    const inner: Promise<LocalizationSnapshot>[] = [];
    const started: number[] = [];
    const emitter: LocalizationEventEmitter = {
      emit: (event) => {
        if (event.phase !== 'initialization' || event.status !== 'started')
          return;
        started.push(started.length);
        if (holder.localization !== undefined && inner.length === 0) {
          inner.push(holder.localization.initialize());
        }
      },
    };
    const fixture = runtime({ options: { observability: emitter } });
    holder.localization = fixture.localization;
    return { ...fixture, inner, started };
  };

  it('is answered with the attempt in flight', async () => {
    const { localization, inner, started } = reentered();

    const outer = localization.initialize();

    expect(inner).toHaveLength(1);
    expect(inner[0]).toBe(outer);
    expect(await outer).toBe(await inner[0]);
    expect(started).toHaveLength(1);
    localization.dispose();
  });

  it('loads each startup catalog once', async () => {
    const { localization, loads } = reentered();

    await localization.initialize();

    expect(loads[catalogKey('shell', 'en-US')]).toBe(1);
    localization.dispose();
  });
});
