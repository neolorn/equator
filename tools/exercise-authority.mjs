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
export function exerciseAuthority({ inputs, locale, catalog, direction }) {
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
  const number = (options, value) =>
    new Intl.NumberFormat(tag, options).format(Number(value));
  const moment = (options, milliseconds) =>
    new Intl.DateTimeFormat(tag, options).format(milliseconds);
  const unsupported = 'unsupported-formatting-capability';

  // A plain date is noon on that day, read in UTC, so no zone can move it to another day.
  const plainDate = ({ year, month, day }) =>
    Date.UTC(year, month - 1, day, 12);
  const plainTime = ({ hour, minute, second }) =>
    Date.UTC(1970, 0, 1, hour, minute, second);
  const plainDateTime = ({ date, time }) =>
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
  const hostWritesDurations = typeof Intl.DurationFormat === 'function';
  const duration = hostWritesDurations
    ? new Intl.DurationFormat(tag, inputs.duration.options).format(
        inputs.duration.fields,
      )
    : undefined;

  // `largestUnit: 'week'` and a target three days before the reference: three days is short of a
  // week and at least a day, so the policy counts it in days, truncated toward zero, as -3.
  const resolved = { value: -3, unit: 'day' };
  // The application's clock reads `inputs.clock` and its policy names nothing smaller than a
  // minute. The target is 45 seconds before that clock, short of the smallest unit, so it is zero
  // minutes.
  const installed = { value: 0, unit: 'minute' };

  // `en` givenFirst/medium/referring/informal is `{given-informal} {surname}`, and the name
  // carries no informal given name, so the given name stands in. `ar` defaults to long and formal,
  // and givenFirst/long/referring/formal is
  // `{title} {given} {given2} {surname} {generation}، {credentials}`; everything after the surname
  // is empty, and the Arabic comma goes with it.
  const personNames = {
    'en-US': 'Mary Hamish',
    'ar-EG': 'محمد المصري',
  };

  // A field writes a number the way the formatters do, without grouping unless its profile allows
  // it, and a date, a time or a duration field by field in the order and with the separators its
  // profile declares.
  const digits = (value, minimumIntegerDigits) =>
    number({ useGrouping: false, minimumIntegerDigits }, value);
  const dateText = (pattern, value) =>
    pattern.order
      .split('-')
      .map((field) => digits(value[field], field === 'year' ? 4 : 2))
      .join(pattern.separator);
  const timeText = (pattern, { hour, minute, second }) => {
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
  const fieldText = ({ profile, value }) => {
    switch (value.kind) {
      case 'decimal':
        return number(
          {
            useGrouping: false,
            maximumFractionDigits: profile.maximumFractionDigits,
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
        return dateText(profile, value);
      case 'plain-time':
        return timeText(profile, value);
      case 'plain-date-time':
        return [
          dateText(profile.date, value.date),
          timeText(profile.time, value.time),
        ].join(profile.separator);
      case 'time-zone':
        return profile.options.find(({ timeZone }) => timeZone === value.id)
          .labels[0];
      case 'duration':
        return profile.pattern
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
        throw new Error(`No field text is written for ${value.kind}`);
    }
  };
  const moneyField = inputs.controls.money;

  // A message function formats in the message's locale, so its text takes that locale's direction:
  // isolated right to left in a right-to-left message, and bare in a left-to-right one, as spec 09
  // section 8 has it. The application's function writes its operand in capitals, and adds an
  // exclamation mark when the message asks for loud emphasis.
  const extension = inputs.extensions;
  const isolated = (text) =>
    direction === 'rtl' ? `\u2067${text}\u2069` : text;
  const called = catalog['extension.uppercase'].replace(
    /\{\$name :feature:uppercase emphasis=(\w+)\}/u,
    (_, emphasis) =>
      isolated(
        `${extension.operand.toLocaleUpperCase(locale)}${emphasis === 'loud' ? '!' : ''}`,
      ),
  );
  // The application reads a badge as plain text as the word "Badge" and the words it holds.
  const badge = /\{#badge[^}]*\}(.*)\{\/badge\}/u.exec(
    catalog['extension.badge'],
  )[1];
  // The structured message's markup only wraps words, so a reader gets the message without it.
  const richText = catalog[inputs.richMessage].replace(/\{[#/][^}]*\}/gu, '');
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
