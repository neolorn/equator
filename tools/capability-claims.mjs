/**
 * A claim: a check stating which capability it has just asserted, and the context it did it in.
 *
 * `verify:matrix` fills a cell from claims and from nothing else, because the alternatives answer a
 * nearby question. A capability named somewhere in a file the check loads says the file mentions
 * it, and a context inferred from the file's text says what the text looks like; a file that builds
 * one policy to assert another would fill both cells. What a check can report about itself is what
 * it asserted, and that is a line in the check, which a reviewer reads beside the assertions above
 * it.
 *
 * The context is never a name the check passes. It is read from the live thing the check holds: the
 * policy object the application runs, the platform its injector reports, the document a server
 * produced, the browser the driver launched. A check cannot claim a context it is not in, only fail
 * to mention one it is in, and a missed context is an empty cell the gate reports.
 *
 * No imports, so the same record is built in a test worker, in a browser stage's driver, and in a
 * consumer's test bundle, none of which can be assumed to have the others' modules.
 */

/** The observations a claim may carry, each read from the live object the check holds. */
const OBSERVERS = Object.freeze({
  /**
   * The URL policy the application runs. Its kind, and every boolean it carries, because a policy's
   * variants are its booleans: the default-locale variant is a path-prefix policy that omits the
   * default prefix, and a later variant would arrive the same way.
   */
  policy(policy) {
    if (
      policy === null ||
      typeof policy !== 'object' ||
      typeof policy.kind !== 'string'
    ) {
      throw new TypeError(
        'A claim observes the policy the application runs, as the object itself; this is not one.',
      );
    }
    const observed = { kind: policy.kind };
    for (const [key, value] of Object.entries(policy)) {
      if (typeof value === 'boolean') observed[key] = value;
    }
    return observed;
  },
  /** The value of Angular's `PLATFORM_ID` in the injector the check rendered with. */
  platform(platform) {
    if (typeof platform !== 'string' || platform.length === 0) {
      throw new TypeError(
        "A claim observes the platform as the injector's PLATFORM_ID value.",
      );
    }
    return platform;
  },
  /**
   * A document a server answered or a build wrote. Angular marks the root element with
   * `ng-server-context`, `ssr` for a server render and `ssg` for a prerender, so the document says
   * which one produced it.
   */
  document(document) {
    if (typeof document !== 'string') {
      throw new TypeError(
        'A claim observes a document as the text the check read.',
      );
    }
    const contexts = new Set();
    for (const [, value] of document.matchAll(
      /\bng-server-context=["']([^"']*)["']/gu,
    )) {
      for (const part of value.split('|')) {
        if (part.length > 0) contexts.add(part);
      }
    }
    return [...contexts].sort();
  },
  /**
   * How many elements a server rendered that were still the same elements after the client
   * booted. Hydration is adopting markup rather than replacing it, so a count of adopted elements
   * is what shows it happened.
   */
  adoptedElements(count) {
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError(
        'A claim observes adopted elements as a count the check measured.',
      );
    }
    return count;
  },
  /** How many router navigations completed after the first one, without a document request. */
  clientNavigations(count) {
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError(
        'A claim observes client navigations as a count the check measured.',
      );
    }
    return count;
  },
  /** The browser the driver launched, asked for its own name and version. */
  engine(browser) {
    const name = browser?.browserType?.()?.name?.();
    const version = browser?.version?.();
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new TypeError(
        'A claim observes the engine as the launched browser, which reports its own name and version.',
      );
    }
    return { name, version };
  },
});

/** A capability id: a category and a name, as the matrix lists them. */
const CAPABILITY = /^[a-z][a-z-]*:\S(?:.*\S)?$/u;

/**
 * The record a claim leaves, before anything decides whether it counts.
 *
 * Throws on anything it cannot read, rather than leaving the observation out. A misspelt key or a
 * name where the object belongs would otherwise record a claim with less context than the check
 * had, and the cell it should have filled would read as a gap nobody could explain.
 */
export function claimRecord(capability, observed = {}) {
  if (typeof capability !== 'string' || !CAPABILITY.test(capability)) {
    throw new TypeError(
      `A claim names a capability as "category:name", as the matrix lists it; got ${JSON.stringify(capability)}.`,
    );
  }
  const record = {
    capability,
    node: globalThis.process?.versions?.node ?? null,
  };
  for (const [key, value] of Object.entries(observed)) {
    const observe = OBSERVERS[key];
    if (observe === undefined) {
      throw new TypeError(
        `A claim cannot observe ${JSON.stringify(key)}. It can observe ${Object.keys(OBSERVERS).join(', ')}.`,
      );
    }
    record[key] = observe(value);
  }
  return record;
}

/** The environment variable naming the file a stage's claims go to. The gate sets it. */
export const CLAIMS_FILE_VARIABLE = 'EQUATOR_CAPABILITY_CLAIMS';

/** Where a test's claims wait until the test is known to have passed. */
export const CLAIMS_META_KEY = 'equatorCapabilityClaims';
