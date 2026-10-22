/**
 * What the locale options call a locale the host cannot name.
 *
 * The generated configuration carries a name for each locale the build knew, and the host's
 * display names answer for the rest. A tag with a private-use subtag is one the host refuses to
 * name, and an option without a name cannot be shown, so the option is named by its tag.
 */
import { expect, it } from 'vitest';

import { configured, runtime } from './transaction-runtime-harness.js';

it('names a locale the host refuses to name by its tag', () => {
  const { localization } = runtime({
    set: configured('locales', ['en-US', 'ar-EG', 'en-x-region']),
  });

  expect(
    localization
      .localeChoices()
      .map(({ locale, selfName }) => [locale, selfName])
      .at(-1),
  ).toStrictEqual(['en-x-region', 'en-x-region']);
  localization.dispose();
});
