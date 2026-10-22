import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseLocalizedInput } from '../src/localized-input.js';
import { type LocalizedInputProfile } from '@neolorn/equator/core';

/**
 * A measurement field learns the spellings of its unit from the platform's formatter, and what the
 * formatter writes is the platform's locale data, which differs by platform and by release. These
 * cases put a formatter in the platform's place whose spellings have a shape the data of the
 * platform running the suite does not happen to have, so that what the field does with such a
 * shape is held on every platform.
 */

const DAYS: LocalizedInputProfile = { kind: 'measurement', unit: 'day' };

type Part = Intl.NumberFormatPart;

const formatToParts = Intl.NumberFormat.prototype.formatToParts;

/**
 * Stands in for the platform where a unit is written, and leaves every other number to it.
 *
 * `spell` is given the amount without its sign and whether the amount is below zero, and answers
 * the parts the platform would have written.
 */
function writeUnitsAs(
  spell: (amount: string, negative: boolean, count: number) => readonly Part[],
): void {
  vi.spyOn(Intl.NumberFormat.prototype, 'formatToParts').mockImplementation(
    function (this: Intl.NumberFormat, value?: number | bigint | string) {
      if (this.resolvedOptions().style !== 'unit') {
        return formatToParts.call(this, value as number);
      }
      const count = Number(value);
      const negative = count < 0 || Object.is(count, -0);
      return [...spell(String(Math.abs(count)), negative, Math.abs(count))];
    },
  );
}

const integer = (value: string): Part => ({ type: 'integer', value });
const literal = (value: string): Part => ({ type: 'literal', value });
const unit = (value: string): Part => ({ type: 'unit', value });
const minus: Part = { type: 'minusSign', value: '-' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a locale that writes an amount below zero without its number', () => {
  it('still reads the spelling of every plural category above zero', () => {
    writeUnitsAs((amount, negative, count) =>
      negative
        ? [literal('none')]
        : [integer(amount), literal(' '), unit(count === 1 ? 'day' : 'days')],
    );
    const context = { locale: 'en-US' };

    expect(parseLocalizedInput('5 days', DAYS, context)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '5' }, unit: 'day' },
    });
    expect(parseLocalizedInput('1 day', DAYS, context)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '1' }, unit: 'day' },
    });
  });
});

describe('a locale in which one spelling of a unit ends another', () => {
  // The spelling for one is the last letter of the spelling for every other count, so it fits
  // around the whole of `5 days` as well, with `5 day` left where the number belongs.
  const spellings = (): void => {
    writeUnitsAs((amount, negative, count) => [
      ...(negative ? [minus] : []),
      integer(amount),
      ...(count === 1 ? [unit('s')] : [literal(' '), unit('days')]),
    ]);
  };
  const context = { locale: 'en-GB' };

  it('reads an amount by the longest spelling that fits it', () => {
    spellings();

    expect(parseLocalizedInput('5 days', DAYS, context)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '5' } },
    });
  });

  it('reads an amount below zero by the longest spelling that fits it', () => {
    spellings();

    expect(parseLocalizedInput('-5 days', DAYS, context)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '-5' } },
    });
  });

  it('reads the shorter spelling where only it fits', () => {
    spellings();

    expect(parseLocalizedInput('1s', DAYS, context)).toMatchObject({
      status: 'valid',
      value: { amount: { value: '1' } },
    });
  });
});
