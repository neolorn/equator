import { describe, expect, it } from 'vitest';

import { parseLocalizedInput } from '../src/localized-input.js';

const profile = {
  kind: 'plain-date-time',
  date: { order: 'year-month-day', separator: '-' },
  time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
  separator: 'T',
} as const;

describe('a date-time that ends at its separator', () => {
  it.each([
    ['a date that does not exist', '2024-99-99T'],
    ['a date with a short year', '24-01-02T'],
    ['a date that is not digits', 'x-y-zT'],
  ])('is incomplete with %s before it', (_label, text) => {
    const result = parseLocalizedInput(text, profile as never, {
      locale: 'en-US',
    });

    expect(result.status).toBe('incomplete');
    expect(result.text).toBe(text);
  });
});
