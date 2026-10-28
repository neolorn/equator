/**
 * What the consumer's exercise sheet should show, written by the host's own formatters.
 *
 * `specs/12-verification.spec.md` section 8 has formatting checked against an authority Equator did
 * not write. For every value the sheet formats, that authority is the host's `Intl`, handed the
 * inputs the sheet was handed and the options each function's own documentation states. A
 * formatter that picked the wrong digits, the wrong zone, the wrong calendar or the wrong locale
 * would still round-trip through Equator's own parser, and it disagrees with this.
 *
 * Some answers are not the host's to give, and are written out here instead:
 *
 * - a message, which is the translator's, read from the consumer's catalog by the caller, with the
 *   direction CLDR gives its locale, also from the caller;
 * - a person's name, which `Intl` has no formatter for, written by hand from the pinned CLDR
 *   release with the pattern quoted beside it;
 * - which unit a relative time is counted in, which is a rule of Equator's policy rather than of
 *   any locale, worked out by hand from that rule below;
 * - how a field writes a date, a time, a duration or a zone, which is the pattern its profile
 *   declares, filled with the digits the host writes, and how it writes an instant, which is
 *   RFC 3339;
 * - what an extension the application registers answers, which is the application's own rule for
 *   it, stated beside each line below.
 *
 * It reads nothing outside its argument, so a browser row can hand this function to the engine and
 * compare the page with that engine's own formatters, and the consumer stage can run it on the
 * Node its server ran on.
 */
export function exerciseAuthority({
  inputs,
  locale,
  catalog,
  direction,
}: ExerciseAuthorityArguments) {
  const context = inputs.formattingContext;
  const tag = new Intl.Locale(locale, {
    numberingSystem: context.numberingSystem,
  }).toString();
  // What a moment is read against: the zone, calendar and hour cycle the application declares.
  const clock = {
    timeZone: context.timeZone,
    calendar: context.calendar,
    hourCycle: context.hourCycle,
  };
  const number = (options: Intl.NumberFormatOptions, value: unknown) =>
    new Intl.NumberFormat(tag, options).format(Number(value));
  const moment = (options: Intl.DateTimeFormatOptions, milliseconds: number) =>
    new Intl.DateTimeFormat(tag, options).format(milliseconds);
  const unsupported = 'unsupported-formatting-capability';

  // A plain date is noon on that day, read in UTC, so no zone can move it to another day.
  const plainDate = ({ year, month, day }: PlainDateFields) =>
    Date.UTC(year, month - 1, day, 12);
  const plainTime = ({ hour, minute, second }: PlainTimeFields) =>
    Date.UTC(1970, 0, 1, hour, minute, second);
  const plainDateTime = ({
    date,
    time,
  }: {
    readonly date: PlainDateFields;
    readonly time: PlainTimeFields;
  }) =>
    Date.UTC(
      date.year,
      date.month - 1,
      date.day,
      time.hour,
      time.minute,
      time.second,
    );

  const decimal = number(inputs.decimal.options, inputs.decimal.value);
  const money = number(
    {
      ...inputs.money.options,
      style: 'currency',
      currency: inputs.money.currency,
    },
    inputs.money.amount,
  );
  const measurement = number(
    {
      ...inputs.measurement.options,
      style: 'unit',
      unit: inputs.measurement.unit,
    },
    inputs.measurement.amount,
  );
  // A percent is written from the fraction; a value on the percent-unit scale is a hundred times
  // it.
  const percent = number(
    { ...inputs.percent.options, style: 'percent' },
    inputs.percent.scale === 'fractional'
      ? Number(inputs.percent.amount)
      : Number(inputs.percent.amount) / 100,
  );
  // Points are the number itself; the unit is a part of the result, not a character in the text.
  const percentagePoints = number(
    inputs.percentagePoints.options,
    inputs.percentagePoints.amount,
  );
  const instant = moment(
    { ...inputs.instant.options, ...clock },
    inputs.instant.epochMilliseconds,
  );
  const date = moment(
    // A date with no zone is written in the calendar the application declares, as a moment is.
    {
      calendar: context.calendar,
      ...inputs.plainDate.options,
      timeZone: 'UTC',
    },
    plainDate(inputs.plainDate),
  );
  const time = moment(
    {
      hourCycle: context.hourCycle,
      ...inputs.plainTime.options,
      timeZone: 'UTC',
    },
    plainTime(inputs.plainTime),
  );
  const dateTime = moment(
    {
      calendar: context.calendar,
      hourCycle: context.hourCycle,
      ...inputs.plainDateTime.options,
      timeZone: 'UTC',
    },
    plainDateTime(inputs.plainDateTime),
  );
  const zoned = moment(
    {
      ...inputs.zonedDateTime.options,
      ...clock,
      timeZone: inputs.zonedDateTime.timeZone,
    },
    inputs.zonedDateTime.epochMilliseconds,
  );
  // Node 22 has no duration formatter. There the sheet shows the typed result Equator returns in
  // its place, and a pipe shows nothing, which is what section 3 of
  // `specs/08-formatting-parsing-and-domain.spec.md` has a runtime without the capability do.
  const hostWritesDurations =
    typeof (
      Intl as unknown as {
        readonly DurationFormat?: DurationFormatConstructor;
      }
    ).DurationFormat === 'function';
  const duration = hostWritesDurations
    ? new (
        Intl as unknown as {
          readonly DurationFormat: DurationFormatConstructor;
        }
      ).DurationFormat(tag, inputs.duration.options).format(
        inputs.duration.fields,
      )
    : undefined;

  // `largestUnit: 'week'` and a target three days before the reference: three days is short of a
  // week and at least a day, so the policy counts it in days, truncated toward zero, as -3.
  const resolved = { value: -3, unit: 'day' } as const;
  // The application's clock reads `inputs.clock` and its policy names nothing smaller than a
  // minute. The target is 45 seconds before that clock, short of the smallest unit, so it is zero
  // minutes.
  const installed = { value: 0, unit: 'minute' } as const;

  // `en` givenFirst/medium/referring/informal is `{given-informal} {surname}`, and the name
  // carries no informal given name, so the given name stands in. `ar` defaults to long and formal,
  // and givenFirst/long/referring/formal is
  // `{title} {given} {given2} {surname} {generation}، {credentials}`; everything after the surname
  // is empty, and the Arabic comma goes with it.
  const personNames: Readonly<Record<string, string>> = {
    'en-US': 'Mary Hamish',
    'ar-EG': 'محمد المصري',
  };

  // A field writes a number the way the formatters do, without grouping unless its profile allows
  // it, and a date, a time or a duration field by field in the order and with the separators its
  // profile declares.
  const digits = (value: unknown, minimumIntegerDigits: number) =>
    number({ useGrouping: false, minimumIntegerDigits }, value);
  const dateText = (pattern: DatePattern, value: PlainDateFields) =>
    pattern.order
      .split('-')
      .map((field) =>
        digits(value[field as keyof PlainDateFields], field === 'year' ? 4 : 2),
      )
      .join(pattern.separator);
  const timeText = (
    pattern: TimePattern,
    { hour, minute, second }: PlainTimeFields,
  ) => {
    // UTS #35's hour cycles: h11 counts 0 to 11, h12 1 to 12, h23 0 to 23 and h24 1 to 24.
    const shown = {
      h11: hour % 12,
      h12: hour % 12 || 12,
      h23: hour,
      h24: hour || 24,
    }[pattern.hourCycle];
    const fields = [digits(shown, 2), digits(minute, 2)];
    if (pattern.precision !== 'minute') fields.push(digits(second, 2));
    const text = fields.join(pattern.separator);
    const period = pattern.dayPeriod;
    if (period === undefined || !['h11', 'h12'].includes(pattern.hourCycle)) {
      return text;
    }
    const marker = hour < 12 ? period.am : period.pm;
    return period.position === 'prefix'
      ? `${marker}${period.separator ?? ''}${text}`
      : `${text}${period.separator ?? ''}${marker}`;
  };
  const fieldText = ({ profile, value }: FieldControl) => {
    switch (value.kind) {
      case 'decimal':
        return number(
          {
            useGrouping: false,
            maximumFractionDigits: (
              profile as { readonly maximumFractionDigits?: number }
            ).maximumFractionDigits,
          },
          value.value,
        );
      case 'money':
        return number(
          { style: 'currency', currency: value.currency, useGrouping: false },
          value.amount.value,
        );
      case 'measurement':
        return number(
          { style: 'unit', unit: value.unit, useGrouping: false },
          value.amount.value,
        );
      case 'percent':
        return number(
          { style: 'percent', useGrouping: false },
          value.scale === 'fractional'
            ? Number(value.amount.value)
            : Number(value.amount.value) / 100,
        );
      case 'percentage-points':
        return number({ useGrouping: false }, value.amount.value);
      case 'plain-date':
        return dateText(profile as DatePattern, value);
      case 'plain-time':
        return timeText(profile as TimePattern, value);
      case 'plain-date-time':
        return [
          dateText((profile as DateTimeProfile).date, value.date),
          timeText((profile as DateTimeProfile).time, value.time),
        ].join((profile as DateTimeProfile).separator);
      case 'time-zone':
        return (
          (profile as TimeZoneProfile).options.find(
            ({ timeZone }) => timeZone === value.id,
          ) as TimeZoneProfile['options'][number]
        ).labels[0];
      case 'duration':
        return (profile as DurationProfile).pattern
          .map((token) =>
            typeof token === 'string'
              ? token
              : digits(
                  token.field === 'seconds'
                    ? value.seconds.value
                    : value[token.field],
                  token.minimumIntegerDigits ?? 1,
                ),
          )
          .join('');
      case 'instant':
        // Whole seconds in UTC, with no fraction when there is none to write.
        return new Date(Number(BigInt(value.epochNanoseconds) / 1_000_000n))
          .toISOString()
          .replace('.000Z', 'Z');
      default:
        throw new Error(
          `No field text is written for ${(value as { readonly kind: string }).kind}`,
        );
    }
  };
  const moneyField = inputs.controls.money;

  // A message function formats in the message's locale, so its text takes that locale's direction:
  // isolated right to left in a right-to-left message, and bare in a left-to-right one, as spec 09
  // section 8 has it. The application's function writes its operand in capitals, and adds an
  // exclamation mark when the message asks for loud emphasis.
  const extension = inputs.extensions;
  const isolated = (text: string) =>
    direction === 'rtl' ? `\u2067${text}\u2069` : text;
  const called = (catalog['extension.uppercase'] as string).replace(
    /\{\$name :feature:uppercase emphasis=(\w+)\}/u,
    (_: string, emphasis: string) =>
      isolated(
        `${extension.operand.toLocaleUpperCase(locale)}${emphasis === 'loud' ? '!' : ''}`,
      ),
  );
  // The application reads a badge as plain text as the word "Badge" and the words it holds.
  const badge = (
    /\{#badge[^}]*\}(.*)\{\/badge\}/u.exec(
      catalog['extension.badge'] as string,
    ) as RegExpExecArray
  )[1];
  // The structured message's markup only wraps words, so a reader gets the message without it.
  const richText = (catalog[inputs.richMessage] as string).replace(
    /\{[#/][^}]*\}/gu,
    '',
  );
  // Its SKU adapters write a SKU in capitals after "SKU-", and read one back with or without it.
  const sku = extension.parsed.replace(/^SKU-/iu, '').toUpperCase();

  return {
    localize: catalog[inputs.message],
    'directive:LocalizedMessage': richText,
    'directive:LocalizedLabel': catalog[inputs.message],
    localizedDecimal: decimal,
    localizedMoney: money,
    localizedMeasurement: measurement,
    localizedPercent: percent,
    localizedPercentagePoints: percentagePoints,
    localizedInstant: instant,
    localizedPlainDate: date,
    localizedPlainTime: time,
    localizedPlainDateTime: dateTime,
    localizedZonedDateTime: zoned,
    localizedDuration: duration ?? '',

    formatNumber: decimal,
    formatMoney: money,
    formatMeasurement: measurement,
    formatPercent: percent,
    formatPercentagePoints: percentagePoints,
    formatInstant: instant,
    formatPlainDate: date,
    formatPlainTime: time,
    formatPlainDateTime: dateTime,
    formatZonedDateTime: zoned,
    formatDuration: duration ?? unsupported,
    formatNumberRange: new Intl.NumberFormat(
      tag,
      inputs.numberRange.options,
    ).formatRange(
      Number(inputs.numberRange.start),
      Number(inputs.numberRange.end),
    ),
    formatInstantRange: new Intl.DateTimeFormat(tag, {
      ...inputs.instantRange.options,
      ...clock,
    }).formatRange(
      inputs.instantRange.startEpochMilliseconds,
      inputs.instantRange.endEpochMilliseconds,
    ),
    formatList: new Intl.ListFormat(locale, inputs.list.options).format(
      inputs.list.values,
    ),
    formatRelativeTime: new Intl.RelativeTimeFormat(
      tag,
      inputs.relativeTime.options,
    ).format(Number(inputs.relativeTime.value), inputs.relativeTime.unit),
    resolveRelativeTime: new Intl.RelativeTimeFormat(
      tag,
      inputs.resolvedRelativeTime.options,
    ).format(resolved.value, resolved.unit),
    relativeTime: new Intl.RelativeTimeFormat(
      tag,
      inputs.installedRelativeTime.options,
    ).format(installed.value, installed.unit),
    formatDisplayName: new Intl.DisplayNames(
      locale,
      inputs.displayName.options,
    ).of(inputs.displayName.value),
    selectPlural: new Intl.PluralRules(locale, inputs.plural.options).select(
      Number(inputs.plural.value),
    ),
    compareLocalized: [...inputs.collation.values]
      .sort(new Intl.Collator(locale, inputs.collation.options).compare)
      .join(' | '),
    segmentText: [
      ...new Intl.Segmenter(locale, inputs.segmentation.options).segment(
        inputs.segmentation.text,
      ),
    ]
      .map(({ segment }) => segment)
      .join('|'),
    formatPersonName: personNames[locale],
    formatLocalizedInput: fieldText(moneyField),
    parseLocalizedInput: `${moneyField.value.amount.value} ${moneyField.value.currency}`,
    ...Object.fromEntries(
      Object.entries(inputs.controls).map(([kind, field]) => [
        `formatLocalizedInput:${kind}`,
        fieldText(field),
      ]),
    ),
    formattingContext: JSON.stringify({
      timeZone: context.timeZone,
      calendar: context.calendar,
      numberingSystem: context.numberingSystem,
      hourCycle: context.hourCycle,
    }),
    'core:directionForLocale': direction,
    // The Open Graph protocol writes a locale as language_TERRITORY, the territory CLDR's likely one.
    'core:openGraphLocale': (({ language, region }) => `${language}_${region}`)(
      new Intl.Locale(locale).maximize(),
    ),
    'extension:message-function': called,
    'extension:identifier-segment':
      catalog[`feature-state.${extension.member}`],
    // A spelling outside the segment's declared syntax names no member.
    'extension:identifier-segment:refused': 'absent',
    'extension:rich-slot-kind': `Badge: ${badge}`,
    'extension:formatting-adapter': `SKU-${extension.formatted.toUpperCase()}`,
    'extension:parsing-adapter': JSON.stringify({
      status: 'valid',
      text: extension.parsed,
      value: { value: sku },
    }),
  };
}

type HourCycle = 'h11' | 'h12' | 'h23' | 'h24';

interface PlainDateFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface PlainTimeFields {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

interface DecimalValue {
  readonly kind: 'decimal';
  readonly value: string;
}

interface DatePattern {
  readonly order: string;
  readonly separator: string;
}

interface TimePattern {
  readonly hourCycle: HourCycle;
  readonly precision: 'minute' | 'second';
  readonly separator: string;
  readonly dayPeriod?: {
    readonly am: string;
    readonly pm: string;
    readonly position: 'prefix' | 'suffix';
    readonly separator?: string;
  };
}

type DurationField =
  'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds';

interface DurationProfile {
  readonly kind: 'duration';
  readonly pattern: readonly (
    | string
    | { readonly field: DurationField; readonly minimumIntegerDigits?: number }
  )[];
  readonly sign?: string;
}

interface DateTimeProfile {
  readonly kind: 'plain-date-time';
  readonly date: DatePattern;
  readonly time: TimePattern;
  readonly separator: string;
}

interface TimeZoneProfile {
  readonly kind: 'time-zone';
  readonly options: readonly {
    readonly timeZone: string;
    readonly labels: readonly string[];
  }[];
}

export type FieldProfile =
  | { readonly kind: 'decimal'; readonly maximumFractionDigits?: number }
  | {
      readonly kind: 'money';
      readonly currency?: string;
      readonly requireCurrency?: boolean;
    }
  | {
      readonly kind: 'measurement';
      readonly unit?: string;
      readonly requireUnit?: boolean;
    }
  | {
      readonly kind: 'percent';
      readonly scale?: string;
      readonly requirePercentSign?: boolean;
    }
  | { readonly kind: 'percentage-points' }
  | ({ readonly kind: 'plain-date' } & DatePattern)
  | ({ readonly kind: 'plain-time' } & TimePattern)
  | DateTimeProfile
  | TimeZoneProfile
  | DurationProfile
  | { readonly kind: 'instant'; readonly syntax?: string };

interface MoneyValue {
  readonly kind: 'money';
  readonly amount: DecimalValue;
  readonly currency: string;
}

export type FieldValue =
  | DecimalValue
  | MoneyValue
  | {
      readonly kind: 'measurement';
      readonly amount: DecimalValue;
      readonly unit: string;
    }
  | {
      readonly kind: 'percent';
      readonly amount: DecimalValue;
      readonly scale: string;
    }
  | { readonly kind: 'percentage-points'; readonly amount: DecimalValue }
  | ({
      readonly kind: 'plain-date';
      readonly calendar?: string;
    } & PlainDateFields)
  | ({
      readonly kind: 'plain-time';
      readonly nanosecond?: number;
    } & PlainTimeFields)
  | {
      readonly kind: 'plain-date-time';
      readonly date: PlainDateFields;
      readonly time: PlainTimeFields;
    }
  | { readonly kind: 'time-zone'; readonly id: string }
  | ({
      readonly kind: 'duration';
      readonly sign?: number;
      readonly seconds: DecimalValue;
    } & Readonly<Record<Exclude<DurationField, 'seconds'>, number>>)
  | { readonly kind: 'instant'; readonly epochNanoseconds: string };

export interface FieldControl {
  readonly profile: FieldProfile;
  readonly value: FieldValue;
}

export type ExerciseControls = {
  readonly decimal: FieldControl;
  readonly money: FieldControl & { readonly value: MoneyValue };
  readonly measurement: FieldControl;
  readonly percent: FieldControl;
  readonly 'percentage-points': FieldControl;
  readonly 'plain-date': FieldControl;
  readonly 'plain-time': FieldControl;
  readonly 'plain-date-time': FieldControl;
  readonly 'time-zone': FieldControl;
  readonly duration: FieldControl;
  readonly instant: FieldControl;
};

/** The options of a duration formatter, which lib ES2024 does not declare. */
type DurationFormatOptions = Readonly<Record<string, unknown>>;

interface DurationFormatter {
  format(value: Readonly<Record<string, number>>): string;
}

interface DurationFormatConstructor {
  new (
    locales?: string | readonly string[],
    options?: DurationFormatOptions,
  ): DurationFormatter;
}

export interface ExerciseInputs {
  readonly formattingContext: {
    readonly timeZone: string;
    readonly calendar: string;
    readonly numberingSystem: string;
    readonly hourCycle: HourCycle;
  };
  readonly message: string;
  readonly richMessage: string;
  readonly decimal: {
    readonly value: string;
    readonly options: Intl.NumberFormatOptions;
  };
  readonly money: {
    readonly amount: string;
    readonly currency: string;
    readonly options: Intl.NumberFormatOptions;
  };
  readonly measurement: {
    readonly amount: string;
    readonly unit: string;
    readonly options: Intl.NumberFormatOptions;
  };
  readonly percent: {
    readonly amount: string;
    readonly scale: string;
    readonly options: Intl.NumberFormatOptions;
  };
  readonly percentagePoints: {
    readonly amount: string;
    readonly options: Intl.NumberFormatOptions;
  };
  readonly instant: {
    readonly epochMilliseconds: number;
    readonly options: Intl.DateTimeFormatOptions;
  };
  readonly plainDate: PlainDateFields & {
    readonly options: Intl.DateTimeFormatOptions;
  };
  readonly plainTime: PlainTimeFields & {
    readonly options: Intl.DateTimeFormatOptions;
  };
  readonly plainDateTime: {
    readonly date: PlainDateFields;
    readonly time: PlainTimeFields;
    readonly options: Intl.DateTimeFormatOptions;
  };
  readonly zonedDateTime: {
    readonly epochMilliseconds: number;
    readonly timeZone: string;
    readonly options: Intl.DateTimeFormatOptions;
  };
  readonly duration: {
    readonly fields: Readonly<Record<string, number>>;
    readonly options: DurationFormatOptions;
  };
  readonly numberRange: {
    readonly start: string;
    readonly end: string;
    readonly options: Intl.NumberFormatOptions;
  };
  readonly instantRange: {
    readonly startEpochMilliseconds: number;
    readonly endEpochMilliseconds: number;
    readonly options: Intl.DateTimeFormatOptions;
  };
  readonly list: {
    readonly values: readonly string[];
    readonly options: Intl.ListFormatOptions;
  };
  readonly relativeTime: {
    readonly value: string;
    readonly unit: Intl.RelativeTimeFormatUnit;
    readonly options: Intl.RelativeTimeFormatOptions;
  };
  readonly installedRelativeTime: {
    readonly options: Intl.RelativeTimeFormatOptions;
  };
  readonly resolvedRelativeTime: {
    readonly options: Intl.RelativeTimeFormatOptions;
  };
  readonly displayName: {
    readonly value: string;
    readonly options: Intl.DisplayNamesOptions;
  };
  readonly plural: {
    readonly value: string;
    readonly options: Intl.PluralRulesOptions;
  };
  readonly collation: {
    readonly values: readonly string[];
    readonly options: Intl.CollatorOptions;
  };
  readonly segmentation: {
    readonly text: string;
    readonly options: Intl.SegmenterOptions;
  };
  readonly extensions: {
    readonly operand: string;
    readonly member: string;
    readonly formatted: string;
    readonly parsed: string;
  };
  readonly controls: ExerciseControls;
}

export interface ExerciseAuthorityArguments {
  readonly inputs: ExerciseInputs;
  readonly locale: string;
  readonly catalog: Readonly<Record<string, string>>;
  readonly direction: 'ltr' | 'rtl';
}
