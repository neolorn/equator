import { describe, expect, it } from 'vitest';

import { canonicalizeLanguageTag } from '../core/src/language-tag.js';
import { LOCALE_ALIAS_RULES } from '../core/src/locale-aliases.generated.js';

/**
 * Canonical language tags from the pinned CLDR alias data.
 *
 * `specs/01-standards-profile.spec.md` section 3 requires an identity to be canonicalized from the
 * pinned release. The expected values are UTS #35 Part 1 Annex C applied to CLDR 48.2 by hand, and
 * where the annex says nothing, what ECMA-402 requires of `Intl.getCanonicalLocales`, so a host whose
 * ICU carries another CLDR edition disagrees here only on the alias cases.
 */

const canonical = (tag: string): string =>
  canonicalizeLanguageTag(tag) ?? 'refused';

describe('the alias rules', () => {
  it.each([
    ['iw', 'he'],
    ['iw-IL', 'he-IL'],
    ['in', 'id'],
    ['ji', 'yi'],
    ['jw', 'jv'],
    ['mo-MD', 'ro-MD'],
    ['tl-PH', 'fil-PH'],
    ['cmn-Hans-CN', 'zh-Hans-CN'],
    // Aliases the host engines of this release do not all apply: CLDR 48.2 has them.
    ['bh', 'bho'],
    ['tw', 'ak'],
    ['sh', 'sr-Latn'],
    ['sh-BA', 'sr-Latn-BA'],
    ['no-bokmal', 'nb'],
    ['art-lojban', 'jbo'],
    ['cel-gaulish', 'xtg'],
    ['zh-guoyu', 'zh'],
    ['zh-hakka', 'hak'],
    ['sgn-GR', 'gss'],
    ['und-Qaai', 'und-Zinh'],
    ['hy-arevela', 'hy'],
    ['hy-arevmda', 'hyw'],
    ['ja-Latn-hepburn-heploc', 'ja-Latn-alalc97'],
    ['sv-aaland', 'sv-AX'],
    // The replacement fills a region only where the tag had none.
    ['sv-FI-aaland', 'sv-FI'],
    ['de-DD', 'de-DE'],
    ['en-UK', 'en-GB'],
    ['my-BU', 'my-MM'],
    ['sr-YU', 'sr-RS'],
  ])('%s is %s', (tag, expected) => {
    expect(canonical(tag)).toBe(expected);
  });

  // A region split into several takes the one likely subtags give the language, and with a script
  // the language and script first; a language CLDR has no likely region for takes the first.
  it.each([
    ['ru-SU', 'ru-RU'],
    ['hy-SU', 'hy-AM'],
    ['uk-SU', 'uk-UA'],
    ['az-SU', 'az-AZ'],
    ['az-Arab-SU', 'az-Arab-RU'],
    ['und-Armn-SU', 'und-Armn-AM'],
    ['qaa-Armn-SU', 'qaa-Armn-RU'],
    ['sr-CS', 'sr-RS'],
    ['en-t-hy-su', 'en-t-hy-am'],
  ])('%s is %s under the territory exception', (tag, expected) => {
    expect(canonical(tag)).toBe(expected);
  });

  it('leaves every rule at a tag no rule matches', () => {
    const unsettled = LOCALE_ALIAS_RULES.split(',').flatMap((rule) => {
      const [type = '', replacements = ''] = rule.split('>');
      return [type, ...replacements.split(' ')].flatMap((tag) => {
        const once = canonicalizeLanguageTag(tag);
        return once === undefined || canonicalizeLanguageTag(once) === once
          ? []
          : [`${tag}: ${once}, then ${canonicalizeLanguageTag(once)}`];
      });
    });
    expect(unsettled).toEqual([]);
  });

  it('canonicalizes every rule type', () => {
    const refused = LOCALE_ALIAS_RULES.split(',')
      .map((rule) => rule.split('>')[0] as string)
      .filter((type) => canonicalizeLanguageTag(type) === undefined);
    expect(refused).toEqual([]);
  });
});

describe('the syntax', () => {
  it.each([
    ['EN-us', 'en-US'],
    ['zh-hant-tw', 'zh-Hant-TW'],
    ['EN-LATN-US-FONIPA-SCOUSE', 'en-Latn-US-fonipa-scouse'],
    ['de-1996-1901', 'de-1901-1996'],
    ['und', 'und'],
    ['und-Latn', 'und-Latn'],
    ['en-u-ca-gregory-ca-buddhist', 'en-u-ca-gregory'],
    ['en-u-foo-bar-foo', 'en-u-bar-foo'],
    ['en-u-kn-true', 'en-u-kn'],
    ['en-u-ca-true', 'en-u-ca'],
    ['en-u-ca-truex', 'en-u-ca-truex'],
    ['en-u-kn-false', 'en-u-kn-false'],
    ['en-u-true', 'en-u-true'],
    ['en-u-attr-ca-gregory', 'en-u-attr-ca-gregory'],
    ['en-u-1a-foo', 'en-u-1a-foo'],
    ['en-u-nu-arab-a-bbb', 'en-a-bbb-u-nu-arab'],
    ['en-T-ZH-u-NU-arab', 'en-t-zh-u-nu-arab'],
    ['en-t-EN-latn-us-m0-abc', 'en-t-en-latn-us-m0-abc'],
    ['en-t-m0-true', 'en-t-m0-true'],
    ['en-t-k0-abc-k0-def', 'en-t-k0-abc-k0-def'],
    ['en-t-und', 'en-t-und'],
    ['en-t-cmn', 'en-t-zh'],
    ['en-t-iw-il', 'en-t-he-il'],
    ['en-x-A-b-u-c', 'en-x-a-b-u-c'],
    // Extension values keep their spelling: their aliases are in data this release does not pin.
    ['en-u-ms-imperial', 'en-u-ms-imperial'],
    ['en-u-rg-fi01', 'en-u-rg-fi01'],
  ])('%s is %s', (tag, expected) => {
    expect(canonical(tag)).toBe(expected);
  });

  it.each([
    '',
    'root',
    'Latn',
    'x-private',
    'en--us',
    'en_US',
    ' en',
    'en-',
    'a-b',
    'abcdefghi',
    'en-12345678901',
    'i-klingon',
    'zh-min-nan',
    'zh-cmn-Hans',
    'en-GB-oed',
    'de-1996-1996',
    'en-u',
    'en-t',
    'en-a',
    'en-a-b',
    'en-x',
    'en-a-bb-a-cc',
    'en-u-kn-true-x',
    'en-u-a1-foo',
    'en-t-m0',
    'en-t-m0-ab',
    'en-t-en-us-us',
    'en-t-en-1996-1996',
  ])('refuses %j', (tag) => {
    expect(canonicalizeLanguageTag(tag)).toBeUndefined();
  });
});
