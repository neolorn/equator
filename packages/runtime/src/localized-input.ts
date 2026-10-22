// Reading a reader's own spelling of a value back into an invariant one.
//
// `specs/08-formatting-parsing-and-domain.spec.md` section 6 refuses a universal permissive
// parser, so every parser here is opt-in and field-specific and states its locale, its value
// kind, its accepted syntax, its range, its currency, unit or percent policy, and what it does
// with an ambiguity. Only the valid status carries a value, and on commit nothing picks the
// first plausible reading, changes a currency or a unit, or settles a daylight-saving ambiguity
// quietly, because a parser that guesses turns a typing mistake into a wrong amount that looks
// deliberate.

import {
  directionForLocale,
  type DecimalValue,
  type DurationValue,
  type FormattingContext,
  type FormattingResult,
  type LocalizationDiagnostic,
  type LocalizedDurationInputField,
  type LocalizedDurationInputProfile,
  type LocalizedFormattedValue,
  type LocalizedInputProfile,
  type LocalizedInputResult,
  type LocalizedInputValue,
  type LocalizedPlainDateInputPattern,
  type LocalizedPlainTimeInputPattern,
  type LocalizedTimeZoneInputProfile,
  type MeasurementValue,
  type MoneyValue,
  type PercentagePointsValue,
  type PercentValue,
  type PlainDateTimeValue,
  type PlainDateValue,
  type PlainTimeValue,
  type TimeZoneValue,
} from '@neolorn/equator/core';
import {
  decimal,
  duration,
  formatMeasurement,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPercentagePoints,
  instant,
  measurement,
  money,
  percent,
  percentagePoints,
  plainDate,
  plainDateTime,
  plainTime,
  timeZone,
} from './formatting';
import { FormatterCache, formattingLocale, isCalendarName } from './evaluator';
import { isUnicodeKeywordType } from './message-function-options';
import { RUNTIME_LIMITS, codePointLengthAtMost } from './runtime-safety';

interface NumberSyntax {
  readonly digits: ReadonlyMap<string, string>;
  readonly decimal: string;
  readonly group?: string;
  readonly minus: string;
  readonly plus: string;
  /**
   * The formatting-control scalars this locale writes next to a sign.
   *
   * `Intl` reports these as `literal` parts around the sign part (U+061C ARABIC LETTER MARK,
   * U+200E LEFT-TO-RIGHT MARK, U+200F RIGHT-TO-LEFT MARK) and 27 of the 162 locales this ICU
   * build has data for use one, seven of them on both sides of the sign. They carry no value, but a parser that does not expect them cannot read
   * back what the paired formatter just wrote, so a signed number becomes unrenderable in every
   * locale that uses one.
   *
   * Learned rather than listed, for the same reason the digits and the separators are: a written
   * list is a copy of CLDR maintained by hand, wrong the moment either copy moves.
   */
  readonly signMarks: ReadonlySet<string>;
  readonly primaryGroupSize: number;
  readonly secondaryGroupSize: number;
}

/**
 * The part types a written number begins and ends with; everything outside them is decoration. Its
 * separators stand between two of these, so they need no naming here.
 */
const numericPartTypes: ReadonlySet<Intl.NumberFormatPartTypes> =
  new Set<Intl.NumberFormatPartTypes>(['integer', 'fraction']);

const inputFormatterCache = new FormatterCache(128);
const numberSyntaxCache = new Map<string, NumberSyntax>();

function diagnostic(
  code: LocalizationDiagnostic['code'],
  message: string,
  context: FormattingContext,
  reason?: LocalizationDiagnostic['reason'],
): LocalizationDiagnostic {
  return Object.freeze({
    code,
    outcome: 'operational-failure',
    message,
    targetLocale: context.locale,
    ...(reason === undefined ? {} : { reason }),
  });
}

function failed<Value>(
  status: Exclude<LocalizedInputResult<Value>['status'], 'valid'>,
  text: string,
  message: string,
  context: FormattingContext,
  reason?: LocalizationDiagnostic['reason'],
  code: LocalizationDiagnostic['code'] = status === 'unsupported-capability'
    ? 'unsupported-input-capability'
    : 'invalid-localized-input',
): LocalizedInputResult<Value> {
  return Object.freeze({
    status,
    text,
    diagnostic: diagnostic(code, message, context, reason),
  });
}

function valid<Value>(text: string, value: Value): LocalizedInputResult<Value> {
  return Object.freeze({ status: 'valid', text, value });
}

/**
 * What is wrong with the numbering system a context declares, if anything.
 *
 * Decided once, before a field is read or written, because the platform does not decide it the
 * same way everywhere: a number formatter throws on some malformed identifiers, reads others as
 * the system they spell in another case, and quietly writes the locale's own digits for a
 * well-formed one it has no data for. A field that went on would give a caller who asked for one
 * set of digits another. Whether the name is written as one is decided without the host.
 */
function numberingSystemRefusal(
  context: FormattingContext,
): 'malformed' | 'unavailable' | undefined {
  const numberingSystem: unknown = context.numberingSystem;
  if (numberingSystem === undefined) return undefined;
  if (!isUnicodeKeywordType(numberingSystem)) return 'malformed';
  return formattingLocale(context) === undefined ? 'unavailable' : undefined;
}

const malformedNumberingSystem =
  'The numbering system of the formatting context is not a numbering system identifier.';
const unavailableNumberingSystem =
  'This runtime has no data for the numbering system of the formatting context.';

function canonicalInput(text: string): string {
  return text.normalize('NFC');
}

function numberSyntax(context: FormattingContext): NumberSyntax {
  const cacheKey = `${context.locale}\u0000${context.numberingSystem ?? ''}`;
  const cached = numberSyntaxCache.get(cacheKey);
  if (cached !== undefined) {
    numberSyntaxCache.delete(cacheKey);
    numberSyntaxCache.set(cacheKey, cached);
    return cached;
  }
  const numberOptions: Intl.NumberFormatOptions = {
    useGrouping: false,
    ...(context.numberingSystem === undefined
      ? {}
      : { numberingSystem: context.numberingSystem }),
  };
  const digits = new Map<string, string>();
  const digitFormatter = inputFormatterCache.number(
    context.locale,
    numberOptions,
  );
  for (let value = 0; value <= 9; value += 1) {
    const rendered = digitFormatter.format(value);
    if ([...rendered].length !== 1) {
      throw new Error(
        'The locale does not expose a one-scalar decimal digit set.',
      );
    }
    digits.set(rendered, String(value));
  }
  const decimalParts = inputFormatterCache
    .number(context.locale, {
      ...numberOptions,
      minimumFractionDigits: 1,
    })
    .formatToParts(1.1);
  const signedFormatter = inputFormatterCache.number(context.locale, {
    ...numberOptions,
    signDisplay: 'always',
  });
  const negativeSignParts = signedFormatter.formatToParts(-1);
  const positiveSignParts = signedFormatter.formatToParts(1);
  // Everything the locale writes before the first digit, minus the sign itself. Restricted to
  // Unicode's Format category so that a locale which one day writes something with width there
  // (a space, a bracket) does not quietly widen what the sign strip will swallow.
  const signMarks = new Set<string>();
  for (const parts of [negativeSignParts, positiveSignParts]) {
    for (const part of parts) {
      if (part.type === 'integer') break;
      if (part.type !== 'literal') continue;
      for (const scalar of part.value) {
        if (/\p{Cf}/u.test(scalar)) signMarks.add(scalar);
      }
    }
  }
  const groupedParts = inputFormatterCache
    .number(context.locale, {
      ...numberOptions,
      useGrouping: true,
    })
    .formatToParts(123_456_789);
  const integerLengths = groupedParts
    .filter(({ type }) => type === 'integer')
    .map(({ value }) => [...value].length);
  const primaryGroupSize = integerLengths.at(-1) ?? 3;
  const secondaryGroupSize = integerLengths.at(-2) ?? primaryGroupSize;
  const group = groupedParts.find(({ type }) => type === 'group')?.value;
  const syntax = Object.freeze({
    digits,
    decimal: decimalParts.find(({ type }) => type === 'decimal')?.value ?? '.',
    ...(group === undefined ? {} : { group }),
    minus:
      negativeSignParts.find(({ type }) => type === 'minusSign')?.value ?? '-',
    plus:
      positiveSignParts.find(({ type }) => type === 'plusSign')?.value ?? '+',
    signMarks,
    primaryGroupSize,
    secondaryGroupSize,
  });
  numberSyntaxCache.set(cacheKey, syntax);
  while (numberSyntaxCache.size > 64) {
    // A map that holds an entry has a first key, and every key here is text.
    numberSyntaxCache.delete(numberSyntaxCache.keys().next().value as string);
  }
  return syntax;
}

/** One spelling of a marker around a number: what stands before the digits and what after. */
interface AffixPattern {
  readonly prefix: string;
  readonly suffix: string;
  /** Whether the spelling carries the locale's minus sign. */
  readonly negative: boolean;
}

function withoutLeadingSignMarks(value: string, syntax: NumberSyntax): string {
  let index = 0;
  for (const scalar of value) {
    if (!syntax.signMarks.has(scalar)) break;
    index += scalar.length;
  }
  return value.slice(index);
}

interface StrippedSign {
  readonly body: string;
  readonly negative: boolean;
  readonly explicit: boolean;
}

/**
 * Take the sign off the front of a localized number, tolerating the marks the locale writes around
 * it in either position: `؜-١` and `‎-‎۱` both occur, and a person typing the same number types
 * neither.
 *
 * When there is no sign the original text is returned untouched, so a mark is only ever accepted as
 * decoration on a sign and never silently discarded anywhere else.
 */
function stripSign(value: string, syntax: NumberSyntax): StrippedSign {
  const unmarked = withoutLeadingSignMarks(value, syntax);
  for (const [sign, negative] of [
    [syntax.minus, true],
    [syntax.plus, false],
  ] as const) {
    if (sign.length > 0 && unmarked.startsWith(sign)) {
      return Object.freeze({
        body: withoutLeadingSignMarks(unmarked.slice(sign.length), syntax),
        negative,
        explicit: true,
      });
    }
  }
  return Object.freeze({ body: value, negative: false, explicit: false });
}

/**
 * The spelling of a marker around the number in one formatted amount.
 *
 * Nothing when the amount is written without its number, as Arabic writes one day and two days, or
 * without the marker. Such a spelling has no place for digits, so there is nothing to read a number
 * from, and taking it as an affix would match every text.
 */
function affixPattern(
  parts: readonly Intl.NumberFormatPart[],
  marker: Intl.NumberFormatPartTypes,
): AffixPattern | undefined {
  const first = parts.findIndex(({ type }) => numericPartTypes.has(type));
  if (first < 0 || !parts.some(({ type }) => type === marker)) return undefined;
  let last = first;
  for (const [index, part] of parts.entries()) {
    if (numericPartTypes.has(part.type)) last = index;
  }
  return Object.freeze({
    prefix: parts
      .slice(0, first)
      .map(({ value }) => value)
      .join(''),
    suffix: parts
      .slice(last + 1)
      .map(({ value }) => value)
      .join(''),
    negative: parts.some(({ type }) => type === 'minusSign'),
  });
}

/**
 * Counts that between them fall in every plural category of every language the supported hosts
 * have plural rules for: the whole numbers to a hundred, a million for the category the Romance
 * languages keep for it, and two fractions for the categories that only a fraction selects.
 */
const pluralCategoryCounts: readonly number[] = Object.freeze([
  ...Array.from({ length: 101 }, (_, count) => count),
  1_000_000,
  0.1,
  1.5,
]);

const profileAffixCache = new Map<string, readonly AffixPattern[]>();

/**
 * Every spelling of the profile's marker the locale writes beside a number, longest first.
 *
 * A unit is spelled by plural category (`1 day`, `5 days`), so one amount is formatted for each
 * category the locale's plural rules give and each spelling it produces is kept. A person types
 * whichever the amount calls for, and a field that learned only the spelling of one would refuse
 * every other amount. The spellings come from the host's formatter because that is what writes the
 * field: a table of them here would be a second copy of the host's locale data.
 *
 * Longest first, so that `-5 days` is taken as the negative spelling and not as the positive one
 * around `-5`.
 *
 * Empty when the locale has no spelling of the marker that carries a number.
 */
function profileAffixes(
  profile: LocalizedInputProfile,
  context: FormattingContext,
): readonly AffixPattern[] {
  let style: Intl.NumberFormatOptions;
  let marker: Intl.NumberFormatPartTypes;
  let counts: readonly number[];
  if (profile.kind === 'money') {
    style = { style: 'currency', currency: profile.currency };
    marker = 'currency';
    counts = [1];
  } else if (profile.kind === 'measurement') {
    style = { style: 'unit', unit: profile.unit };
    marker = 'unit';
    counts = pluralCategoryCounts;
  } else if (profile.kind === 'percent') {
    style = { style: 'percent' };
    marker = 'percentSign';
    counts = [0.01];
  } else {
    return [];
  }
  const cacheKey = JSON.stringify([
    context.locale,
    context.numberingSystem,
    style,
  ]);
  const cached = profileAffixCache.get(cacheKey);
  if (cached !== undefined) {
    profileAffixCache.delete(cacheKey);
    profileAffixCache.set(cacheKey, cached);
    return cached;
  }
  const learned = new Map<string, AffixPattern>();
  try {
    const formatter = inputFormatterCache.number(context.locale, {
      ...style,
      ...(context.numberingSystem === undefined
        ? {}
        : { numberingSystem: context.numberingSystem }),
    });
    const rules = inputFormatterCache.plural(context.locale, {});
    const categories = new Set<string>();
    for (const count of counts) {
      const category = rules.select(count);
      if (categories.has(category)) continue;
      const positive = affixPattern(formatter.formatToParts(count), marker);
      if (positive === undefined) continue;
      categories.add(category);
      learned.set(JSON.stringify(positive), positive);
      const negative = affixPattern(formatter.formatToParts(-count), marker);
      // A spelling of a negative amount that shows no minus sign says nothing of the sign, so no
      // sign is read from it.
      if (negative?.negative === true) {
        learned.set(JSON.stringify(negative), negative);
      }
    }
  } catch {
    // A currency or unit the platform refuses has no spelling to learn; the field then reads a
    // bare number, or refuses where the profile requires the marker. The refusal comes from
    // building the formatter, before any spelling is kept, so there is nothing to discard.
  }
  const affixes = Object.freeze(
    [...learned.values()].sort(
      (left, right) =>
        right.prefix.length +
        right.suffix.length -
        (left.prefix.length + left.suffix.length),
    ),
  );
  profileAffixCache.set(cacheKey, affixes);
  while (profileAffixCache.size > 64) {
    // A map that holds an entry has a first key, and every key here is text.
    profileAffixCache.delete(profileAffixCache.keys().next().value as string);
  }
  return affixes;
}

function stripAffix(value: string, affix: AffixPattern): string | undefined {
  if (
    !value.startsWith(affix.prefix) ||
    !value.endsWith(affix.suffix) ||
    value.length < affix.prefix.length + affix.suffix.length
  ) {
    return undefined;
  }
  return value.slice(
    affix.prefix.length,
    affix.suffix.length === 0 ? undefined : -affix.suffix.length,
  );
}

function compareDecimal(left: DecimalValue, right: DecimalValue): number {
  const parts = (value: DecimalValue): [bigint, number] => {
    const negative = value.value.startsWith('-');
    const unsigned = negative ? value.value.slice(1) : value.value;
    const [integer = '0', fraction = ''] = unsigned.split('.');
    const coefficient = BigInt(`${integer}${fraction}`);
    return [negative ? -coefficient : coefficient, fraction.length];
  };
  const [leftCoefficient, leftScale] = parts(left);
  const [rightCoefficient, rightScale] = parts(right);
  const scale = Math.max(leftScale, rightScale);
  const alignedLeft = leftCoefficient * 10n ** BigInt(scale - leftScale);
  const alignedRight = rightCoefficient * 10n ** BigInt(scale - rightScale);
  return alignedLeft < alignedRight ? -1 : alignedLeft > alignedRight ? 1 : 0;
}

function divideByHundred(value: DecimalValue): DecimalValue {
  const negative = value.value.startsWith('-');
  const unsigned = negative ? value.value.slice(1) : value.value;
  const [integer = '0', fraction = ''] = unsigned.split('.');
  const padded = integer.padStart(3, '0');
  const split = padded.length - 2;
  return decimal(
    `${negative ? '-' : ''}${padded.slice(0, split)}.${padded.slice(split)}${fraction}`,
  );
}

function validateRange<Value>(
  amount: DecimalValue,
  profile: Extract<
    LocalizedInputProfile,
    {
      readonly kind:
        'decimal' | 'money' | 'measurement' | 'percent' | 'percentage-points';
    }
  >,
  text: string,
  context: FormattingContext,
  produce: () => Value,
): LocalizedInputResult<Value> {
  if (
    profile.minimum !== undefined &&
    compareDecimal(amount, profile.minimum) < 0
  ) {
    return failed(
      'out-of-range',
      text,
      'The value is below the declared minimum.',
      context,
    );
  }
  if (
    profile.maximum !== undefined &&
    compareDecimal(amount, profile.maximum) > 0
  ) {
    return failed(
      'out-of-range',
      text,
      'The value is above the declared maximum.',
      context,
    );
  }
  return valid(text, produce());
}

function parseNumeric(
  text: string,
  profile: Extract<
    LocalizedInputProfile,
    {
      readonly kind:
        'decimal' | 'money' | 'measurement' | 'percent' | 'percentage-points';
    }
  >,
  context: FormattingContext,
): LocalizedInputResult<
  | DecimalValue
  | MoneyValue
  | MeasurementValue
  | PercentValue
  | PercentagePointsValue
> {
  const source = canonicalInput(text);
  if (
    (profile.maximumFractionDigits !== undefined &&
      (!Number.isSafeInteger(profile.maximumFractionDigits) ||
        profile.maximumFractionDigits < 0)) ||
    !canonicalDecimalContract(profile.minimum) ||
    !canonicalDecimalContract(profile.maximum) ||
    (profile.minimum !== undefined &&
      profile.maximum !== undefined &&
      compareDecimal(profile.minimum, profile.maximum) > 0) ||
    (profile.kind === 'money' && !/^[A-Z]{3}$/u.test(profile.currency)) ||
    (profile.kind === 'measurement' && !/^[a-z0-9-]{1,64}$/u.test(profile.unit))
  ) {
    return failed(
      'policy-rejected',
      text,
      'The localized input profile is invalid.',
      context,
    );
  }
  let syntax: NumberSyntax;
  try {
    syntax = numberSyntax(context);
  } catch {
    return failed(
      'unsupported-capability',
      text,
      'The locale does not expose a strict decimal input syntax.',
      context,
      'native-capability-rejected',
    );
  }
  // Asked here and not sooner, so that an invalid profile and a locale with no digits to read are
  // reported for the empty text as for any other, and before the marker a profile requires, so
  // that a field nobody has typed in is incomplete and not missing its marker.
  if (source.length === 0) {
    return failed(
      'incomplete',
      text,
      'The localized value is incomplete.',
      context,
    );
  }
  let working = source;
  const affixes = profileAffixes(profile, context);
  const requireAffix =
    (profile.kind === 'money' && profile.requireCurrency === true) ||
    (profile.kind === 'measurement' && profile.requireUnit === true) ||
    (profile.kind === 'percent' && profile.requirePercentSign === true);
  if (requireAffix && affixes.length === 0) {
    return failed(
      'unsupported-capability',
      text,
      'The locale cannot express the required input affix.',
      context,
    );
  }
  let negative = false;
  let affixMatches = false;
  for (const affix of affixes) {
    const body = stripAffix(working, affix);
    if (body === undefined) continue;
    working = body;
    negative = affix.negative;
    affixMatches = true;
    break;
  }
  if (requireAffix && !affixMatches) {
    return failed(
      'policy-rejected',
      text,
      'The input omits the declared currency, unit, or percent marker.',
      context,
    );
  }
  if (!affixMatches) {
    const stripped = stripSign(working, syntax);
    working = stripped.body;
    if (stripped.negative) negative = true;
  }
  if (working.length === 0) {
    return failed(
      'incomplete',
      text,
      'The localized value is incomplete.',
      context,
    );
  }
  const integerGroups: string[] = [''];
  let fraction = '';
  let decimalSeen = false;
  for (const scalar of working) {
    const digit = syntax.digits.get(scalar);
    if (digit !== undefined) {
      if (decimalSeen) fraction += digit;
      else integerGroups[integerGroups.length - 1] += digit;
      continue;
    }
    if (scalar === syntax.decimal && !decimalSeen) {
      decimalSeen = true;
      continue;
    }
    if (syntax.group !== undefined && scalar === syntax.group && !decimalSeen) {
      if (profile.allowGrouping !== true) {
        return failed(
          'policy-rejected',
          text,
          'Grouping is disabled by this field profile.',
          context,
        );
      }
      integerGroups.push('');
      continue;
    }
    if (/\p{White_Space}/u.test(scalar)) {
      return failed(
        'invalid',
        text,
        'Unexpected whitespace is not permitted inside a localized number.',
        context,
      );
    }
    if (scalar === '.' || scalar === ',') {
      return failed(
        'ambiguous',
        text,
        'The input uses a separator that is ambiguous for this locale.',
        context,
      );
    }
    return failed(
      'invalid',
      text,
      'The localized numeric syntax is invalid.',
      context,
    );
  }
  if (integerGroups.some((group) => group.length === 0)) {
    return failed(
      'incomplete',
      text,
      'The localized grouping is incomplete.',
      context,
    );
  }
  if (decimalSeen && fraction.length === 0) {
    return failed(
      'incomplete',
      text,
      'The localized fraction is incomplete.',
      context,
    );
  }
  if (integerGroups.length > 1) {
    const last = integerGroups.at(-1) as string;
    const middle = integerGroups.slice(1, -1);
    const first = integerGroups[0] as string;
    if (
      last.length !== syntax.primaryGroupSize ||
      middle.some((group) => group.length !== syntax.secondaryGroupSize) ||
      first.length < 1 ||
      first.length > syntax.secondaryGroupSize
    ) {
      return failed(
        'invalid',
        text,
        'The localized grouping pattern is invalid.',
        context,
      );
    }
  }
  if (
    profile.maximumFractionDigits !== undefined &&
    fraction.length > profile.maximumFractionDigits
  ) {
    return failed(
      'policy-rejected',
      text,
      'The input exceeds the declared fractional precision.',
      context,
    );
  }
  const amount = decimal(
    `${negative ? '-' : ''}${integerGroups.join('')}${fraction.length === 0 ? '' : `.${fraction}`}`,
  );
  switch (profile.kind) {
    case 'decimal':
      return validateRange(amount, profile, text, context, () => amount);
    case 'money':
      return validateRange(amount, profile, text, context, () =>
        money(amount, profile.currency),
      );
    case 'measurement':
      return validateRange(amount, profile, text, context, () =>
        measurement(amount, profile.unit),
      );
    case 'percent': {
      const scaled =
        profile.scale === 'fractional' ? divideByHundred(amount) : amount;
      return validateRange(scaled, profile, text, context, () =>
        percent(scaled, profile.scale),
      );
    }
    case 'percentage-points':
      return validateRange(amount, profile, text, context, () =>
        percentagePoints(amount),
      );
  }
}

function localizedDigits(
  value: string,
  context: FormattingContext,
): string | undefined {
  // Each field parser has already asked for this context's syntax and answered for a locale the
  // platform refuses, so the syntax is there to read by the time a field's digits are.
  const syntax = numberSyntax(context);
  let result = '';
  for (const scalar of value) {
    const digit = syntax.digits.get(scalar);
    if (digit === undefined) return undefined;
    result += digit;
  }
  return result;
}

type DatePatternWithLimit = LocalizedPlainDateInputPattern & {
  readonly maximumCharacters?: number;
};

type TimePatternWithLimit = LocalizedPlainTimeInputPattern & {
  readonly maximumCharacters?: number;
};

function validCharacterLimit(value: number | undefined): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) &&
      value > 0 &&
      value <= RUNTIME_LIMITS.localizedInputCodePoints)
  );
}

/**
 * The most characters a field reads: what its profile declares, and its kind's own limit where the
 * profile declares none.
 */
function fieldCharacterLimit(profile: LocalizedInputProfile): number {
  return (
    (profile as LocalizedInputProfile & { readonly maximumCharacters?: number })
      .maximumCharacters ??
    (profile.kind === 'plain-date' ||
    profile.kind === 'plain-time' ||
    profile.kind === 'instant'
      ? 64
      : profile.kind === 'plain-date-time'
        ? 128
        : 256)
  );
}

function validPatternLiteral(value: string, maximumLength = 16): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maximumLength &&
    value === value.normalize('NFC') &&
    !/\p{Number}/u.test(value)
  );
}

function comparePlainDate(left: PlainDateValue, right: PlainDateValue): number {
  const leftFields = [left.year, left.month, left.day];
  const rightFields = [right.year, right.month, right.day];
  for (let index = 0; index < leftFields.length; index += 1) {
    const difference =
      (leftFields[index] as number) - (rightFields[index] as number);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function validPlainDateBoundary(
  value: PlainDateValue | undefined,
  calendar: string,
): boolean {
  if (value === undefined || value.calendar !== calendar)
    return value === undefined;
  try {
    // Throws for fields that are not a date's, and for an ISO or a Gregorian date that does not
    // exist: a boundary written by hand can hold anything. A calendar that is neither is refused
    // by the reader as one it cannot read, which is the truer report for it.
    plainDate(value.year, value.month, value.day, value.calendar);
    return true;
  } catch {
    return false;
  }
}

function validDatePattern(profile: DatePatternWithLimit): boolean {
  const calendar = profile.calendar ?? 'iso8601';
  return (
    validCharacterLimit(profile.maximumCharacters) &&
    ['day-month-year', 'month-day-year', 'year-month-day'].includes(
      profile.order,
    ) &&
    validPatternLiteral(profile.separator) &&
    isCalendarName(calendar) &&
    validPlainDateBoundary(profile.minimum, calendar) &&
    validPlainDateBoundary(profile.maximum, calendar) &&
    !(
      profile.minimum !== undefined &&
      profile.maximum !== undefined &&
      comparePlainDate(profile.minimum, profile.maximum) > 0
    )
  );
}

function parsePlainDate(
  text: string,
  profile: DatePatternWithLimit,
  context: FormattingContext,
): LocalizedInputResult<PlainDateValue> {
  const source = canonicalInput(text);
  const calendar = profile.calendar ?? 'iso8601';
  if (!validDatePattern(profile)) {
    return failed(
      'policy-rejected',
      text,
      'The declared localized date profile is invalid.',
      context,
    );
  }
  if (calendar !== 'iso8601' && calendar !== 'gregory') {
    return failed(
      'unsupported-capability',
      text,
      'Strict localized date input for this calendar requires an enabled parsing provider.',
      context,
    );
  }
  try {
    numberSyntax(context);
  } catch {
    return failed(
      'unsupported-capability',
      text,
      'The locale does not expose a strict date input syntax.',
      context,
      'native-capability-rejected',
    );
  }
  const fields = source.split(profile.separator);
  if (fields.length < 3 || fields.some((field) => field.length === 0)) {
    return failed(
      'incomplete',
      text,
      'The localized date is incomplete.',
      context,
    );
  }
  if (fields.length !== 3) {
    return failed(
      'invalid',
      text,
      'The localized date has an invalid field count.',
      context,
    );
  }
  const values = fields.map((field) => localizedDigits(field, context));
  if (values.some((value) => value === undefined)) {
    return failed(
      'invalid',
      text,
      'The localized date contains invalid digits.',
      context,
    );
  }
  // The pattern was held to the three orders, and each names the year, the month and the day once.
  const order = profile.order.split('-');
  const digitsOf = (name: string): string =>
    values[order.indexOf(name)] as string;
  const year = Number(digitsOf('year'));
  const month = Number(digitsOf('month'));
  const day = Number(digitsOf('day'));
  if (digitsOf('year').length !== 4) {
    return failed(
      'invalid',
      text,
      'The localized date fields are invalid.',
      context,
    );
  }
  let value: PlainDateValue | undefined;
  try {
    value = plainDate(year, month, day, calendar);
  } catch {
    // Fields that are no date, or a date its calendar does not have, leave no value, and the
    // refusal below is the answer for that.
  }
  if (value === undefined) {
    return failed(
      'out-of-range',
      text,
      'The localized date does not exist.',
      context,
      'malformed-input',
    );
  }
  if (
    (profile.minimum !== undefined &&
      comparePlainDate(value, profile.minimum) < 0) ||
    (profile.maximum !== undefined &&
      comparePlainDate(value, profile.maximum) > 0)
  ) {
    return failed(
      'out-of-range',
      text,
      'The localized date is outside the declared field range.',
      context,
    );
  }
  return valid(text, value);
}

function plainTimeNanoseconds(value: PlainTimeValue): number {
  return (
    ((value.hour * 60 + value.minute) * 60 + value.second) * 1_000_000_000 +
    value.nanosecond
  );
}

function comparePlainTime(left: PlainTimeValue, right: PlainTimeValue): number {
  const difference = plainTimeNanoseconds(left) - plainTimeNanoseconds(right);
  return difference < 0 ? -1 : difference > 0 ? 1 : 0;
}

function validPlainTimeBoundary(value: PlainTimeValue | undefined): boolean {
  if (value === undefined) return true;
  try {
    const canonical = plainTime(
      value.hour,
      value.minute,
      value.second,
      value.nanosecond,
    );
    return comparePlainTime(canonical, value) === 0;
  } catch {
    return false;
  }
}

function validTimePattern(profile: TimePatternWithLimit): boolean {
  const fractionalDigits = profile.fractionalSecondDigits;
  const usesDayPeriod =
    profile.hourCycle === 'h11' || profile.hourCycle === 'h12';
  const dayPeriod = profile.dayPeriod;
  const dayPeriodSeparator = dayPeriod?.separator ?? '';
  // A pattern is authored, in a project file or in a call, and these two fields name a member of
  // a fixed set rather than carrying a value. They are read as what was written.
  const precision: unknown = profile.precision;
  const dayPeriodPosition: unknown = dayPeriod?.position;
  return (
    validCharacterLimit(profile.maximumCharacters) &&
    ['h11', 'h12', 'h23', 'h24'].includes(profile.hourCycle) &&
    validPatternLiteral(profile.separator) &&
    (precision === 'minute' ||
      precision === 'second' ||
      precision === 'fraction') &&
    (precision === 'fraction'
      ? Number.isSafeInteger(fractionalDigits) &&
        (fractionalDigits as number) >= 1 &&
        (fractionalDigits as number) <= 9
      : fractionalDigits === undefined) &&
    (usesDayPeriod
      ? dayPeriod !== undefined &&
        typeof dayPeriod.am === 'string' &&
        typeof dayPeriod.pm === 'string' &&
        typeof dayPeriodSeparator === 'string' &&
        dayPeriod.am.length > 0 &&
        dayPeriod.pm.length > 0 &&
        [...dayPeriod.am].length <= 32 &&
        [...dayPeriod.pm].length <= 32 &&
        dayPeriod.am === dayPeriod.am.normalize('NFC') &&
        dayPeriod.pm === dayPeriod.pm.normalize('NFC') &&
        dayPeriod.am !== dayPeriod.pm &&
        (dayPeriodPosition === 'prefix' || dayPeriodPosition === 'suffix') &&
        [...dayPeriodSeparator].length <= 8 &&
        dayPeriodSeparator === dayPeriodSeparator.normalize('NFC') &&
        (dayPeriodSeparator.length === 0 ||
          validPatternLiteral(dayPeriodSeparator, 8))
      : dayPeriod === undefined) &&
    validPlainTimeBoundary(profile.minimum) &&
    validPlainTimeBoundary(profile.maximum) &&
    !(
      profile.minimum !== undefined &&
      profile.maximum !== undefined &&
      comparePlainTime(profile.minimum, profile.maximum) > 0
    )
  );
}

function parsePlainTime(
  text: string,
  profile: TimePatternWithLimit,
  context: FormattingContext,
): LocalizedInputResult<PlainTimeValue> {
  const source = canonicalInput(text);
  if (!validTimePattern(profile)) {
    return failed(
      'policy-rejected',
      text,
      'The declared localized time profile is invalid.',
      context,
    );
  }
  let syntax: NumberSyntax;
  try {
    syntax = numberSyntax(context);
  } catch {
    return failed(
      'unsupported-capability',
      text,
      'The locale does not expose a strict time input syntax.',
      context,
      'native-capability-rejected',
    );
  }
  if (
    profile.precision === 'fraction' &&
    profile.separator === syntax.decimal
  ) {
    return failed(
      'policy-rejected',
      text,
      'The time field and fractional separators must be distinct.',
      context,
    );
  }
  let body = source;
  let period: 'am' | 'pm' | undefined;
  if (profile.dayPeriod !== undefined) {
    const separator = profile.dayPeriod.separator ?? '';
    const markers = (['am', 'pm'] as const).map((name) => {
      const label = profile.dayPeriod?.[name] as string;
      const marker =
        profile.dayPeriod?.position === 'prefix'
          ? `${label}${separator}`
          : `${separator}${label}`;
      const matches =
        profile.dayPeriod?.position === 'prefix'
          ? body.startsWith(marker)
          : body.endsWith(marker);
      return { name, marker, matches };
    });
    const matches = markers.filter(({ matches: match }) => match);
    if (matches.length > 1) {
      return failed(
        'ambiguous',
        text,
        'The localized day-period marker is ambiguous.',
        context,
      );
    }
    const match = matches[0];
    if (match === undefined) {
      return failed(
        'incomplete',
        text,
        'The localized time requires its declared day-period marker.',
        context,
      );
    }
    period = match.name;
    body =
      profile.dayPeriod.position === 'prefix'
        ? body.slice(match.marker.length)
        : body.slice(0, -match.marker.length);
  }
  const fields = body.split(profile.separator);
  const expectedFields = profile.precision === 'minute' ? 2 : 3;
  if (
    fields.length < expectedFields ||
    fields.some((field) => field.length === 0)
  ) {
    return failed(
      'incomplete',
      text,
      'The localized time is incomplete.',
      context,
    );
  }
  if (fields.length !== expectedFields) {
    return failed(
      'invalid',
      text,
      'The localized time has an invalid field count.',
      context,
    );
  }
  const [hourField = '', minuteField = '', secondsField = ''] = fields;
  let secondField = secondsField;
  let fractionField = '';
  if (profile.precision === 'fraction') {
    const fractionParts = secondsField.split(syntax.decimal);
    if (
      fractionParts.length < 2 ||
      fractionParts.some((field) => field.length === 0)
    ) {
      return failed(
        'incomplete',
        text,
        'The localized fractional time is incomplete.',
        context,
      );
    }
    if (fractionParts.length !== 2) {
      return failed(
        'invalid',
        text,
        'The localized fractional time is invalid.',
        context,
      );
    }
    [secondField, fractionField] = fractionParts as [string, string];
  }
  const localized = [hourField, minuteField];
  if (profile.precision !== 'minute') localized.push(secondField);
  if (profile.precision === 'fraction') localized.push(fractionField);
  const values = localized.map((field) => localizedDigits(field, context));
  if (values.some((value) => value === undefined)) {
    return failed(
      'invalid',
      text,
      'The localized time contains invalid digits.',
      context,
    );
  }
  const [
    hourDigits = '',
    minuteDigits = '',
    secondDigits = '',
    fractionDigits = '',
  ] = values as string[];
  const declaredFractionDigits = profile.fractionalSecondDigits ?? 0;
  if (
    hourDigits.length < 1 ||
    hourDigits.length > 2 ||
    minuteDigits.length !== 2 ||
    (profile.precision !== 'minute' && secondDigits.length !== 2) ||
    (profile.precision === 'fraction' &&
      fractionDigits.length !== declaredFractionDigits)
  ) {
    const hasShortField =
      hourDigits.length === 0 ||
      minuteDigits.length < 2 ||
      (profile.precision !== 'minute' && secondDigits.length < 2) ||
      (profile.precision === 'fraction' &&
        fractionDigits.length < declaredFractionDigits);
    return failed(
      hasShortField ? 'incomplete' : 'invalid',
      text,
      'The localized time fields do not match the declared widths.',
      context,
    );
  }
  const displayedHour = Number(hourDigits);
  const minute = Number(minuteDigits);
  const second = profile.precision === 'minute' ? 0 : Number(secondDigits);
  const nanosecond =
    profile.precision === 'fraction'
      ? Number(fractionDigits.padEnd(9, '0'))
      : 0;
  let hour = displayedHour;
  if (profile.hourCycle === 'h11') {
    if (displayedHour > 11) hour = -1;
    else if (period === 'pm') hour += 12;
  } else if (profile.hourCycle === 'h12') {
    if (displayedHour < 1 || displayedHour > 12) hour = -1;
    else hour = (displayedHour % 12) + (period === 'pm' ? 12 : 0);
  } else if (profile.hourCycle === 'h23') {
    if (displayedHour > 23) hour = -1;
  } else if (displayedHour === 24) {
    hour = minute === 0 && second === 0 && nanosecond === 0 ? 0 : -1;
  } else if (displayedHour < 1 || displayedHour > 23) {
    hour = -1;
  }
  let value: PlainTimeValue;
  try {
    value = plainTime(hour, minute, second, nanosecond);
  } catch {
    return failed(
      'out-of-range',
      text,
      'The localized time contains out-of-range clock fields.',
      context,
      'malformed-input',
    );
  }
  if (
    (profile.minimum !== undefined &&
      comparePlainTime(value, profile.minimum) < 0) ||
    (profile.maximum !== undefined &&
      comparePlainTime(value, profile.maximum) > 0)
  ) {
    return failed(
      'out-of-range',
      text,
      'The localized time is outside the declared field range.',
      context,
    );
  }
  return valid(text, value);
}

function comparePlainDateTime(
  left: PlainDateTimeValue,
  right: PlainDateTimeValue,
): number {
  const dateComparison = comparePlainDate(left.date, right.date);
  return dateComparison === 0
    ? comparePlainTime(left.time, right.time)
    : dateComparison;
}

function validPlainDateTimeBoundary(
  value: PlainDateTimeValue | undefined,
  calendar: string,
): boolean {
  return (
    value === undefined ||
    (validPlainDateBoundary(value.date, calendar) &&
      validPlainTimeBoundary(value.time))
  );
}

/**
 * The pattern of one half of a date-time field, held to the field's limit.
 *
 * The limit of a date-time field is the field's own. A half is a part of text the field has already
 * measured, so it takes the field's limit and none of its own: a date or a time alone is held to a
 * shorter default, which would refuse a half the field's limit has room for.
 */
function dateTimeHalf<Pattern extends object>(
  pattern: Pattern,
  profile: Extract<LocalizedInputProfile, { readonly kind: 'plain-date-time' }>,
): Pattern & { readonly maximumCharacters: number } {
  return { ...pattern, maximumCharacters: fieldCharacterLimit(profile) };
}

function parsePlainDateTimeInput(
  text: string,
  profile: Extract<LocalizedInputProfile, { readonly kind: 'plain-date-time' }>,
  context: FormattingContext,
): LocalizedInputResult<PlainDateTimeValue> {
  const source = canonicalInput(text);
  const calendar = profile.date.calendar ?? 'iso8601';
  const date = dateTimeHalf(profile.date, profile);
  const time = dateTimeHalf(profile.time, profile);
  if (
    !validCharacterLimit(profile.maximumCharacters) ||
    !validDatePattern(date) ||
    !validTimePattern(time) ||
    !validPatternLiteral(profile.separator) ||
    profile.separator === profile.date.separator ||
    !validPlainDateTimeBoundary(profile.minimum, calendar) ||
    !validPlainDateTimeBoundary(profile.maximum, calendar) ||
    (profile.minimum !== undefined &&
      profile.maximum !== undefined &&
      comparePlainDateTime(profile.minimum, profile.maximum) > 0)
  ) {
    return failed(
      'policy-rejected',
      text,
      'The declared localized date-time profile is invalid.',
      context,
    );
  }
  // Asked of the field and not left to its halves, which are reached only by a text that has
  // both: the calendar and the locale are reported whatever the text.
  if (calendar !== 'iso8601' && calendar !== 'gregory') {
    return failed(
      'unsupported-capability',
      text,
      'Strict localized date input for this calendar requires an enabled parsing provider.',
      context,
    );
  }
  try {
    numberSyntax(context);
  } catch {
    return failed(
      'unsupported-capability',
      text,
      'The locale does not expose a strict date-time input syntax.',
      context,
      'native-capability-rejected',
    );
  }
  const boundary = source.indexOf(profile.separator);
  if (boundary < 1 || boundary + profile.separator.length >= source.length) {
    return failed(
      'incomplete',
      text,
      'The localized date-time is incomplete.',
      context,
    );
  }
  const dateResult = parsePlainDate(source.slice(0, boundary), date, context);
  // A half reports the half it was given, and the field reports the text it was given.
  if (dateResult.status !== 'valid') {
    return Object.freeze({ ...dateResult, text });
  }
  const timeResult = parsePlainTime(
    source.slice(boundary + profile.separator.length),
    time,
    context,
  );
  if (timeResult.status !== 'valid') {
    return Object.freeze({ ...timeResult, text });
  }
  const value = plainDateTime(dateResult.value, timeResult.value);
  if (
    (profile.minimum !== undefined &&
      comparePlainDateTime(value, profile.minimum) < 0) ||
    (profile.maximum !== undefined &&
      comparePlainDateTime(value, profile.maximum) > 0)
  ) {
    return failed(
      'out-of-range',
      text,
      'The localized date-time is outside the declared field range.',
      context,
    );
  }
  return valid(text, value);
}

interface ResolvedTimeZoneInputOption {
  readonly timeZone: TimeZoneValue;
  readonly labels: readonly string[];
}

function resolveTimeZoneInputOptions(
  profile: LocalizedTimeZoneInputProfile,
): readonly ResolvedTimeZoneInputOption[] | undefined {
  if (
    !validCharacterLimit(profile.maximumCharacters) ||
    !Array.isArray(profile.options) ||
    profile.options.length < 1 ||
    profile.options.length > 256
  ) {
    return undefined;
  }
  const resolved: ResolvedTimeZoneInputOption[] = [];
  let labelCount = 0;
  try {
    for (const option of profile.options) {
      if (
        option === null ||
        typeof option !== 'object' ||
        !Array.isArray(option.labels) ||
        option.labels.length < 1 ||
        option.labels.length > 64
      )
        return undefined;
      const optionLabels: readonly string[] = option.labels;
      const labels = optionLabels.map((label) => canonicalInput(label));
      labelCount += labels.length;
      if (
        labelCount > 2048 ||
        labels.some(
          (label, index) =>
            label.length === 0 ||
            [...label].length > 256 ||
            label !== optionLabels[index],
        )
      ) {
        return undefined;
      }
      resolved.push(
        Object.freeze({
          timeZone: timeZone(option.timeZone),
          labels: Object.freeze(labels),
        }),
      );
    }
  } catch {
    return undefined;
  }
  return Object.freeze(resolved);
}

function parseTimeZoneInput(
  text: string,
  profile: LocalizedTimeZoneInputProfile,
  context: FormattingContext,
): LocalizedInputResult<TimeZoneValue> {
  const source = canonicalInput(text);
  const options = resolveTimeZoneInputOptions(profile);
  if (options === undefined) {
    return failed(
      'policy-rejected',
      text,
      'The declared localized time-zone profile is invalid.',
      context,
    );
  }
  const exact = new Map<string, TimeZoneValue>();
  for (const option of options) {
    if (option.labels.includes(source))
      exact.set(option.timeZone.id, option.timeZone);
  }
  if (exact.size === 1) {
    return valid(text, [...exact.values()][0] as TimeZoneValue);
  }
  if (exact.size > 1) {
    return failed(
      'ambiguous',
      text,
      'The localized time-zone label identifies more than one allowed zone.',
      context,
    );
  }
  if (
    source.length === 0 ||
    options.some((option) =>
      option.labels.some((label) => label.startsWith(source)),
    )
  ) {
    return failed(
      'incomplete',
      text,
      'The localized time-zone label is incomplete.',
      context,
    );
  }
  return failed(
    'invalid',
    text,
    'The localized time-zone label is not allowed by this field profile.',
    context,
  );
}

function canonicalDecimalContract(value: DecimalValue | undefined): boolean {
  if (value === undefined) return true;
  try {
    return decimal(value.value).value === value.value;
  } catch {
    return false;
  }
}

/** The units a duration field may name, in the order a duration value holds them. */
const durationFieldNames = Object.freeze([
  'years',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
  'seconds',
] as const);

function validDurationField(field: LocalizedDurationInputField): boolean {
  const minimumIntegerDigits = field.minimumIntegerDigits ?? 1;
  const maximumIntegerDigits = field.maximumIntegerDigits ?? 15;
  const maximumFractionDigits = field.maximumFractionDigits ?? 0;
  // A pattern is authored, and its unit is read as what was written: a name outside the seven has
  // no member of a duration value to fill.
  const name: unknown = field.field;
  return (
    (durationFieldNames as readonly unknown[]).includes(name) &&
    Number.isSafeInteger(minimumIntegerDigits) &&
    minimumIntegerDigits >= 1 &&
    minimumIntegerDigits <= 15 &&
    Number.isSafeInteger(maximumIntegerDigits) &&
    maximumIntegerDigits >= minimumIntegerDigits &&
    maximumIntegerDigits <= 15 &&
    Number.isSafeInteger(maximumFractionDigits) &&
    maximumFractionDigits >= 0 &&
    maximumFractionDigits <= 9 &&
    (field.field === 'seconds'
      ? true
      : field.maximumFractionDigits === undefined) &&
    canonicalDecimalContract(field.minimum) &&
    canonicalDecimalContract(field.maximum) &&
    (field.minimum === undefined ||
      (!field.minimum.value.startsWith('-') &&
        (field.field === 'seconds' || !field.minimum.value.includes('.')))) &&
    (field.maximum === undefined ||
      (!field.maximum.value.startsWith('-') &&
        (field.field === 'seconds' || !field.maximum.value.includes('.')))) &&
    !(
      field.minimum !== undefined &&
      field.maximum !== undefined &&
      compareDecimal(field.minimum, field.maximum) > 0
    )
  );
}

function validDurationPattern(
  profile: LocalizedDurationInputProfile,
  syntax: NumberSyntax,
): boolean {
  if (
    !validCharacterLimit(profile.maximumCharacters) ||
    !Array.isArray(profile.pattern) ||
    !['forbidden', 'optional', 'required'].includes(profile.sign ?? 'forbidden')
  ) {
    return false;
  }
  const fields = new Set<string>();
  for (const [index, token] of profile.pattern.entries()) {
    const previous = profile.pattern[index - 1];
    if (typeof token === 'string') {
      if (
        token.length === 0 ||
        [...token].length > 64 ||
        token !== token.normalize('NFC') ||
        typeof previous === 'string' ||
        [...token].some(
          (scalar) =>
            syntax.digits.has(scalar) ||
            scalar === syntax.decimal ||
            scalar === syntax.minus ||
            scalar === syntax.plus ||
            // A literal made of the marks that decorate a sign would be eaten by the sign strip
            // before the pattern ever saw it.
            syntax.signMarks.has(scalar),
        )
      ) {
        return false;
      }
    } else {
      if (
        token === null ||
        typeof token !== 'object' ||
        (previous !== undefined && typeof previous !== 'string') ||
        fields.has(token.field) ||
        !validDurationField(token)
      ) {
        return false;
      }
      fields.add(token.field);
    }
  }
  return fields.size > 0;
}

function parseDurationFieldValue(
  source: string,
  field: LocalizedDurationInputField,
  syntax: NumberSyntax,
  text: string,
  context: FormattingContext,
): LocalizedInputResult<DecimalValue> {
  if (source.length === 0) {
    return failed(
      'incomplete',
      text,
      `The localized duration ${field.field} field is incomplete.`,
      context,
    );
  }
  const decimalParts = source.split(syntax.decimal);
  if (
    decimalParts.length > 2 ||
    (decimalParts.length === 2 && field.field !== 'seconds')
  ) {
    return failed(
      'invalid',
      text,
      `The localized duration ${field.field} field has invalid numeric syntax.`,
      context,
    );
  }
  const [integerSource = '', fractionSource] = decimalParts;
  const integer = localizedDigits(integerSource, context);
  const fraction =
    fractionSource === undefined
      ? undefined
      : localizedDigits(fractionSource, context);
  // Asked before whether a side is still empty: text that is not digits is not made a number by
  // typing more of it.
  if (
    integer === undefined ||
    (fraction === undefined && fractionSource !== undefined)
  ) {
    return failed(
      'invalid',
      text,
      `The localized duration ${field.field} field contains invalid digits.`,
      context,
    );
  }
  // An empty whole part is short of the unit's width, which the next test reports.
  if (fraction === '') {
    return failed(
      'incomplete',
      text,
      `The localized duration ${field.field} field is incomplete.`,
      context,
    );
  }
  const minimumIntegerDigits = field.minimumIntegerDigits ?? 1;
  const maximumIntegerDigits = field.maximumIntegerDigits ?? 15;
  if (
    integer.length < minimumIntegerDigits ||
    integer.length > maximumIntegerDigits
  ) {
    return failed(
      integer.length < minimumIntegerDigits ? 'incomplete' : 'policy-rejected',
      text,
      `The localized duration ${field.field} field does not match its declared width.`,
      context,
    );
  }
  if ((fraction?.length ?? 0) > (field.maximumFractionDigits ?? 0)) {
    return failed(
      'policy-rejected',
      text,
      'The localized duration seconds exceed the declared precision.',
      context,
    );
  }
  const value = decimal(
    fraction === undefined ? integer : `${integer}.${fraction}`,
  );
  if (
    (field.minimum !== undefined && compareDecimal(value, field.minimum) < 0) ||
    (field.maximum !== undefined && compareDecimal(value, field.maximum) > 0)
  ) {
    return failed(
      'out-of-range',
      text,
      `The localized duration ${field.field} field is outside its declared range.`,
      context,
    );
  }
  return valid(text, value);
}

function parseDurationInput(
  text: string,
  profile: LocalizedDurationInputProfile,
  context: FormattingContext,
): LocalizedInputResult<DurationValue> {
  const source = canonicalInput(text);
  let syntax: NumberSyntax;
  try {
    syntax = numberSyntax(context);
  } catch {
    return failed(
      'unsupported-capability',
      text,
      'The locale does not expose a strict duration input syntax.',
      context,
      'native-capability-rejected',
    );
  }
  if (!validDurationPattern(profile, syntax)) {
    return failed(
      'policy-rejected',
      text,
      'The declared localized duration profile is invalid.',
      context,
    );
  }
  if (source.length === 0) {
    return failed(
      'incomplete',
      text,
      'The localized duration is incomplete.',
      context,
    );
  }
  const signedBody = stripSign(source, syntax);
  let body = signedBody.body;
  const negative = signedBody.negative;
  const explicitSign = signedBody.explicit;
  const signPolicy = profile.sign ?? 'forbidden';
  if (signPolicy === 'forbidden' && explicitSign) {
    return failed(
      'policy-rejected',
      text,
      'A sign is forbidden by this duration field profile.',
      context,
    );
  }
  if (signPolicy === 'required' && !explicitSign) {
    return failed(
      'incomplete',
      text,
      'The localized duration requires an explicit sign.',
      context,
    );
  }
  if (body.length === 0) {
    return failed(
      'incomplete',
      text,
      'The localized duration is incomplete.',
      context,
    );
  }
  const values = new Map<string, DecimalValue>();
  let cursor = 0;
  for (const [index, token] of profile.pattern.entries()) {
    if (typeof token === 'string') {
      const remainder = body.slice(cursor);
      if (!remainder.startsWith(token)) {
        return failed(
          token.startsWith(remainder) ? 'incomplete' : 'invalid',
          text,
          'The localized duration does not match its declared literals.',
          context,
        );
      }
      cursor += token.length;
      continue;
    }
    const next = profile.pattern[index + 1];
    const end =
      typeof next === 'string' ? body.indexOf(next, cursor) : body.length;
    if (end < 0) {
      return failed(
        'incomplete',
        text,
        `The localized duration ${token.field} field is incomplete.`,
        context,
      );
    }
    const result = parseDurationFieldValue(
      body.slice(cursor, end),
      token,
      syntax,
      text,
      context,
    );
    if (result.status !== 'valid') {
      return result as LocalizedInputResult<DurationValue>;
    }
    values.set(token.field, result.value);
    cursor = end;
  }
  if (cursor !== body.length) {
    return failed(
      'invalid',
      text,
      'The localized duration has unexpected trailing input.',
      context,
    );
  }
  const integer = (field: string): number =>
    Number(values.get(field)?.value ?? '0');
  const hasValue = [...values.values()].some(({ value }) => value !== '0');
  if (negative && !hasValue) {
    return failed(
      'policy-rejected',
      text,
      'A localized duration cannot encode negative zero.',
      context,
    );
  }
  return valid(
    text,
    duration(
      {
        years: integer('years'),
        months: integer('months'),
        weeks: integer('weeks'),
        days: integer('days'),
        hours: integer('hours'),
        minutes: integer('minutes'),
        seconds: values.get('seconds') ?? decimal('0'),
      },
      hasValue ? (negative ? -1 : 1) : 0,
    ),
  );
}

function parseRfc3339(
  text: string,
  profile: Extract<LocalizedInputProfile, { readonly kind: 'instant' }>,
  context: FormattingContext,
) {
  const source = canonicalInput(text);
  // A profile is authored, and the syntax it names is read as what was written: one this reader
  // does not implement is refused, because reading RFC 3339 under another name would accept text
  // the profile never contracted.
  const syntax: unknown = profile.syntax;
  if (syntax !== 'rfc3339') {
    return failed(
      'policy-rejected',
      text,
      'The declared localized instant profile is invalid.',
      context,
    );
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u.exec(
      source,
    );
  if (match === null) {
    return failed(
      source.length === 0 || /[T:.+-]$/u.test(source)
        ? 'incomplete'
        : 'invalid',
      text,
      'The instant must use the declared RFC 3339 syntax.',
      context,
    );
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fraction = '',
    zone,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) {
    return failed(
      'invalid',
      text,
      'The instant contains invalid clock fields.',
      context,
    );
  }
  try {
    plainDate(year, month, day);
  } catch {
    return failed(
      'invalid',
      text,
      'The instant contains an invalid date.',
      context,
      'malformed-input',
    );
  }
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    if (zone === '-00:00') {
      return failed(
        'policy-rejected',
        text,
        'RFC 3339 unknown-local-offset notation cannot identify an instant.',
        context,
      );
    }
    const sign = zone?.startsWith('-') ? -1 : 1;
    const offsetHour = Number(zone?.slice(1, 3));
    const offsetMinute = Number(zone?.slice(4, 6));
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      return failed(
        'policy-rejected',
        text,
        'The instant offset is outside policy.',
        context,
      );
    }
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }
  const date = new Date(0);
  date.setUTCHours(hour, minute, second, 0);
  date.setUTCFullYear(year, month - 1, day);
  // A date that exists in a four-digit year, moved by at most fourteen hours, is a whole number of
  // milliseconds well inside what a number holds exactly.
  const milliseconds = date.getTime() - offsetMinutes * 60_000;
  const fractionNanoseconds = BigInt((fraction + '000000000').slice(0, 9));
  return valid(
    text,
    instant(
      (BigInt(milliseconds) * 1_000_000n + fractionNanoseconds).toString(),
    ),
  );
}

/**
 * Reads text a person typed in their own conventions, and returns the exact value behind it.
 *
 * Takes the text, the profile saying what kind of value is expected and how loosely it may be
 * written, and the context saying which locale's conventions to read it in. Returns either a valid
 * result carrying the value, or a result carrying the status and a diagnostic. It does not throw
 * for bad input, because unreadable input is the ordinary case in a form.
 *
 * The profile decides the value's type: a money profile returns an amount with its currency, a
 * date profile a calendar date, and so on. Text longer than the profile's own character limit, than
 * the limit of the profile's kind where it declares none, or than the runtime's, is refused before
 * it is read at all and before the platform is asked anything about the locale.
 */
export function parseLocalizedInput<Profile extends LocalizedInputProfile>(
  text: string,
  profile: Profile,
  context: FormattingContext,
): LocalizedInputResult<LocalizedInputValue<Profile>> {
  const declaredMaximum = (
    profile as LocalizedInputProfile & { readonly maximumCharacters?: number }
  ).maximumCharacters;
  if (
    typeof text !== 'string' ||
    !validCharacterLimit(declaredMaximum) ||
    codePointLengthAtMost(
      text,
      Math.min(
        declaredMaximum ?? RUNTIME_LIMITS.localizedInputCodePoints,
        RUNTIME_LIMITS.localizedInputCodePoints,
      ),
    ) === undefined
  ) {
    return failed(
      'out-of-range',
      typeof text === 'string' ? text : '',
      'The localized input exceeds the fixed runtime ceiling.',
      context,
    ) as LocalizedInputResult<LocalizedInputValue<Profile>>;
  }
  // Asked before the context's numbering system and the locale's digits, which are the first
  // questions put to the platform: text of any length would otherwise cost them.
  if ([...canonicalInput(text)].length > fieldCharacterLimit(profile)) {
    return failed(
      'policy-rejected',
      text,
      'The input exceeds the declared field limit.',
      context,
    );
  }
  const refusal = numberingSystemRefusal(context);
  if (refusal === 'malformed') {
    return failed(
      'policy-rejected',
      text,
      malformedNumberingSystem,
      context,
      undefined,
      'invalid-configuration',
    );
  }
  if (refusal === 'unavailable') {
    return failed(
      'unsupported-capability',
      text,
      unavailableNumberingSystem,
      context,
      'native-capability-rejected',
    );
  }
  let result: LocalizedInputResult<unknown>;
  switch (profile.kind) {
    case 'plain-date':
      result = parsePlainDate(text, profile, context);
      break;
    case 'plain-time':
      result = parsePlainTime(text, profile, context);
      break;
    case 'plain-date-time':
      result = parsePlainDateTimeInput(text, profile, context);
      break;
    case 'time-zone':
      result = parseTimeZoneInput(text, profile, context);
      break;
    case 'duration':
      result = parseDurationInput(text, profile, context);
      break;
    case 'instant':
      result = parseRfc3339(text, profile, context);
      break;
    default:
      result = parseNumeric(text, profile, context);
  }
  return result as LocalizedInputResult<LocalizedInputValue<Profile>>;
}

/**
 * What a writer answers in place of text under a locale the platform has no digits for.
 *
 * Kept apart from the answer for a value the profile cannot represent, because the two are
 * different faults: one is the value's or the profile's, and the other is a capability the platform
 * lacks, which the caller is told as one.
 */
const NO_DIGITS = Symbol('no digits');

type WrittenText = string | typeof NO_DIGITS | undefined;

function localizedDateText(
  value: PlainDateValue,
  profile: LocalizedPlainDateInputPattern,
  context: FormattingContext,
): WrittenText {
  let formatter: Intl.NumberFormat;
  let yearFormatter: Intl.NumberFormat;
  try {
    formatter = inputFormatterCache.number(context.locale, {
      useGrouping: false,
      minimumIntegerDigits: 2,
      ...(context.numberingSystem === undefined
        ? {}
        : { numberingSystem: context.numberingSystem }),
    });
    yearFormatter = inputFormatterCache.number(context.locale, {
      useGrouping: false,
      minimumIntegerDigits: 4,
      ...(context.numberingSystem === undefined
        ? {}
        : { numberingSystem: context.numberingSystem }),
    });
  } catch {
    return NO_DIGITS;
  }
  try {
    // Throws for a value that is not a date: one written by hand with a field that is not a whole
    // number in its range.
    plainDate(value.year, value.month, value.day, value.calendar);
  } catch {
    return undefined;
  }
  const fields: Readonly<Record<string, string>> = {
    day: formatter.format(value.day),
    month: formatter.format(value.month),
    year: yearFormatter.format(value.year),
  };
  return profile.order
    .split('-')
    .map((field) => fields[field] as string)
    .join(profile.separator);
}

function localizedInputFormatting(
  semantic: 'plain-time' | 'plain-date-time' | 'time-zone' | 'duration',
  text: string,
  source: unknown,
  context: FormattingContext,
): FormattingResult {
  const value: LocalizedFormattedValue = Object.freeze({
    kind: 'formatted-value',
    semantic,
    text,
    parts: Object.freeze([{ kind: 'literal' as const, value: text }]),
    locale: context.locale,
    language: context.locale,
    direction: directionForLocale(context.locale),
    source,
  });
  return Object.freeze({ ok: true, value });
}

function localizeInvariantDigits(value: string, syntax: NumberSyntax): string {
  const localizedByAscii = new Map<string, string>();
  for (const [localized, ascii] of syntax.digits) {
    localizedByAscii.set(ascii, localized);
  }
  return [...value]
    .map((digit) => localizedByAscii.get(digit) as string)
    .join('');
}

function localizedTimeText(
  value: PlainTimeValue,
  profile: TimePatternWithLimit,
  context: FormattingContext,
): WrittenText {
  if (!validTimePattern(profile)) return undefined;
  let syntax: NumberSyntax;
  try {
    syntax = numberSyntax(context);
  } catch {
    return NO_DIGITS;
  }
  try {
    // Throws for a value that is not a time: one written by hand with a field that is not a whole
    // number in its range.
    plainTime(value.hour, value.minute, value.second, value.nanosecond);
  } catch {
    return undefined;
  }
  if (
    (profile.precision === 'minute' &&
      (value.second !== 0 || value.nanosecond !== 0)) ||
    (profile.precision === 'second' && value.nanosecond !== 0)
  ) {
    return undefined;
  }
  let displayedHour = value.hour;
  let period: 'am' | 'pm' | undefined;
  if (profile.hourCycle === 'h11') {
    period = value.hour < 12 ? 'am' : 'pm';
    displayedHour = value.hour % 12;
  } else if (profile.hourCycle === 'h12') {
    period = value.hour < 12 ? 'am' : 'pm';
    displayedHour = value.hour % 12 || 12;
  } else if (profile.hourCycle === 'h24' && value.hour === 0) {
    displayedHour = 24;
  }
  const localizeField = (field: number): string =>
    localizeInvariantDigits(String(field).padStart(2, '0'), syntax);
  const fields = [localizeField(displayedHour), localizeField(value.minute)];
  if (profile.precision !== 'minute') {
    let seconds = localizeField(value.second);
    if (profile.precision === 'fraction') {
      const digits = profile.fractionalSecondDigits as number;
      const nanoseconds = String(value.nanosecond).padStart(9, '0');
      if (/[^0]/u.test(nanoseconds.slice(digits))) return undefined;
      seconds += `${syntax.decimal}${localizeInvariantDigits(
        nanoseconds.slice(0, digits),
        syntax,
      )}`;
    }
    fields.push(seconds);
  }
  let text = fields.join(profile.separator);
  if (period !== undefined && profile.dayPeriod !== undefined) {
    const marker = profile.dayPeriod[period];
    const separator = profile.dayPeriod.separator ?? '';
    text =
      profile.dayPeriod.position === 'prefix'
        ? `${marker}${separator}${text}`
        : `${text}${separator}${marker}`;
  }
  return text;
}

function durationFieldAmount(
  value: DurationValue,
  field: LocalizedDurationInputField['field'],
): DecimalValue {
  return field === 'seconds' ? value.seconds : decimal(String(value[field]));
}

function localizedDurationText(
  value: DurationValue,
  profile: LocalizedDurationInputProfile,
  context: FormattingContext,
): WrittenText {
  let syntax: NumberSyntax;
  try {
    syntax = numberSyntax(context);
  } catch {
    return NO_DIGITS;
  }
  if (!validDurationPattern(profile, syntax)) return undefined;
  try {
    // Throws for a value that is not a duration: one written by hand with a field that is not a
    // whole number from zero up, or a sign that disagrees with its fields.
    duration(
      {
        years: value.years,
        months: value.months,
        weeks: value.weeks,
        days: value.days,
        hours: value.hours,
        minutes: value.minutes,
        seconds: value.seconds,
      },
      value.sign,
    );
  } catch {
    return undefined;
  }
  const declaredFields = new Set(
    profile.pattern
      .filter(
        (token): token is LocalizedDurationInputField =>
          typeof token !== 'string',
      )
      .map(({ field }) => field),
  );
  if (
    durationFieldNames.some(
      (field) =>
        !declaredFields.has(field) &&
        durationFieldAmount(value, field).value !== '0',
    )
  ) {
    return undefined;
  }
  const signPolicy = profile.sign ?? 'forbidden';
  if (signPolicy === 'forbidden' && value.sign < 0) return undefined;
  let text =
    value.sign < 0
      ? syntax.minus
      : signPolicy === 'required'
        ? syntax.plus
        : '';
  for (const token of profile.pattern) {
    if (typeof token === 'string') {
      text += token;
      continue;
    }
    const amount = durationFieldAmount(value, token.field);
    if (
      (token.minimum !== undefined &&
        compareDecimal(amount, token.minimum) < 0) ||
      (token.maximum !== undefined && compareDecimal(amount, token.maximum) > 0)
    ) {
      return undefined;
    }
    const [integer = '0', fraction] = amount.value.split('.');
    const minimumIntegerDigits = token.minimumIntegerDigits ?? 1;
    const maximumIntegerDigits = token.maximumIntegerDigits ?? 15;
    if (
      integer.length > maximumIntegerDigits ||
      (fraction?.length ?? 0) > (token.maximumFractionDigits ?? 0)
    ) {
      return undefined;
    }
    text += localizeInvariantDigits(
      integer.padStart(minimumIntegerDigits, '0'),
      syntax,
    );
    if (fraction !== undefined) {
      text += `${syntax.decimal}${localizeInvariantDigits(fraction, syntax)}`;
    }
  }
  return text;
}

function localizedTimeZoneText(
  value: TimeZoneValue,
  profile: LocalizedTimeZoneInputProfile,
): string | undefined {
  const options = resolveTimeZoneInputOptions(profile);
  if (options === undefined) return undefined;
  let canonical: TimeZoneValue;
  try {
    canonical = timeZone(value.id);
  } catch {
    return undefined;
  }
  return options.find(({ timeZone: option }) => option.id === canonical.id)
    ?.labels[0];
}

function formattingLocaleWithoutDigits(
  context: FormattingContext,
): FormattingResult {
  return Object.freeze({
    ok: false,
    diagnostic: diagnostic(
      'unsupported-formatting-capability',
      'This runtime has no digits to write the value in for the locale of the formatting context.',
      context,
      'native-capability-rejected',
    ),
  });
}

function formattingPolicyFailure(
  message: string,
  context: FormattingContext,
): FormattingResult {
  return Object.freeze({
    ok: false,
    diagnostic: diagnostic('invalid-localized-input', message, context),
  });
}

function valueMatchesProfile(
  value: LocalizedInputValue<LocalizedInputProfile>,
  profile: LocalizedInputProfile,
): boolean {
  switch (profile.kind) {
    case 'decimal':
      return value.kind === 'decimal';
    case 'money':
      return value.kind === 'money' && value.currency === profile.currency;
    case 'measurement':
      return value.kind === 'measurement' && value.unit === profile.unit;
    case 'percent':
      return value.kind === 'percent' && value.scale === profile.scale;
    case 'percentage-points':
      return value.kind === 'percentage-points';
    case 'plain-date':
      return (
        value.kind === 'plain-date' &&
        value.calendar === (profile.calendar ?? 'iso8601')
      );
    case 'plain-time':
      return value.kind === 'plain-time';
    case 'plain-date-time':
      return (
        value.kind === 'plain-date-time' &&
        value.date.calendar === (profile.date.calendar ?? 'iso8601')
      );
    case 'time-zone':
      return value.kind === 'time-zone';
    case 'duration':
      return value.kind === 'duration';
    case 'instant':
      return value.kind === 'instant';
  }
}

function invariantInputIdentity(
  value: LocalizedInputValue<LocalizedInputProfile>,
): string {
  switch (value.kind) {
    case 'decimal':
      return `decimal:${value.value}`;
    case 'money':
      return `money:${value.currency}:${value.amount.value}`;
    case 'measurement':
      return `measurement:${value.unit}:${value.amount.value}`;
    case 'percent':
      return `percent:${value.scale}:${value.amount.value}`;
    case 'percentage-points':
      return `percentage-points:${value.amount.value}`;
    case 'plain-date':
      return `plain-date:${value.calendar}:${value.year}-${value.month}-${value.day}`;
    case 'plain-time':
      return `plain-time:${value.hour}:${value.minute}:${value.second}:${value.nanosecond}`;
    case 'plain-date-time':
      return `plain-date-time:${value.date.calendar}:${value.date.year}-${value.date.month}-${value.date.day}T${value.time.hour}:${value.time.minute}:${value.time.second}:${value.time.nanosecond}`;
    case 'time-zone':
      return `time-zone:${value.id}`;
    case 'duration':
      return `duration:${value.sign}:${value.years}:${value.months}:${value.weeks}:${value.days}:${value.hours}:${value.minutes}:${value.seconds.value}`;
    case 'instant':
      return `instant:${value.epochNanoseconds}`;
  }
}

function verifyFormattedInput(
  formatted: FormattingResult,
  value: LocalizedInputValue<LocalizedInputProfile>,
  profile: LocalizedInputProfile,
  context: FormattingContext,
): FormattingResult {
  if (!formatted.ok) return formatted;
  // Counted in the composed form, as the field's reader counts what it is given, so the two
  // agree about every text whatever form the platform writes in.
  if (
    [...canonicalInput(formatted.value.text)].length >
    fieldCharacterLimit(profile)
  ) {
    return formattingPolicyFailure(
      'The formatted value exceeds the declared localized-input field limit.',
      context,
    );
  }
  const parsed = parseLocalizedInput(formatted.value.text, profile, context);
  if (
    parsed.status !== 'valid' ||
    invariantInputIdentity(
      parsed.value as LocalizedInputValue<LocalizedInputProfile>,
    ) !== invariantInputIdentity(value)
  ) {
    return formattingPolicyFailure(
      'The invariant value cannot round-trip through the declared localized input profile.',
      context,
    );
  }
  return formatted;
}

function formatRfc3339(
  value: ReturnType<typeof instant>,
  context: FormattingContext,
): FormattingResult {
  const billion = 1_000_000_000n;
  const nanoseconds = BigInt(value.epochNanoseconds);
  let seconds = nanoseconds / billion;
  let fraction = nanoseconds % billion;
  if (fraction < 0) {
    seconds -= 1n;
    fraction += billion;
  }
  // A count of milliseconds too large to hold exactly is also past the range of a date, so the date
  // below is not a time at all and the same refusal covers it.
  const date = new Date(Number(seconds * 1_000n));
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 0 || year > 9999) {
    return formattingPolicyFailure(
      'The instant cannot be represented by the declared four-digit RFC 3339 profile.',
      context,
    );
  }
  const pad = (field: number, width = 2): string =>
    String(field).padStart(width, '0');
  const fractionText =
    fraction === 0n
      ? ''
      : // Bounded to nine characters by padStart, so the quadratic behaviour that made the same
        // pattern costly in normalizeDecimal cannot arise here.
        `.${fraction.toString().padStart(9, '0').replace(/0+$/u, '')}`;
  const text = `${pad(year, 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}${fractionText}Z`;
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      kind: 'formatted-value',
      semantic: 'instant',
      text,
      parts: Object.freeze([{ kind: 'literal' as const, value: text }]),
      locale: context.locale,
      language: 'und',
      direction: 'ltr',
      source: value,
    }),
  });
}

/**
 * The grouping and precision a numeric value is written with.
 *
 * A profile that declares a precision is written to it, so a value carrying more is rounded and
 * the re-read reports it. A profile that declares none reads every fraction digit typed, so the
 * value is written with every one it has: the platform's default precision would round a value the
 * same profile had read. The style's own default is kept as a floor, which is what leaves a whole
 * amount of money showing the places its currency shows.
 */
function numericWritingOptions(
  profile: Extract<
    LocalizedInputProfile,
    {
      readonly kind:
        'decimal' | 'money' | 'measurement' | 'percent' | 'percentage-points';
    }
  >,
  amount: DecimalValue,
  context: FormattingContext,
  style: Intl.NumberFormatOptions,
  shownFurtherLeft = 0,
): { useGrouping: boolean; maximumFractionDigits: number } {
  const useGrouping = profile.allowGrouping ?? false;
  if (profile.maximumFractionDigits !== undefined) {
    return {
      useGrouping,
      maximumFractionDigits: profile.maximumFractionDigits,
    };
  }
  const mark = amount.value.indexOf('.');
  const carried =
    mark < 0 ? 0 : amount.value.length - mark - 1 - shownFurtherLeft;
  let shownByDefault = 0;
  try {
    shownByDefault = inputFormatterCache
      .number(context.locale, style)
      .resolvedOptions().maximumFractionDigits as number;
  } catch {
    // A locale, currency or unit the platform refuses is reported by the formatter this precision
    // is handed to, with the diagnostic that belongs to it.
  }
  return {
    useGrouping,
    maximumFractionDigits: Math.max(carried, shownByDefault),
  };
}

/**
 * Writes an exact value back out in the spelling the same profile would read.
 *
 * The other half of the round trip: what this writes, parsing reads, and what parsing read, this
 * writes. That is what lets a field hold the locale's spelling while the form holds the value.
 *
 * Takes the value, the profile it was parsed under, and the context. Returns the text, or a
 * reported failure when the value does not match the profile it is being written against. A value
 * that is not of the declared shape at all is reported the same way and is never thrown.
 */
export function formatLocalizedInput<Profile extends LocalizedInputProfile>(
  value: LocalizedInputValue<Profile>,
  profile: Profile,
  context: FormattingContext,
): FormattingResult {
  try {
    return writeLocalizedInput(value, profile, context);
  } catch {
    // A value written by hand can lack a member its kind declares or hold something else in its
    // place, and reading it then throws. The caller is owed a result either way.
    return formattingPolicyFailure(
      'The invariant value does not match the declared localized input profile.',
      context,
    );
  }
}

function writeLocalizedInput<Profile extends LocalizedInputProfile>(
  value: LocalizedInputValue<Profile>,
  profile: Profile,
  context: FormattingContext,
): FormattingResult {
  if (
    !valueMatchesProfile(
      value as LocalizedInputValue<LocalizedInputProfile>,
      profile,
    )
  ) {
    return formattingPolicyFailure(
      'The invariant value does not match the declared localized input profile.',
      context,
    );
  }
  const refusal = numberingSystemRefusal(context);
  if (refusal !== undefined) {
    return Object.freeze({
      ok: false,
      diagnostic:
        refusal === 'malformed'
          ? diagnostic(
              'invalid-configuration',
              malformedNumberingSystem,
              context,
            )
          : diagnostic(
              'unsupported-formatting-capability',
              unavailableNumberingSystem,
              context,
              'native-capability-rejected',
            ),
    });
  }
  switch (profile.kind) {
    case 'decimal':
      return verifyFormattedInput(
        formatNumber(
          value as DecimalValue,
          context,
          numericWritingOptions(profile, value as DecimalValue, context, {}),
        ),
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    case 'money':
      return verifyFormattedInput(
        formatMoney(
          value as MoneyValue,
          context,
          numericWritingOptions(
            profile,
            (value as MoneyValue).amount,
            context,
            { style: 'currency', currency: profile.currency },
          ),
        ),
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    case 'measurement':
      return verifyFormattedInput(
        formatMeasurement(
          value as MeasurementValue,
          context,
          numericWritingOptions(
            profile,
            (value as MeasurementValue).amount,
            context,
            { style: 'unit', unit: profile.unit },
          ),
        ),
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    case 'percent':
      return verifyFormattedInput(
        formatPercent(
          value as PercentValue,
          context,
          numericWritingOptions(
            profile,
            (value as PercentValue).amount,
            context,
            { style: 'percent' },
            // The percent style shows a fraction as a hundred times itself, two digits further left.
            profile.scale === 'fractional' ? 2 : 0,
          ),
        ),
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    case 'percentage-points':
      return verifyFormattedInput(
        formatPercentagePoints(
          value as PercentagePointsValue,
          context,
          numericWritingOptions(
            profile,
            (value as PercentagePointsValue).amount,
            context,
            {},
          ),
        ),
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    case 'plain-date': {
      const text = localizedDateText(value as PlainDateValue, profile, context);
      if (text === NO_DIGITS) return formattingLocaleWithoutDigits(context);
      if (text === undefined) {
        return formattingPolicyFailure(
          'The invariant date cannot be represented by the declared localized input profile.',
          context,
        );
      }
      return verifyFormattedInput(
        Object.freeze({
          ok: true,
          value: Object.freeze({
            kind: 'formatted-value',
            semantic: 'plain-date',
            text,
            parts: Object.freeze([{ kind: 'literal' as const, value: text }]),
            locale: context.locale,
            language: context.locale,
            direction: directionForLocale(context.locale),
            source: value,
          }),
        }),
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    }
    case 'plain-time': {
      const text = localizedTimeText(value as PlainTimeValue, profile, context);
      if (text === NO_DIGITS) return formattingLocaleWithoutDigits(context);
      if (text === undefined) {
        return formattingPolicyFailure(
          'The invariant time cannot be represented by the declared localized input profile.',
          context,
        );
      }
      return verifyFormattedInput(
        localizedInputFormatting('plain-time', text, value, context),
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    }
    case 'plain-date-time': {
      const dateTime = value as PlainDateTimeValue;
      const timeText = localizedTimeText(
        dateTime.time,
        dateTimeHalf(profile.time, profile),
        context,
      );
      if (timeText === NO_DIGITS) return formattingLocaleWithoutDigits(context);
      if (timeText === undefined) {
        return formattingPolicyFailure(
          'The invariant date-time cannot be represented by the declared localized input profile.',
          context,
        );
      }
      // The date half has text here: the one thing that leaves it without any is a locale the
      // platform refuses, and the time half has just been written in this one.
      const dateText = localizedDateText(
        dateTime.date,
        profile.date,
        context,
      ) as string;
      const text = `${dateText}${profile.separator}${timeText}`;
      return verifyFormattedInput(
        localizedInputFormatting('plain-date-time', text, value, context),
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    }
    case 'time-zone': {
      const text = localizedTimeZoneText(value as TimeZoneValue, profile);
      if (text === undefined) {
        return formattingPolicyFailure(
          'The invariant time zone is not represented by the declared localized input profile.',
          context,
        );
      }
      return verifyFormattedInput(
        localizedInputFormatting('time-zone', text, value, context),
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    }
    case 'duration': {
      const text = localizedDurationText(
        value as DurationValue,
        profile,
        context,
      );
      if (text === NO_DIGITS) return formattingLocaleWithoutDigits(context);
      if (text === undefined) {
        return formattingPolicyFailure(
          'The invariant duration cannot be represented by the declared localized input profile.',
          context,
        );
      }
      return verifyFormattedInput(
        localizedInputFormatting('duration', text, value, context),
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    }
    case 'instant': {
      const formatted = formatRfc3339(
        value as ReturnType<typeof instant>,
        context,
      );
      return verifyFormattedInput(
        formatted,
        value as LocalizedInputValue<LocalizedInputProfile>,
        profile,
        context,
      );
    }
  }
}
