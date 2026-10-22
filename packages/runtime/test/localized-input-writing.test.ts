import { describe, expect, it } from 'vitest';

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
  type LocalizedInputValue,
} from '@neolorn/equator/core';

/**
 * Writing is the other half of reading: a value is written in the spelling its profile reads, and
 * only when reading that spelling gives the same value back. A value of another kind, a value the
 * profile's precision or range would change, and a value the platform cannot spell exactly are
 * each reported, because a field showing a neighbouring value looks correct and is not.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const ARABIC_DIGITS: FormattingContext = Object.freeze({
  locale: 'ar-EG',
  numberingSystem: 'arab',
});
// A numbering system the locale would not pick for itself, so only the context can be its source.
const ENGLISH_IN_ARABIC_DIGITS: FormattingContext = Object.freeze({
  locale: 'en-US',
  numberingSystem: 'arab',
});

const PROFILES: Readonly<Record<string, LocalizedInputProfile>> = Object.freeze(
  {
    decimal: { kind: 'decimal' },
    money: { kind: 'money', currency: 'USD', requireCurrency: true },
    measurement: { kind: 'measurement', unit: 'kilometer', requireUnit: true },
    percent: {
      kind: 'percent',
      scale: 'percent-unit',
      requirePercentSign: true,
    },
    'percentage-points': { kind: 'percentage-points' },
    'plain-date': {
      kind: 'plain-date',
      order: 'year-month-day',
      separator: '-',
    },
    'plain-time': {
      kind: 'plain-time',
      hourCycle: 'h23',
      precision: 'minute',
      separator: ':',
    },
    'plain-date-time': {
      kind: 'plain-date-time',
      date: { order: 'year-month-day', separator: '-' },
      time: { hourCycle: 'h23', precision: 'minute', separator: ':' },
      separator: ' ',
    },
    'time-zone': {
      kind: 'time-zone',
      options: [{ timeZone: 'Europe/Paris', labels: ['Paris'] }],
    },
    duration: {
      kind: 'duration',
      pattern: [{ field: 'hours' }, ':', { field: 'minutes' }],
    },
    instant: { kind: 'instant', syntax: 'rfc3339' },
  },
);

// Built per case, because a value constructor that threw here would take the whole file with it.
function values(): Readonly<Record<string, unknown>> {
  return {
    decimal: decimal('5'),
    money: money(decimal('5'), 'USD'),
    measurement: measurement(decimal('5'), 'kilometer'),
    percent: percent(decimal('5'), 'percent-unit'),
    'percentage-points': percentagePoints(decimal('5')),
    'plain-date': plainDate(2024, 1, 2),
    'plain-time': plainTime(13, 45),
    'plain-date-time': plainDateTime(plainDate(2024, 1, 2), plainTime(13, 45)),
    'time-zone': timeZone('Europe/Paris'),
    duration: duration({ hours: 1, minutes: 30 }),
    instant: instant('1704164645000000000'),
  };
}

const TEXTS: Readonly<Record<string, string>> = Object.freeze({
  decimal: '5',
  money: '$5.00',
  measurement: '5 km',
  percent: '5%',
  'percentage-points': '5',
  'plain-date': '2024-01-02',
  'plain-time': '13:45',
  'plain-date-time': '2024-01-02 13:45',
  'time-zone': 'Paris',
  duration: '1:30',
  instant: '2024-01-02T03:04:05Z',
});

function write(
  value: unknown,
  profile: object,
  context: FormattingContext = EN,
): ReturnType<typeof formatLocalizedInput> {
  return formatLocalizedInput(
    value as LocalizedInputValue<LocalizedInputProfile>,
    profile as LocalizedInputProfile,
    context,
  );
}

function written(
  value: unknown,
  profile: object,
  context: FormattingContext = EN,
): string | undefined {
  const result = write(value, profile, context);
  return result.ok ? result.value.text : undefined;
}

const REFUSED_WRITE = {
  ok: false,
  diagnostic: {
    code: 'invalid-localized-input',
    outcome: 'operational-failure',
    targetLocale: 'en-US',
  },
};

describe('a value written under the profile of its own kind', () => {
  for (const kind of Object.keys(PROFILES)) {
    it(`writes a ${kind} value and reads it back`, () => {
      const value = values()[kind];
      const profile = PROFILES[kind] as LocalizedInputProfile;
      expect(written(value, profile)).toBe(TEXTS[kind]);
      expect(
        parseLocalizedInput(TEXTS[kind] as string, profile, EN),
      ).toMatchObject({ status: 'valid', value });
    });
  }
});

describe('a value written under the profile of another kind', () => {
  for (const profileKind of Object.keys(PROFILES)) {
    for (const valueKind of Object.keys(PROFILES)) {
      if (valueKind === profileKind) continue;
      it(`refuses ${valueKind} under ${profileKind}`, () => {
        expect(
          write(values()[valueKind], PROFILES[profileKind] as object),
        ).toMatchObject(REFUSED_WRITE);
      });
    }
  }

  const NEAR_MISSES: readonly (readonly [string, () => unknown, object])[] = [
    [
      'money in another currency',
      () => money(decimal('5'), 'EUR'),
      PROFILES['money'] as object,
    ],
    [
      'a quantity in another unit',
      () => measurement(decimal('5'), 'meter'),
      PROFILES['measurement'] as object,
    ],
    [
      'a percentage on the other scale',
      () => percent(decimal('0.05'), 'fractional'),
      PROFILES['percent'] as object,
    ],
    [
      'a date in another calendar',
      () => plainDate(2024, 1, 2, 'gregory'),
      PROFILES['plain-date'] as object,
    ],
    [
      'an ISO date under a Gregorian pattern',
      () => plainDate(2024, 1, 2),
      { ...PROFILES['plain-date'], calendar: 'gregory' },
    ],
  ];

  const LOOKALIKES: readonly (readonly [string, object, object])[] = [
    [
      'a currency',
      { kind: 'decimal', value: '5', currency: 'USD' },
      PROFILES['money'] as object,
    ],
    [
      'a unit',
      { kind: 'decimal', value: '5', unit: 'kilometer' },
      PROFILES['measurement'] as object,
    ],
    [
      'a percent scale',
      { kind: 'decimal', value: '5', scale: 'percent-unit' },
      PROFILES['percent'] as object,
    ],
  ];

  for (const [title, value, profile] of LOOKALIKES) {
    it(`refuses a value of another kind that carries ${title}`, () => {
      // The kind is what makes a value money or a quantity, not the member beside it.
      expect(write(value, profile)).toMatchObject(REFUSED_WRITE);
    });
  }

  for (const [title, value, profile] of NEAR_MISSES) {
    it(`refuses ${title}`, () => {
      expect(write(value(), profile)).toMatchObject(REFUSED_WRITE);
    });
  }
});

describe('a number written for a field', () => {
  it('writes no grouping unless the profile allows it', () => {
    expect(written(decimal('1234567'), { kind: 'decimal' })).toBe('1234567');
    expect(
      written(decimal('1234567'), { kind: 'decimal', allowGrouping: false }),
    ).toBe('1234567');
  });

  it('writes grouping when the profile allows it', () => {
    expect(
      written(decimal('1234567'), { kind: 'decimal', allowGrouping: true }),
    ).toBe('1,234,567');
  });

  it('writes a negative number with the sign the locale uses', () => {
    expect(written(decimal('-5.5'), { kind: 'decimal' })).toBe('-5.5');
  });

  it('writes as many fraction digits as the profile declares', () => {
    expect(
      written(decimal('1.23456'), {
        kind: 'decimal',
        maximumFractionDigits: 5,
      }),
    ).toBe('1.23456');
  });

  it('writes the digits of the numbering system the context names', () => {
    expect(written(decimal('12'), { kind: 'decimal' }, ARABIC_DIGITS)).toBe(
      '١٢',
    );
  });

  const NUMERIC: readonly (readonly [string, () => unknown, object, string])[] =
    [
      [
        'grouped money',
        () => money(decimal('1234.5'), 'USD'),
        { kind: 'money', currency: 'USD', allowGrouping: true },
        '$1,234.50',
      ],
      [
        'ungrouped money',
        () => money(decimal('1234.5'), 'USD'),
        { kind: 'money', currency: 'USD' },
        '$1234.50',
      ],
      [
        'money to three places',
        () => money(decimal('1.005'), 'USD'),
        { kind: 'money', currency: 'USD', maximumFractionDigits: 3 },
        '$1.005',
      ],
      [
        'a grouped quantity',
        () => measurement(decimal('1234.5'), 'kilometer'),
        { kind: 'measurement', unit: 'kilometer', allowGrouping: true },
        '1,234.5 km',
      ],
      [
        'an ungrouped quantity',
        () => measurement(decimal('1234.5'), 'kilometer'),
        { kind: 'measurement', unit: 'kilometer' },
        '1234.5 km',
      ],
      [
        'a quantity to five places',
        () => measurement(decimal('1.23456'), 'kilometer'),
        { kind: 'measurement', unit: 'kilometer', maximumFractionDigits: 5 },
        '1.23456 km',
      ],
      [
        'a grouped percentage',
        () => percent(decimal('1234'), 'percent-unit'),
        { kind: 'percent', scale: 'percent-unit', allowGrouping: true },
        '1,234%',
      ],
      [
        'an ungrouped percentage',
        () => percent(decimal('1234'), 'percent-unit'),
        { kind: 'percent', scale: 'percent-unit' },
        '1234%',
      ],
      [
        'a fraction as a percentage',
        () => percent(decimal('0.25'), 'fractional'),
        { kind: 'percent', scale: 'fractional' },
        '25%',
      ],
      [
        'a percentage to two places',
        () => percent(decimal('12.34'), 'percent-unit'),
        { kind: 'percent', scale: 'percent-unit', maximumFractionDigits: 2 },
        '12.34%',
      ],
      [
        'grouped percentage points',
        () => percentagePoints(decimal('1234.5')),
        { kind: 'percentage-points', allowGrouping: true },
        '1,234.5',
      ],
      [
        'ungrouped percentage points',
        () => percentagePoints(decimal('1234.5')),
        { kind: 'percentage-points' },
        '1234.5',
      ],
      [
        'percentage points to five places',
        () => percentagePoints(decimal('1.23456')),
        { kind: 'percentage-points', maximumFractionDigits: 5 },
        '1.23456',
      ],
    ];

  for (const [title, value, profile, text] of NUMERIC) {
    it(`writes ${title}`, () => {
      expect(written(value(), profile)).toBe(text);
    });
  }

  // A profile that declares no precision reads every fraction digit typed, so it writes every one
  // the value has, and keeps the fraction digits the locale shows for a rounder value.
  const UNDECLARED: readonly (readonly [
    string,
    () => unknown,
    object,
    string,
    FormattingContext?,
  ])[] = [
    [
      'a number to five places',
      () => decimal('1.23456'),
      { kind: 'decimal' },
      '1.23456',
    ],
    [
      'a number to sixteen places',
      () => decimal('0.1234567890123456'),
      { kind: 'decimal' },
      '0.1234567890123456',
    ],
    [
      'a number to five places in Arabic digits',
      () => decimal('1.23456'),
      { kind: 'decimal' },
      '١٫٢٣٤٥٦',
      ARABIC_DIGITS,
    ],
    [
      'money to three places',
      () => money(decimal('1.005'), 'USD'),
      { kind: 'money', currency: 'USD' },
      '$1.005',
    ],
    [
      'money to one place in the two the currency shows',
      () => money(decimal('5.5'), 'USD'),
      { kind: 'money', currency: 'USD' },
      '$5.50',
    ],
    [
      'whole money in the two places the currency shows',
      () => money(decimal('5'), 'USD'),
      { kind: 'money', currency: 'USD' },
      '$5.00',
    ],
    [
      'whole money in a currency that shows no places',
      () => money(decimal('5'), 'JPY'),
      { kind: 'money', currency: 'JPY' },
      '¥5',
    ],
    [
      'a fraction of a currency that shows no places',
      () => money(decimal('5.5'), 'JPY'),
      { kind: 'money', currency: 'JPY' },
      '¥5.5',
    ],
    [
      'a quantity to five places',
      () => measurement(decimal('1.23456'), 'kilometer'),
      { kind: 'measurement', unit: 'kilometer' },
      '1.23456 km',
    ],
    [
      'a fraction as a percentage to three places',
      () => percent(decimal('0.12345'), 'fractional'),
      { kind: 'percent', scale: 'fractional' },
      '12.345%',
    ],
    [
      'a fraction as a percentage below one',
      () => percent(decimal('0.005'), 'fractional'),
      { kind: 'percent', scale: 'fractional' },
      '0.5%',
    ],
    [
      'a tenth as a whole percentage',
      () => percent(decimal('0.1'), 'fractional'),
      { kind: 'percent', scale: 'fractional' },
      '10%',
    ],
    [
      'a percentage to two places',
      () => percent(decimal('12.34'), 'percent-unit'),
      { kind: 'percent', scale: 'percent-unit' },
      '12.34%',
    ],
    [
      'percentage points to five places',
      () => percentagePoints(decimal('1.23456')),
      { kind: 'percentage-points' },
      '1.23456',
    ],
  ];

  for (const [title, value, profile, text, context] of UNDECLARED) {
    it(`writes ${title} when no precision is declared`, () => {
      expect(written(value(), profile, context ?? EN)).toBe(text);
      expect(
        parseLocalizedInput(
          text,
          profile as LocalizedInputProfile,
          context ?? EN,
        ),
      ).toMatchObject({ status: 'valid', value: value() });
    });
  }

  const ROUNDED: readonly (readonly [string, () => unknown, object])[] = [
    [
      'a number',
      () => decimal('1.005'),
      { kind: 'decimal', maximumFractionDigits: 2 },
    ],
    [
      'money',
      () => money(decimal('1.005'), 'USD'),
      { kind: 'money', currency: 'USD', maximumFractionDigits: 2 },
    ],
    [
      'a quantity',
      () => measurement(decimal('1.005'), 'kilometer'),
      { kind: 'measurement', unit: 'kilometer', maximumFractionDigits: 2 },
    ],
    [
      'a percentage',
      () => percent(decimal('1.005'), 'percent-unit'),
      { kind: 'percent', scale: 'percent-unit', maximumFractionDigits: 2 },
    ],
    [
      'percentage points',
      () => percentagePoints(decimal('1.005')),
      { kind: 'percentage-points', maximumFractionDigits: 2 },
    ],
  ];

  for (const [title, value, profile] of ROUNDED) {
    it(`does not write ${title} the declared precision would round`, () => {
      expect(write(value(), profile)).toMatchObject(REFUSED_WRITE);
    });
  }

  it('does not write a number outside the declared range', () => {
    const profile = { kind: 'decimal', maximum: decimal('10') };
    expect(write(decimal('50'), profile)).toMatchObject(REFUSED_WRITE);
    expect(written(decimal('10'), profile)).toBe('10');
  });

  it('passes on the report of a number the platform cannot spell exactly', () => {
    expect(
      write(decimal('0.1234567890123456789'), { kind: 'decimal' }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: 'unsupported-formatting-capability' },
    });
  });

  it('writes text exactly as long as the declared limit', () => {
    expect(
      written(decimal('42'), { kind: 'decimal', maximumCharacters: 2 }),
    ).toBe('42');
  });

  it('does not write text longer than the declared limit', () => {
    expect(
      write(decimal('123'), { kind: 'decimal', maximumCharacters: 2 }),
    ).toMatchObject(REFUSED_WRITE);
  });
});

describe('a date written for a field', () => {
  const ISO = PROFILES['plain-date'] as object;

  it('writes the fields in the declared order and describes the text', () => {
    const value = plainDate(2024, 1, 2);
    expect(write(value, ISO)).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'plain-date',
        text: '2024-01-02',
        parts: [{ kind: 'literal', value: '2024-01-02' }],
        locale: 'en-US',
        language: 'en-US',
        direction: 'ltr',
        source: value,
      },
    });
  });

  const ORDERS: readonly (readonly [string, string, string])[] = [
    ['day-month-year', '/', '02/01/2024'],
    ['month-day-year', '/', '01/02/2024'],
    ['year-month-day', '.', '2024.01.02'],
  ];

  for (const [order, separator, text] of ORDERS) {
    it(`writes ${order} as ${text}`, () => {
      expect(written(plainDate(2024, 1, 2), { ...ISO, order, separator })).toBe(
        text,
      );
    });
  }

  it('pads the year to four digits and the others to two', () => {
    expect(written(plainDate(99, 12, 31), ISO)).toBe('0099-12-31');
  });

  it('writes a year of four digits without grouping', () => {
    expect(written(plainDate(9999, 12, 31), ISO)).toBe('9999-12-31');
  });

  it('writes the digits and direction of the context', () => {
    expect(write(plainDate(2024, 1, 2), ISO, ARABIC_DIGITS)).toMatchObject({
      ok: true,
      value: {
        text: '٢٠٢٤-٠١-٠٢',
        locale: 'ar-EG',
        language: 'ar-EG',
        direction: 'rtl',
      },
    });
  });

  it('writes the numbering system the context names over the locale default', () => {
    expect(written(plainDate(2024, 1, 2), ISO, ENGLISH_IN_ARABIC_DIGITS)).toBe(
      '٢٠٢٤-٠١-٠٢',
    );
  });

  it('writes a Gregorian date under a Gregorian pattern', () => {
    expect(
      written(plainDate(2024, 1, 2, 'gregory'), {
        ...ISO,
        calendar: 'gregory',
      }),
    ).toBe('2024-01-02');
  });

  it('does not write a year of five digits', () => {
    expect(write(plainDate(12_345, 1, 2), ISO)).toMatchObject(REFUSED_WRITE);
  });

  it('does not write a date outside the declared range', () => {
    const profile = { ...ISO, minimum: plainDate(2024, 1, 10) };
    expect(write(plainDate(2024, 1, 9), profile)).toMatchObject(REFUSED_WRITE);
    expect(written(plainDate(2024, 1, 10), profile)).toBe('2024-01-10');
  });

  it('does not write a date whose fields the text would change', () => {
    // A day that is not a whole number has no spelling, and the nearest spelling is another day.
    const value = {
      kind: 'plain-date',
      year: 2024,
      month: 1,
      day: 2.0004,
      calendar: 'iso8601',
    };
    expect(write(value, ISO)).toMatchObject(REFUSED_WRITE);
  });

  it('does not write under a pattern that does not hold together', () => {
    expect(
      write(plainDate(2024, 1, 2), { ...ISO, separator: '' }),
    ).toMatchObject(REFUSED_WRITE);
  });
});
