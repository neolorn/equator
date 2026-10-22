import { describe, expect, it } from 'vitest';

import { canonicalizeLanguageTag } from '../core/src/language-tag.js';
import {
  negotiateLocale,
  parseAcceptLanguage,
} from '../core/src/locale-negotiation.js';

/**
 * Which ranges of an `Accept-Language` header are read at all, and what lookup asks about them.
 *
 * The header is written by the client, so each case here is a spelling a client can send: a range
 * that is too long, one carrying a character no language tag has, a weight with more digits than
 * the grammar's sender may write. The candidates are read through the canonicalization the caller
 * supplies, which is the only thing lookup shows of the steps it took.
 */

const canonicalize = canonicalizeLanguageTag;

const candidates = (range: string): readonly string[] => {
  const asked: string[] = [];
  negotiateLocale([range], [], (value) => {
    asked.push(value);
    return canonicalize(value);
  });
  return asked;
};

describe('the ranges an Accept-Language header is read for', () => {
  it('reads a weight whose integer part has more than one digit', () => {
    // A recipient is not bound by the sender's grammar, so `00.5` is the number it spells. Read as
    // no weight at all, German keeps the default of 1 and outranks the English it was placed under.
    expect(parseAcceptLanguage('de;q=00.5, en')).toEqual(['en', 'de']);
  });

  it('reads a weight with white space around any part of it', () => {
    expect(parseAcceptLanguage('de;q=0.5 , en')).toEqual(['en', 'de']);
    expect(parseAcceptLanguage('de; q=0.5, en')).toEqual(['en', 'de']);
    expect(parseAcceptLanguage('de;q =0.5, en')).toEqual(['en', 'de']);
    expect(parseAcceptLanguage('de;q=0.5, en')).toEqual(['en', 'de']);
  });

  it('leaves the default of 1 for a parameter whose name only contains q', () => {
    expect(parseAcceptLanguage('de;xq=0.5, en')).toEqual(['de', 'en']);
    expect(parseAcceptLanguage('de;qx=0.5, en')).toEqual(['de', 'en']);
  });

  it('leaves the default of 1 when a weight is followed by anything else', () => {
    // `0.5x` is not a number, so it states no weight. Reading the digits it begins with would rank
    // German below English on the strength of a parameter that is not one.
    expect(parseAcceptLanguage('de;q=0.5x, en')).toEqual(['de', 'en']);
  });

  it('keeps a range exactly as long as the bound and drops one a character longer', () => {
    const atBound = 'a'.repeat(64);
    const pastBound = 'a'.repeat(65);

    expect(parseAcceptLanguage(`${atBound}, en`)).toEqual([atBound, 'en']);
    expect(parseAcceptLanguage(`${pastBound}, en`)).toEqual(['en']);
  });

  it('drops a range that only begins like a language range', () => {
    expect(parseAcceptLanguage('en_US, de')).toEqual(['de']);
  });

  it('drops a range that only ends like a language range', () => {
    expect(parseAcceptLanguage('_en, de')).toEqual(['de']);
  });

  it('drops the wildcard and an empty range', () => {
    expect(parseAcceptLanguage('*, , de')).toEqual(['de']);
  });

  it('keeps header order among ranges of equal weight', () => {
    expect(parseAcceptLanguage('fr, en, de')).toEqual(['fr', 'en', 'de']);
    expect(parseAcceptLanguage('fr;q=0.5, en, de;q=0.5, ar')).toEqual([
      'en',
      'ar',
      'fr',
      'de',
    ]);
  });
});

describe('the candidates lookup asks about', () => {
  it('asks about nothing for an empty range', () => {
    expect(candidates('')).toEqual([]);
  });

  it('stops once truncation leaves nothing', () => {
    // A range that begins with a hyphen truncates to the empty string, which is not a candidate.
    expect(candidates('-en')).toEqual(['-en']);
  });

  it('keeps a one-character first subtag as the last candidate', () => {
    // A singleton is removed with the subtag before it only when there is one before it.
    expect(candidates('a-b')).toEqual(['a-b', 'a']);
  });

  it('removes a singleton that follows a leading hyphen', () => {
    expect(candidates('-a-b')).toEqual(['-a-b']);
  });

  it('removes every trailing singleton in one step', () => {
    expect(candidates('en-a-b-cc')).toEqual(['en-a-b-cc', 'en']);
  });
});

describe('the supported locale a range is answered with', () => {
  it('answers the exact locale ahead of an earlier one in the same language', () => {
    expect(negotiateLocale(['en-GB'], ['en-US', 'en-GB'], canonicalize)).toBe(
      'en-GB',
    );
  });

  it('goes on to the next range when a candidate is not a tag and the list holds a non-locale', () => {
    // A list written by hand can hold an entry that is no text at all. A candidate that is not a
    // tag is not that entry, so the range is passed over and the next one answers.
    const supported = [undefined, 'en'] as unknown as readonly string[];
    expect(negotiateLocale(['-x', 'en'], supported, canonicalize)).toBe('en');
  });

  it('answers nothing for a range with no language subtag', () => {
    expect(negotiateLocale([''], [''], canonicalize)).toBeUndefined();
  });

  it('does not answer an unrelated language to an encompassing one', () => {
    expect(negotiateLocale(['no'], ['en-US'], canonicalize)).toBeUndefined();
  });

  it('does not answer an encompassed language written in another script', () => {
    expect(negotiateLocale(['no'], ['nb-Cyrl'], canonicalize)).toBeUndefined();
    expect(negotiateLocale(['no'], ['nb-Cyrl', 'nb-NO'], canonicalize)).toBe(
      'nb-NO',
    );
  });

  it('moves to the next range when an encompassing one matches nothing', () => {
    expect(negotiateLocale(['no', 'en'], ['en-US'], canonicalize)).toBe(
      'en-US',
    );
  });
});
