import { describe, expect, it } from 'vitest';

import { refuseUndeclaredMode } from '../router/src/navigation-scopes.js';
import { LocalizationError } from '@neolorn/equator/core';

/**
 * The mode the Router integration is configured with.
 *
 * `specs/06-runtime-and-angular.spec.md` section 7 gives a locale change one of two modes and
 * refuses any other. The integration makes a change of its own on every navigation in the mode it
 * was configured with, so a value that is neither is refused where the configuration is given, by
 * `provideLocalizedRouter` and by the integration's constructor, which both ask this function.
 */

function refusal(act: () => unknown): LocalizationError | undefined {
  try {
    act();
  } catch (error: unknown) {
    if (error instanceof LocalizationError) return error;
    throw error;
  }
  return undefined;
}

describe('the mode of the Router integration', () => {
  it.each(['eager', 'Coordinated', '', 0, false, null, {}])(
    'is refused as a configuration fault when it is %j',
    (mode) => {
      expect(
        refusal(() => refuseUndeclaredMode(mode))?.diagnostic,
      ).toStrictEqual({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message:
          'The mode of the localized Router integration is coordinated or progressive.',
      });
    },
  );

  it.each([undefined, 'coordinated', 'progressive'])(
    'is taken when it is %j',
    (mode) => {
      expect(refusal(() => refuseUndeclaredMode(mode))).toBeUndefined();
    },
  );
});
