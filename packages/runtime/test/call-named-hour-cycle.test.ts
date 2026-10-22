import { expect, it } from 'vitest';

import {
  formatPlainDateTime,
  formatPlainTime,
  plainDate,
  plainDateTime,
  plainTime,
} from '../src/formatting.js';

const EN = Object.freeze({ locale: 'en-US' });

it('keeps the hour cycle a plain-time call names when the context names none', () => {
  const result = formatPlainTime(plainTime(13, 5), EN, {
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  expect(result.ok && result.value.text).toBe('13:05');
});

it('keeps the hour cycle a plain-date-time call names when the context names none', () => {
  const result = formatPlainDateTime(
    plainDateTime(plainDate(2024, 3, 14), plainTime(13, 5)),
    EN,
    { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' },
  );
  expect(result.ok && result.value.text).toBe('13:05');
});

// The call is the narrowest layer: the hour cycle it names is the one written, over the context's.
const TWELVE_HOUR = Object.freeze({
  locale: 'en-US',
  hourCycle: 'h12',
} as const);

it('keeps the hour cycle a plain-time call names over the one the context names', () => {
  const result = formatPlainTime(plainTime(13, 5), TWELVE_HOUR, {
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  expect(result.ok && result.value.text).toBe('13:05');
});

it('keeps the hour cycle a plain-date-time call names over the one the context names', () => {
  const result = formatPlainDateTime(
    plainDateTime(plainDate(2024, 3, 14), plainTime(13, 5)),
    TWELVE_HOUR,
    { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' },
  );
  expect(result.ok && result.value.text).toBe('13:05');
});

it('writes a plain time in the hour cycle the context names where the call names none', () => {
  const twentyFourHour = { locale: 'en-US', hourCycle: 'h23' } as const;
  const fields = { hour: 'numeric', minute: 'numeric' } as const;

  expect(
    formatPlainTime(plainTime(13, 5), twentyFourHour, fields),
  ).toMatchObject({ ok: true, value: { text: '13:05' } });
  expect(
    formatPlainDateTime(
      plainDateTime(plainDate(2024, 3, 14), plainTime(13, 5)),
      twentyFourHour,
      fields,
    ),
  ).toMatchObject({ ok: true, value: { text: '13:05' } });
});
