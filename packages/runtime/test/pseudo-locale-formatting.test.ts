import { describe, expect, it } from 'vitest';

import {
  type FormattingContext,
  type LocalizedValuePart,
} from '@neolorn/equator/core';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import {
  compareLocalized,
  decimal,
  formatInstant,
  formatNumber,
  instant,
  selectPlural,
} from '../src/formatting.js';
import { localizationTransferSnapshot } from '../src/localization.js';
import { compileSet, editedSet } from './catalog-store-harness.js';
import { evaluateArtifact } from './compiled-artifact-harness.js';
import { parse } from './message-harness.js';
import { runtime } from './transaction-runtime-harness.js';

/**
 * How a pseudo-locale is formatted.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4 and
 * `specs/03-locale-identity-and-resolution.spec.md` section 4. A pseudo-locale's script subtag says
 * which way its text runs and nothing else: `en-Arab-XB` is English, forced right to left. Its text
 * is its language's, so the rule that sends a language in a script it does not usually take to root
 * is not applied along its chain, and it formats in `en` with what its formatting declares, the
 * same writing and so no fallback. The same tag on a context that does not mark it is a locale in
 * the Arabic script, which the pinned chain sends to root.
 *
 * Every supported Node line's ICU has no data for `en-Arab-XB` or `en-Arab` and answers `en`; each
 * case that depends on it asserts that first.
 */

const BIDI = 'en-Arab-XB';
const N = decimal('1234.5');
const NOON = instant('1710417600000000000');

const pseudo = (
  locale: string,
  more: Partial<FormattingContext> = {},
): FormattingContext =>
  Object.freeze({ locale, timeZone: 'UTC', pseudoLocale: true, ...more });

const real = (locale: string): FormattingContext =>
  Object.freeze({ locale, timeZone: 'UTC' });

const numberLocaleOf = (locale: string): string =>
  new Intl.NumberFormat(locale, { localeMatcher: 'lookup' }).resolvedOptions()
    .locale;

describe('a pseudo-locale context', () => {
  it('writes a number in en, in the digits its declaration names, and is not a fallback', () => {
    expect(numberLocaleOf(BIDI)).toBe('en');
    expect(numberLocaleOf('en-Arab')).toBe('en');
    const written = formatNumber(N, pseudo(BIDI, { numberingSystem: 'arab' }));
    expect(written).toMatchObject({
      ok: true,
      value: { text: '١٬٢٣٤٫٥', language: 'en' },
    });
    expect(written.ok && 'fallback' in written.value).toBe(false);
  });

  it('writes a date in en and is not a fallback', () => {
    const written = formatInstant(NOON, pseudo(BIDI), { dateStyle: 'long' });
    expect(written).toMatchObject({
      ok: true,
      value: { text: 'March 14, 2024', language: 'en' },
    });
    expect(written.ok && 'fallback' in written.value).toBe(false);
  });

  it('selects plurals and orders text as en does', () => {
    const plural = selectPlural(decimal('1'), pseudo(BIDI));
    expect(plural).toMatchObject({ ok: true, value: 'one', language: 'en' });
    expect(plural.ok && 'fallback' in plural).toBe(false);
    expect(compareLocalized('a', 'b', pseudo(BIDI))).toMatchObject({
      ok: true,
      value: -1,
    });
  });

  it('formats under a region UTS #35 leaves free as under XB', () => {
    expect(formatNumber(N, pseudo('en-Arab-XC'))).toMatchObject({
      ok: true,
      value: { text: '1,234.5', language: 'en' },
    });
  });

  it('formats en-Latn-XA in en, as it did without the mark', () => {
    for (const context of [pseudo('en-Latn-XA'), real('en-Latn-XA')]) {
      const written = formatNumber(N, context);
      expect(written).toMatchObject({
        ok: true,
        value: { text: '1,234.5', language: 'en' },
      });
      expect(written.ok && 'fallback' in written.value).toBe(false);
    }
  });
});

describe('the same tag on a context that does not mark it', () => {
  it('is a locale in the Arabic script, which inherits from root and is refused', () => {
    expect(formatNumber(N, real(BIDI))).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'unsupported-formatting-capability',
        reason: 'native-capability-rejected',
      },
    });
  });
});

describe('a context that marks a locale that is not a pseudo-locale', () => {
  it.each(['ru-Latn', 'en-US', 'en-Arab'])(
    'is refused as malformed for %s, by a formatter and a capability',
    (locale) => {
      const refusal = {
        ok: false,
        diagnostic: {
          code: 'unsupported-formatting-capability',
          reason: 'malformed-input',
        },
      };
      expect(formatNumber(N, pseudo(locale))).toMatchObject(refusal);
      expect(selectPlural(decimal('1'), pseudo(locale))).toMatchObject(refusal);
    },
  );
});

describe('a message value under a pseudo-locale', () => {
  const INPUTS: readonly CompiledInputContract[] = [
    { name: 'n', type: 'number', optional: false, nullable: false },
    { name: 'd', type: 'date-time', optional: false, nullable: false },
  ];

  const valuePart = (source: string): LocalizedValuePart => {
    const semantics = parse(source) as unknown as {
      declarations: unknown;
      pattern: unknown;
    };
    const result = evaluateArtifact(
      {
        body: {
          kind: 'pattern',
          declarations: semantics.declarations,
          pattern: semantics.pattern,
        },
        inputs: INPUTS,
        resultKind: 'structured',
      },
      { n: 1234.5, d: new Date(Date.UTC(2024, 2, 14, 13, 5)) },
      undefined,
      pseudo(BIDI, { numberingSystem: 'arab' }),
    );
    if (result.kind !== 'parts') throw new Error('Expected parts.');
    const part = result.value.find(
      (candidate): candidate is LocalizedValuePart =>
        candidate.kind === 'value',
    );
    if (part === undefined) throw new Error('Expected a value part.');
    return part;
  };

  it('is written in en, in the declared digits, and names en without a fallback', () => {
    const part = valuePart('{$n :number}');
    expect(part).toMatchObject({ value: '١٬٢٣٤٫٥', valueLanguage: 'en' });
    expect('valueFallback' in part).toBe(false);
  });

  it('writes a :date value in en and names en without a fallback', () => {
    const part = valuePart('{$d :date}');
    expect(part.valueLanguage).toBe('en');
    expect('valueFallback' in part).toBe(false);
  });
});

describe('the context a runtime builds', () => {
  const TEXT = {
    shell: {
      'en-US': 'messages:\n  title: Pseudo\n  greeting: "Hello {$name}"\n',
      'ar-EG': 'messages:\n  title: زائف\n  greeting: "مرحبا {$name}"\n',
      [BIDI]: 'messages:\n  title: Pseudo\n  greeting: "Hello {$name}"\n',
    },
    lazy: {
      'en-US': 'messages:\n  heading: Lazy heading\n',
      'ar-EG': 'messages:\n  heading: عنوان مؤجل\n',
      [BIDI]: 'messages:\n  heading: Lazy heading\n',
    },
  };

  const set = () =>
    editedSet(
      compileSet(undefined, TEXT, ['en-US', 'ar-EG', BIDI]),
      ({ configuration }) => {
        const fields = configuration as Record<string, unknown>;
        fields['pseudoLocales'] = [BIDI];
        fields['formatting'] = { [BIDI]: { numberingSystem: 'arab' } };
      },
    );

  it('marks the locale the generated configuration lists as a pseudo-locale, and no other', async () => {
    const { localization } = runtime({ set: set() });
    await localization.initialize();
    expect(localization.snapshot()?.formatting).toStrictEqual({
      locale: 'en-US',
    });

    expect(await localization.changeLocale(BIDI)).toMatchObject({
      status: 'committed',
    });
    expect(localization.snapshot()?.formatting).toStrictEqual({
      locale: BIDI,
      numberingSystem: 'arab',
      pseudoLocale: true,
    });
    localization.dispose();
  });

  it('does not carry the mark in the state it transfers', async () => {
    const { localization } = runtime({ set: set() });
    await localization.initialize();
    await localization.changeLocale(BIDI);

    expect(
      localizationTransferSnapshot(localization)?.formatting,
    ).toStrictEqual({ locale: BIDI, numberingSystem: 'arab' });
    localization.dispose();
  });
});
