/**
 * A locale change commits on a page that runs no transition.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 12: a release MUST NOT require a transition
 * animation, and an application's motion MUST NOT delay the commit. A commit that waited for a
 * `transitionend` would never end on a page that animates nothing, and on a page that honours a
 * reduced-motion preference by turning its transitions off, which is the reader it would fail.
 *
 * The bound is asserted as a race rather than left to the test timeout, so a commit that waits
 * fails here, by name, instead of as a hang somewhere in the suite.
 */

import { describe, expect, it } from 'vitest';

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

import { runtimeExtensions } from './runtime-extensions';

describe('a locale change on a page with no transition', () => {
  it('commits without waiting for one', async () => {
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
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });
    const localization = TestBed.inject(Localization);
    await localization.initialize();

    const outcome = await Promise.race([
      localization.changeLocale('ar-EG').then(({ status }) => status),
      new Promise<'still waiting'>((resolve) =>
        setTimeout(() => resolve('still waiting'), 2_000),
      ),
    ]);

    expect(outcome).toBe('committed');
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
  });
});
