/**
 * The generated fallback chains of a configuration, read as a table and not chain by chain.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 4 resolves each locale's parents at
 * build time, and the runtime trusts a chain about what it means and never about its shape. One
 * malformed chain is a table built against something else, so it refuses the table whatever the
 * other chains look like, and a table that holds no chain at all has nothing malformed in it.
 */
import { describe, expect, it } from 'vitest';

import { diagnosticOf } from './catalog-store-harness.js';
import { configured, runtime } from './transaction-runtime-harness.js';

const refusal = (table: unknown) =>
  diagnosticOf(() =>
    runtime({
      set: configured('localeFallbacks', table),
    }).localization.dispose(),
  );

describe('a table of generated fallback chains', () => {
  it('is admitted when it holds no chain', () => {
    expect(refusal({})).toBeUndefined();
  });

  it('is refused for an empty chain that stands beside a well formed one', () => {
    expect(refusal({ 'ar-EG': ['en-US'], 'en-US': [] })).toMatchObject({
      code: 'invalid-configuration',
    });
  });
});
