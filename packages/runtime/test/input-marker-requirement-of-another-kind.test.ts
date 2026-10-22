import { describe, expect, it } from 'vitest';

import { parseLocalizedInput } from '../src/localized-input.js';
import { type FormattingContext } from '@neolorn/equator/core';

/**
 * Each marker requirement belongs to one kind of field: the currency to money, the unit to a
 * measurement, the percent sign to a percent. A profile assembled from settings can carry one that
 * belongs to another kind, and a field has no marker of another kind to require, so the member is
 * not read and the field reads what it reads without it.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

const REQUIREMENTS: readonly string[] = [
  'requireCurrency',
  'requireUnit',
  'requirePercentSign',
];

const read = (text: string, profile: object) =>
  parseLocalizedInput(text, profile as never, EN);

describe('a marker requirement on a field of another kind', () => {
  it.each(REQUIREMENTS)('is not read by a decimal field: %s', (member) => {
    expect(read('5', { kind: 'decimal', [member]: true })).toMatchObject({
      status: 'valid',
      value: { kind: 'decimal', value: '5' },
    });
  });

  it.each(REQUIREMENTS)(
    'is not read by a field of percentage points: %s',
    (member) => {
      expect(
        read('5', { kind: 'percentage-points', [member]: true }),
      ).toMatchObject({
        status: 'valid',
        value: { kind: 'percentage-points', amount: { value: '5' } },
      });
    },
  );

  it.each(['requireUnit', 'requirePercentSign'])(
    'is not read by a money field: %s',
    (member) => {
      expect(
        read('5', { kind: 'money', currency: 'USD', [member]: true }),
      ).toMatchObject({
        status: 'valid',
        value: { kind: 'money', currency: 'USD', amount: { value: '5' } },
      });
    },
  );

  it.each(['requireCurrency', 'requirePercentSign'])(
    'is not read by a measurement field: %s',
    (member) => {
      expect(
        read('5', { kind: 'measurement', unit: 'day', [member]: true }),
      ).toMatchObject({
        status: 'valid',
        value: { kind: 'measurement', unit: 'day', amount: { value: '5' } },
      });
    },
  );

  it.each(['requireCurrency', 'requireUnit'])(
    'is not read by a percent field: %s',
    (member) => {
      expect(
        read('5', { kind: 'percent', scale: 'percent-unit', [member]: true }),
      ).toMatchObject({
        status: 'valid',
        value: { kind: 'percent', amount: { value: '5' } },
      });
    },
  );

  it.each([
    ['requireCurrency', { kind: 'money', currency: 'USD' }],
    ['requireUnit', { kind: 'measurement', unit: 'day' }],
    ['requirePercentSign', { kind: 'percent', scale: 'percent-unit' }],
  ])('is read by the field it belongs to: %s', (member, profile) => {
    expect(read('5', { ...profile, [member]: true })).toMatchObject({
      status: 'policy-rejected',
    });
  });
});
