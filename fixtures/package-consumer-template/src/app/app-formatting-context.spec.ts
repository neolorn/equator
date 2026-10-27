import { describe, expect, it, beforeEach } from 'vitest';

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Localization,
  provideLocalizationSetup,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { messages } from '#i18n/shell';

import { appFormattingContext } from './app.config';
import inputs from './exercise-inputs.json';
import { runtimeExtensions } from './runtime-extensions';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

/**
 * Does the formatting context this application declares reach rendered output?
 *
 * This application declares `numberingSystem: 'latn'` in `app.config.ts` and nothing asserted
 * it. Only the
 * browser harness bootstraps through `appConfig`; every vitest spec here builds its own providers,
 * and the one digit assertion in the lab (`formatted-placeholders.spec.ts`) deliberately configures
 * *no* numbering system in order to pin the `arab` fallback. So the declaration could have been
 * deleted, or never wired at all, and the suite would not have moved.
 *
 * This is a claim about the channel, not about the formatter. Whether `Intl` honours a numbering
 * system is a pure question and is settled once in `packages/runtime/test/numeric-formatting.test.ts`:
 * an invariant is asserted in one layer rather than two. What cannot be asked
 * there is whether a value written into `withFormattingContext()` survives the provider composition,
 * the locale change and the message pipeline to arrive at the text a visitor reads. That needs the
 * composed runtime, so it is here.
 *
 * `ar-EG` is the only locale this can be asked in. `latn` is `en-US`'s own default, so the English
 * case renders identically whether the declaration arrives or not: the same vacuity that let a
 * numbering-system injection go green against three locale-default rows.
 */

const ARABIC_INDIC = /[٠-٩]/u;
const LATIN = /[0-9]/u;

function setup(): Localization {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalizationSetup(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
        },
        // The application's own object, not a copy of its values. A copy would keep passing after
        // someone edited the declaration, which is the failure this spec exists to prevent.
        withFormattingContext(appFormattingContext),
      ),
    ],
  });
  return TestBed.inject(Localization);
}

describe('the declared formatting context reaches rendered output', () => {
  let localization: Localization;

  beforeEach(async () => {
    localization = setup();
    await localization.initialize();
    await localization.changeLocale('ar-EG');
  });

  it('renders Latin digits in ar-EG, which resolves to arab on its own', () => {
    const rendered = localization.text(messages.fmt.number, { v: 1234.5 });
    expect(
      rendered,
      'the numbering system the application declared through withFormattingContext',
    ).toMatch(LATIN);
    // Both directions. Asserting only that Latin digits are present would pass for a partly
    // converted string, and asserting only their absence would pass for a string with no digits
    // at all.
    expect(rendered).not.toMatch(ARABIC_INDIC);
    claimCapability('feature:withFormattingContext', {
      platform: TestBed.inject(PLATFORM_ID) as string,
    });
  });

  it('is asserting against a locale whose default differs, so the claim is not vacuous', () => {
    // Read from the platform rather than stated. If a future CLDR made `latn` the default for
    // `ar-EG`, the assertion above would still pass while proving nothing, and this is what
    // notices.
    const platformDefault = new Intl.NumberFormat('ar-EG').resolvedOptions()
      .numberingSystem;
    expect(platformDefault).not.toBe(appFormattingContext.numberingSystem);
  });

  it('is the context the exercise sheet is checked against', () => {
    // The gate hands the sheet's inputs to the host's own formatters with this context, and the
    // sheet is written with the application's. Held equal here, so a change to either one is a
    // change to both.
    expect(inputs.formattingContext).toEqual(appFormattingContext);
  });

  it('still renders Arabic text around the Latin digits', () => {
    // The numbering system is a formatting decision and must not have changed the message locale.
    // A context that arrived by resetting the whole runtime to English would satisfy the digit
    // assertions and be wrong.
    const rendered = localization.text(messages.fmt.number, { v: 1234.5 });
    expect(rendered).toMatch(/\p{Script=Arabic}/u);
  });
});
