import { createHostLocalePolicy, type LocaleUrlPolicy } from '@neolorn/equator';
import { configuration } from '#i18n';

/**
 * The origin this build answers at, which must be one of the policy's own. A build serves one
 * origin, so the consumer row builds once for each.
 */
export const SITE_ORIGIN = 'http://en-us.localhost';

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
 * Each locale on an origin of its own. `.localhost` names are reserved for loopback, so a request
 * the gate fails to route still never leaves the machine.
 */
export const routePolicy: LocaleUrlPolicy = createHostLocalePolicy({
  defaultLocale: configuration.defaultLocale,
  origins: Object.fromEntries(
    addressedLocales.map((locale) => [
      locale,
      `http://${locale.toLowerCase()}.localhost`,
    ]),
  ),
  localeNeutralRoots: ['assets'],
  xDefaultUrl: 'http://en-us.localhost',
});
