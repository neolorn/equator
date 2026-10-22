import {
  createDefaultLocalePrefixPolicy,
  type LocaleUrlPolicy,
} from '@neolorn/equator';
import { configuration } from '#i18n';

/** The site this deployment answers at, which the router and `server.ts` both compose from. */
export const SITE_ORIGIN = 'https://site.example';

/**
 * The locales that have an address: every locale this build generated, except `en-Latn-XA`.
 *
 * Read from the generated configuration, which is where the locales are declared, so adding or
 * removing one is an edit to `equator.config.json` and nothing here. A pseudo-locale is in the
 * configuration only in a build made with `equator generate --pseudo`, so a production build gives
 * `en-Arab-XB` no address, prerenders nothing at it, and advertises no `hreflang` for it.
 *
 * `en-Latn-XA` is left out on purpose: a configured locale with no address, reachable only by a
 * client-side switch, is a case the switcher has to handle, and this application is where it is
 * exercised.
 */
export const addressedLocales = configuration.locales.filter(
  (locale) => locale !== 'en-Latn-XA',
);

/**
 * The development row's policy with the default locale written without its prefix, which is the
 * shape of a site that was English at `/` before it had a second language.
 */
export const routePolicy: LocaleUrlPolicy = createDefaultLocalePrefixPolicy({
  defaultLocale: configuration.defaultLocale,
  locales: Object.fromEntries(
    addressedLocales.map((locale) => [locale, locale.toLowerCase()]),
  ),
  aliases: {
    en: 'en-US',
    ar: 'ar-EG',
  },
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/',
});
