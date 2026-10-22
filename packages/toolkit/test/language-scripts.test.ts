import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { LANGUAGE_SCRIPTS } from '../src/language-scripts.generated.js';

/**
 * The toolkit's likely-script table against the pinned likely subtags it is drawn from.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 4. The catalog chain sends a language
 * in a script it does not usually take to root, and a project configures locales in any
 * language, so the table holds every language the pinned data lists, each with the script its
 * likely subtags give. A language_region aliases to language_script_region where its likely
 * script is not its language's, so the table holds each such language_region too.
 */

const require = createRequire(import.meta.url);
const likelySubtags = (
  JSON.parse(
    readFileSync(
      require.resolve('cldr-core/supplemental/likelySubtags.json'),
      'utf8',
    ),
  ) as { supplemental: { likelySubtags: Record<string, string> } }
).supplemental.likelySubtags;

describe('the language-script table of the toolkit', () => {
  it('holds every language, and every language_region of another script, with the script the pinned likely subtags give it', () => {
    const held = new Map(
      Object.entries(LANGUAGE_SCRIPTS).flatMap(([script, languages]) =>
        languages.split(' ').map((language) => [language, script] as const),
      ),
    );
    const scriptOf = (key: string) => likelySubtags[key]?.split('-')[1];
    const pinned = Object.keys(likelySubtags)
      .filter((key) => {
        const [language = '', region, ...rest] = key.split('-');
        if (language === 'und' || rest.length > 0) return false;
        if (region === undefined) return true;
        return (
          /^(?:[A-Z]{2}|d{3})$/u.test(region) &&
          scriptOf(language) !== undefined &&
          scriptOf(key) !== scriptOf(language)
        );
      })
      .map((key) => [key, scriptOf(key)] as const);
    expect(pinned.length).toBeGreaterThan(7_000);
    expect(pinned).toContainEqual(['zh-TW', 'Hant']);
    expect([...held].sort()).toEqual([...pinned].sort());
  });
});
