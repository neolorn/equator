import {
  createPathPrefixLocalePolicy,
  type LocaleUrlPolicy,
} from '@neolorn/equator';
import { configuration } from '#i18n';

/**
 * The site this deployment answers at, declared once because two things compose it.
 *
 * The router builds every canonical and alternate URL from it, and `server.ts` builds the sitemap
 * from it. Written twice they could disagree, and the failure would be a sitemap advertising
 * addresses the head of every page contradicts, which is exactly the disagreement the two are
 * supposed to be incapable of.
 */
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
 * Each addressed locale under its tag in lower case, and the default locale the configuration
 * declares.
 *
 * Typed as every policy rather than as the one built here, because this file and `addresses.json`
 * beside it are what a consumer row replaces to run the same application under another policy, and
 * the specs ask the running policy which kind it is.
 */
export const routePolicy: LocaleUrlPolicy = createPathPrefixLocalePolicy({
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
