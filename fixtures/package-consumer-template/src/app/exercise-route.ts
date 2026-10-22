import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  viewChildren,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  LOCALE_URL_POLICY,
  LocalizePipe,
  LocalizedDecimalPipe,
  LocalizedDurationPipe,
  LocalizedInstantPipe,
  LocalizedLabel,
  LocalizedMeasurementPipe,
  LocalizedMessage,
  LocalizedMoneyPipe,
  LocalizedPercentPipe,
  LocalizedPercentagePointsPipe,
  LocalizedPlainDatePipe,
  LocalizedPlainDateTimePipe,
  LocalizedPlainTimePipe,
  LocalizedZonedDateTimePipe,
  compareLocalized,
  decimal,
  duration,
  formatDisplayName,
  formatDuration,
  formatInstant,
  formatInstantRange,
  formatList,
  formatLocalizedInput,
  formatMeasurement,
  formatMoney,
  formatNumber,
  formatNumberRange,
  formatPercent,
  formatPercentagePoints,
  formatPersonName,
  formatPlainDate,
  formatPlainDateTime,
  formatPlainTime,
  formatRelativeTime,
  formatZonedDateTime,
  injectLocalization,
  instant,
  measurement,
  money,
  parseLocalizedInput,
  percent,
  percentagePoints,
  personName,
  plainDate,
  plainDateTime,
  plainTime,
  resolveRelativeTime,
  segmentText,
  selectPlural,
  timeZone,
  zonedDateTime,
  type FormattingContext,
  type Localization,
  type FormattingResult,
  type LocalizedInputProfile,
  type LocalizedInputValue,
  type LocalizedMoneyInputProfile,
  type PercentScale,
  type PersonNameFieldKey,
  type PlainDateValue,
  type PlainTimeValue,
  type RelativeTimeOutcome,
  type RelativeTimePolicy,
} from '@neolorn/equator';
import { directionForLocale, openGraphLocale } from '@neolorn/equator/core';
import { LocalizedInput } from '@neolorn/equator/forms';
import { families, messages } from '#i18n/shell';
import { personNames } from '#i18n/person-names';

import inputs from './exercise-inputs.json';
import { skuFormatAdapter, skuParseAdapter } from './runtime-extensions';

/** Epoch milliseconds as the epoch-nanosecond string `instant` takes. */
const at = (milliseconds: number) =>
  instant(`${BigInt(milliseconds) * 1_000_000n}`);

const dateOf = ({ year, month, day }: typeof inputs.plainDateTime.date) =>
  plainDate(year, month, day);
const timeOf = ({ hour, minute, second }: typeof inputs.plainDateTime.time) =>
  plainTime(hour, minute, second);

/**
 * The values the sheet writes, built from `exercise-inputs.json`, which the checks read too. The
 * checks hand the same file to the host's own formatters and hold every line of the sheet to what
 * they write.
 */
const values = Object.freeze({
  decimal: decimal(inputs.decimal.value),
  money: money(decimal(inputs.money.amount), inputs.money.currency),
  measurement: measurement(
    decimal(inputs.measurement.amount),
    inputs.measurement.unit,
  ),
  percent: percent(
    decimal(inputs.percent.amount),
    inputs.percent.scale as PercentScale,
  ),
  percentagePoints: percentagePoints(decimal(inputs.percentagePoints.amount)),
  instant: at(inputs.instant.epochMilliseconds),
  plainDate: dateOf(inputs.plainDate),
  plainTime: timeOf(inputs.plainTime),
  plainDateTime: plainDateTime(
    dateOf(inputs.plainDateTime.date),
    timeOf(inputs.plainDateTime.time),
  ),
  zonedDateTime: zonedDateTime(
    at(inputs.zonedDateTime.epochMilliseconds),
    inputs.zonedDateTime.timeZone,
  ),
  duration: duration(inputs.duration.fields),
});

/**
 * The options, typed. JSON gives each option a string where the formatters take one of a few
 * words, and the file is what the checks read, so the words are checked there rather than here.
 */
const options = Object.freeze({
  decimal: inputs.decimal.options as Intl.NumberFormatOptions,
  money: inputs.money.options as Intl.NumberFormatOptions,
  measurement: inputs.measurement.options as Intl.NumberFormatOptions,
  percent: inputs.percent.options as Intl.NumberFormatOptions,
  percentagePoints: inputs.percentagePoints.options as Intl.NumberFormatOptions,
  instant: inputs.instant.options as Intl.DateTimeFormatOptions,
  plainDate: inputs.plainDate.options as Intl.DateTimeFormatOptions,
  plainTime: inputs.plainTime.options as Intl.DateTimeFormatOptions,
  plainDateTime: inputs.plainDateTime.options as Intl.DateTimeFormatOptions,
  zonedDateTime: inputs.zonedDateTime.options as Intl.DateTimeFormatOptions,
  duration: inputs.duration.options,
  numberRange: inputs.numberRange.options as Intl.NumberFormatOptions,
  instantRange: inputs.instantRange.options as Intl.DateTimeFormatOptions,
  list: inputs.list.options as Intl.ListFormatOptions,
  relativeTime: inputs.relativeTime.options as Intl.RelativeTimeFormatOptions,
  resolvedRelativeTime: inputs.resolvedRelativeTime
    .options as Intl.RelativeTimeFormatOptions,
  installedRelativeTime: inputs.installedRelativeTime
    .options as Intl.RelativeTimeFormatOptions,
  displayName: inputs.displayName.options as Intl.DisplayNamesOptions,
  plural: inputs.plural.options as Intl.PluralRulesOptions,
  collation: inputs.collation.options as Intl.CollatorOptions,
  segmentation: inputs.segmentation.options as Intl.SegmenterOptions,
});

/** A field's value as the inputs write it, which is the shape the runtime's own values take. */
interface WrittenValue {
  readonly kind: string;
  // The fields differ by kind, and each case below reads its own kind's.
  readonly [field: string]: any;
}

/** A field's value, made the way an application makes one, from what the inputs write. */
function made(
  written: WrittenValue,
): LocalizedInputValue<LocalizedInputProfile> {
  switch (written.kind) {
    case 'decimal':
      return decimal(written['value']);
    case 'money':
      return money(decimal(written['amount'].value), written['currency']);
    case 'measurement':
      return measurement(decimal(written['amount'].value), written['unit']);
    case 'percent':
      return percent(decimal(written['amount'].value), written['scale']);
    case 'percentage-points':
      return percentagePoints(decimal(written['amount'].value));
    case 'plain-date':
      return plainDate(
        written['year'],
        written['month'],
        written['day'],
        written['calendar'],
      );
    case 'plain-time':
      return plainTime(
        written['hour'],
        written['minute'],
        written['second'],
        written['nanosecond'],
      );
    case 'plain-date-time':
      return plainDateTime(
        made(written['date']) as PlainDateValue,
        made(written['time']) as PlainTimeValue,
      );
    case 'time-zone':
      return timeZone(written['id']);
    case 'duration':
      return duration(
        {
          years: written['years'],
          months: written['months'],
          weeks: written['weeks'],
          days: written['days'],
          hours: written['hours'],
          minutes: written['minutes'],
          seconds: decimal(written['seconds'].value),
        },
        written['sign'],
      );
    case 'instant':
      return instant(written['epochNanoseconds']);
    default:
      throw new Error(
        `The exercise inputs give a field of a kind the sheet cannot make: ${written.kind}`,
      );
  }
}

/** One field of every kind the runtime reads, each with the value the inputs give it. */
const fields = Object.entries(inputs.controls).map(
  ([kind, { profile, value }]) => ({
    kind,
    profile: profile as LocalizedInputProfile,
    value: made(value),
  }),
);

const moneyInput = inputs.controls.money.profile as LocalizedMoneyInputProfile;

/** What a failed call puts on the sheet: its code, which the checks can name. */
const written = (result: FormattingResult): string =>
  result.ok ? result.value.text : result.diagnostic.code;

/** A relative time's words, or the kind of answer it was where it has none. */
const said = (outcome: RelativeTimeOutcome): string =>
  outcome.kind === 'relative'
    ? outcome.formatted.text
    : outcome.kind === 'unavailable'
      ? outcome.diagnostic.code
      : outcome.kind;

/** The sheet's line for every formatting function, in the locale the runtime has committed. */
function formattedLines(
  context: FormattingContext,
): readonly { readonly id: string; readonly text: string }[] {
  const names = inputs.personName as Readonly<
    Record<
      string,
      {
        readonly language: string;
        readonly fields: Readonly<Partial<Record<PersonNameFieldKey, string>>>;
      }
    >
  >;
  const name = names[context.locale];
  const input = formatLocalizedInput(
    money(
      decimal(inputs.controls.money.value.amount.value),
      moneyInput.currency,
    ),
    moneyInput,
    context,
  );
  const parsed = parseLocalizedInput(
    input.ok ? input.value.text : '',
    moneyInput,
    context,
  );
  const resolved = resolveRelativeTime(
    at(inputs.resolvedRelativeTime.targetEpochMilliseconds),
    at(inputs.resolvedRelativeTime.referenceEpochMilliseconds),
    inputs.resolvedRelativeTime.policy as RelativeTimePolicy,
    context,
    options.resolvedRelativeTime,
  );
  const plural = selectPlural(
    decimal(inputs.plural.value),
    context,
    options.plural,
  );
  const segments = segmentText(
    inputs.segmentation.text,
    context,
    options.segmentation,
  );
  return [
    {
      id: 'formatNumber',
      text: written(formatNumber(values.decimal, context, options.decimal)),
    },
    {
      id: 'formatMoney',
      text: written(formatMoney(values.money, context, options.money)),
    },
    {
      id: 'formatMeasurement',
      text: written(
        formatMeasurement(values.measurement, context, options.measurement),
      ),
    },
    {
      id: 'formatPercent',
      text: written(formatPercent(values.percent, context, options.percent)),
    },
    {
      id: 'formatPercentagePoints',
      text: written(
        formatPercentagePoints(
          values.percentagePoints,
          context,
          options.percentagePoints,
        ),
      ),
    },
    {
      id: 'formatInstant',
      text: written(formatInstant(values.instant, context, options.instant)),
    },
    {
      id: 'formatPlainDate',
      text: written(
        formatPlainDate(values.plainDate, context, options.plainDate),
      ),
    },
    {
      id: 'formatPlainTime',
      text: written(
        formatPlainTime(values.plainTime, context, options.plainTime),
      ),
    },
    {
      id: 'formatPlainDateTime',
      text: written(
        formatPlainDateTime(
          values.plainDateTime,
          context,
          options.plainDateTime,
        ),
      ),
    },
    {
      id: 'formatZonedDateTime',
      text: written(
        formatZonedDateTime(
          values.zonedDateTime,
          context,
          options.zonedDateTime,
        ),
      ),
    },
    {
      id: 'formatDuration',
      text: written(formatDuration(values.duration, context, options.duration)),
    },
    {
      id: 'formatNumberRange',
      text: written(
        formatNumberRange(
          decimal(inputs.numberRange.start),
          decimal(inputs.numberRange.end),
          context,
          options.numberRange,
        ),
      ),
    },
    {
      id: 'formatInstantRange',
      text: written(
        formatInstantRange(
          at(inputs.instantRange.startEpochMilliseconds),
          at(inputs.instantRange.endEpochMilliseconds),
          context,
          options.instantRange,
        ),
      ),
    },
    {
      id: 'formatList',
      text: written(formatList(inputs.list.values, context, options.list)),
    },
    {
      id: 'formatRelativeTime',
      text: written(
        formatRelativeTime(
          decimal(inputs.relativeTime.value),
          inputs.relativeTime.unit as Intl.RelativeTimeFormatUnit,
          context,
          options.relativeTime,
        ),
      ),
    },
    { id: 'resolveRelativeTime', text: said(resolved) },
    {
      id: 'formatDisplayName',
      text: written(
        formatDisplayName(
          inputs.displayName.value,
          context,
          options.displayName,
        ),
      ),
    },
    {
      id: 'selectPlural',
      text: plural.ok ? plural.value : plural.diagnostic.code,
    },
    { id: 'compareLocalized', text: collated(context) },
    {
      id: 'segmentText',
      text: segments.ok
        ? segments.value.map(({ segment }) => segment).join('|')
        : segments.diagnostic.code,
    },
    {
      id: 'formatPersonName',
      text:
        name === undefined
          ? ''
          : written(
              formatPersonName(
                personName(name.language, name.fields),
                context,
                {},
                personNames,
              ),
            ),
    },
    { id: 'formatLocalizedInput', text: written(input) },
    {
      id: 'parseLocalizedInput',
      text:
        parsed.status === 'valid'
          ? `${parsed.value.amount.value} ${parsed.value.currency}`
          : parsed.diagnostic.code,
    },
  ];
}

/**
 * Each field kind's two lines: the text its value is written as, and what reading that text back
 * gives, which is the value again.
 */
function fieldLines(
  context: FormattingContext,
): readonly { readonly id: string; readonly text: string }[] {
  return fields.flatMap(({ kind, profile, value }) => {
    const text = formatLocalizedInput(value, profile, context);
    const read = parseLocalizedInput(
      text.ok ? text.value.text : '',
      profile,
      context,
    );
    return [
      { id: `formatLocalizedInput:${kind}`, text: written(text) },
      {
        id: `parseLocalizedInput:${kind}`,
        text: JSON.stringify(
          read.status === 'valid' ? read.value : { status: read.status },
        ),
      },
    ];
  });
}

/**
 * A line for each kind of extension the application registers, each reached the way an
 * application reaches it: a message that calls the function, a family member named by a segment, a
 * slot read as plain text, and the two adapters called through the localization.
 */
function extensionLines(
  localization: Localization,
): readonly { readonly id: string; readonly text: string }[] {
  const { operand, member, refusedMember, formatted, parsed } =
    inputs.extensions;
  const resolved = families.featureState.resolve({ state: member });
  const refused = families.featureState.resolve({ state: refusedMember });
  return [
    {
      id: 'extension:message-function',
      text: localization.text(messages.extension.uppercase, { name: operand }),
    },
    {
      id: 'extension:identifier-segment',
      text: resolved === undefined ? 'absent' : localization.text(resolved),
    },
    {
      id: 'extension:identifier-segment:refused',
      text: refused === undefined ? 'absent' : localization.text(refused),
    },
    {
      id: 'extension:rich-slot-kind',
      text: localization.parts(messages.extension.badge).text,
    },
    {
      id: 'extension:formatting-adapter',
      text: written(
        localization.formatWithAdapter(skuFormatAdapter, formatted),
      ),
    },
    {
      id: 'extension:parsing-adapter',
      text: JSON.stringify(
        localization.parseWithAdapter(skuParseAdapter, parsed),
      ),
    },
  ];
}

/**
 * A moment worded by the localization itself, which names no clock and no thresholds, so the words
 * are the ones the application installed.
 */
function installedLines(
  localization: Localization,
): readonly { readonly id: string; readonly text: string }[] {
  return [
    {
      id: 'relativeTime',
      text: said(
        localization.relativeTime(
          at(inputs.installedRelativeTime.targetEpochMilliseconds),
          options.installedRelativeTime,
        ),
      ),
    },
  ];
}

/**
 * What every line above was written under: the context the runtime carries, and what the core
 * entry point, which loads without Angular, says of the locale.
 */
function contextLines({
  locale,
  timeZone,
  calendar,
  numberingSystem,
  hourCycle,
}: FormattingContext): readonly {
  readonly id: string;
  readonly text: string;
}[] {
  return [
    {
      id: 'formattingContext',
      text: JSON.stringify({ timeZone, calendar, numberingSystem, hourCycle }),
    },
    { id: 'core:directionForLocale', text: directionForLocale(locale) },
    { id: 'core:openGraphLocale', text: openGraphLocale(locale) ?? '' },
  ];
}

/** The collation inputs in the order the locale sorts them, or the code of the first refusal. */
function collated(context: FormattingContext): string {
  let refusal: string | undefined;
  const sorted = [...inputs.collation.values].sort((left, right) => {
    const compared = compareLocalized(left, right, context, options.collation);
    if (compared.ok) return compared.value;
    refusal ??= compared.diagnostic.code;
    return 0;
  });
  return refusal ?? sorted.join(' | ');
}

/**
 * Every pipe and every formatting function, each on a line of its own, writing fixed inputs in the
 * locale the page is shown in.
 *
 * Reached at `exercise/:sheet`, as a sheet rendered on request and as one the build prerenders, and
 * at `drawn-sheet`, which the server answers with the application shell, so the checks read each
 * line as the server wrote it, as the build wrote it, as the client adopted it, as a client
 * navigation drew it and as a client render drew it.
 */
@Component({
  selector: 'feature-exercise-route',
  standalone: true,
  imports: [
    LocalizePipe,
    LocalizedDecimalPipe,
    LocalizedDurationPipe,
    LocalizedInstantPipe,
    LocalizedMeasurementPipe,
    LocalizedMoneyPipe,
    LocalizedPercentPipe,
    LocalizedPercentagePointsPipe,
    LocalizedPlainDatePipe,
    LocalizedPlainDateTimePipe,
    LocalizedPlainTimePipe,
    LocalizedZonedDateTimePipe,
    LocalizedInput,
    LocalizedLabel,
    LocalizedMessage,
    ReactiveFormsModule,
  ],
  template: `
    <section
      data-route-view="exercise"
      [attr.data-exercise-sheet]="sheet"
      [attr.data-exercise-locale]="locale()"
      [attr.data-url-policy]="policy"
    >
      <p data-exercise="localize">{{ messages.appTitle | localize }}</p>
      <p data-exercise="directive:LocalizedMessage">
        <localized-message [handle]="messages.learnMore" />
      </p>
      <section
        data-exercise="directive:LocalizedLabel"
        data-exercise-attribute="aria-label"
        [localizedLabel]="messages.appTitle"
      ></section>
      <p data-exercise="localizedDecimal">
        {{ values.decimal | localizedDecimal: options.decimal }}
      </p>
      <p data-exercise="localizedMoney">
        {{ values.money | localizedMoney: options.money }}
      </p>
      <p data-exercise="localizedMeasurement">
        {{ values.measurement | localizedMeasurement: options.measurement }}
      </p>
      <p data-exercise="localizedPercent">
        {{ values.percent | localizedPercent: options.percent }}
      </p>
      <p data-exercise="localizedPercentagePoints">
        {{
          values.percentagePoints
            | localizedPercentagePoints: options.percentagePoints
        }}
      </p>
      <p data-exercise="localizedInstant">
        {{ values.instant | localizedInstant: options.instant }}
      </p>
      <p data-exercise="localizedPlainDate">
        {{ values.plainDate | localizedPlainDate: options.plainDate }}
      </p>
      <p data-exercise="localizedPlainTime">
        {{ values.plainTime | localizedPlainTime: options.plainTime }}
      </p>
      <p data-exercise="localizedPlainDateTime">
        {{
          values.plainDateTime | localizedPlainDateTime: options.plainDateTime
        }}
      </p>
      <p data-exercise="localizedZonedDateTime">
        {{
          values.zonedDateTime | localizedZonedDateTime: options.zonedDateTime
        }}
      </p>
      <p data-exercise="localizedDuration">
        {{ values.duration | localizedDuration: options.duration }}
      </p>
      @for (line of lines(); track line.id) {
        <p [attr.data-exercise]="line.id">{{ line.text }}</p>
      }
      @for (field of fields; track field.kind) {
        <label>
          {{ field.kind }}
          <input
            [attr.data-field]="field.kind"
            [formControl]="field.control"
            [localizedInput]="field.profile"
          />
        </label>
        <p [attr.data-field-read]="field.kind">{{ readBy($index) }}</p>
      }
    </section>
  `,
})
export class FeatureLabExerciseRoute {
  private readonly localization = injectLocalization();
  protected readonly messages = messages;
  protected readonly values = values;
  protected readonly options = options;
  protected readonly sheet =
    inject(ActivatedRoute).snapshot.paramMap.get('sheet') ?? '';
  // The checks name the policy the page runs in their claims, read from the page on the server as
  // well as in a browser.
  protected readonly policy = JSON.stringify(inject(LOCALE_URL_POLICY).policy);
  protected readonly locale = computed(
    () => this.localization.snapshot()?.primaryLocale ?? '',
  );
  protected readonly lines = computed(() => {
    const context = this.localization.snapshot()?.formatting;
    return context === undefined
      ? []
      : [
          ...formattedLines(context),
          ...fieldLines(context),
          ...extensionLines(this.localization),
          ...installedLines(this.localization),
          ...contextLines(context),
        ];
  });
  protected readonly fields = fields.map(({ kind, profile, value }) => ({
    kind,
    profile,
    control: new FormControl(value, { nonNullable: true }),
  }));
  private readonly readers = viewChildren(LocalizedInput);

  /**
   * What a field last read from what was typed into it, as the field itself reports it, so a
   * reader of the page can wait for the read rather than for the form's next render.
   */
  protected readBy(index: number): string {
    const result = this.readers()[index]?.result();
    return JSON.stringify(
      result === undefined
        ? null
        : result.status === 'valid'
          ? { status: result.status, value: result.value }
          : { status: result.status },
    );
  }

  constructor() {
    // The application reports itself ready after its own first render, which can come before a
    // lazy route's. Until the client draws the sheet, its lines are the server's, which a browser
    // whose formatters differ from the server's would be held against.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      host
        .querySelector<HTMLElement>('[data-route-view="exercise"]')
        ?.setAttribute('data-exercise-drawn', 'client');
    });
  }
}
