import { describe, expect, it } from 'vitest';

import { parseLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * A field's profile and its locale are judged before its text, and every result carries the text
 * that was given.
 *
 * A field that cannot be read at all says so whatever is typed in it, the empty text included: a
 * form that shows "incomplete" for a field no typing can complete sends its user after the wrong
 * fault. And a result is matched to its field by the text it carries, so a date-time field whose
 * fault is in one half still reports the whole of what was typed.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const NOT_A_LOCALE: FormattingContext = Object.freeze({ locale: 'not a tag' });

const DATE: LocalizedInputProfile = {
  kind: 'plain-date',
  order: 'year-month-day',
  separator: '-',
};
const TIME: LocalizedInputProfile = {
  kind: 'plain-time',
  hourCycle: 'h23',
  precision: 'minute',
  separator: ':',
};
const TWELVE_HOUR: LocalizedInputProfile = {
  kind: 'plain-time',
  hourCycle: 'h12',
  precision: 'minute',
  separator: ':',
  dayPeriod: { am: 'AM', pm: 'PM', position: 'suffix', separator: ' ' },
};
const DATE_TIME: LocalizedInputProfile = {
  kind: 'plain-date-time',
  date: { order: 'year-month-day', separator: '-' },
  time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
  separator: ' ',
};

const UNSUPPORTED = {
  status: 'unsupported-capability',
  diagnostic: {
    code: 'unsupported-input-capability',
    reason: 'native-capability-rejected',
  },
};

describe('a field in a locale that is not a language tag', () => {
  it.each([
    ['an empty time', '', TIME],
    ['an empty time with a day period', '', TWELVE_HOUR],
    ['a time', '09:30', TIME],
    ['a date', '2026-03-14', DATE],
    ['an empty date', '', DATE],
    ['an empty date and time', '', DATE_TIME],
    ['a date and time with only its date', '2026-03-14', DATE_TIME],
    ['a date and time', '2026-03-14 09:30', DATE_TIME],
  ] as const)('is an unsupported capability for %s', (_, text, profile) => {
    expect(parseLocalizedInput(text, profile, NOT_A_LOCALE)).toMatchObject({
      ...UNSUPPORTED,
      text,
    });
  });

  it('reads the same texts in a locale that is one', () => {
    expect(parseLocalizedInput('09:30', TIME, EN).status).toBe('valid');
    expect(parseLocalizedInput('2026-03-14', DATE, EN).status).toBe('valid');
    expect(parseLocalizedInput('2026-03-14 09:30', DATE_TIME, EN).status).toBe(
      'valid',
    );
  });

  it('is incomplete for an empty time in a locale that is one', () => {
    expect(parseLocalizedInput('', TIME, EN).status).toBe('incomplete');
    expect(parseLocalizedInput('', TWELVE_HOUR, EN).status).toBe('incomplete');
  });
});

describe('a date-time field under a calendar it does not read', () => {
  const BUDDHIST: LocalizedInputProfile = {
    kind: 'plain-date-time',
    date: { order: 'year-month-day', separator: '-', calendar: 'buddhist' },
    time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
    separator: ' ',
  };

  it.each([
    ['a whole text', '2569-03-14 09:30'],
    ['the empty text', ''],
    ['a text with only a date', '2569-03-14'],
    ['a text whose date is one character', '2 09:30'],
  ])('is an unsupported capability for %s', (_, text) => {
    expect(parseLocalizedInput(text, BUDDHIST, EN)).toMatchObject({
      status: 'unsupported-capability',
      text,
    });
  });
});

describe('the text a date-time result carries', () => {
  it.each([
    ['a date that does not exist', '2026-02-30 09:30', 'out-of-range'],
    ['a date short of a field', '2026-02 09:30', 'incomplete'],
    ['a date that is not digits', '2026-0x-14 09:30', 'invalid'],
    ['a time that does not exist', '2026-03-14 25:30', 'out-of-range'],
    ['a time short of a field', '2026-03-14 09', 'incomplete'],
    ['a time that is not digits', '2026-03-14 0x:30', 'invalid'],
  ] as const)('is the whole text for %s', (_, text, status) => {
    const result = parseLocalizedInput(text, DATE_TIME, EN);
    expect(result.status).toBe(status);
    expect(result.text).toBe(text);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('is the text as typed, not its normalized form', () => {
    // A decomposed letter in the faulty half: the result gives back the characters that came in.
    const typed = `2026-03-14 09:3e${String.fromCodePoint(0x301)}`;
    const result = parseLocalizedInput(typed, DATE_TIME, EN);
    expect(result.status).toBe('invalid');
    expect(result.text).toBe(typed);
  });
});
