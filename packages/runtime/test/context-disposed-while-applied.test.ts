import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import type { LocalizationCommitHook } from '../src/localization.js';

import { rejectionOf } from './catalog-store-harness.js';
import { observed, runtime } from './transaction-runtime-harness.js';

// `apply` runs before a snapshot is current. A context destroyed there has nothing to publish to,
// so the change is one in flight when its context was destroyed, not a commit that stands.
describe('a context destroyed by a hook while a snapshot is applied', () => {
  it('ends a locale change as cancelled and holds no snapshot', async () => {
    let made: ReturnType<typeof runtime> | undefined;
    let armed = false;
    const told: string[] = [];
    const hook: LocalizationCommitHook = {
      apply: () => {
        if (armed) made?.localization.dispose();
      },
      committed: (snapshot) => {
        told.push(snapshot.primaryLocale);
      },
    };
    made = runtime({ options: { commitHooks: [hook] } });
    const { localization } = made;
    await localization.initialize();
    armed = true;

    const result = await localization.changeLocale('ar-EG');

    expect(result.status).toBe('cancelled');
    expect(localization.snapshot()).toBeUndefined();
    expect(localization.lifecycle()).toBe('failed');
    expect(told).toEqual(['en-US']);
  });

  it('ends an initialization with the disposed failure and holds no snapshot', async () => {
    let made: ReturnType<typeof runtime> | undefined;
    const told: string[] = [];
    const hook: LocalizationCommitHook = {
      apply: () => {
        made?.localization.dispose();
      },
      committed: (snapshot) => {
        told.push(snapshot.primaryLocale);
      },
    };
    made = runtime({ options: { commitHooks: [hook] } });
    const { localization } = made;

    const failure: unknown = await localization
      .initialize()
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LocalizationError);
    expect(failure).toMatchObject({ diagnostic: { code: 'disposed' } });
    // The disposal is the failure itself and stands for nothing else, so it carries no cause.
    expect((failure as LocalizationError).cause).toBeUndefined();
    expect(localization.snapshot()).toBeUndefined();
    expect(told).toEqual([]);
  });
});

// A hook that destroys the context and then throws has stopped the commit twice over. The
// destruction is what the caller is told: a destroyed context has no attempt to retry.
describe('a context destroyed by a hook that then throws', () => {
  it('ends an initialization with the disposed failure, whatever the hook threw', async () => {
    let made: ReturnType<typeof runtime> | undefined;
    const thrown = new Error('the hook under test threw after disposing');
    const hook: LocalizationCommitHook = {
      apply: () => {
        made?.localization.dispose();
        throw thrown;
      },
    };
    made = runtime({ options: { commitHooks: [hook] } });
    const { localization } = made;

    let failure: unknown;
    try {
      await localization.initialize();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(LocalizationError);
    expect(failure).toMatchObject({
      diagnostic: { code: 'disposed', outcome: 'operational-failure' },
      cause: thrown,
    });
    expect(localization.snapshot()).toBeUndefined();
  });

  it('ends an initialization with the disposed failure where the hook threw a typed one', async () => {
    let made: ReturnType<typeof runtime> | undefined;
    const hook: LocalizationCommitHook = {
      apply: () => {
        made?.localization.dispose();
        throw new LocalizationError({
          code: 'invalid-configuration',
          outcome: 'operational-failure',
          message: 'the hook under test refused the snapshot by name',
        });
      },
    };
    made = runtime({ options: { commitHooks: [hook] } });
    const { localization } = made;

    const diagnostic = await rejectionOf(() => localization.initialize());

    expect(diagnostic).toMatchObject({ code: 'disposed' });
  });

  it('reports the attempt as cancelled for the disposal', async () => {
    let made: ReturnType<typeof runtime> | undefined;
    const hook: LocalizationCommitHook = {
      apply: () => {
        made?.localization.dispose();
        throw new Error('the hook under test threw after disposing');
      },
    };
    const sink = observed();
    made = runtime({
      options: { commitHooks: [hook], observability: sink.emitter },
    });
    const { localization } = made;

    await rejectionOf(() => localization.initialize());

    expect(sink.phase('initialization').at(-1)).toMatchObject({
      status: 'cancelled',
      reason: 'disposed',
    });
  });

  it('ends a locale change as cancelled', async () => {
    let made: ReturnType<typeof runtime> | undefined;
    let armed = false;
    const hook: LocalizationCommitHook = {
      apply: () => {
        if (!armed) return;
        made?.localization.dispose();
        throw new Error('the hook under test threw after disposing');
      },
    };
    made = runtime({ options: { commitHooks: [hook] } });
    const { localization } = made;
    await localization.initialize();
    armed = true;

    const result = await localization.changeLocale('ar-EG');

    expect(result).toMatchObject({
      status: 'cancelled',
      diagnostic: { code: 'cancelled' },
    });
  });
});
