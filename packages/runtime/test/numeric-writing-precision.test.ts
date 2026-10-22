import { describe, expect, it, vi } from 'vitest';

import { type FormattingContext } from '@neolorn/equator/core';

/**
 * A numeric field that declares no precision is written with the fraction digits its value has.
 *
 * The text alone cannot show that the precision asked of the platform is the value's own: a
 * platform that writes the shortest digits identifying a number writes the same text under any
 * larger bound, and one that writes the number's full binary expansion would then write digits the
 * value does not have. So each case reads the precision the formatter was constructed with.
 *
 * Each case takes a fresh module instance, because a formatter the module already holds is not
 * constructed again.
 */

const EN: FormattingContext = { locale: 'en-US' };

interface Construction {
  readonly style: string | undefined;
  readonly maximumFractionDigits: number | undefined;
}

const recordingNumberFormat = (): {
  constructions: () => readonly Construction[];
  restore: () => void;
} => {
  const real = Intl.NumberFormat;
  const constructions: Construction[] = [];
  const install = (value: typeof Intl.NumberFormat): void => {
    Object.defineProperty(Intl, 'NumberFormat', {
      value,
      configurable: true,
      writable: true,
    });
  };
  install(
    // A proxy with only a `construct` trap, so `instanceof Intl.NumberFormat` still holds for what
    // the formatter cache stores.
    new Proxy(real, {
      construct(target, args, newTarget) {
        const options = (args[1] ?? {}) as Intl.NumberFormatOptions;
        constructions.push({
          style: options.style,
          maximumFractionDigits: options.maximumFractionDigits,
        });
        return Reflect.construct(target, args, newTarget) as object;
      },
    }),
  );
  return { constructions: () => constructions, restore: () => install(real) };
};

const fresh = async (): Promise<{
  readonly formatting: typeof import('../src/formatting.js');
  readonly input: typeof import('../src/localized-input.js');
}> => {
  vi.resetModules();
  return {
    formatting: await import('../src/formatting.js'),
    input: await import('../src/localized-input.js'),
  };
};

/** The largest precision any formatter of the style was constructed with. */
const widest = (
  constructions: readonly Construction[],
  style: string | undefined,
): number =>
  Math.max(
    ...constructions
      .filter((construction) => construction.style === style)
      .map((construction) => construction.maximumFractionDigits ?? -1),
  );

describe('the precision a numeric field asks of the platform', () => {
  it('is the five places a number has', async () => {
    const { formatting, input } = await fresh();
    const recorder = recordingNumberFormat();
    try {
      const result = input.formatLocalizedInput(
        formatting.decimal('1.23456'),
        { kind: 'decimal' },
        EN,
      );
      expect(result).toMatchObject({ ok: true, value: { text: '1.23456' } });
      expect(widest(recorder.constructions(), undefined)).toBe(5);
    } finally {
      recorder.restore();
    }
  });

  it('is the three places the platform shows by default for a whole number', async () => {
    const { formatting, input } = await fresh();
    const recorder = recordingNumberFormat();
    try {
      const result = input.formatLocalizedInput(
        formatting.decimal('5'),
        { kind: 'decimal' },
        EN,
      );
      expect(result).toMatchObject({ ok: true, value: { text: '5' } });
      expect(widest(recorder.constructions(), undefined)).toBe(3);
    } finally {
      recorder.restore();
    }
  });

  it('is the two places a currency shows for an amount with one', async () => {
    const { formatting, input } = await fresh();
    const recorder = recordingNumberFormat();
    try {
      const result = input.formatLocalizedInput(
        formatting.money(formatting.decimal('5.5'), 'USD'),
        { kind: 'money', currency: 'USD' },
        EN,
      );
      expect(result).toMatchObject({ ok: true, value: { text: '$5.50' } });
      expect(widest(recorder.constructions(), 'currency')).toBe(2);
    } finally {
      recorder.restore();
    }
  });

  it('is the three places a fraction shows as a percentage', async () => {
    const { formatting, input } = await fresh();
    const recorder = recordingNumberFormat();
    try {
      const result = input.formatLocalizedInput(
        formatting.percent(formatting.decimal('0.12345'), 'fractional'),
        { kind: 'percent', scale: 'fractional' },
        EN,
      );
      expect(result).toMatchObject({ ok: true, value: { text: '12.345%' } });
      expect(widest(recorder.constructions(), 'percent')).toBe(3);
    } finally {
      recorder.restore();
    }
  });

  it('is no places for a fraction that is a whole percentage', async () => {
    const { formatting, input } = await fresh();
    const recorder = recordingNumberFormat();
    try {
      const result = input.formatLocalizedInput(
        formatting.percent(formatting.decimal('0.5'), 'fractional'),
        { kind: 'percent', scale: 'fractional' },
        EN,
      );
      expect(result).toMatchObject({ ok: true, value: { text: '50%' } });
      expect(widest(recorder.constructions(), 'percent')).toBe(0);
    } finally {
      recorder.restore();
    }
  });

  it('is the two places a percentage on the percent-unit scale has', async () => {
    const { formatting, input } = await fresh();
    const recorder = recordingNumberFormat();
    try {
      const result = input.formatLocalizedInput(
        formatting.percent(formatting.decimal('12.34'), 'percent-unit'),
        { kind: 'percent', scale: 'percent-unit' },
        EN,
      );
      expect(result).toMatchObject({ ok: true, value: { text: '12.34%' } });
      expect(widest(recorder.constructions(), 'percent')).toBe(2);
    } finally {
      recorder.restore();
    }
  });

  it('is the precision the profile declares, whatever the value has', async () => {
    const { formatting, input } = await fresh();
    const recorder = recordingNumberFormat();
    try {
      const result = input.formatLocalizedInput(
        formatting.measurement(formatting.decimal('1.5'), 'kilometer'),
        { kind: 'measurement', unit: 'kilometer', maximumFractionDigits: 4 },
        EN,
      );
      expect(result).toMatchObject({ ok: true, value: { text: '1.5 km' } });
      expect(widest(recorder.constructions(), 'unit')).toBe(4);
    } finally {
      recorder.restore();
    }
  });
});
