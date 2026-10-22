import {
  type ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import {
  localStorageStore,
  memoryStore,
  withLocaleSources,
  withObservability,
  withPersistence,
  withRecoveryMessage,
  withoutDocumentLocale,
} from '@neolorn/equator';
import { provideLocalization } from '#i18n';
import { messages } from '#i18n/shell';

import { accountProfile } from './account-profile';
import { routes } from './app.routes';
import { eventLog } from './event-log';
import { tabSessionStore } from './tab-session-store';

/**
 * A panel another page embeds, so the page it sits in owns the document's language and direction,
 * and its addresses belong to that page rather than to a locale.
 *
 * No address states a locale here, so the reader decides: a choice remembered in one of four
 * places, then the languages their browser sends, then the panel's own default. The stores are
 * listed in the order a choice is believed: this tab, this device, then the account, which follows
 * the reader to other devices. Memory is last, and holds a choice this page made for as long as it
 * is open when none of the others can keep one, as when the browser refuses storage.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideClientHydration(withEventReplay()),
    provideRouter(routes),
    provideLocalization(
      withoutDocumentLocale(),
      withLocaleSources('stored', 'browser', 'default'),
      withPersistence(
        tabSessionStore,
        localStorageStore({ key: 'embedded-locale' }),
        accountProfile,
        memoryStore(),
      ),
      withRecoveryMessage({ message: messages.recovery.unavailable }),
      withObservability(eventLog),
    ),
  ],
};
