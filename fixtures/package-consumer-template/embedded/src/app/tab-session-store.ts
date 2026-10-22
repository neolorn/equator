import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, inject } from '@angular/core';
import type {
  LocalizationPersistenceStore,
  LocalizationPersistenceStoreFactory,
} from '@neolorn/equator';

const KEY = 'embedded-tab-locale';

/**
 * A choice kept for as long as this tab is open, which none of Equator's own stores does: memory
 * ends with the page and local storage outlives the tab.
 *
 * Written against the store port, so it holds to the same rules as the stores Equator ships: a
 * store that cannot read where it is asked reports nothing, and one that cannot write returns.
 */
export const tabSessionStore: LocalizationPersistenceStoreFactory = () => {
  const browser = isPlatformBrowser(inject(PLATFORM_ID));
  const store: LocalizationPersistenceStore = {
    id: 'tab-session',
    read: () =>
      browser ? (sessionStorage.getItem(KEY) ?? undefined) : undefined,
    write: (locale) => {
      if (browser) sessionStorage.setItem(KEY, locale);
    },
    forget: () => {
      if (browser) sessionStorage.removeItem(KEY);
    },
  };
  return store;
};
