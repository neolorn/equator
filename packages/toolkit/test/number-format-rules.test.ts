import { describe, expect, it } from 'vitest';

import { CURRENCY_DIGITS } from '../src/currency-digits.generated.js';
import {
  isWellFormedUnitIdentifier,
  NUMBER_FORMAT_RULES_EDITION,
  numberFormatRefusal,
  unsupportedNumberFormatCombination,
  type NumberFormatOptionValue,
} from '../src/number-format-rules.js';
import { SANCTIONED_SINGLE_UNITS } from '../src/sanctioned-units.generated.js';

/**
 * The transcribed ECMA-402 rules against the host they were transcribed from.
 *
 * The toolkit judges a message's number options by `number-format-rules.ts` and never asks the host,
 * so nothing in the toolkit would notice the transcription drifting from the constructor it stands
 * for. These cases put both to every option the rules read, at each bound and either side of it,
 * and require one answer from both, the same exception included.
 *
 * The edition and the engine differ in one step, 16.1.2 step 13, which the engine leaves out. The
 * toolkit declares what only that step accepts unsupported, so its answer is the edition's with that
 * declaration, and every case the two differ on is counted as one the declaration covers.
 */

type Options = Readonly<Record<string, NumberFormatOptionValue>>;

function hostRefusal(options: Options): string | undefined {
  try {
    new Intl.NumberFormat('en', options as Intl.NumberFormatOptions);
    return undefined;
  } catch (error) {
    return (error as Error).name;
  }
}

function disagreements(cases: Iterable<Options>): {
  readonly count: number;
  readonly refused: number;
  readonly declared: number;
  readonly differing: readonly string[];
} {
  let count = 0;
  let refused = 0;
  let declared = 0;
  const differing: string[] = [];
  for (const options of cases) {
    count += 1;
    const host = hostRefusal(options);
    const edition = numberFormatRefusal(options);
    const unsupported = unsupportedNumberFormatCombination(options);
    const rule = (edition ?? unsupported)?.exception;
    if (host !== undefined) refused += 1;
    if (unsupported !== undefined) declared += 1;
    if (host !== rule) {
      differing.push(`${JSON.stringify(options)}: host ${host}, rules ${rule}`);
    }
  }
  return { count, refused, declared, differing };
}

function* product(
  axes: Readonly<Record<string, readonly NumberFormatOptionValue[]>>,
): Generator<Options> {
  const names = Object.keys(axes);
  const walk = function* (
    index: number,
    options: Record<string, NumberFormatOptionValue>,
  ): Generator<Options> {
    if (index === names.length) {
      yield { ...options };
      return;
    }
    const name = names[index] as string;
    for (const value of axes[name] ?? []) {
      if (value === undefined) delete options[name];
      else options[name] = value;
      yield* walk(index + 1, options);
    }
    delete options[name];
  };
  yield* walk(0, {});
}

describe('the sanctioned units', () => {
  it('are the units the host sanctions', () => {
    expect([...SANCTIONED_SINGLE_UNITS]).toEqual(
      [...Intl.supportedValuesOf('unit')].sort(),
    );
  });

  it('are judged as the host judges them, alone and in every quotient of two', () => {
    const units = [
      ...SANCTIONED_SINGLE_UNITS,
      'furlong',
      'square-meter',
      'meter-per-second-squared',
      'Meter',
      'per',
      '',
    ];
    const cases: Options[] = [];
    for (const numerator of units) {
      cases.push({ style: 'unit', unit: numerator });
      for (const denominator of units) {
        cases.push({ style: 'unit', unit: `${numerator}-per-${denominator}` });
      }
    }
    cases.push(
      { style: 'unit', unit: 'meter-per-second-per-second' },
      { style: 'unit', unit: '-per-meter' },
      { style: 'unit', unit: 'meter-per-' },
    );
    const { count, differing } = disagreements(cases);
    expect(count).toBe(51 + 51 * 51 + 3);
    expect(differing).toEqual([]);
  });

  it('are read through IsWellFormedUnitIdentifier, which takes one quotient and no more', () => {
    expect(isWellFormedUnitIdentifier('liter-per-kilometer')).toBe(true);
    expect(isWellFormedUnitIdentifier('liter-per-kilometer-per-hour')).toBe(
      false,
    );
    expect(isWellFormedUnitIdentifier('kilometer-per-')).toBe(false);
  });
});

describe('the options the constructor reads', () => {
  it('are judged as the host judges them, every value at each bound and either side of it', () => {
    const single: Record<string, readonly NumberFormatOptionValue[]> = {
      localeMatcher: ['lookup', 'best fit', 'best', 1],
      numberingSystem: ['latn', 'Latn', 'ab', 'abcdefghi', 'arab-latn', 'x_y'],
      style: ['decimal', 'percent', 'currency', 'unit', 'Decimal', ''],
      currency: ['EUR', 'eur', 'EU', 'EURO', 'E1R', 'ÉUR', ''],
      currencyDisplay: ['code', 'symbol', 'narrowSymbol', 'name', 'never'],
      currencySign: ['standard', 'accounting', 'none'],
      unit: ['meter', 'Meter', 'furlong'],
      unitDisplay: ['short', 'narrow', 'long', 'wide'],
      notation: ['standard', 'scientific', 'engineering', 'compact', 'none'],
      compactDisplay: ['short', 'long', 'medium'],
      useGrouping: [
        true,
        false,
        0,
        '',
        'min2',
        'auto',
        'always',
        'true',
        'false',
        'never',
        1,
      ],
      signDisplay: ['auto', 'never', 'always', 'exceptZero', 'negative', 'x'],
      minimumIntegerDigits: [0, 1, 21, 22, 1.5, '3', 'x', Infinity],
      roundingIncrement: [0, 1, 2, 3, 5, 5000, 5001, 2.5, '25', 'x'],
      roundingMode: [
        'ceil',
        'floor',
        'expand',
        'trunc',
        'halfCeil',
        'halfFloor',
        'halfExpand',
        'halfTrunc',
        'halfEven',
        'nearest',
      ],
      roundingPriority: ['auto', 'morePrecision', 'lessPrecision', 'more'],
      trailingZeroDisplay: ['auto', 'stripIfInteger', 'strip'],
    };
    const cases: Options[] = [];
    for (const style of ['decimal', 'currency', 'unit']) {
      const required =
        style === 'currency'
          ? { currency: 'EUR' }
          : style === 'unit'
            ? { unit: 'meter' }
            : {};
      for (const [name, values] of Object.entries(single)) {
        for (const value of values) {
          cases.push({ style, ...required, [name]: value });
        }
      }
    }
    const { differing, refused } = disagreements(cases);
    expect(refused).toBeGreaterThan(100);
    expect(differing).toEqual([]);
  });

  it('are judged as the host judges them in every combination of the digit options', () => {
    const { count, refused, declared, differing } = disagreements(
      product({
        style: ['decimal', 'percent', 'currency', 'unit'],
        currency: [undefined, 'EUR', 'JPY', 'BHD', 'CLF'],
        unit: [undefined, 'meter'],
        notation: [undefined, 'compact'],
        roundingIncrement: [undefined, 1, 5, 25],
        roundingPriority: [undefined, 'auto', 'morePrecision', 'lessPrecision'],
        minimumFractionDigits: [undefined, 0, 1, 3, 101],
        maximumFractionDigits: [undefined, 0, 1, 3],
        minimumSignificantDigits: [undefined, 2, 22],
        maximumSignificantDigits: [undefined, 1, 21],
      }),
    );
    expect(count).toBe(4 * 5 * 2 * 2 * 4 * 4 * 5 * 4 * 3 * 3);
    expect(refused).toBeGreaterThan(count / 2);
    expect(declared).toBeGreaterThan(0);
    expect(differing).toEqual([]);
  });

  it('name the step that throws, for every step that can', () => {
    // The host's error carries no step, so the cases above hold only the exception. A refusal is
    // cited by its step, and a step of GetOption or DefaultNumberOption by the step that called it.
    const steps: readonly [Options, string, 'RangeError' | 'TypeError'][] = [
      [{ localeMatcher: 'best' }, '9.2.8 step 4, 9.2.11 step 5', 'RangeError'],
      [{ numberingSystem: 'ab' }, '9.2.8 step 6.d.ii', 'RangeError'],
      [{ style: 'Decimal' }, '16.1.3 step 1, 9.2.11 step 5', 'RangeError'],
      [{ style: 'currency' }, '16.1.3 step 4.a', 'TypeError'],
      [{ currency: 'EU' }, '16.1.3 step 5.a', 'RangeError'],
      [
        { currencyDisplay: 'never' },
        '16.1.3 step 6, 9.2.11 step 5',
        'RangeError',
      ],
      [{ currencySign: 'none' }, '16.1.3 step 7, 9.2.11 step 5', 'RangeError'],
      [{ style: 'unit' }, '16.1.3 step 9.a', 'TypeError'],
      [{ unit: 'furlong' }, '16.1.3 step 10.a', 'RangeError'],
      [{ unitDisplay: 'wide' }, '16.1.3 step 11, 9.2.11 step 5', 'RangeError'],
      [{ notation: 'none' }, '16.1.1 step 11, 9.2.11 step 5', 'RangeError'],
      [
        { minimumIntegerDigits: 0 },
        '16.1.2 step 1, 9.2.13 step 3',
        'RangeError',
      ],
      [{ roundingIncrement: 0 }, '16.1.2 step 7, 9.2.13 step 3', 'RangeError'],
      [{ roundingIncrement: 3 }, '16.1.2 step 8', 'RangeError'],
      [
        { roundingMode: 'nearest' },
        '16.1.2 step 9, 9.2.11 step 5',
        'RangeError',
      ],
      [
        { roundingPriority: 'more' },
        '16.1.2 step 10, 9.2.11 step 5',
        'RangeError',
      ],
      [
        { trailingZeroDisplay: 'strip' },
        '16.1.2 step 11, 9.2.11 step 5',
        'RangeError',
      ],
      [
        { minimumSignificantDigits: 22 },
        '16.1.2 step 22.a.i, 9.2.13 step 3',
        'RangeError',
      ],
      [
        { maximumSignificantDigits: 22 },
        '16.1.2 step 22.a.ii, 9.2.13 step 3',
        'RangeError',
      ],
      [
        { minimumFractionDigits: 101 },
        '16.1.2 step 23.a.i, 9.2.13 step 3',
        'RangeError',
      ],
      [
        { maximumFractionDigits: 101 },
        '16.1.2 step 23.a.ii, 9.2.13 step 3',
        'RangeError',
      ],
      [
        { minimumFractionDigits: 3, maximumFractionDigits: 1 },
        '16.1.2 step 23.a.v',
        'RangeError',
      ],
      [
        { roundingIncrement: 5, maximumSignificantDigits: 2 },
        '16.1.2 step 29.a',
        'TypeError',
      ],
      [
        {
          roundingIncrement: 5,
          minimumFractionDigits: 1,
          maximumFractionDigits: 2,
        },
        '16.1.2 step 29.b',
        'RangeError',
      ],
      [
        { compactDisplay: 'medium' },
        '16.1.1 step 16, 9.2.11 step 5',
        'RangeError',
      ],
      [{ useGrouping: 'never' }, '16.1.1 step 20, 9.2.12 step 6', 'RangeError'],
      [{ signDisplay: 'x' }, '16.1.1 step 24, 9.2.11 step 5', 'RangeError'],
    ];
    for (const [options, step, exception] of steps) {
      expect(numberFormatRefusal(options), JSON.stringify(options)).toEqual({
        step,
        exception,
      });
      expect(hostRefusal(options), JSON.stringify(options)).toBe(exception);
    }
  });

  it('read the currency fraction digits the pinned CLDR release gives', () => {
    // The yen is written with none and the Bahraini dinar with three, so the fraction digits a
    // rounding increment needs differ between them for the same written minimum.
    expect(CURRENCY_DIGITS['JPY']).toBe(0);
    expect(CURRENCY_DIGITS['BHD']).toBe(3);
    expect(CURRENCY_DIGITS['EUR']).toBeUndefined();
    for (const [currency, digits] of Object.entries(CURRENCY_DIGITS)) {
      expect(
        new Intl.NumberFormat('en', {
          style: 'currency',
          currency,
        }).resolvedOptions().maximumFractionDigits,
        currency,
      ).toBe(digits);
    }
    const increment = {
      style: 'currency',
      roundingIncrement: 5,
      minimumFractionDigits: 1,
    } as const;
    expect(
      numberFormatRefusal({ ...increment, currency: 'JPY' }),
    ).toBeUndefined();
    expect(numberFormatRefusal({ ...increment, currency: 'EUR' })).toEqual({
      step: '16.1.2 step 29.b',
      exception: 'RangeError',
    });
  });

  it('declare unsupported only what the edition accepts through 16.1.2 step 13', () => {
    // The edition gives this no fraction digits and accepts it; the engine throws.
    expect(numberFormatRefusal({ roundingIncrement: 5 })).toBeUndefined();
    expect(
      unsupportedNumberFormatCombination({ roundingIncrement: 5 }),
    ).toEqual({
      step: '16.1.2 step 29.b without 16.1.2 step 13',
      exception: 'RangeError',
    });
    // Written out, the range is the author's and both accept it.
    const written = {
      roundingIncrement: 5,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    };
    expect(numberFormatRefusal(written)).toBeUndefined();
    expect(unsupportedNumberFormatCombination(written)).toBeUndefined();
    // Refused by the edition itself, so not a declaration.
    expect(
      unsupportedNumberFormatCombination({
        roundingIncrement: 5,
        maximumSignificantDigits: 2,
      }),
    ).toBeUndefined();
  });

  it('are transcribed from the edition the lock pins', async () => {
    const { readFile } = await import('node:fs/promises');
    const lock = JSON.parse(
      await readFile(
        new URL('../../../standards/sources.lock.json', import.meta.url),
        'utf8',
      ),
    ) as {
      dataSources: Record<string, { version?: string }>;
    };
    expect(lock.dataSources['ecma402MeasurementUnitIdentifiers']?.version).toBe(
      NUMBER_FORMAT_RULES_EDITION,
    );
  });
});
