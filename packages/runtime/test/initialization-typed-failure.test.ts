/**
 * What an initialization rejects with when the thing that stopped it was not a typed failure.
 *
 * `specs/06-runtime-and-angular.spec.md` section 5: when no initial snapshot can be built the
 * failure is typed. Section 11 lets a coherence-critical effect prevent the commit, and such an
 * effect is application code that throws whatever it throws.
 */
import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import type { LocalizationCommitHook } from '../src/localization.js';

import { runtime } from './transaction-runtime-harness.js';

/** A hook that refuses every snapshot with an error of its own until it is told to stop. */
function refusing() {
  const thrown = new Error('the hook under test refused the snapshot');
  const state = { refuse: true };
  const hook: LocalizationCommitHook = {
    apply: () => {
      if (state.refuse) throw thrown;
    },
  };
  return { ...runtime({ options: { commitHooks: [hook] } }), thrown, state };
}

async function failureOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('an initialization stopped by an error that carries no diagnostic', () => {
  it('rejects with the typed internal failure, and keeps what was thrown as its cause', async () => {
    const { localization, thrown } = refusing();

    const failure = await failureOf(() => localization.initialize());

    expect(failure).toBeInstanceOf(LocalizationError);
    expect(failure).toMatchObject({
      diagnostic: {
        code: 'internal-invariant',
        outcome: 'operational-failure',
      },
      cause: thrown,
    });
    expect(localization.lifecycle()).toBe('failed');
    localization.dispose();
  });

  it('rejects a retry the same way, and commits once the hook accepts', async () => {
    const { localization, thrown, state } = refusing();
    await failureOf(() => localization.initialize());

    const failure = await failureOf(() => localization.retry());

    expect(failure).toBeInstanceOf(LocalizationError);
    expect(failure).toMatchObject({
      diagnostic: { code: 'internal-invariant' },
      cause: thrown,
    });
    expect(localization.lifecycle()).toBe('failed');

    state.refuse = false;
    await expect(localization.retry()).resolves.toMatchObject({
      primaryLocale: 'en-US',
    });
    localization.dispose();
  });

  it('hands a typed failure through as it is', async () => {
    const typed = new LocalizationError({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: 'the hook under test refused the snapshot by name',
    });
    const { localization } = runtime({
      options: {
        commitHooks: [
          {
            apply: () => {
              throw typed;
            },
          },
        ],
      },
    });

    expect(await failureOf(() => localization.initialize())).toBe(typed);
    localization.dispose();
  });
});
