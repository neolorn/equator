import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import { parse, renderSemantics } from './message-harness.js';

/**
 * An input closed to a list of numbers or booleans.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 7 lets a refinement's `enum` hold literal values
 * compatible with the input's type, so a list may hold numbers or booleans as well as strings. The
 * compiler writes such a list into the artifact and the loader admits it; these cases hold the
 * evaluator to the same list at the point of use.
 */

const closedTo = (
  type: CompiledInputContract['type'],
  values: NonNullable<CompiledInputContract['enum']>,
): readonly CompiledInputContract[] => [
  { name: 'value', type, optional: false, nullable: false, enum: values },
];

const codeOf = (
  contract: readonly CompiledInputContract[],
  value: unknown,
): string | undefined => {
  try {
    renderSemantics(parse('fixed'), contract, { value });
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic.code;
    throw error;
  }
  return undefined;
};

describe('an input closed to a list of numbers', () => {
  const closed = closedTo('integer', [1, 2, 3]);

  it('accepts a listed number', () => {
    expect(codeOf(closed, 2)).toBeUndefined();
  });

  it.each([
    ['a number that is not listed', 4],
    ['the text of a listed number', '2'],
    ['a boolean', true],
  ])('refuses %s', (_label, value) => {
    expect(codeOf(closed, value)).toBe('invalid-message-input');
  });
});

describe('an input closed to a list of booleans', () => {
  const closed = closedTo('boolean', [true]);

  it('accepts the listed boolean', () => {
    expect(codeOf(closed, true)).toBeUndefined();
  });

  it.each([
    ['the boolean that is not listed', false],
    ['the text of the listed boolean', 'true'],
    ['the number one', 1],
  ])('refuses %s', (_label, value) => {
    expect(codeOf(closed, value)).toBe('invalid-message-input');
  });
});
