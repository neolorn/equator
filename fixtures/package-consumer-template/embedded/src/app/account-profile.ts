import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, REQUEST, inject } from '@angular/core';
import {
  profileStore,
  type LocalizationPersistenceStoreFactory,
} from '@neolorn/equator';

/** Where this deployment keeps a signed-in reader's preferences. */
export const PROFILE_PATH = '/account/locale';
/** The cookie the account's preference travels in, which only this deployment reads. */
export const PROFILE_COOKIE = 'embedded-account-locale';

/**
 * The account's remembered language, read from the request while the server renders and from the
 * account endpoint in the browser.
 *
 * The transport is built where the store is, inside the injector, because the request it reads on
 * the server belongs to one render and a transport declared with the configuration would be shared
 * by every render in the process.
 */
export const accountProfile: LocalizationPersistenceStoreFactory = () => {
  const browser = isPlatformBrowser(inject(PLATFORM_ID));
  const request = inject(REQUEST, { optional: true });
  return profileStore({
    read: async () => {
      if (!browser) {
        const header = request?.headers.get('cookie') ?? '';
        const entry = header
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${PROFILE_COOKIE}=`));
        return entry?.slice(PROFILE_COOKIE.length + 1);
      }
      const response = await fetch(PROFILE_PATH, {
        credentials: 'same-origin',
      });
      return response.ok ? (await response.text()) || undefined : undefined;
    },
    write: async (locale) => {
      if (!browser) return;
      await fetch(PROFILE_PATH, {
        method: 'PUT',
        credentials: 'same-origin',
        body: locale,
      });
    },
    forget: async () => {
      if (!browser) return;
      await fetch(PROFILE_PATH, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    },
  })();
};
