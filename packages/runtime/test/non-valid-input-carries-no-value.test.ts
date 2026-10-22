import { describe, expect, it } from 'vitest';

import { decimal } from '../src/formatting.js';
import { parseLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
  type LocalizedInputStatus,
} from '@neolorn/equator/core';

/**
 * Only a valid reading carries a value. A caller that reads `value` off a result without checking
 * its status would otherwise commit whatever a half-typed or refused field happened to hold, so
 * each non-valid status is reached here by an input of its own and inspected for a value.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
// French groups with a narrow space and marks decimals with a comma, so a full stop reads two ways.
const FR: FormattingContext = Object.freeze({ locale: 'fr-FR' });

const DECIMAL: LocalizedInputProfile = Object.freeze({
  kind: 'decimal',
  maximumFractionDigits: 2,
  maximum: decimal('100'),
});
const DATE: LocalizedInputProfile = Object.freeze({
  kind: 'plain-date',
  order: 'year-month-day',
  separator: '-',
});

const CASES: readonly (readonly [
  Exclude<LocalizedInputStatus, 'valid'>,
  string,
  LocalizedInputProfile,
  FormattingContext?,
])[] = [
  ['incomplete', '2024-01', DATE],
  ['invalid', '12x', DECIMAL],
  ['ambiguous', '1.5', { kind: 'decimal' }, FR],
  ['out-of-range', '1'.repeat(100_000), DECIMAL],
  [
    'unsupported-capability',
    '2024-01-02',
    { ...DATE, calendar: 'hebrew' } as LocalizedInputProfile,
  ],
  ['policy-rejected', '1,000', { kind: 'decimal', allowGrouping: false }],
];

describe('a localized input result that is not valid', () => {
  for (const [status, text, profile, context] of CASES) {
    it(`carries no value when it is ${status}`, () => {
      const result = parseLocalizedInput(text, profile, context ?? EN);
      expect(result.status).toBe(status);
      expect(Object.hasOwn(result, 'value')).toBe(false);
    });
  }

  it('is told apart from a valid one, which does carry its value', () => {
    const result = parseLocalizedInput('42', DECIMAL, EN);
    expect(result).toMatchObject({ status: 'valid', value: { value: '42' } });
  });
});
