import table from './addresses.json';
import { routePolicy } from './route-policy';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * Where this application's pages live, read from `addresses.json` beside this file.
 *
 * The table is written out by hand, one address per page per locale, rather than computed. An
 * expected address computed through Equator agrees with Equator by construction, so a spec that
 * compared against one would pass whatever Equator did. Each consumer row that runs this
 * application under another policy replaces the table together with `route-policy.ts`.
 *
 * A page has an address in a locale only where arriving there, with no preference stated, yields
 * that locale. That is the rule Equator advertises and links by, so under a locale-neutral policy
 * most pages have an address in the default locale alone.
 *
 * The table spells each address in plain Unicode, as a person reads it. The functions below give
 * it back in the form each reader compares against, through the platform's own URL parser.
 */
export type Page = keyof typeof table.pages;

const pages: Readonly<Record<Page, Readonly<Record<string, string>>>> =
  table.pages;
const origins: Readonly<Record<string, string>> = table.origins;

/** The policy the table was written for, named as the capability matrix names its columns. */
export const tablePolicy: string = table.policy;

/**
 * The least this deployment keeps any page as, where the table says it declares a floor.
 *
 * Written into the table rather than read from `response-caching.ts`, so a floor that goes missing
 * there fails the checks that expect it instead of switching them off.
 */
export const expectedPageCaching = (():
  'per-visitor' | 'not-stored' | undefined => {
  const value = (table as Readonly<Record<string, unknown>>)['pageCaching'];
  if (
    value === undefined ||
    value === 'per-visitor' ||
    value === 'not-stored'
  ) {
    return value;
  }
  throw new Error(
    `The address table gives pageCaching as ${JSON.stringify(value)}, which is no floor a deployment can declare.`,
  );
})();

/**
 * The absolute URL `x-default` points at, where the table says the policy declares one.
 *
 * Written into the table for the reason the floor is: a declaration that goes missing from
 * `route-policy.ts` fails the checks that expect it instead of switching them off.
 */
export const expectedXDefault = ((): string | undefined => {
  const value = (table as Readonly<Record<string, unknown>>)['xDefault'];
  if (value === undefined || typeof value === 'string') return value;
  throw new Error(
    `The address table gives xDefault as ${JSON.stringify(value)}, which is not an address.`,
  );
})();

/** The first path segments the table says the policy leaves to whatever serves them. */
export const expectedLocaleNeutralRoots = ((): readonly string[] => {
  const value = (table as Readonly<Record<string, unknown>>)[
    'localeNeutralRoots'
  ];
  if (value === undefined) return [];
  if (
    Array.isArray(value) &&
    value.every((each): each is string => typeof each === 'string')
  ) {
    return value;
  }
  throw new Error(
    `The address table gives localeNeutralRoots as ${JSON.stringify(value)}, which is not a list of segments.`,
  );
})();

const written = (page: Page, locale: string): string => {
  const value = pages[page][locale];
  if (value === undefined) {
    throw new Error(
      `The address table gives ${page} no address in ${locale}, so this check does not apply to the policy it was written for.`,
    );
  }
  return value;
};

/** The origin a locale is served from. */
export function localeOrigin(locale: string): string {
  const origin = origins[locale];
  if (origin === undefined) {
    throw new Error(`The address table names no origin for ${locale}.`);
  }
  return origin;
}

/** Every locale the page has an address in. */
export function addressedLocales(page: Page): readonly string[] {
  return Object.keys(pages[page]);
}

/**
 * The address as Equator writes it: a path, or an absolute URL where the origin is the locale, with
 * every character a path cannot carry percent-encoded.
 */
export function pageAddress(page: Page, locale: string): string {
  const value = written(page, locale);
  const parsed = new URL(value, localeOrigin(locale));
  return /^[a-z][a-z0-9+.-]*:/iu.test(value) ? parsed.href : parsed.pathname;
}

/** The absolute URL, as a canonical link or a request states it. */
export function pageUrl(page: Page, locale: string): string {
  return new URL(written(page, locale), localeOrigin(locale)).href;
}

/** The path alone, percent-encoded, as the address bar's `pathname` holds it. */
export function pagePath(page: Page, locale: string): string {
  return new URL(written(page, locale), localeOrigin(locale)).pathname;
}

// What a spec needs to know about the running policy before it can expect anything of an address.
// Each is read from the policy rather than written into the table, so a kind misspelled here is a
// compile error rather than a spec that never runs.

/**
 * Whether every address says which locale it is in. Under locale-neutral only one that a single
 * locale spells does, such as the Arabic article's slug.
 */
export const localeInAddress = routePolicy.kind !== 'locale-neutral';

/** Whether the locale is a segment of the path, so an address an application writes can carry one. */
export const localeInPath = routePolicy.kind === 'path-prefix';

/** Whether a locale switch stays in the document. Under locale-host it moves to another origin. */
export const switchInDocument = routePolicy.kind !== 'locale-host';

/** Whether this build must be told which origin it answers at, which only locale-host needs. */
export const originRequired = routePolicy.kind === 'locale-host';

/**
 * Whether an address that names no locale is sent to one. Only a path-prefix policy that prefixes
 * every locale has such addresses.
 */
export const entryRedirects =
  routePolicy.kind === 'path-prefix' && !routePolicy.omitDefaultPrefix;

/**
 * Whether some address states no locale, so a source that reads the URL has nothing to read
 * there: the root under a policy that prefixes every locale, and under locale-neutral every
 * address more than one locale spells. `unstatedAddress` is one.
 */
export const addressCanStateNone =
  entryRedirects || routePolicy.kind === 'locale-neutral';

/** An address that states no locale, where `addressCanStateNone` says there is one. */
export const unstatedAddress = `${localeOrigin('en-US')}/`;

/**
 * Claims the running policy's own row, for a check that exercised it. Each consumer row runs one
 * policy, and a claim for another policy's row would be refused as a mislabel, so only the one
 * that matches is made.
 *
 * `platform` is the `PLATFORM_ID` of the injector a check rendered with, and is left out by a
 * check that rendered through none, since there is nothing for it to report.
 */
export function claimRunningPolicy(platform?: string): void {
  const rendered = platform === undefined ? {} : { platform };
  if (routePolicy.kind === 'locale-host') {
    claimCapability('policy:locale-host', { policy: routePolicy, ...rendered });
  } else if (routePolicy.kind === 'locale-neutral') {
    claimCapability('policy:locale-neutral', {
      policy: routePolicy,
      ...rendered,
    });
  } else if (routePolicy.omitDefaultPrefix) {
    claimCapability('policy:default-locale-prefix', {
      policy: routePolicy,
      ...rendered,
    });
  } else {
    claimCapability('policy:path-prefix', { policy: routePolicy, ...rendered });
  }
}
