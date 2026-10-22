import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  type PersonNameFieldKey,
} from '@neolorn/equator/core';

import { personName } from '../src/formatting.js';

/**
 * What `personName` admits as a name, and what it stores.
 *
 * The constructor's own contract: the language is the name's and is stored canonical, every part
 * is trimmed and normalized, a part is bounded, and text that changes how a rendered name reads is
 * refused. The field and variant lists are written out here and not read from the library, so a
 * key the constructor stopped carrying shows as a missing part.
 */

const FIELDS = [
  'title',
  'given',
  'given2',
  'surname',
  'surname2',
  'generation',
  'credentials',
] as const;
const VARIANTS = [
  'informal',
  'prefix',
  'core',
  'vocative',
  'genitive',
] as const;

function refusal(create: () => unknown): LocalizationError {
  let thrown: unknown;
  try {
    create();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LocalizationError);
  return thrown as LocalizationError;
}

describe('a person name', () => {
  it('is a frozen value of its own kind', () => {
    const name = personName('en', { given: 'Ada', surname: 'Lovelace' });

    expect(name).toEqual({
      kind: 'person-name',
      language: 'en',
      fields: { given: 'Ada', surname: 'Lovelace' },
    });
    expect(Object.isFrozen(name)).toBe(true);
    expect(Object.isFrozen(name.fields)).toBe(true);
  });

  it.each(FIELDS)('keeps the field %s', (field) => {
    expect(personName('en', { [field]: 'Ada' }).fields).toEqual({
      [field]: 'Ada',
    });
  });

  it.each(VARIANTS)('keeps every field in the variant %s', (variant) => {
    const supplied = Object.fromEntries(
      FIELDS.map((field) => [`${field}-${variant}`, `${field} text`]),
    ) as Partial<Record<PersonNameFieldKey, string>>;

    expect(personName('en', supplied).fields).toEqual(supplied);
  });

  it('stores the language in its canonical spelling', () => {
    expect(personName('EN-us', { given: 'Ada' }).language).toBe('en-US');
  });

  it('trims a part', () => {
    expect(personName('en', { given: '  Ada \t' }).fields.given).toBe('Ada');
  });

  it('stores a part in normalization form C', () => {
    const decomposed = `Jose${String.fromCodePoint(0x301)}`;
    const composed = `Jos${String.fromCodePoint(0xe9)}`;

    expect(personName('es', { given: decomposed }).fields.given).toBe(composed);
  });

  it('refuses a name with no part', () => {
    expect(refusal(() => personName('en', {})).diagnostic.code).toBe(
      'invalid-message-input',
    );
  });
});

describe('the language of a person name', () => {
  // A tag that is missing or out of bounds is refused before it is read as a tag, so the refusal
  // does not call it malformed.
  it('refuses a language that is not a string', () => {
    const failure = refusal(() =>
      personName(5 as unknown as string, { given: 'Ada' }),
    );

    expect(failure.diagnostic.reason).toBeUndefined();
  });

  it('refuses an empty language', () => {
    const failure = refusal(() => personName('', { given: 'Ada' }));

    expect(failure.diagnostic.reason).toBeUndefined();
  });

  it('refuses a tag that is not a language tag as malformed', () => {
    const failure = refusal(() => personName('not a tag', { given: 'Ada' }));

    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.reason).toBe('malformed-input');
  });

  // Private-use subtags are the way to a well-formed tag of a chosen length.
  const tagOfLength = (length: number): string => {
    const tail = (length - 'en-x'.length) % 9;
    const whole = (length - 'en-x'.length - tail) / 9;
    return `en-x${'-aaaaaaaa'.repeat(whole)}${tail === 0 ? '' : `-${'a'.repeat(tail - 1)}`}`;
  };

  it('admits a well-formed tag of exactly 128 code units', () => {
    const tag = tagOfLength(128);

    expect(tag).toHaveLength(128);
    expect(personName(tag, { given: 'Ada' }).language).toBe(tag);
  });

  it('refuses a well-formed tag of 129 code units', () => {
    const tag = tagOfLength(129);

    expect(tag).toHaveLength(129);
    refusal(() => personName(tag, { given: 'Ada' }));
  });
});

describe('a part of a person name', () => {
  it('refuses a part that is not a string', () => {
    refusal(() => personName('en', { given: 5 as unknown as string }));
  });

  it('refuses a part that is only white space', () => {
    refusal(() => personName('en', { given: ' \t ', surname: 'Lovelace' }));
  });

  // The bound on what is supplied is read before trimming, so padding counts toward it.
  it('admits a supplied part of exactly 512 code units', () => {
    const supplied = `Ada${' '.repeat(509)}`;

    expect(personName('en', { given: supplied }).fields.given).toBe('Ada');
  });

  it('refuses a supplied part of 513 code units', () => {
    refusal(() => personName('en', { given: `Ada${' '.repeat(510)}` }));
  });

  it('admits a part of exactly 256 code points', () => {
    const text = 'a'.repeat(256);

    expect(personName('en', { given: text }).fields.given).toBe(text);
  });

  it('counts a part in code points and not in code units', () => {
    const text = String.fromCodePoint(0x20000).repeat(256);

    expect(text).toHaveLength(512);
    expect(personName('zh', { surname: text }).fields.surname).toBe(text);
  });

  it('refuses a part of 257 code points', () => {
    refusal(() => personName('en', { given: 'a'.repeat(257) }));
  });

  it.each([
    ['a null character', 0x0],
    ['a line feed', 0xa],
    ['the last C0 control', 0x1f],
    ['delete', 0x7f],
    ['a left-to-right embedding', 0x202a],
    ['a right-to-left override', 0x202e],
    ['a left-to-right isolate', 0x2066],
    ['a pop directional isolate', 0x2069],
  ])('refuses a part carrying %s', (_, codePoint) => {
    const text = `Ada${String.fromCodePoint(codePoint)}Lovelace`;

    expect(
      refusal(() => personName('en', { given: text })).diagnostic.code,
    ).toBe('invalid-message-input');
  });

  // Text is a sequence of characters, and half of a surrogate pair is not one. Each half is built
  // from its code unit so that this file holds none.
  it.each([
    ['a high surrogate with no low one', [0x41, 0xd83d]],
    ['a low surrogate with no high one', [0xde00, 0x41]],
    ['a pair in the wrong order', [0xde00, 0xd83d]],
    ['a high surrogate between two letters', [0x41, 0xd83d, 0x42]],
    ['the first high surrogate alone', [0xd800]],
    ['the last low surrogate alone', [0xdfff]],
  ])('refuses a part carrying %s', (_, units) => {
    const text = String.fromCharCode(...units);

    expect(
      refusal(() => personName('en', { given: text })).diagnostic.code,
    ).toBe('invalid-message-input');
  });

  it('admits a part carrying a whole surrogate pair', () => {
    const text = String.fromCharCode(0x41, 0xd83d, 0xde00);

    expect(personName('en', { given: text }).fields.given).toBe(text);
  });

  it.each([
    ['the character before the surrogates', 0xd7ff],
    ['the character after the surrogates', 0xe000],
  ])('admits a part carrying %s', (_, codePoint) => {
    const text = 'Ada' + String.fromCodePoint(codePoint);

    expect(personName('en', { given: text }).fields.given).toBe(text);
  });

  it.each([
    ['a space', 0x20],
    ['the character before delete', 0x7e],
    ['a zero-width joiner', 0x200d],
    ['the character before the embeddings', 0x2029],
    ['the character after the isolates', 0x206a],
  ])('admits a part carrying %s', (_, codePoint) => {
    const text = `Ada${String.fromCodePoint(codePoint)}Lovelace`;

    expect(personName('en', { given: text }).fields.given).toBe(text);
  });
});
