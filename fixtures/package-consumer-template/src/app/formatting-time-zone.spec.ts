import { describe, expect, it } from 'vitest';

import { TestBed } from '@angular/core/testing';
import { Localization, withFormattingContext } from '@neolorn/equator';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { messages } from '#i18n/shell';

import { runtimeExtensions } from './runtime-extensions';

/**
 * This application's catalogs format dates that name no zone of their own, `fmt.date` among them,
 * so they are written in the formatting context's. A context that names none is refused before
 * anything renders, where the defect is the application's to fix, rather than on the first date a
 * reader is shown.
 */

const setup = {
  configuration,
  catalogSet,
  catalogLoaders,
  recoveryPayload,
  extensions: runtimeExtensions,
};

describe('a date written in the formatting context zone', () => {
  it('refuses to start when the context names no zone', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideLocalizationTesting(setup)],
    });

    expect(() => TestBed.inject(Localization)).toThrow(
      /formats a date or a time in the formatting context's time zone.*withFormattingContext\(\{ timeZone/su,
    );
  });

  it('starts when the context names one', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideLocalizationTesting(
          setup,
          withFormattingContext({ timeZone: 'Asia/Tokyo' }),
        ),
      ],
    });
    const localization = TestBed.inject(Localization);
    await localization.initialize();

    expect(localization.text(messages.fmt.date, { v: new Date(0) })).not.toBe(
      '',
    );
  });
});
