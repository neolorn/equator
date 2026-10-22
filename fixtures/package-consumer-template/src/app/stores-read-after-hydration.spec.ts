/**
 * A page the server drew is adopted as it was decided, and the stores only the browser can read
 * are read once hydration is over.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 8. The server rendered `en-US`; the
 * browser remembers `ar-EG` and the declared order puts the stored choice first, so the page moves
 * once the application is stable. The transfer is delivered as the `<appId>-state` element, for the
 * reason `runtime-admission-and-limits.spec.ts` gives, and the application is bootstrapped rather
 * than composed through `TestBed`, because the re-read is a bootstrap listener.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_ID, Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  Localization,
  provideLocalizationSetup,
  withFormattingContext,
  withLocaleSources,
  withPersistence,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';

import { runtimeExtensions } from './runtime-extensions';

const KEY = '@neolorn/equator:localization-state/1';
const APP = 'hydration-restore-lab';

@Component({
  selector: 'hydration-restore-host',
  template: '<main data-hydrated-page></main>',
})
class HydrationRestoreHost {}

/** A store that remembers one locale and accepts nothing, as another tab's choice would read. */
const remembering = (locale: string) => () =>
  Object.freeze({
    id: 'remembered',
    read: () => locale,
    write: () => undefined,
  });

const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const step of cleanup.splice(0)) step();
});

describe('a server-rendered page once hydration is over', () => {
  it('moves to the choice the stores hold', async () => {
    const script = document.createElement('script');
    script.id = `${APP}-state`;
    script.type = 'application/json';
    script.textContent = JSON.stringify({
      [KEY]: {
        profile: 'equator-transfer-state/1',
        primaryLocale: 'en-US',
        formatting: { locale: 'en-US' },
        catalogs: [],
        participants: [],
      },
    });
    document.body.appendChild(script);
    const host = document.createElement('hydration-restore-host');
    document.body.appendChild(host);
    cleanup.push(
      () => script.remove(),
      () => host.remove(),
    );

    const application = await bootstrapApplication(HydrationRestoreHost, {
      providers: [
        { provide: APP_ID, useValue: APP },
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders,
            recoveryPayload,
            extensions: runtimeExtensions,
          },
          withPersistence(remembering('ar-EG')),
          withLocaleSources('stored', 'default'),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });
    cleanup.push(() => application.destroy());
    const localization = application.injector.get(Localization);

    // The control: the server's decision was adopted, so the move below is the re-read and not a
    // first resolution that happened to consult the store.
    expect(localization.renderedLocale()).toBe('en-US');

    await application.whenStable();
    await vi.waitFor(() => {
      expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    });
  });
});
