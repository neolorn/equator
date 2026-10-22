import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A plain date formatted with no options is written as a numeric day, month and year, and those
 * three fields are asked of the platform by name.
 *
 * The text cannot show that: a platform given no fields at all chooses the same three, so the two
 * requests read alike wherever that default holds. What tells them apart is the request, so this
 * reads the options the date formatter is constructed with.
 *
 * Each case takes a fresh module instance, because a formatter the module already holds is not
 * constructed again.
 */

const realDateTimeFormat = Intl.DateTimeFormat;

function install(value: typeof Intl.DateTimeFormat): void {
  Object.defineProperty(Intl, 'DateTimeFormat', {
    value,
    configurable: true,
    writable: true,
  });
}

function recordConstructions(): Intl.DateTimeFormatOptions[] {
  const constructions: Intl.DateTimeFormatOptions[] = [];
  install(
    // A proxy with only a `construct` trap, so `instanceof Intl.DateTimeFormat` still holds for
    // what the formatter cache stores.
    new Proxy(realDateTimeFormat, {
      construct(target, args, newTarget) {
        // A construction that asks only which locale the host has is the runtime finding the
        // locale of the parent chain that formats, not the formatter whose fields are read here.
        const options = args[1] as Intl.DateTimeFormatOptions;
        const probe =
          Object.keys(options).length === 1 &&
          options.localeMatcher === 'lookup';
        if (!probe) constructions.push({ ...options });
        return Reflect.construct(target, args, newTarget) as object;
      },
    }),
  );
  return constructions;
}

afterEach(() => {
  install(realDateTimeFormat);
});

describe('the fields a plain date is formatted with', () => {
  it('are a numeric year, month and day when the call names none', async () => {
    vi.resetModules();
    const { formatPlainDate, plainDate } = await import('../src/formatting.js');
    const constructions = recordConstructions();

    const result = formatPlainDate(plainDate(2026, 3, 14), {
      locale: 'en-US',
    });

    expect(result).toMatchObject({ ok: true, value: { text: '3/14/2026' } });
    expect(constructions).toStrictEqual([
      { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' },
    ]);
  });

  it('are the fields the call names when it names some', async () => {
    vi.resetModules();
    const { formatPlainDate, plainDate } = await import('../src/formatting.js');
    const constructions = recordConstructions();

    const result = formatPlainDate(
      plainDate(2026, 3, 14),
      { locale: 'en-US' },
      { month: 'long' },
    );

    expect(result).toMatchObject({ ok: true, value: { text: 'March' } });
    expect(constructions).toStrictEqual([{ month: 'long', timeZone: 'UTC' }]);
  });
});
