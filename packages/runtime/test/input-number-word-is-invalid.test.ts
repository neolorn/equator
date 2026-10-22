import { describe, expect, it } from 'vitest';

import { parseLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * A number field that is given a word has been given something that is not a number, and typing
 * more of it will not make it one. That is the invalid status, which a form shows as a mistake,
 * and not the incomplete status, which a form shows as a field still being typed in. The words
 * here are the ones a page writes into a field when it prints a value it does not have.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

const WORDS: readonly string[] = ['undefined', 'null', 'NaN', 'Infinity'];

const FIELDS: readonly (readonly [string, LocalizedInputProfile])[] = [
  ['a decimal', { kind: 'decimal' }],
  ['percentage points', { kind: 'percentage-points' }],
  ['money', { kind: 'money', currency: 'USD' }],
  ['a measurement', { kind: 'measurement', unit: 'day' }],
  ['a percent', { kind: 'percent', scale: 'percent-unit' }],
];

describe('a word in a number field', () => {
  describe.each(FIELDS)('of %s', (_name, profile) => {
    it.each(WORDS)('reads %s as invalid', (word) => {
      expect(parseLocalizedInput(word, profile, EN)).toMatchObject({
        status: 'invalid',
        text: word,
        diagnostic: { code: 'invalid-localized-input' },
      });
    });
  });
});
