import { describe, expect, it } from 'vitest';

import { createLocalizationRuntime } from '../src/localization.js';
import {
  LocalizationError,
  type LocaleChangeMode,
  type LocalizationSetup,
} from '@neolorn/equator/core';

import { compileSet, loadersFor, scope } from './catalog-store-harness.js';

/**
 * A locale change whose mode is neither of the two the contract declares.
 *
 * `specs/06-runtime-and-angular.spec.md` section 7 gives a change one of two modes and refuses any
 * other value as a configuration fault, in the caller's own stack, as it refuses any other option
 * it cannot act on. A value that reaches here untyped is a misspelling or a stale constant, and
 * running it as either mode would decide for the caller whether the page waits.
 */

async function started() {
  const set = compileSet();
  const localization = createLocalizationRuntime({
    setup: {
      configuration: set.configuration,
      catalogSet: set.descriptor,
      catalogLoaders: loadersFor(set),
    } as unknown as LocalizationSetup,
    bootstrapScopes: [scope('shell')],
  });
  await localization.initialize();
  return localization;
}

function refusal(act: () => unknown): LocalizationError {
  try {
    act();
  } catch (error: unknown) {
    if (error instanceof LocalizationError) return error;
    throw error;
  }
  throw new Error('The change was not refused.');
}

describe('changeLocale with a mode that is neither declared value', () => {
  for (const mode of ['eager', 'Coordinated', '', 0, false, null, {}]) {
    it(`refuses ${JSON.stringify(mode)} as a configuration fault and starts nothing`, async () => {
      const localization = await started();
      const before = localization.snapshot();
      const last = localization.lastResult();

      const error = refusal(() =>
        localization.changeLocale('ar-EG', {
          mode: mode as unknown as LocaleChangeMode,
        }),
      );

      expect(error.diagnostic).toMatchObject({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: 'The mode of a locale change is coordinated or progressive.',
      });
      expect(localization.snapshot()).toBe(before);
      expect(localization.lastResult()).toBe(last);
    });
  }

  it('runs a change that names no mode as coordinated, and one that names either as named', async () => {
    const localization = await started();

    expect(await localization.changeLocale('ar-EG')).toMatchObject({
      status: 'committed',
      mode: 'coordinated',
    });
    expect(
      await localization.changeLocale('en-US', { mode: 'progressive' }),
    ).toMatchObject({ status: 'committed', mode: 'progressive' });
    expect(
      await localization.changeLocale('ar-EG', { mode: 'coordinated' }),
    ).toMatchObject({ status: 'committed', mode: 'coordinated' });
  });
});
