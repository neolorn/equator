/**
 * The language a locale option states for a locale with no likely script.
 *
 * An option's language is read from the locale's profile, and a profile needs a script: the one
 * the tag writes, or the one likely-subtags data gives its language. A language that data does not
 * know has neither, so it has no profile. The option still has to state a language, and the tag's
 * first subtag is that language, so the option carries it with the region left off.
 */
import { expect, it } from 'vitest';

import { LocalizationError, localeProfile } from '@neolorn/equator/core';

import { configured, runtime } from './transaction-runtime-harness.js';

it('is the first subtag of the tag', () => {
  expect(() => localeProfile('tlh-AQ')).toThrow(LocalizationError);

  const { localization } = runtime({
    set: configured('locales', ['en-US', 'ar-EG', 'tlh-AQ']),
  });

  expect(
    localization
      .localeChoices()
      .map(({ locale, language }) => [locale, language]),
  ).toStrictEqual([
    ['en-US', 'en'],
    ['ar-EG', 'ar'],
    ['tlh-AQ', 'tlh'],
  ]);
  localization.dispose();
});
