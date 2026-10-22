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
import { evaluateArtifact } from './compiled-artifact-harness.js';
import { parse } from './message-harness.js';

/**
 * Which locale a result names, and when that locale is a fallback.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4. A result names the locale of the
 * parent chain that wrote it wherever that is not the context's own, and it is a fallback only
 * where that locale is written otherwise: another language, or the same language in another
 * script, each script taken from the pinned likely subtags. ICU keeps plural rules per language,
 * so `en` answers for `en-US` and is the same writing, and `zh`, which is written in Simplified
 * Chinese, answers for `zh-TW`, which is written in Traditional.
 *
 * The locales are ones every supported Node line's ICU answers this way; each case asserts what
 * the host used before it asserts what the result reports, so a host that keeps the rules of the
 * locale itself fails the precondition rather than the rule.
 */

const at = (locale: string): FormattingContext =>
  Object.freeze({ locale, timeZone: 'UTC' });

const pluralLocaleOf = (locale: string): string =>
  new Intl.PluralRules(locale).resolvedOptions().locale;
const collatorLocaleOf = (locale: string): string =>
  new Intl.Collator(locale).resolvedOptions().locale;

describe('a capability answered by a locale of the same writing', () => {
  it.each(['en-US', 'en-AU'])(
    'names en for the plural rules of %s and is not a fallback',
    (locale) => {
      expect(pluralLocaleOf(locale)).toBe('en');
      const answer = selectPlural(decimal('2'), at(locale));
      expect(answer).toMatchObject({ ok: true, language: 'en' });
      expect(answer.ok && 'fallback' in answer).toBe(false);
    },
  );

  it('names pt for the collation of pt-PT and is not a fallback', () => {
    expect(collatorLocaleOf('pt-PT')).toBe('pt');
    const answer = compareLocalized('a', 'b', at('pt-PT'));
    expect(answer).toMatchObject({ ok: true, language: 'pt' });
    expect(answer.ok && 'fallback' in answer).toBe(false);
  });
});

describe('a capability answered by a locale of another script', () => {
  it.each(['zh-TW', 'zh-HK'])(
    'is a fallback for the plural rules of %s, written in Traditional Chinese and answered in Simplified',
    (locale) => {
      expect(pluralLocaleOf(locale)).toBe('zh');
      expect(selectPlural(decimal('2'), at(locale))).toMatchObject({
        ok: true,
        language: 'zh',
        fallback: true,
      });
    },
  );
});

describe('a formatter answered by another locale of the chain', () => {
  const N = decimal('1234.5');
  const NOON = instant('1710417600000000000');

  it('names de for de-AQ and is not a fallback', () => {
    const written = formatNumber(N, at('de-AQ'));
    expect(written).toMatchObject({ ok: true, value: { language: 'de' } });
    expect(written.ok && 'fallback' in written.value).toBe(false);
  });

  it('is a fallback for ht, written as fr-HT in another language', () => {
    for (const written of [
      formatNumber(N, at('ht')),
      formatInstant(NOON, at('ht'), { dateStyle: 'full' }),
    ]) {
      expect(written).toMatchObject({
        ok: true,
        value: { language: 'fr-HT', fallback: true },
      });
    }
  });

  it('names nothing and is not a fallback where the host has the locale itself', () => {
    const written = formatNumber(N, at('en-AU'));
    expect(written).toMatchObject({ ok: true, value: { language: 'en-AU' } });
    expect(written.ok && 'fallback' in written.value).toBe(false);
  });
});

describe('a message value formatted by another locale of the chain', () => {
  const N_INPUT: readonly CompiledInputContract[] = [
    { name: 'n', type: 'number', optional: false, nullable: false },
  ];

  const D_INPUT: readonly CompiledInputContract[] = [
    { name: 'd', type: 'date-time', optional: false, nullable: false },
  ];

  const valuePart = (
    locale: string,
    source = '{$n :number}',
  ): LocalizedValuePart => {
    const semantics = parse(source) as unknown as {
      declarations: unknown;
      pattern: unknown;
    };
    const dated = source.includes('$d');
    const result = evaluateArtifact(
      {
        body: {
          kind: 'pattern',
          declarations: semantics.declarations,
          pattern: semantics.pattern,
        },
        inputs: dated ? D_INPUT : N_INPUT,
        resultKind: 'structured',
      },
      dated ? { d: new Date(Date.UTC(2024, 2, 14, 13, 5)) } : { n: 1234.5 },
      undefined,
      at(locale),
    );
    if (result.kind !== 'parts') throw new Error('Expected parts.');
    const part = result.value.find(
      (candidate): candidate is LocalizedValuePart =>
        candidate.kind === 'value',
    );
    if (part === undefined) throw new Error('Expected a value part.');
    return part;
  };

  it('is a fallback for ht, written as fr-HT', () => {
    expect(valuePart('ht')).toMatchObject({
      valueLanguage: 'fr-HT',
      valueFallback: true,
    });
  });

  it('names de for de-AQ and is not a fallback', () => {
    const part = valuePart('de-AQ');
    expect(part.valueLanguage).toBe('de');
    expect('valueFallback' in part).toBe(false);
  });

  it('is a fallback for a :date value under ht, written as fr-HT', () => {
    expect(valuePart('ht', '{$d :date}')).toMatchObject({
      valueLanguage: 'fr-HT',
      valueFallback: true,
    });
  });

  it('names de for a :date value under de-AQ and is not a fallback', () => {
    const part = valuePart('de-AQ', '{$d :date}');
    expect(part.valueLanguage).toBe('de');
    expect('valueFallback' in part).toBe(false);
  });
});
