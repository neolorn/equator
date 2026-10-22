import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  createLocaleNeutralPolicy,
} from '@neolorn/equator/core';

/**
 * A list of locales with an empty slot in it, given to the one policy constructor that takes its
 * locales as a list.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md` holds a policy to canonical locale
 * tags. A slot with nothing in it is not a tag, and neither is a value that is not text, so the
 * constructor refuses each as a configuration error and never reads one by its spelling. The
 * other lists a constructor takes are the locale-neutral roots, which
 * `neutral-roots-empty-slot.test.ts` covers; every other table is a record, which has no slots.
 */

/** A locale, an empty slot, and a locale. */
const holed = (): string[] => {
  const locales = ['en-US'];
  locales[2] = 'ar-EG';
  return locales;
};

/** The diagnostic a call refuses with, or `undefined` when it did not refuse. */
const refusal = (call: () => unknown) => {
  try {
    call();
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic;
    throw error;
  }
};

const constructing = (locales: readonly unknown[]) => () =>
  createLocaleNeutralPolicy({
    defaultLocale: 'en-US',
    locales: locales as readonly string[],
  });

describe('createLocaleNeutralPolicy', () => {
  it('builds a policy from a list with every slot filled', () => {
    expect(constructing(['en-US', 'ar-EG'])().locales).toStrictEqual({
      'en-US': '',
      'ar-EG': '',
    });
  });

  it('refuses a list with an empty slot', () => {
    expect(refusal(constructing(holed()))).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
    expect(refusal(constructing(new Array<string>(1)))).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
  });

  it.each([
    [undefined],
    [null],
    [42],
    [['en-US']],
    [{ toString: () => 'ar-EG' }],
  ])('refuses a list holding %j in place of a tag', (value) => {
    expect(refusal(constructing(['en-US', value]))).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
  });
});
