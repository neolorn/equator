# How to format a value

Build a canonical value, then format it through the facade. The value carries what the formatter
needs to be correct, so nothing has to be inferred from a number.

## Before you begin

You need a composed runtime, which every Equator application has after
[the tutorial](../tutorial.md).

## Build the value

Money is an amount and a currency together, and the amount is exact:

```text
money(decimal('19.99'), 'USD');
```

`decimal` takes a string, because a string is what your database, your API and your form gave you.

The rest follow the same shape. `measurement(decimal('3.5'), 'kilometer')` carries its unit.
`percent(decimal('0.15'))` carries its scale, so nothing has to guess whether `15` meant fifteen
percent or fifteen hundredths. `plainDate(2026, 3, 14)` is a date with no time and no zone. Its
numbers are an ISO date, and it is written in the formatting context's calendar when it is formatted,
which is the locale's own unless the application or the call names another. The reason
these are values rather than numbers is [About canonical values](../explanation/about-values.md).

## Format it

Every formatter is on the facade and takes the locale from the runtime rather than from an argument:

```ts src/app/formatting.spec.ts
import { afterEach, describe, expect, it } from 'vitest';

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FormattingResult } from '@neolorn/equator/core';
import {
  decimal,
  Localization,
  money,
  plainDate,
  withRecoveryMessage,
} from '@neolorn/equator';
import {
  provideLocalizationTesting,
  resetLocalizationTestEnvironment,
} from '@neolorn/equator/testing';
import { localizationSetup } from '#i18n';
import { messages } from '#i18n/shell';

afterEach(resetLocalizationTestEnvironment);

// A formatter reports rather than throws, so a test says which half it is asserting.
function formatted(result: FormattingResult): string {
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value.text;
}

async function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideLocalizationTesting(
        localizationSetup,
        withRecoveryMessage({ message: messages.recoveryMessage }),
      ),
    ],
  });
  const localization = TestBed.inject(Localization);
  await localization.initialize();
  return localization;
}

describe('formatting', () => {
  it('writes an amount the way the committed locale writes it', async () => {
    const localization = await setup();
    const price = money(decimal('19.99'), 'USD');

    expect(formatted(localization.formatMoney(price))).toBe('$19.99');
  });

  it('follows the locale, and the amount stays exact', async () => {
    const localization = await setup();
    const price = money(decimal('19.99'), 'USD');
    await localization.changeLocale('ar-EG');

    // A different script for the digits, and the same nineteen ninety-nine.
    expect(formatted(localization.formatMoney(price))).toContain('١٩');
  });

  it('takes the options Intl takes, minus the ones the value decided', async () => {
    const localization = await setup();

    expect(
      formatted(
        localization.formatPlainDate(plainDate(2026, 3, 14), {
          dateStyle: 'long',
        }),
      ),
    ).toBe('March 14, 2026');
    expect(
      formatted(
        localization.formatList(['red', 'green', 'blue'], {
          type: 'conjunction',
        }),
      ),
    ).toBe('red, green, and blue');
  });
});
```

The options are `Intl`'s own, minus the ones the value already decided. `formatMoney` takes no
`currency`, because the money value carries it.

A formatter returns a result rather than throwing. A success carries the formatted text, the parts
behind it, and the locale that produced it, so a template that styles the currency symbol
differently from the amount has the pieces. A failure carries a diagnostic with a code.

A duration is written by the host's `Intl.DurationFormat`, and Node 22 does not have one. There,
`formatDuration` and `localizedDuration` fail with `unsupported-formatting-capability` rather than
put the units in an order Equator would have to guess.

A date fails with the same code where the host has no calendar under the name it was asked for,
whether the call, the value or the formatting context named it, rather than being written in
another calendar. A zoned date-time fails with it too where the host has no rules for its zone.

A formatter that writes digits fails with it where the host has no digits under the numbering
system it was asked for, whether the call or the formatting context named it, rather than writing
the digits of the locale. A calendar and a numbering system are named in lower case, as in
`islamic-civil` and `arab`.

`plainDate` takes a calendar name as a fourth argument, in lower case as in `islamic-civil`, and
the numbers are then that calendar's.
A `gregory` date is the ISO date of the same numbers and is written in the Gregorian calendar
whatever the context's is, which is what a date field of that calendar gives you. `formatPlainDate` fails with the
same code for a date in any other calendar, because writing it would mean converting between
calendars.

## Format in a template

A value that a template renders takes a pipe instead, one for each canonical value kind:
`localizedDecimal`, `localizedMoney`, `localizedMeasurement`, `localizedPercent`,
`localizedPercentagePoints`, `localizedInstant`, `localizedPlainDate`, `localizedPlainTime`,
`localizedPlainDateTime`, `localizedZonedDateTime` and `localizedDuration`. Each one is typed to its
own value and to the options that value leaves open, so a money value in a date pipe does not
compile. Import the ones a component uses, the way you import any other standalone declarable:

```ts src/app/price-tag.spec.ts
import { afterEach, describe, expect, it } from 'vitest';

import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  decimal,
  Localization,
  LocalizedMoneyPipe,
  money,
  withObservability,
  withRecoveryMessage,
  type LocalizationObservabilityEvent,
  type LocalizationObservabilitySink,
} from '@neolorn/equator';
import {
  provideLocalizationTesting,
  resetLocalizationTestEnvironment,
} from '@neolorn/equator/testing';
import { localizationSetup } from '#i18n';
import { messages } from '#i18n/shell';

afterEach(resetLocalizationTestEnvironment);

@Component({
  selector: 'price-tag',
  imports: [LocalizedMoneyPipe],
  template: `
    <p data-price>{{ price | localizedMoney }}</p>
    <p data-beyond-precision>{{ beyondPrecision | localizedMoney }}</p>
  `,
})
class PriceTag {
  protected readonly price = money(decimal('19.99'), 'USD');

  // More significant digits than a double holds, so this amount cannot reach the platform
  // formatter without losing precision.
  protected readonly beyondPrecision = money(
    decimal('0.12345678901234567890123'),
    'USD',
  );
}

const events: LocalizationObservabilityEvent[] = [];

const sink: LocalizationObservabilitySink = {
  emit: (event: LocalizationObservabilityEvent): void => {
    events.push(event);
  },
};

async function setup(): Promise<Localization> {
  events.length = 0;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideLocalizationTesting(
        localizationSetup,
        withRecoveryMessage({ message: messages.recoveryMessage }),
        withObservability(sink),
      ),
    ],
  });
  const localization = TestBed.inject(Localization);
  await localization.initialize();
  return localization;
}

function textOf(host: HTMLElement, marker: string): string {
  return host.querySelector(`[${marker}]`)?.textContent?.trim() ?? '';
}

describe('a value rendered by a pipe', () => {
  it('is written the way the committed locale writes it', async () => {
    await setup();
    const fixture = TestBed.createComponent(PriceTag);
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(textOf(host, 'data-price')).toBe('$19.99');
  });

  it('renders nothing and reports when it cannot be written', async () => {
    await setup();
    const fixture = TestBed.createComponent(PriceTag);
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(textOf(host, 'data-beyond-precision')).toBe('');
    expect(events.some(({ phase }) => phase === 'formatting')).toBe(true);
  });
});
```

A failed format renders an empty string and reports the diagnostic through the observability sink,
so nothing is silent and nothing throws in a template. A throw would take a view down over one value
that a locale cannot express, and a stand-in sentence would put Equator wording on your page. What
reaches the sink is [About diagnostics and runtime outcomes](../explanation/about-diagnostics.md).

Hold the options in a field rather than writing them into the binding. A pipe formats again only
when the value, the options or the locale has changed, and an object written inline in a template is
a new object on every pass.

Relative time, ranges, lists, display names and person names have no pipe and stay on the facade. A
relative time answers with an outcome rather than a string, because the distance between two moments
can be too far to phrase and what to show instead is your decision. The other four take two operands
or a plain array rather than one canonical value, so a pipe for them would have to accept an untyped
argument.

## Set the conventions once

`withFormattingContext` sets what every formatter starts from: the numbering system, the calendar,
the hour cycle and the time zone. It is one setting for the application, and what that means for a
project shipping both `ar-EG` and `fa-IR` is
[About canonical values](../explanation/about-values.md).

A message that formats a date or a time and names no zone, such as `{$when :date}`, is written in
this one. If any catalog has such a message and the context names no `timeZone`, the application
refuses to start and says so, rather than failing the first time a reader is shown a date. Name the
zone here, or write `timeZone` on the expression.

A `timeZone`, a `calendar` or a `unit` written on an expression, and the options of a number taken
together, are judged when the message is compiled, and the answer does not depend on the machine
that compiles it. The zone is a name of the time zone
database Equator pins, so `timeZone=|+05:00|` is `EQ1204`. The calendar is any name written as a
calendar name, and one the rendering host does not count in is reported when the date is formatted.

## Choose relative time thresholds

`withRelativeTimePolicy` sets which unit a distance between two moments is said in.
`withLocalizationClock` decides what "now" is: leave it out and you get the system clock, and set
`fixedClock` in a test to make a relative time reproducible. The thresholds are yours to choose,
which is [About canonical values](../explanation/about-values.md).

## Format a person's name

Order, which parts are used, and how they are shortened vary by the name's own language rather than
by the page's, so `personName` takes the language the name is in:

```text
personName('ja', { surname: '田中', givenName: '太郎' });
```

Formatting uses [CLDR](https://cldr.unicode.org/)'s rules for that language, which is what puts the
surname first for a Japanese name read on an English page.

## Put a formatted value inside a sentence

A message that contains a formatted number puts it in a placeholder, and the catalog decides the
wording around it, which is [How to write a message](write-messages.md).

## Related

- [About canonical values](../explanation/about-values.md)
- [How to read typed input](read-typed-input.md)
- [How to test localized output](test-localized-output.md)
