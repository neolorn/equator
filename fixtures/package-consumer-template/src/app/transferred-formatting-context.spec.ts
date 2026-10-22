/**
 * A formatting context the server rendered one locale with belongs to that locale.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4. The transfer is delivered the way a
 * document delivers it, as the `<appId>-state` element, for the reason
 * `runtime-admission-and-limits.spec.ts` gives: seeding `TransferState` through the injector runs
 * after the runtime has already read it.
 *
 * The server's context names Thai digits for `en-US`, which neither locale writes on its own, so
 * the first page shows that the transfer was adopted and the page after a switch shows whether it
 * followed the reader into `ar-EG`.
 */
import { TestBed } from '@angular/core/testing';
import { APP_ID } from '@angular/core';
import { describe, expect, it } from 'vitest';

import {
  Localization,
  provideLocalizationSetup,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { messages } from '#i18n/shell';

import { runtimeExtensions } from './runtime-extensions';

const KEY = '@neolorn/equator:localization-state/1';
const APP = 'transfer-context-lab';
const THAI = /[๐-๙]/u;
const ARABIC_INDIC = /[٠-٩]/u;

describe('a transferred formatting context', () => {
  it('applies to the locale the server rendered and to no other', async () => {
    TestBed.resetTestingModule();
    const script = document.createElement('script');
    script.id = `${APP}-state`;
    script.type = 'application/json';
    script.textContent = JSON.stringify({
      [KEY]: {
        profile: 'equator-transfer-state/1',
        primaryLocale: 'en-US',
        formatting: { locale: 'en-US', numberingSystem: 'thai' },
        catalogs: [],
        participants: [],
      },
    });
    document.body.appendChild(script);
    try {
      await TestBed.configureTestingModule({
        providers: [
          { provide: APP_ID, useValue: APP },
          provideLocalizationSetup(
            {
              configuration,
              catalogSet,
              catalogLoaders,
              extensions: runtimeExtensions,
            },
            withFormattingContext({ timeZone: 'UTC' }),
          ),
        ],
      }).compileComponents();
      const localization = TestBed.inject(Localization);
      await localization.initialize();

      // The control: without it, a transfer that was never adopted passes the assertions below.
      expect(localization.snapshot()?.primaryLocale).toBe('en-US');
      expect(localization.text(messages.fmt.number, { v: 1234 })).toMatch(THAI);

      await localization.changeLocale('ar-EG');
      const arabic = localization.text(messages.fmt.number, { v: 1234 });
      expect(arabic).not.toMatch(THAI);
      expect(arabic).toMatch(ARABIC_INDIC);
      localization.dispose();
    } finally {
      script.remove();
      TestBed.resetTestingModule();
    }
  });
});
