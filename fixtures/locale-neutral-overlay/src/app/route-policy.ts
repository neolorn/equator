import {
  createLocaleNeutralPolicy,
  type LocaleUrlPolicy,
} from '@neolorn/equator';
import { configuration } from '#i18n';

/** The site this deployment answers at, which the router and `server.ts` both compose from. */
export const SITE_ORIGIN = 'https://site.example';

/**
 * The locales this policy serves: every locale this build generated, except `en-Latn-XA`.
 *
 * Read from the generated configuration, which is where the locales are declared, so adding or
 * removing one is an edit to `equator.config.json` and nothing here. A pseudo-locale is in the
 * configuration only in a build made with `equator generate --pseudo`.
 *
 * `en-Latn-XA` is left out as the development row leaves it out, so what differs between the rows
 * is only where the locale is not.
 */
export const addressedLocales = configuration.locales.filter(
  (locale) => locale !== 'en-Latn-XA',
);

/**
 * One address for every locale, with the locale coming from the reader rather than from the URL.
 * The same locales as the development row, so what differs is only where the locale is not.
 */
export const routePolicy: LocaleUrlPolicy = createLocaleNeutralPolicy({
  defaultLocale: configuration.defaultLocale,
  locales: addressedLocales,
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/',
});
