import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * A numeric field learns how its locale writes a number from what the platform's formatter writes:
 * the signs, the marks a locale puts around a sign, the separators and the sizes of the groups.
 * Which locales write what is the platform's locale data, and it differs from one release of that
 * data to the next, so these cases hand the field a formatter whose output is fixed here. That
 * holds each rule to every platform, the ones whose data has no locale showing it included.
 *
 * Each case takes a fresh module instance, because what a module has learned of a locale is kept.
 */

const EN: FormattingContext = { locale: 'en-US' };

const PLAIN: LocalizedInputProfile = { kind: 'decimal' };
const GROUPED: LocalizedInputProfile = { kind: 'decimal', allowGrouping: true };

// Built from their code points so that this file holds no invisible character.
const LEFT_TO_RIGHT_MARK = String.fromCodePoint(0x200e);
const FULLWIDTH_PLUS = String.fromCodePoint(0xff0b);

type Parts = Intl.NumberFormatPart[];

/** Which of the renderings the field learns from a formatter is asked for. */
type Rendering = 'signed' | 'grouped' | 'fraction' | 'digits';

const realNumberFormat = Intl.NumberFormat;

function install(value: typeof Intl.NumberFormat): void {
  Object.defineProperty(Intl, 'NumberFormat', {
    value,
    configurable: true,
    writable: true,
  });
}

/**
 * Replaces what a plain number formatter reports as its parts.
 *
 * Only a `construct` trap, so `instanceof Intl.NumberFormat` still holds for what the formatter
 * cache stores.
 */
function rewriteNumberParts(
  rewrite: (rendering: Rendering, parts: Parts, value: number) => Parts,
  digit: (text: string) => string = (text) => text,
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
        if (options.style !== undefined) return formatter;
        const rendering: Rendering =
          options.signDisplay === 'always'
            ? 'signed'
            : options.useGrouping === true
              ? 'grouped'
              : options.minimumFractionDigits === 1
                ? 'fraction'
                : 'digits';
        const formatToParts = formatter.formatToParts.bind(formatter);
        Object.defineProperty(formatter, 'formatToParts', {
          value: (value: number) =>
            rewrite(rendering, formatToParts(value), value),
        });
        if (rendering === 'digits') {
          const format = formatter.format.bind(formatter);
          Object.defineProperty(formatter, 'format', {
            value: (value: number) => digit(format(value)),
          });
        }
        return formatter;
      },
    }),
  );
}

/** Rewrites one rendering and leaves the others as the platform wrote them. */
function rewriteOnly(
  wanted: Rendering,
  rewrite: (parts: Parts, value: number) => Parts,
): void {
  rewriteNumberParts((rendering, parts, value) =>
    rendering === wanted ? rewrite(parts, value) : parts,
  );
}

async function freshParser(): Promise<
  typeof import('../src/localized-input.js').parseLocalizedInput
> {
  vi.resetModules();
  return (await import('../src/localized-input.js')).parseLocalizedInput;
}

const literal = (value: string): Intl.NumberFormatPart => ({
  type: 'literal',
  value,
});

afterEach(() => {
  install(realNumberFormat);
});

describe('the marks a locale writes around a sign', () => {
  it('are the invisible characters it writes before the number', async () => {
    rewriteOnly('signed', (parts) => [literal(LEFT_TO_RIGHT_MARK), ...parts]);
    const parse = await freshParser();
    expect(parse(`${LEFT_TO_RIGHT_MARK}-5`, PLAIN, EN)).toMatchObject({
      status: 'valid',
      value: { value: '-5' },
    });
    expect(parse('-5', PLAIN, EN)).toMatchObject({
      status: 'valid',
      value: { value: '-5' },
    });
  });

  it('are not what it writes after the number', async () => {
    rewriteOnly('signed', (parts) => [...parts, literal(LEFT_TO_RIGHT_MARK)]);
    const parse = await freshParser();
    expect(parse(`${LEFT_TO_RIGHT_MARK}-5`, PLAIN, EN).status).toBe('invalid');
    expect(parse('-5', PLAIN, EN).status).toBe('valid');
  });

  it('are not a character with width, wherever the locale writes it', async () => {
    rewriteOnly('signed', (parts) => [literal('('), ...parts]);
    const parse = await freshParser();
    expect(parse('(-5', PLAIN, EN).status).toBe('invalid');
    expect(parse('-5', PLAIN, EN).status).toBe('valid');
  });

  it('are not the invisible characters inside the sign itself', async () => {
    // The sign is then two characters, and a text carrying both is a signed number. Taking the
    // first for a mark would strip it and leave a sign the locale does not write.
    rewriteOnly('signed', (parts) =>
      parts.map((part) =>
        part.type === 'minusSign'
          ? { type: 'minusSign', value: `${LEFT_TO_RIGHT_MARK}-` }
          : part,
      ),
    );
    const parse = await freshParser();
    expect(parse(`${LEFT_TO_RIGHT_MARK}-5`, PLAIN, EN)).toMatchObject({
      status: 'valid',
      value: { value: '-5' },
    });
  });
});

describe('the signs a locale writes', () => {
  it('are read as the locale writes them, the plus sign included', async () => {
    rewriteOnly('signed', (parts) =>
      parts.map((part) =>
        part.type === 'plusSign'
          ? { type: 'plusSign', value: FULLWIDTH_PLUS }
          : part,
      ),
    );
    const parse = await freshParser();
    expect(parse(`${FULLWIDTH_PLUS}5`, PLAIN, EN)).toMatchObject({
      status: 'valid',
      value: { value: '5' },
    });
    expect(parse('+5', PLAIN, EN).status).toBe('invalid');
  });

  it('fall back to the hyphen and the plus where the locale shows none', async () => {
    rewriteOnly('signed', (parts) =>
      parts.filter(({ type }) => type !== 'minusSign' && type !== 'plusSign'),
    );
    const parse = await freshParser();
    expect(parse('-5', PLAIN, EN)).toMatchObject({
      status: 'valid',
      value: { value: '-5' },
    });
    expect(parse('+5', PLAIN, EN)).toMatchObject({
      status: 'valid',
      value: { value: '5' },
    });
  });

  it('are never an empty text, which every number would begin with', async () => {
    rewriteOnly('signed', (parts) =>
      parts.map((part) =>
        part.type === 'minusSign' ? { type: 'minusSign', value: '' } : part,
      ),
    );
    const parse = await freshParser();
    expect(parse('5', PLAIN, EN)).toMatchObject({
      status: 'valid',
      value: { value: '5' },
    });
  });
});

describe('the separators a locale writes', () => {
  it('fall back to the full stop where the locale shows no decimal separator', async () => {
    rewriteOnly('fraction', (parts) =>
      parts.filter(({ type }) => type !== 'decimal'),
    );
    const parse = await freshParser();
    expect(parse('1.5', PLAIN, EN)).toMatchObject({
      status: 'valid',
      value: { value: '1.5' },
    });
  });

  it('include no group separator where the locale writes a large number without one', async () => {
    rewriteOnly('grouped', () => [{ type: 'integer', value: '123456789' }]);
    const parse = await freshParser();
    expect(parse('1234', GROUPED, EN)).toMatchObject({
      status: 'valid',
      value: { value: '1234' },
    });
    expect(parse('1,234', GROUPED, EN).status).toBe('ambiguous');
  });
});

describe('the digits a locale writes', () => {
  it('are no digit set where the platform writes one as more than a character', async () => {
    rewriteNumberParts(
      (_, parts) => parts,
      (text) => `n${text}`,
    );
    const parse = await freshParser();
    expect(parse('5', PLAIN, EN)).toMatchObject({
      status: 'unsupported-capability',
      diagnostic: {
        code: 'unsupported-input-capability',
        reason: 'native-capability-rejected',
      },
    });
  });

  it('are a digit set where it writes each as one', async () => {
    rewriteNumberParts((_, parts) => parts);
    const parse = await freshParser();
    expect(parse('5', PLAIN, EN)).toMatchObject({
      status: 'valid',
      value: { value: '5' },
    });
  });
});

describe('the sizes of the groups a locale writes', () => {
  it('are pairs where the locale writes pairs all the way down', async () => {
    rewriteOnly('grouped', () => [
      { type: 'integer', value: '1' },
      { type: 'group', value: ',' },
      { type: 'integer', value: '23' },
      { type: 'group', value: ',' },
      { type: 'integer', value: '45' },
      { type: 'group', value: ',' },
      { type: 'integer', value: '67' },
      { type: 'group', value: ',' },
      { type: 'integer', value: '89' },
    ]);
    const parse = await freshParser();
    expect(parse('1,23', GROUPED, EN)).toMatchObject({
      status: 'valid',
      value: { value: '123' },
    });
    expect(parse('1,234', GROUPED, EN).status).toBe('invalid');
  });

  it('are the last group and the one before it, whatever their sizes', async () => {
    // Three groups, so the one before the last is not the third from the start as well.
    rewriteOnly('grouped', () => [
      { type: 'integer', value: '12' },
      { type: 'group', value: ',' },
      { type: 'integer', value: '3456' },
      { type: 'group', value: ',' },
      { type: 'integer', value: '789' },
    ]);
    const parse = await freshParser();
    expect(parse('1,2345,678', GROUPED, EN)).toMatchObject({
      status: 'valid',
      value: { value: '12345678' },
    });
    expect(parse('12,345,678', GROUPED, EN).status).toBe('invalid');
  });
});

describe('what is learned of a locale under one numbering system', () => {
  const ARABIC_DIGITS: FormattingContext = {
    locale: 'en-US',
    numberingSystem: 'arab',
  };
  const ARABIC_FIVE = String.fromCodePoint(0x665);

  it('is not what is used for the locale under none, in either order', async () => {
    const first = await freshParser();
    expect(first(ARABIC_FIVE, PLAIN, ARABIC_DIGITS).status).toBe('valid');
    expect(first('5', PLAIN, EN).status).toBe('valid');
    expect(first(ARABIC_FIVE, PLAIN, EN).status).toBe('invalid');

    const second = await freshParser();
    expect(second('5', PLAIN, EN).status).toBe('valid');
    expect(second(ARABIC_FIVE, PLAIN, ARABIC_DIGITS).status).toBe('valid');
    expect(second('5', PLAIN, ARABIC_DIGITS).status).toBe('invalid');
  });

  it('is not what is used for the locale under another', async () => {
    const LATIN_DIGITS: FormattingContext = {
      locale: 'en-US',
      numberingSystem: 'latn',
    };
    const parse = await freshParser();
    expect(parse(ARABIC_FIVE, PLAIN, ARABIC_DIGITS).status).toBe('valid');
    expect(parse('5', PLAIN, LATIN_DIGITS).status).toBe('valid');
    expect(parse(ARABIC_FIVE, PLAIN, LATIN_DIGITS).status).toBe('invalid');
  });
});
