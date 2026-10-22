/**
 * Canonical locale identity against the pinned CLDR alias data, not the host's copy of it.
 *
 * `specs/01-standards-profile.spec.md` section 3 requires an identity to be canonicalized from the
 * pinned CLDR release and the recorded registry snapshot, and forbids the host runtime's registry
 * from deciding one that is stored, compared or exchanged. The host's ICU carries its own CLDR
 * edition, so every single-subtag language alias the pinned release states is asked of the
 * canonicalizer that decides catalog and configuration identities.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { canonicalizeLocale } from '../src/locales.js';

const require = createRequire(import.meta.url);
const aliases = JSON.parse(
  readFileSync(require.resolve('cldr-core/supplemental/aliases.json'), 'utf8'),
) as {
  readonly supplemental: {
    readonly metadata: {
      readonly alias: {
        readonly languageAlias: Readonly<
          Record<string, { readonly _replacement: string }>
        >;
      };
    };
  };
};

/** Plain language subtags only: every one is a tag a configuration may name as it stands. */
const languageAliases = Object.entries(
  aliases.supplemental.metadata.alias.languageAlias,
)
  .filter(([alias]) => /^[a-z]{2,3}$/u.test(alias))
  .map(([alias, { _replacement }]) => ({
    alias,
    replacement: _replacement.replaceAll('_', '-'),
  }))
  .filter(({ replacement }) =>
    /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/u.test(replacement),
  );

describe('canonical identity from the pinned alias data', () => {
  it('reads a plain language alias for every one the pinned release states', () => {
    expect(languageAliases.length).toBeGreaterThan(100);
  });

  it('canonicalizes each such alias to the pinned replacement', () => {
    const disagreements = languageAliases.flatMap(({ alias, replacement }) => {
      const canonical = canonicalizeLocale(alias);
      const expected = canonicalizeLocale(replacement);
      const got = canonical.ok ? canonical.value : 'refused';
      const want = expected.ok ? expected.value : replacement;
      return got === want ? [] : [`${alias}: ${got}, pinned ${want}`];
    });
    expect(disagreements).toEqual([]);
  });
});
