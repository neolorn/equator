import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * A numeric field learns the spellings of its marker from what the platform's formatter writes, so
 * what it reads depends on the platform's locale data. These cases hand it a formatter whose output
 * is fixed here, which holds the rules to every platform: a spelling is learned only where it
 * carries both the number and the marker, and a sign only where the spelling shows one.
 *
 * Each case takes a fresh module instance, because the spellings a module has learned are kept.
 */

const EN: FormattingContext = { locale: 'en-US' };

const DAYS: LocalizedInputProfile = { kind: 'measurement', unit: 'day' };
const DAYS_REQUIRED: LocalizedInputProfile = {
  kind: 'measurement',
  unit: 'day',
  requireUnit: true,
};

type Parts = Intl.NumberFormatPart[];

const realNumberFormat = Intl.NumberFormat;

function install(value: typeof Intl.NumberFormat): void {
  Object.defineProperty(Intl, 'NumberFormat', {
    value,
    configurable: true,
    writable: true,
  });
}

/**
 * Replaces what a unit formatter reports as its parts, and leaves every other formatter alone.
 *
 * Only a `construct` trap, so `instanceof Intl.NumberFormat` still holds for what the formatter
 * cache stores.
 */
function rewriteUnitParts(
  rewrite: (parts: Parts, value: number) => Parts,
): void {
  install(
    new Proxy(realNumberFormat, {
      construct(target, args, newTarget) {
        const formatter = Reflect.construct(
          target,
          args,
          newTarget,
        ) as Intl.NumberFormat;
        const options = (args[1] ?? {}) as Intl.NumberFormatOptions;
        if (options.style !== 'unit') return formatter;
        const formatToParts = formatter.formatToParts.bind(formatter);
        Object.defineProperty(formatter, 'formatToParts', {
          value: (value: number) => rewrite(formatToParts(value), value),
        });
        return formatter;
      },
    }),
  );
}

async function freshParser(): Promise<
  typeof import('../src/localized-input.js').parseLocalizedInput
> {
  vi.resetModules();
  return (await import('../src/localized-input.js')).parseLocalizedInput;
}

afterEach(() => {
  install(realNumberFormat);
});

describe('a marker the platform does not report beside the number', () => {
  const unmarked = (parts: Parts): Parts =>
    parts.map((part) =>
      part.type === 'unit' ? { type: 'literal', value: part.value } : part,
    );

  it('is a capability the locale lacks where the profile requires it', async () => {
    rewriteUnitParts(unmarked);
    const parse = await freshParser();
    expect(parse('5 days', DAYS_REQUIRED, EN)).toMatchObject({
      status: 'unsupported-capability',
      diagnostic: { code: 'unsupported-input-capability' },
    });
  });

  it('leaves the field reading a bare number where the profile does not', async () => {
    rewriteUnitParts(unmarked);
    const parse = await freshParser();
    expect(parse('5', DAYS, EN)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '5' } },
    });
    expect(parse('5 days', DAYS, EN).status).toBe('invalid');
  });
});

describe('a spelling the platform writes with no number in it', () => {
  // Every amount written as the bare word, the way some locales write one and two of a unit.
  const wordOnly = (parts: Parts): Parts =>
    parts.filter(({ type }) => type === 'unit' || type === 'literal');

  it('is not learned, so a bare number is not taken for it', async () => {
    rewriteUnitParts(wordOnly);
    const parse = await freshParser();
    expect(parse('5', DAYS, EN)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '5' } },
    });
    expect(parse('-5', DAYS, EN)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '-5' } },
    });
    expect(parse('5', DAYS_REQUIRED, EN).status).toBe('unsupported-capability');
  });

  it('is skipped for the amounts that have it while the others are learned', async () => {
    rewriteUnitParts((parts, value) =>
      Math.abs(value) === 1 ? wordOnly(parts) : parts,
    );
    const parse = await freshParser();
    expect(parse('5 days', DAYS_REQUIRED, EN)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '5' } },
    });
    expect(parse('1 day', DAYS_REQUIRED, EN).status).toBe('policy-rejected');
    expect(parse('5', DAYS_REQUIRED, EN).status).toBe('policy-rejected');
  });
});

describe('a negative amount the platform writes without a minus sign', () => {
  it('gives no sign to the text that matches its spelling', async () => {
    // The negative amount written exactly as the positive one.
    rewriteUnitParts((parts) =>
      parts.filter(({ type }) => type !== 'minusSign'),
    );
    const parse = await freshParser();
    expect(parse('5 days', DAYS_REQUIRED, EN)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '5' } },
    });
    expect(parse('-5 days', DAYS_REQUIRED, EN).status).not.toBe('valid');
  });

  it('gives no sign where the sign is reported as plain text', async () => {
    rewriteUnitParts((parts) =>
      parts.map((part) =>
        part.type === 'minusSign'
          ? { type: 'literal', value: part.value }
          : part,
      ),
    );
    const parse = await freshParser();
    expect(parse('5 days', DAYS_REQUIRED, EN)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '5' } },
    });
    expect(parse('-5 days', DAYS_REQUIRED, EN).status).not.toBe('valid');
  });
});

describe('the spellings a field has learned', () => {
  it('are learned once for a locale and a unit', async () => {
    let unitRenderings = 0;
    rewriteUnitParts((parts) => {
      unitRenderings += 1;
      return parts;
    });
    const parse = await freshParser();
    expect(parse('5 days', DAYS_REQUIRED, EN).status).toBe('valid');
    const learned = unitRenderings;
    expect(learned).toBeGreaterThan(0);
    expect(parse('1 day', DAYS_REQUIRED, EN).status).toBe('valid');
    expect(unitRenderings).toBe(learned);
  });

  it('are learned from one amount for each plural category', async () => {
    const amounts = new Set<number>();
    rewriteUnitParts((parts, value) => {
      amounts.add(Math.abs(value));
      return parts;
    });
    const parse = await freshParser();
    expect(parse('5 days', DAYS_REQUIRED, EN).status).toBe('valid');
    // English has two categories, and the first amounts that fall in them are zero and one.
    expect([...amounts].sort()).toEqual([0, 1]);
  });
});

describe('a spelling whose two sides share a character', () => {
  // The marker before the number ends in the character the marker after it begins with, so a text
  // holding that character once begins with the one and ends with the other without holding both.
  const overlapping = (parts: Parts): Parts => [
    { type: 'unit', value: 'ab' },
    ...parts.filter(({ type }) => type !== 'unit' && type !== 'literal'),
    { type: 'unit', value: 'ba' },
  ];

  it('is not matched by a text shorter than its two sides together', async () => {
    rewriteUnitParts(overlapping);
    const parse = await freshParser();
    expect(parse('aba', DAYS, EN).status).toBe('invalid');
    expect(parse('aba', DAYS_REQUIRED, EN).status).toBe('policy-rejected');
  });

  it('is matched by a text that holds both sides', async () => {
    rewriteUnitParts(overlapping);
    const parse = await freshParser();
    expect(parse('ab5ba', DAYS_REQUIRED, EN)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '5' } },
    });
    expect(parse('abba', DAYS_REQUIRED, EN).status).toBe('incomplete');
  });
});
