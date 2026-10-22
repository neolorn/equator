import { describe, expect, it, vi } from 'vitest';

import {
  decimal,
  duration,
  instant,
  measurement,
  money,
  percent,
  percentagePoints,
  plainDate,
  plainDateTime,
  plainTime,
  timeZone,
} from '../src/formatting.js';
import {
  formatLocalizedInput,
  parseLocalizedInput,
} from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * The numbering system of a context is a declaration, and a field reads and writes nothing under
 * one it cannot honour. An identifier that is not one at all is a mistake in the call; a
 * well-formed one the host has no digits for is a capability the host lacks. Neither is read as
 * "no numbering system declared", which would give the locale's own digits to a caller who asked
 * for others.
 */

// The last three a host reads as the system they spell in lower case, or looks up and does not
// find; how a name is written is not the host's to decide.
const MALFORMED: readonly string[] = [
  '',
  'no',
  'not valid',
  'latn-',
  'LATN',
  'Arab',
  'arabicext',
];
// Well formed, and not a numbering system any host has.
const UNKNOWN = 'zzzz';

const FIELDS: readonly (readonly [
  string,
  LocalizedInputProfile,
  string,
  unknown,
])[] = [
  ['decimal', { kind: 'decimal' }, '5', decimal('5')],
  [
    'money',
    { kind: 'money', currency: 'USD' },
    '5',
    money(decimal('5'), 'USD'),
  ],
  [
    'measurement',
    { kind: 'measurement', unit: 'day' },
    '5',
    measurement(decimal('5'), 'day'),
  ],
  [
    'percent',
    { kind: 'percent', scale: 'percent-unit' },
    '5',
    percent(decimal('5'), 'percent-unit'),
  ],
  [
    'percentage-points',
    { kind: 'percentage-points' },
    '5',
    percentagePoints(decimal('5')),
  ],
  [
    'plain-date',
    { kind: 'plain-date', order: 'year-month-day', separator: '-' },
    '2024-01-02',
    plainDate(2024, 1, 2),
  ],
  [
    'plain-time',
    {
      kind: 'plain-time',
      hourCycle: 'h23',
      precision: 'minute',
      separator: ':',
    },
    '13:45',
    plainTime(13, 45),
  ],
  [
    'plain-date-time',
    {
      kind: 'plain-date-time',
      date: { order: 'year-month-day', separator: '-' },
      time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
      separator: ' ',
    },
    '2024-01-02 13:45',
    plainDateTime(plainDate(2024, 1, 2), plainTime(13, 45)),
  ],
  [
    'time-zone',
    {
      kind: 'time-zone',
      options: [{ timeZone: 'UTC', labels: ['UTC'] }],
    },
    'UTC',
    timeZone('UTC'),
  ],
  [
    'duration',
    {
      kind: 'duration',
      pattern: [{ field: 'hours', maximumIntegerDigits: 2 }],
    },
    '5',
    duration({ hours: 5 }),
  ],
  [
    'instant',
    { kind: 'instant', syntax: 'rfc3339' },
    '2024-01-02T03:04:05Z',
    instant('1704164645000000000'),
  ],
];

describe('a field under a context that declares no numbering system', () => {
  for (const [kind, profile, text, value] of FIELDS) {
    it(`reads and writes a ${kind} field`, () => {
      const context = { locale: 'en-US' };
      expect(parseLocalizedInput(text, profile, context).status).toBe('valid');
      expect(
        formatLocalizedInput(value as never, profile, context),
      ).toMatchObject({ ok: true });
    });
  }
});

describe('a field read under a numbering system that is not an identifier', () => {
  it('is refused without the host being asked whether the name is one', () => {
    const asked = vi.spyOn(Intl, 'Locale');
    const listed = vi.spyOn(Intl, 'supportedValuesOf');

    for (const numberingSystem of MALFORMED) {
      expect(
        parseLocalizedInput(
          '5',
          { kind: 'decimal' },
          { locale: 'en-US', numberingSystem },
        ).status,
      ).toBe('policy-rejected');
    }
    expect(asked).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  for (const locale of ['en-US', 'ar-EG']) {
    for (const numberingSystem of MALFORMED) {
      it(`is refused as an invalid configuration in ${locale} for ${JSON.stringify(numberingSystem)}`, () => {
        expect(
          parseLocalizedInput(
            '5',
            { kind: 'decimal' },
            { locale, numberingSystem },
          ),
        ).toMatchObject({
          status: 'policy-rejected',
          text: '5',
          diagnostic: {
            code: 'invalid-configuration',
            outcome: 'operational-failure',
            targetLocale: locale,
          },
        });
      });
    }

    it(`is refused in ${locale} after the same locale was read with none declared`, () => {
      const text = new Intl.NumberFormat(locale, { useGrouping: false }).format(
        5,
      );
      expect(
        parseLocalizedInput(text, { kind: 'decimal' }, { locale }),
      ).toMatchObject({ status: 'valid', value: { value: '5' } });
      expect(
        parseLocalizedInput(
          text,
          { kind: 'decimal' },
          { locale, numberingSystem: '' },
        ),
      ).toMatchObject({
        status: 'policy-rejected',
        diagnostic: { code: 'invalid-configuration' },
      });
    });

    it(`is refused in ${locale} when the identifier is not text`, () => {
      const context = {
        locale,
        numberingSystem: 5,
      } as unknown as FormattingContext;
      expect(
        parseLocalizedInput('5', { kind: 'decimal' }, context),
      ).toMatchObject({
        status: 'policy-rejected',
        diagnostic: { code: 'invalid-configuration' },
      });
    });
  }

  for (const [kind, profile, text] of FIELDS) {
    it(`is refused for a ${kind} field`, () => {
      expect(
        parseLocalizedInput(text, profile, {
          locale: 'en-US',
          numberingSystem: '',
        }),
      ).toMatchObject({
        status: 'policy-rejected',
        diagnostic: { code: 'invalid-configuration' },
      });
    });
  }
});

describe('a field written under a numbering system that is not an identifier', () => {
  for (const [kind, profile, , value] of FIELDS) {
    for (const locale of ['en-US', 'ar-EG']) {
      it(`is reported as an invalid configuration for a ${kind} field in ${locale}`, () => {
        expect(
          formatLocalizedInput(value as never, profile, {
            locale,
            numberingSystem: '',
          }),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: 'invalid-configuration',
            outcome: 'operational-failure',
            targetLocale: locale,
          },
        });
      });
    }
  }
});

describe('a field under a numbering system the host has no digits for', () => {
  it('finds that the host does not have it', () => {
    expect(Intl.supportedValuesOf('numberingSystem')).not.toContain(UNKNOWN);
  });

  for (const locale of ['en-US', 'ar-EG']) {
    for (const [kind, profile, text, value] of FIELDS) {
      it(`is not read for a ${kind} field in ${locale}`, () => {
        expect(
          parseLocalizedInput(text, profile, {
            locale,
            numberingSystem: UNKNOWN,
          }),
        ).toMatchObject({
          status: 'unsupported-capability',
          diagnostic: {
            code: 'unsupported-input-capability',
            reason: 'native-capability-rejected',
            targetLocale: locale,
          },
        });
      });

      it(`is not written for a ${kind} field in ${locale}`, () => {
        expect(
          formatLocalizedInput(value as never, profile, {
            locale,
            numberingSystem: UNKNOWN,
          }),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: 'unsupported-formatting-capability',
            reason: 'native-capability-rejected',
            targetLocale: locale,
          },
        });
      });
    }
  }
});

describe('a field under a numbering system the host has', () => {
  it('reads and writes its digits', () => {
    const context = { locale: 'en-US', numberingSystem: 'arab' };
    const written = formatLocalizedInput(
      decimal('5'),
      { kind: 'decimal' },
      context,
    );
    expect(written).toMatchObject({ ok: true });
    const text = (written as { value: { text: string } }).value.text;
    expect(text).not.toBe('5');
    expect(
      parseLocalizedInput(text, { kind: 'decimal' }, context),
    ).toMatchObject({ status: 'valid', value: { value: '5' } });
  });
});
