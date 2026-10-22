import {
  formatCatalog,
  parseConfiguration,
  type Catalog,
  type ProjectConfiguration,
} from '../src/index.js';

/**
 * A project configuration for a test, built by the parser that reads a real one.
 *
 * A hand-written object literal goes stale when `ProjectConfiguration` gains a field, and silently
 * wherever a test file is not typechecked. A literal is also the wrong shape for a different
 * reason: `locales`, `sourceLocale` and `defaultLocale` are `CanonicalLocale`, a branded type no
 * literal can produce, so writing one out either casts the brand away or does not compile.
 *
 * Going through `parseConfiguration` answers both. The fixture is whatever the parser produces
 * from the source a project would actually contain, so a field added to the configuration is
 * supplied here on the day it lands rather than remembered, and the locales are branded by the
 * function that owns the brand. It is the general rule for a value under test: validate it
 * against the Equator function that will receive it, not against the primitive underneath.
 */
export function testProjectConfiguration(
  locales: readonly string[],
  overrides: Readonly<Record<string, unknown>> = {},
): ProjectConfiguration {
  const [sourceLocale] = locales;
  if (sourceLocale === undefined) {
    throw new Error('A test configuration needs at least one locale.');
  }
  const parsed = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale,
      defaultLocale: sourceLocale,
      locales,
      ...overrides,
    }),
  );
  if (!parsed.ok) {
    throw new Error(
      `The test configuration is not an Equator configuration: ${parsed.diagnostics
        .map(({ code, summary }) => `${code} ${summary}`)
        .join('; ')}`,
    );
  }
  return parsed.value;
}

/**
 * How long a test waits for something another party does: a watcher's first pass, a prompt.
 *
 * Under the suite's 120 s test bound, so a wait that runs out fails with its own assertion and not
 * with the test's time limit, and far above what the wait costs, so it ends only on a hang.
 */
export const WAIT_BOUND_MS = 100_000;

/** The text `formatCatalog` writes for a catalog the test knows it accepts. */
export function writtenCatalog(catalog: Catalog): string {
  const written = formatCatalog(catalog);
  if (!written.ok) {
    throw new Error(
      `The catalog under test cannot be written: ${written.diagnostics
        .map(({ code, summary }) => `${code} ${summary}`)
        .join('; ')}`,
    );
  }
  return written.value;
}
