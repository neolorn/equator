import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The address table a consumer's specs read, for the gate tools that check the same consumer.
 *
 * `src/app/addresses.json` is written out by hand for the URL policy the consumer runs, one address
 * per page per locale. Reading it here makes the files a build must write, the addresses a browser
 * pass visits and the addresses the specs expect one statement. Computing them through Equator
 * would derive each check from the thing it checks.
 *
 * The table's `policy` names the policy it was written for, and `address-table.spec.ts` holds it to
 * the policy the consumer runs, so what follows from it here is what the running policy does.
 */
export async function readConsumerAddresses(consumerRoot) {
  const table = JSON.parse(
    await readFile(resolve(consumerRoot, 'src/app/addresses.json'), 'utf8'),
  );
  const parsed = (page, locale) => {
    const written = table.pages[page]?.[locale];
    if (written === undefined) {
      throw new Error(
        `The address table gives ${page} no address in ${locale}, and this check needs one.`,
      );
    }
    return new URL(written, table.origins[locale]);
  };
  const policy = table.policy;
  const shownPath = (page, locale) => {
    const addressed = Object.keys(table.pages[page] ?? {});
    if (
      policy !== 'locale-neutral' ||
      addressed.includes(locale) ||
      addressed.length !== 1
    ) {
      return parsed(page, locale).pathname;
    }
    return parsed(page, addressed[0]).pathname;
  };
  return Object.freeze({
    policy,
    /** The origin a locale is served from. */
    origin: (locale) => table.origins[locale],
    /** Whether the page has an address in that locale. */
    has: (page, locale) => table.pages[page]?.[locale] !== undefined,
    /** Every locale the page has an address in. */
    locales: (page) => Object.keys(table.pages[page] ?? {}),
    /**
     * The address as Equator writes it for a link: absolute where the table writes the origin,
     * because the locale is the origin, and a path otherwise.
     */
    address: (page, locale) => {
      const url = parsed(page, locale);
      return /^[a-z][a-z0-9+.-]*:/iu.test(table.pages[page][locale])
        ? url.href
        : url.pathname;
    },
    /** The absolute URL, as a canonical link or an alternate states it. */
    url: (page, locale) => parsed(page, locale).href,
    /** The path, percent-encoded, as a request carries it. */
    path: (page, locale) => parsed(page, locale).pathname,
    /**
     * The path the address bar holds while the page is shown in the locale. Under locale-neutral
     * no address names a locale, so a page the table gives no address in that locale keeps the one
     * address it has.
     */
    shownPath,
    /** The absolute URL of that path, which the head of the page shown in the locale states. */
    shownUrl: (page, locale) =>
      new URL(shownPath(page, locale), table.origins[locale]).href,
    /** The file prerendering writes the page to, decoded as a file name spells it. */
    file: (page, locale) => {
      const path = decodeURIComponent(parsed(page, locale).pathname);
      return path === '/' ? 'index.html' : `${path.slice(1)}/index.html`;
    },
    /** Whether the locale is a segment of the path. */
    localeInPath:
      policy === 'path-prefix' || policy === 'default-locale-prefix',
    /** Whether an address that names no locale is sent to one. */
    entryRedirects: policy === 'path-prefix',
    /** Whether every address says which locale it is in, which under locale-neutral only some do. */
    localeInAddress: policy !== 'locale-neutral',
    /** Whether a locale switch stays in the document. */
    switchInDocument: policy !== 'locale-host',
    /** Whether the origin names the locale, so a build answers at one origin and serves its locale. */
    localeInOrigin: policy === 'locale-host',
    /** The least the deployment keeps any page as, where the table says it declares a floor. */
    pageCaching: table.pageCaching,
    /**
     * The mode the consumer declares for its navigations, where the table says it declares one
     * other than the default.
     */
    navigationMode: table.navigationMode,
    /** The absolute URL `x-default` points at, where the table says the policy declares one. */
    xDefault: table.xDefault,
    /** The first path segments the policy leaves to whatever serves them. */
    localeNeutralRoots: Object.freeze([...(table.localeNeutralRoots ?? [])]),
    /** The pages the build prerenders, each in every locale it has an address in. */
    prerendered: Object.freeze([...table.prerendered]),
    /**
     * Whether a pseudo-locale also spells the page's address in the locale, so a build that
     * generates one renders it on request rather than prerendering it.
     */
    sharedWithPseudoLocales: (page, locale) =>
      table.sharedWithPseudoLocales?.[page]?.includes(locale) ?? false,
  });
}

/** The line in `src/app/route-policy.ts` that says which origin the consumer's build answers at. */
export const SITE_ORIGIN_DECLARATION =
  /^export const SITE_ORIGIN = '([^'\n]*)';$/mu;

/**
 * The builds a consumer is deployed as: one for each origin its locales are served at.
 *
 * The consumer's own build answers at the origin `route-policy.ts` declares and is written to
 * `dist/feature-lab`. Under a policy that puts each locale on an origin of its own, a deployment
 * builds once more for every other origin, with that line changed, which is what the consumer stage
 * does; each of those is written beside it, named for the origin's host.
 */
export async function readConsumerBuilds(consumerRoot) {
  const policyPath = resolve(consumerRoot, 'src/app/route-policy.ts');
  const declared = SITE_ORIGIN_DECLARATION.exec(
    await readFile(policyPath, 'utf8'),
  );
  if (declared === null) {
    throw new Error(
      `${policyPath} declares no SITE_ORIGIN in the form the gate reads, so no build can be told where it answers.`,
    );
  }
  const siteOrigin = declared[1];
  return Object.freeze({
    policyPath,
    siteOrigin,
    /** Where the build of `base` that answers at `origin` is written, relative to the consumer. */
    output: (origin, base = 'dist/feature-lab') =>
      origin === siteOrigin ? base : `${base}-${new URL(origin).hostname}`,
  });
}
