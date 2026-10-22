import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import { RUNTIME_LIMITS } from '../src/runtime-safety.js';
import { parse, renderSemantics } from './message-harness.js';

/**
 * What a message accepts for each input its generated contract declares.
 *
 * `specs/06-runtime-and-angular.spec.md` section 2 has evaluation read values that are already in
 * memory, and the contract is what says which values those may be. TypeScript checks the call site
 * of a generated handle and nothing checks a value that arrives through `unknown`, a JSON payload
 * or a JavaScript caller, so the evaluator holds the same contract again at the point of use.
 *
 * Every refusal is asserted by its code. The message under test does not print the input, so a
 * refusal cannot come from formatting the value: it comes from the contract or it does not come.
 */

const contractOf = (
  type: CompiledInputContract['type'],
  extra: Partial<CompiledInputContract> = {},
): readonly CompiledInputContract[] => [
  { name: 'value', type, optional: false, nullable: false, ...extra },
];

const UNUSED = 'fixed';
const PRINTED = '[{$value}]';

const refusalOf = (run: () => unknown): LocalizationError => {
  try {
    run();
  } catch (error) {
    if (error instanceof LocalizationError) return error;
    throw error;
  }
  throw new Error('Expected a refusal and nothing was thrown.');
};

const accepts = (
  contract: readonly CompiledInputContract[],
  value: unknown,
): void => {
  expect(renderSemantics(parse(UNUSED), contract, { value })).toBe('fixed');
};

const refuses = (
  contract: readonly CompiledInputContract[],
  value: unknown,
): void => {
  const failure = refusalOf(() =>
    renderSemantics(parse(UNUSED), contract, { value }),
  );
  expect(failure.diagnostic.code).toBe('invalid-message-input');
  expect(failure.diagnostic.outcome).toBe('operational-failure');
};

const LONGEST = 'a'.repeat(RUNTIME_LIMITS.outputCodePoints);

describe('a boolean input', () => {
  it.each([true, false])('accepts %s', (value) => {
    accepts(contractOf('boolean'), value);
  });

  it.each([
    ['the word true', 'true'],
    ['one', 1],
    ['zero', 0],
  ])('refuses %s', (_label, value) => {
    refuses(contractOf('boolean'), value);
  });

  it('prints as the word for its value', () => {
    expect(
      renderSemantics(parse(PRINTED), contractOf('boolean'), { value: true }),
    ).toBe('[true]');
  });
});

describe('a date-time input', () => {
  it.each([
    ['a date', new Date(Date.UTC(2024, 0, 2))],
    ['the epoch as a number', 0],
    ['a timestamp', 1_700_000_000_000],
    ['a timestamp before the epoch', -1],
  ])('accepts %s', (_label, value) => {
    accepts(contractOf('date-time'), value);
  });

  it.each([
    ['a date that holds no time', new Date(Number.NaN)],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a date written as text', '2024-01-02T00:00:00Z'],
    ['a timestamp written as text', '1700000000000'],
    ['a boolean', true],
    ['an object that is not a date', { getTime: (): number => 0 }],
  ])('refuses %s', (_label, value) => {
    refuses(contractOf('date-time'), value);
  });
});

describe('an integer input', () => {
  it.each([0, 3, -3, Number.MAX_SAFE_INTEGER])('accepts %d', (value) => {
    accepts(contractOf('integer'), value);
  });

  it.each([
    ['a fraction', 1.5],
    ['an integer past the safe range', 2 ** 53],
    ['not a number', Number.NaN],
    ['an integer written as text', '3'],
    ['a boolean', true],
  ])('refuses %s', (_label, value) => {
    refuses(contractOf('integer'), value);
  });
});

describe('a number input', () => {
  it.each([0, 1.5, -2.25, 1e21])('accepts %d', (value) => {
    accepts(contractOf('number'), value);
  });

  it.each([
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['a number written as text', '1.5'],
    ['a boolean', true],
    ['a date', new Date(0)],
  ])('refuses %s', (_label, value) => {
    refuses(contractOf('number'), value);
  });

  it('prints as the number it is when no function formats it', () => {
    expect(
      renderSemantics(parse(PRINTED), contractOf('number'), { value: 1.5 }),
    ).toBe('[1.5]');
  });
});

describe('a string input', () => {
  it.each([
    ['the empty string', ''],
    ['a word', 'word'],
    ['text exactly as long as the output ceiling', LONGEST],
  ])('accepts %s', (_label, value) => {
    accepts(contractOf('string'), value);
  });

  it.each([
    ['text one code point past the output ceiling', `${LONGEST}a`],
    ['a number', 5],
    ['a boolean', false],
    ['a list of strings', ['a']],
    ['a date', new Date(0)],
  ])('refuses %s', (_label, value) => {
    refuses(contractOf('string'), value);
  });
});

describe('an input closed to a list of values', () => {
  const closed = contractOf('string', { enum: ['draft', 'sent'] });

  it('accepts a listed value', () => {
    accepts(closed, 'draft');
    accepts(closed, 'sent');
  });

  it.each([
    ['a value that is not listed', 'archived'],
    ['a listed value in another case', 'Draft'],
    ['a number', 0],
    ['a list holding a listed value', ['draft']],
  ])('refuses %s', (_label, value) => {
    refuses(closed, value);
  });
});

describe('an input that may be absent', () => {
  it('accepts null only where the contract says nullable', () => {
    accepts(contractOf('string', { nullable: true }), null);
    refuses(contractOf('string'), null);
    refuses(contractOf('string', { optional: true }), null);
  });

  it('accepts an omitted value only where the contract says optional', () => {
    const optional = contractOf('number', { optional: true });
    accepts(optional, undefined);
    expect(renderSemantics(parse(UNUSED), optional, {})).toBe('fixed');
    refuses(contractOf('number'), undefined);
    refuses(contractOf('number', { nullable: true }), undefined);
    expect(
      refusalOf(() => renderSemantics(parse(UNUSED), contractOf('number'), {}))
        .diagnostic.code,
    ).toBe('invalid-message-input');
  });

  it('still holds a present value to the type when the input is optional or nullable', () => {
    const loose = contractOf('number', { optional: true, nullable: true });
    accepts(loose, 2);
    refuses(loose, 'two');
    refuses(loose, Number.NaN);
  });

  it('prints nothing for a null or an omitted value', () => {
    expect(
      renderSemantics(
        parse(PRINTED),
        contractOf('string', { nullable: true }),
        {
          value: null,
        },
      ),
    ).toBe('[]');
    expect(
      renderSemantics(
        parse(PRINTED),
        contractOf('string', { optional: true }),
        {},
      ),
    ).toBe('[]');
  });
});

describe('the inputs a message is given as a whole', () => {
  it('refuses a name the contract does not declare', () => {
    const failure = refusalOf(() =>
      renderSemantics(parse(UNUSED), contractOf('string'), {
        value: 'x',
        other: 'y',
      }),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
  });
});
