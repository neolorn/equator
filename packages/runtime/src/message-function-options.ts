/**
 * The option vocabulary of every built-in MessageFormat function, transcribed from LDML 48 Part 9.
 *
 * `specs/01-standards-profile.spec.md` section 8 requires a function's whole option vocabulary
 * rather than its name, and refuses an option that is accepted and never read. This table is the
 * whole vocabulary the compiler and the evaluator read.
 *
 * One table, and it covers every built-in. A compiler that looks a function up here and returns
 * when it is absent accepts every option name and every option value written on the functions that
 * are missing: with `:string`, `:datetime`, `:date` and `:time` absent, thirteen messages compile
 * and throw while rendering, and thirty-seven compile, render, and silently ignore the option the
 * author wrote.
 *
 * The numeric half is why the shape is what it is. One union of seven option names shared by all
 * six numeric functions drops everything else on the floor:
 * `{$price :currency roundingMode=halfEven}` compiles, ships, and rounds the other way, and
 * `trailingZeroDisplay`, `roundingPriority`, `roundingIncrement`, `currencySign` and `:currency`'s
 * `fractionDigits` do nothing at all. None of that is visible in the conformance suite, which
 * writes none of those five names in any of its 461 cases, so the table cannot be read off failing
 * cases. It has to be the specification's own tables, because they are the only place the missing
 * options exist.
 *
 * The six functions do not share an option set. `:integer` has no fraction-digit options,
 * `:percent` has no `roundingIncrement` and no `minimumIntegerDigits`, `:unit` has no
 * `trailingZeroDisplay`, `:currency` fixes its fraction digits with a single `fractionDigits`
 * option rather than a minimum and a maximum, and `:offset` has nothing but `add` and `subtract`.
 * A union cannot express that, which is why each function names what it accepts.
 *
 * What they do share is the *meaning* of an option they both have: `roundingMode` is the same nine
 * values wherever it appears. So the rules live in one registry keyed by option name and each
 * function lists the names it takes, which gives a shared option one definition.
 *
 * **This file exists twice, byte for byte**, at `packages/toolkit/src/message-function-options.ts`
 * and `packages/runtime/src/message-function-options.ts`. The two packages cannot import from each other (the
 * toolkit is a build-time tool that carries `ajv`, `yaml` and `messageformat`, and none of that
 * belongs in a browser bundle) but the compiler and the evaluator have to agree about every
 * option, because the compiler's job is to refuse what the evaluator could not honour. So the file
 * is duplicated and `packages/runtime/test/message-function-options.test.ts` compares the two
 * sources character for character, so the two cannot drift.
 */

/**
 * A digit size option, and why the bounds are not ECMA-402's copied into a second table.
 *
 * The specification fixes the *syntax*: `digit-size-option = "0" / (("1"-"9") [DIGIT])`, so a
 * string representation is `0` through `99` and nothing else. `042`, `+1` and `100` are all Bad
 * Option. It then leaves the *range* to the implementation: *"Implementations MAY define upper and
 * lower limits on the resolved value of a digit size option consistent with that implementation's
 * practical limits."*
 *
 * Equator's practical limits are `Intl.NumberFormat`'s, because that is what receives the value.
 * They are declared here rather than discovered at each call site so a diagnostic can name the
 * range, and `packages/runtime/test/message-function-options.test.ts` probes `Intl` to confirm each
 * bound is where this table says it is. A limit nothing measures is a guess with a comment on it.
 */
export interface DigitSizeRule {
  readonly kind: 'digit-size';
  readonly minimum: number;
  readonly maximum: number;
  /** `:currency`'s `fractionDigits`, whose other value is the literal `auto`. */
  readonly auto?: true;
  /** `:currency` states its fraction digits once and fixes both ends of the range with it. */
  readonly writes?: readonly string[];
}

export interface EnumeratedRule {
  readonly kind: 'enumerated';
  readonly values: readonly string[];
  /**
   * Values the specification requires and Equator has no way to produce. Refused by name rather
   * than ignored: `currencyDisplay=never` asks for the amount without its currency, and silently
   * printing the currency anyway is a money bug with no diagnostic attached to it.
   */
  readonly unsupported?: readonly string[];
  /** The value `Intl` spells as `false`, and throws on when it is given as a string. */
  readonly asFalse?: string;
}

/** A code or identifier whose vocabulary is CLDR data rather than a closed list. */
export interface IdentifierRule {
  readonly kind: 'identifier';
  readonly pattern: RegExp;
  readonly describes: string;
}

/**
 * An option the specification types as a boolean, written in a message as text.
 *
 * `hour12` is the only one. It is not an enumerated rule with two values, because the value that
 * reaches `Intl` is a boolean and the string `"false"` is truthy: passing it through unconverted
 * gives a twelve-hour clock to an author who wrote `hour12=false`, with nothing to say so.
 */
export interface BooleanRule {
  readonly kind: 'boolean';
}

/**
 * An option whose valid values are a body of data rather than a rule.
 *
 * `timeZone` is the one, and the data is the time-zone database the release pins. A message is
 * judged against that table where it is compiled, so every machine gives it the same answer; the
 * table is the compiler's to carry and this file gives no verdict. A value that arrives where a
 * message is rendered, through a variable, is built into the formatter, and a zone the host has
 * no rules for is reported there. `alternatives` names the values that are never a zone's name
 * because the specification gives them a meaning of their own.
 */
export interface ConstructedRule {
  readonly kind: 'constructed';
  readonly describes: string;
  readonly alternatives?: readonly string[];
}

/** An option the specification defines and Equator cannot implement at all. */
export interface UnsupportedRule {
  readonly kind: 'unsupported';
  readonly reason: string;
}

export type MessageOptionRule =
  | BooleanRule
  | ConstructedRule
  | DigitSizeRule
  | EnumeratedRule
  | IdentifierRule
  | UnsupportedRule;

/**
 * How the type of a Unicode locale keyword is written: the name of a calendar, of a numbering
 * system, of a collation.
 *
 * UTS #35 Part 1 writes it as one or more subtags of three to eight ASCII letters and digits
 * joined by hyphens, in lower case in its canonical form. Whether a name is one is decided by this
 * and never by the host, so a message compiles to the same answer on every machine and a value is
 * the same value in every engine. Whether the host has the calendar or the digits a well-formed
 * name asks for is a separate question, answered where something is formatted with it.
 */
export const UNICODE_KEYWORD_TYPE = /^[a-z0-9]{3,8}(?:-[a-z0-9]{3,8})*$/u;

export function isUnicodeKeywordType(value: unknown): value is string {
  return typeof value === 'string' && UNICODE_KEYWORD_TYPE.test(value);
}

const digits = (minimum: number, maximum: number): DigitSizeRule =>
  Object.freeze({ kind: 'digit-size', minimum, maximum });

const oneOf = (
  values: readonly string[],
  extra: Omit<EnumeratedRule, 'kind' | 'values'> = {},
): EnumeratedRule =>
  Object.freeze({
    kind: 'enumerated',
    values: Object.freeze([...values]),
    ...extra,
  });

/**
 * Every option the specification defines for a built-in function, and what a valid value of it is.
 *
 * Keyed by name rather than by function because an option means the same thing wherever it is
 * accepted. Which function accepts which name is `MESSAGE_FUNCTION_OPTIONS` below. The date
 * family spells four of its options twice (`:date` writes `fields` and `length` where
 * `:datetime` writes `dateFields` and `dateLength`, and `:time` writes `precision` where
 * `:datetime` writes `timePrecision`) so the value sets are named once and referenced by both
 * spellings rather than typed out twice.
 */
const DATE_FIELDS_VALUES: readonly string[] = Object.freeze([
  'weekday',
  'day-weekday',
  'month-day',
  'month-day-weekday',
  'year-month-day',
  'year-month-day-weekday',
]);
const DATE_LENGTH_VALUES: readonly string[] = Object.freeze([
  'long',
  'medium',
  'short',
]);
const TIME_PRECISION_VALUES: readonly string[] = Object.freeze([
  'hour',
  'minute',
  'second',
]);

export const MESSAGE_OPTION_RULES: Readonly<Record<string, MessageOptionRule>> =
  Object.freeze({
    /**
     * *"If the implementation does not recognize the value of the `select` option, or if the value
     * is not a literal, a Bad Option error is emitted."* The default when absent is `plural`.
     *
     * Equator rejects rather than ignores, and at compile time rather than at format time, because
     * the value decides which CLDR table a target catalog's plural coverage is checked against. An
     * unrecognized value falling through to the cardinal table would let an ordinal message missing
     * `two` and `few` pass a completeness gate while shipping "2th" and "3th".
     *
     * `cardinal` is deliberately not here. It is what `Intl.PluralRules` calls this value and what
     * `messageformat@4.0.0` declares in its types, but the specification spells it `plural`; taking
     * both would put two spellings of one thing into catalogs that are meant to be portable.
     */
    select: oneOf(['plural', 'ordinal', 'exact']),
    signDisplay: oneOf(['auto', 'always', 'exceptZero', 'negative', 'never']),
    useGrouping: oneOf(['auto', 'always', 'never', 'min2'], {
      asFalse: 'never',
    }),
    // The ABNF's ceiling is 99 and `Intl.NumberFormat` accepts 0..100 for fraction digits and 1..21
    // for integer and significant digits. The narrower of the two is what a value has to satisfy to
    // be both a MessageFormat digit size option and a number this runtime can format.
    minimumIntegerDigits: digits(1, 21),
    minimumFractionDigits: digits(0, 99),
    maximumFractionDigits: digits(0, 99),
    minimumSignificantDigits: digits(1, 21),
    maximumSignificantDigits: digits(1, 21),
    trailingZeroDisplay: oneOf(['auto', 'stripIfInteger']),
    roundingPriority: oneOf(['auto', 'morePrecision', 'lessPrecision']),
    /**
     * Spelled out rather than computed, because the specification spells it out and the set is not
     * a rule: it is the increments CLDR data supports. `Intl.NumberFormat` accepts exactly these
     * fifteen and no others, which `message-function-options.test.ts` checks rather than assumes.
     */
    roundingIncrement: oneOf([
      '1',
      '2',
      '5',
      '10',
      '20',
      '25',
      '50',
      '100',
      '200',
      '250',
      '500',
      '1000',
      '2000',
      '2500',
      '5000',
    ]),
    roundingMode: oneOf([
      'ceil',
      'floor',
      'expand',
      'trunc',
      'halfCeil',
      'halfFloor',
      'halfExpand',
      'halfTrunc',
      'halfEven',
    ]),
    add: digits(0, 99),
    subtract: digits(0, 99),
    /**
     * A Unicode Currency Identifier is three ASCII letters (UTS #35). Case is not folded, although
     * `Intl` would fold it: `money` takes a code only in capitals, so a currency a message names is
     * spelled the one way a money value spells it.
     */
    currency: Object.freeze({
      kind: 'identifier',
      pattern: /^[A-Z]{3}$/u,
      describes: 'a three-letter Unicode Currency Identifier such as EUR',
    } as const),
    currencySign: oneOf(['accounting', 'standard']),
    currencyDisplay: oneOf(
      ['narrowSymbol', 'symbol', 'name', 'code', 'never'],
      {
        unsupported: Object.freeze(['never']),
      },
    ),
    /**
     * *"unlike number/integer formats, the fraction digits for currency formatting are fixed"*: one
     * option, not a minimum and a maximum, and `auto` means the digits the currency itself uses.
     * Equator passed `minimumFractionDigits` and `maximumFractionDigits` to `:currency` and ignored
     * `fractionDigits`, so it accepted the two names the specification does not give this function
     * and dropped the one it does.
     */
    fractionDigits: Object.freeze({
      kind: 'digit-size',
      minimum: 0,
      maximum: 99,
      auto: true,
      writes: Object.freeze(['minimumFractionDigits', 'maximumFractionDigits']),
    } as const),
    /**
     * A CLDR unit identifier, in the "core" form `Intl` takes: lower-case segments joined by `-`,
     * with an optional `per-` compound. The `measure-unit/` prefixed long form is not accepted:
     * `Intl` refuses it.
     */
    unit: Object.freeze({
      kind: 'identifier',
      pattern: /^[a-z]+(?:-[a-z0-9]+)*(?:-per-[a-z]+(?:-[a-z0-9]+)*)?$/u,
      describes: 'a CLDR unit identifier such as meter or mile-per-hour',
    } as const),
    unitDisplay: oneOf(['short', 'narrow', 'long']),
    /**
     * `usage` asks for conversion into the locale's preferred unit: kilometres to miles, and the
     * rounding that goes with it. `Intl.NumberFormat` does not convert; it accepts the option and
     * silently ignores it, which is the worst of the three possible outcomes, because a message
     * asking for road distances would print metres to an American reader with nothing to say so.
     *
     * The specification anticipates exactly this: implementing `usage` is optional, and
     * *"Implementations SHOULD emit an Unsupported Operation error if the requested conversion is
     * not supported."* Equator supports none of them, so it says so at compile time instead.
     */
    usage: Object.freeze({
      kind: 'unsupported',
      reason:
        'unit conversion is not implemented; this runtime formats the value it is given, in the unit it is given',
    } as const),
    /**
     * The date family, from "Date and Time Value Formatting".
     *
     * `fields` names the parts of a date to show and `length` how much of each to spell out; the
     * two decide the `Intl.DateTimeFormat` component options together rather than one at a time,
     * which is why `dateTimeFormatOptions` reads them as a pair.
     */
    fields: oneOf(DATE_FIELDS_VALUES),
    dateFields: oneOf(DATE_FIELDS_VALUES),
    length: oneOf(DATE_LENGTH_VALUES),
    dateLength: oneOf(DATE_LENGTH_VALUES),
    precision: oneOf(TIME_PRECISION_VALUES),
    timePrecision: oneOf(TIME_PRECISION_VALUES),
    /** `Intl` spells this `timeZoneName`, and omits the indicator entirely when it is absent. */
    timeZoneStyle: oneOf(['long', 'short']),
    /**
     * *"The default value for `timeZone` is the default time zone provided by the formatting
     * context"*, and `input` is *"the time zone of the operand"*.
     *
     * `input` never reaches `Intl`. It is resolved against the operand's own resolved options, and
     * a chain that supplies none is refused where it is written rather than reported while
     * rendering: the specification's Bad Operand for this case is a render-time error beside a
     * rendered fallback, which `specs/04-message-authoring-and-catalogs.spec.md` section 6 declines
     * by name.
     */
    timeZone: Object.freeze({
      kind: 'constructed',
      describes: 'a time zone identifier such as UTC or Europe/Paris',
      alternatives: Object.freeze(['input']),
    } as const),
    /**
     * A name and not a list. Which calendars exist is the host's data, and a list read from the
     * machine that compiles would refuse on one machine what another accepts. A well-formed name
     * the rendering host does not count in is reported where the date is formatted.
     */
    calendar: Object.freeze({
      kind: 'identifier',
      pattern: UNICODE_KEYWORD_TYPE,
      describes:
        'a calendar name such as gregory or islamic-civil, written in lower case',
    } as const),
    hour12: Object.freeze({ kind: 'boolean' } as const),
  });

/**
 * Options a numeric function consumes itself. They belong to a resolved value and never reach
 * `Intl.NumberFormat`, which has no idea what any of them mean.
 */
const NOT_FORMATTING: readonly string[] = Object.freeze([
  'select',
  'add',
  'subtract',
  'usage',
]);

/**
 * What a message function requires its operand to be.
 *
 * Three of the five belong to the built-in profile; an extension declares any of the five, because
 * its descriptor's operand type is drawn from the same portable set an input contract is. The union
 * is the wider one so that one profile shape describes a built-in and an extension alike.
 */
export type MessageOperandKind =
  'boolean' | 'date-time' | 'integer' | 'number' | 'string';

export interface MessageFunctionOptionProfile {
  readonly operand: MessageOperandKind;
  /** Every option the specification requires this function to accept, and nothing else. */
  readonly accepts: readonly string[];
  /**
   * Options thrown away when they arrive from the operand rather than being written on the
   * expression. The specification names these per function and the lists are not the same.
   */
  readonly discardedFromOperand: readonly string[];
  /**
   * The only options this function inherits at all, where the specification states inheritance as
   * an allow-list rather than as a deny-list.
   *
   * The two families genuinely differ and neither rule can be written as the other. A numeric
   * function inherits everything except what it names, which is why *"`.local $x = {41 :integer
   * signDisplay=always}`"* followed by `{$x :offset add=1}` prints `+42` although `:offset` has no
   * `signDisplay`. A date function inherits only the *date/time override options*: *"Any operand
   * options not matching the date/time override options are ignored."*
   */
  readonly inheritsOnly?: readonly string[];
  /**
   * Options whose value the specification requires to be written as a literal, so a variable in
   * their place is refused rather than resolved at render.
   *
   * *"The `fields` and `length` option values MUST each be set by a literal"*, and the same
   * sentence appears for `:datetime` and `:time`: everything except the date/time override
   * options. The numeric family names one, `select`, and for the reason Equator cares about it: a
   * value that arrives at render time cannot be measured against a plural table at build time.
   */
  readonly literalOnly: readonly string[];
  /**
   * Options this function's own resolved value does not carry forward. Distinct from
   * `discardedFromOperand`, which is about what arrives rather than what leaves.
   */
  readonly excludedFromResolved: readonly string[];
}

const NONE: readonly string[] = Object.freeze([]);
const SELECT_ONLY: readonly string[] = Object.freeze(['select']);

/**
 * The profile of a registered extension, from what its descriptor declares.
 *
 * An extension is a message function, so it has a profile like any other, built here from its
 * descriptor. A registered function's name and whether it selects are not enough to say what its
 * resolved value carries, and treating an extension declaration as carrying nothing, while the
 * runtime carries the whole resolved mapping forward, has two consequences, both measured:
 *
 *   * `.local $x = {$v :ext:thing minimumFractionDigits=4}` followed by
 *     `{$x :number maximumFractionDigits=2}` **compiles** and throws at render, where the identical
 *     message with `:number` in the declaration is refused at compile with both options named;
 *   * `.local $t = {$d :ext:zoned timeZone=|Asia/Tokyo|}` followed by `{$t :date timeZone=input}`
 *     is **refused** at compile although the runtime renders it correctly, which is a valid message
 *     rejected. The cost section 8 accepts for refusing, spent on nothing.
 *
 * The inheritance rule is the numeric one rather than the date one, and that is not a default: it
 * is what the runtime does. An extension's resolved value carries everything its operand carried
 * with its own options over the top, discarding nothing, and the descriptor narrows only what the
 * function is *called* with. So the profile discards nothing and excludes nothing, and `accepts`
 * is the descriptor's own option list.
 */
export function extensionOptionProfile(
  operand: MessageOperandKind,
  accepts: readonly string[],
): MessageFunctionOptionProfile {
  return Object.freeze({
    operand,
    accepts: Object.freeze([...accepts]),
    discardedFromOperand: NONE,
    literalOnly: NONE,
    excludedFromResolved: NONE,
  });
}

const profileOf = (
  accepts: readonly string[],
  discardedFromOperand: readonly string[] = NONE,
  excludedFromResolved: readonly string[] = NONE,
): MessageFunctionOptionProfile =>
  Object.freeze({
    operand: 'number',
    accepts: Object.freeze([...accepts]),
    discardedFromOperand,
    literalOnly: accepts.includes('select') ? SELECT_ONLY : NONE,
    excludedFromResolved,
  });

/**
 * *"Date/time override options are options that allow an expression to override values set by the
 * current locale, or provided by the formatting context."* They are the only ones a date function
 * takes from its operand, and `hour12` is not among `:date`'s, because `:date` does not have one.
 */
const DATE_OVERRIDES: readonly string[] = Object.freeze([
  'timeZone',
  'calendar',
]);
const DATE_TIME_OVERRIDES: readonly string[] = Object.freeze([
  'timeZone',
  'calendar',
  'hour12',
]);

const dateProfileOf = (
  accepts: readonly string[],
  inheritsOnly: readonly string[],
): MessageFunctionOptionProfile =>
  Object.freeze({
    operand: 'date-time',
    accepts: Object.freeze([...accepts]),
    discardedFromOperand: NONE,
    inheritsOnly,
    literalOnly: Object.freeze(
      accepts.filter((name) => !inheritsOnly.includes(name)),
    ),
    excludedFromResolved: NONE,
  });

const DIGIT_OPTIONS = [
  'minimumIntegerDigits',
  'minimumFractionDigits',
  'maximumFractionDigits',
  'minimumSignificantDigits',
  'maximumSignificantDigits',
] as const;

/**
 * Every built-in function and the options it accepts.
 *
 * A function absent from this table is not a function with no options; it is a function whose
 * options nothing reads. The table covers all ten, and `:string` is present with an empty list
 * rather than left out: *"The function `:string` has no options."*
 */
export const MESSAGE_FUNCTION_OPTIONS: Readonly<
  Record<string, MessageFunctionOptionProfile>
> = Object.freeze({
  number: profileOf([
    'select',
    'signDisplay',
    'useGrouping',
    ...DIGIT_OPTIONS,
    'trailingZeroDisplay',
    'roundingPriority',
    'roundingIncrement',
    'roundingMode',
  ]),
  integer: profileOf(
    [
      'select',
      'signDisplay',
      'useGrouping',
      'minimumIntegerDigits',
      'maximumSignificantDigits',
    ],
    /**
     * *"Options with the following names are however discarded if included in the operand."*
     * `:integer` pins `maximumFractionDigits` to 0, so a `minimumFractionDigits` of 2 arriving by
     * inheritance asks `Intl` for a range whose minimum is above its maximum, and it throws while
     * rendering. Written on the expression they are the author's own contradiction to own; arriving
     * from an operand they are nobody's.
     */
    Object.freeze([
      'minimumFractionDigits',
      'maximumFractionDigits',
      'minimumSignificantDigits',
    ]),
  ),
  offset: profileOf(
    ['add', 'subtract'],
    NONE,
    /**
     * *"The `:offset` options are not included in the resolved option values."* They say what was
     * done to the number, and the number they were done to is the resolved value, so carrying them
     * forward would offset again: arithmetic nobody wrote.
     */
    Object.freeze(['add', 'subtract']),
  ),
  currency: profileOf([
    'currency',
    'currencySign',
    'currencyDisplay',
    'useGrouping',
    'minimumIntegerDigits',
    'fractionDigits',
    'minimumSignificantDigits',
    'maximumSignificantDigits',
    'trailingZeroDisplay',
    'roundingPriority',
    'roundingIncrement',
    'roundingMode',
  ]),
  percent: profileOf(
    [
      'signDisplay',
      'useGrouping',
      'minimumFractionDigits',
      'maximumFractionDigits',
      'minimumSignificantDigits',
      'maximumSignificantDigits',
      'trailingZeroDisplay',
      'roundingPriority',
      'roundingMode',
    ],
    /**
     * `:percent` has no `select`, no `minimumIntegerDigits` and no `roundingIncrement` of its own,
     * and the specification says all three are discarded when they arrive from an operand. So
     * `.local $n = {1 :number select=exact}` followed by `{$n :percent}` is a valid message: the
     * option is dropped, not reported. Equator refused it, which is a message rejected for
     * conforming.
     */
    Object.freeze(['minimumIntegerDigits', 'roundingIncrement', 'select']),
  ),
  unit: profileOf([
    'unit',
    'usage',
    'unitDisplay',
    'signDisplay',
    'useGrouping',
    ...DIGIT_OPTIONS,
    'roundingPriority',
    'roundingIncrement',
    'roundingMode',
  ]),
  datetime: dateProfileOf(
    [
      'dateFields',
      'dateLength',
      'timePrecision',
      'timeZoneStyle',
      ...DATE_TIME_OVERRIDES,
    ],
    DATE_TIME_OVERRIDES,
  ),
  date: dateProfileOf(['fields', 'length', ...DATE_OVERRIDES], DATE_OVERRIDES),
  time: dateProfileOf(
    ['precision', 'timeZoneStyle', ...DATE_TIME_OVERRIDES],
    DATE_TIME_OVERRIDES,
  ),
  /**
   * *"The function `:string` has no options."* An empty list is a statement, and it is the one that
   * makes `{$s :string nosuchoption=x}` a refusal instead of a message that renders as though the
   * option had not been written. `u:` options are removed before any of this is consulted.
   */
  string: Object.freeze({
    operand: 'string',
    accepts: NONE,
    discardedFromOperand: NONE,
    inheritsOnly: NONE,
    literalOnly: NONE,
    excludedFromResolved: NONE,
  }),
});

/**
 * The functions whose operand MessageFormat calls a Number Operand.
 *
 * Derived from the table rather than kept beside it, for the reason the plural selector set is:
 * a hand-kept second list is the drift a single table exists to remove.
 */
export const NUMERIC_FUNCTIONS: readonly string[] = Object.freeze(
  Object.entries(MESSAGE_FUNCTION_OPTIONS)
    .filter(([, profile]) => profile.operand === 'number')
    .map(([name]) => name)
    .sort(),
);

/**
 * The options one expression is formatted with, once its operand has had its say.
 *
 * One implementation, called by the compiler and by the evaluator, because the compiler's job is to
 * refuse what the evaluator could not honour and two merges that had to agree eventually would not.
 */
export function inheritedOptions<T>(
  carried: Readonly<Record<string, T>> | undefined,
  written: Readonly<Record<string, T>>,
  profile: MessageFunctionOptionProfile | undefined,
): Readonly<Record<string, T>> {
  if (carried === undefined || profile === undefined) return written;
  const kept = Object.entries(carried).filter(([name]) =>
    profile.inheritsOnly === undefined
      ? !profile.discardedFromOperand.includes(name)
      : profile.inheritsOnly.includes(name),
  );
  return Object.freeze({ ...Object.fromEntries(kept), ...written });
}

/** `digit-size-option = "0" / (("1"-"9") [DIGIT])`, transcribed rather than approximated. */
const DIGIT_SIZE_OPTION = /^(?:0|[1-9][0-9]?)$/u;

/** Every option name some numeric function accepts, derived so it cannot fall behind the table. */
const NUMERIC_OPTION_NAMES: ReadonlySet<string> = Object.freeze(
  new Set(
    Object.values(MESSAGE_FUNCTION_OPTIONS)
      .filter((profile) => profile.operand === 'number')
      .flatMap((profile) => [...profile.accepts]),
  ),
) as ReadonlySet<string>;

/**
 * What is wrong with one option written on one built-in function, or `undefined` if nothing is.
 *
 * The wording is returned rather than a code, because both callers put it in the same sentence and
 * a reader who has just written `roundingMode=nearest` needs the nine values, not a lookup.
 *
 * A `constructed` option gets no verdict here on purpose. Its vocabulary is a body of data rather
 * than a rule, and the compiler holds the table that answers for it.
 */
export function messageOptionProblem(
  functionName: string,
  optionName: string,
  value: string,
): string | undefined {
  const profile = MESSAGE_FUNCTION_OPTIONS[functionName];
  if (profile === undefined) return undefined;
  if (!profile.accepts.includes(optionName)) {
    return profile.accepts.length === 0
      ? `is not an option of :${functionName}, which the specification gives none`
      : `is not an option of :${functionName}; it takes ` +
          `${[...profile.accepts].sort().join(', ')}`;
  }
  const rule = MESSAGE_OPTION_RULES[optionName];
  if (rule === undefined) return undefined;
  switch (rule.kind) {
    case 'constructed':
      return undefined;
    case 'boolean':
      return value === 'true' || value === 'false'
        ? undefined
        : 'is not true or false';
    case 'unsupported':
      return `is outside the Equator 1 profile: ${rule.reason}`;
    case 'identifier':
      return rule.pattern.test(value) ? undefined : `is not ${rule.describes}`;
    case 'enumerated':
      if (!rule.values.includes(value)) {
        return `is not one of ${rule.values.join(', ')}`;
      }
      return rule.unsupported?.includes(value) === true
        ? 'is in the specification but not in the Equator 1 profile: this runtime has no way to produce it'
        : undefined;
    case 'digit-size': {
      if (rule.auto === true && value === 'auto') return undefined;
      if (!DIGIT_SIZE_OPTION.test(value)) {
        return (
          'is not a digit size option' +
          (rule.auto === true ? ' and is not auto' : '') +
          '; the value must be written as 0 to 99 with no leading zero or sign'
        );
      }
      const size = Number(value);
      return size >= rule.minimum && size <= rule.maximum
        ? undefined
        : `is outside the range this runtime can format, which is ${rule.minimum} to ${rule.maximum}`;
    }
  }
}

/**
 * The `Intl.NumberFormat` options a numeric expression's resolved options amount to.
 *
 * Every option in the resolved set is applied, not only the ones the annotating function accepts.
 * The specification's own `:offset` example depends on that: `.local $x = {41 :integer
 * signDisplay=always}` followed by `{$x :offset add=1}` prints `+42`, and `:offset` has no
 * `signDisplay` option of its own. An operand's options are *"included in the resolved option
 * values of the expression"*, and the resolved options are what a value is formatted with, so
 * restricting formatting to what the function accepts would silently drop the annotation the author
 * wrote one line up.
 *
 * What a function accepts governs what may be *written* on it and the discard lists govern what
 * survives inheritance; by the time options reach here both questions have been answered.
 *
 * Shared with the compiler so it judges exactly the options the evaluator will build the formatter
 * with, and refuses at compile time what would otherwise throw at render. That matters most for
 * `roundingIncrement`, whose validity is not a property of its value at all: it depends on the
 * fraction digits the whole set resolves to, so `{42 :number roundingIncrement=5
 * maximumSignificantDigits=2}` is a legal MessageFormat expression that ECMA-402 refuses. The
 * compiler holds the set to the pinned edition's rules, transcribed in
 * `packages/toolkit/src/number-format-rules.ts` rather than here, because the evaluator has no use
 * for them: it builds the formatter, and the host answers for an option set no compiler saw.
 *
 * Every value is expected to have been through `numberOptionProblem` already, which is why
 * there is no second check here. One authority on what a valid option is, called before this.
 */
/**
 * A date expression's resolved options, with `timeZone=input` answered.
 *
 * *"The value `input` corresponds to the time zone of the operand."* An Equator date input is a
 * `Date`, which carries no zone, so the only operand that can answer is one whose own declaration
 * wrote a zone: `.local $t = {$when :datetime timeZone=|Europe/Paris|}` and then
 * `{$t :time timeZone=input}`. When nothing in the chain wrote one, `input` is left in place and
 * the caller refuses: the specification's answer here is a Bad Operand error beside a rendered
 * fallback, and `specs/04-message-authoring-and-catalogs.spec.md` section 6 declines that in favour
 * of refusing where it is written.
 *
 * One implementation for the compiler and the evaluator, because the compiler decides whether a
 * message may ship on exactly the question the evaluator will ask.
 */
export function resolvedDateOptions(
  carried: Readonly<Record<string, string>> | undefined,
  written: Readonly<Record<string, string>>,
  profile: MessageFunctionOptionProfile | undefined,
): Readonly<Record<string, string>> {
  const merged = inheritedOptions(carried, written, profile);
  if (merged['timeZone'] !== 'input') return merged;
  const operandZone = carried?.['timeZone'];
  return operandZone === undefined || operandZone === 'input'
    ? merged
    : Object.freeze({ ...merged, timeZone: operandZone });
}

/**
 * The `Intl.DateTimeFormat` options a date expression's resolved options amount to.
 *
 * This is the whole of what `fields`, `length`, `precision` and `timeZoneStyle` mean: the
 * specification defines them as names for combinations of the platform's component options, and
 * nowhere else. Written once and called by the compiler and the evaluator, so that "the compiler
 * constructs the formatter the evaluator will construct" is a fact about one function rather than
 * an agreement between two.
 *
 * `fields` and `length` are read as a pair because they decide one thing together: the fields say
 * which components appear and the length says how much of each is spelled out, so `month` is
 * `long`, `numeric` or `short` depending on both. Absent, the fields default to `year-month-day`,
 * which the specification names as the default.
 *
 * `timeZone=input` never arrives here. It names the operand's own zone rather than a zone, and is
 * resolved against the operand before any formatter is built.
 */
export function dateTimeFormatOptions(
  functionName: string,
  resolved: Readonly<Record<string, string>>,
): Intl.DateTimeFormatOptions {
  const options: Record<string, unknown> = {};
  const calendar = resolved['calendar'];
  if (calendar !== undefined) options['calendar'] = calendar;
  const zone = resolved['timeZone'];
  if (zone !== undefined && zone !== 'input') options['timeZone'] = zone;
  if (functionName !== 'time') {
    const fields = new Set(
      (
        resolved[functionName === 'date' ? 'fields' : 'dateFields'] ??
        'year-month-day'
      ).split('-'),
    );
    const length = resolved[functionName === 'date' ? 'length' : 'dateLength'];
    if (fields.has('year')) options['year'] = 'numeric';
    if (fields.has('month')) {
      options['month'] =
        length === 'long' ? 'long' : length === 'short' ? 'numeric' : 'short';
    }
    if (fields.has('day')) options['day'] = 'numeric';
    if (fields.has('weekday')) {
      options['weekday'] = length === 'long' ? 'long' : 'short';
    }
  }
  if (functionName !== 'date') {
    const hour12 = resolved['hour12'];
    // The string, converted. `"false"` is truthy, so passing it through would give a twelve-hour
    // clock to an author who wrote `hour12=false` and say nothing about it.
    if (hour12 !== undefined) options['hour12'] = hour12 === 'true';
    switch (resolved[functionName === 'time' ? 'precision' : 'timePrecision']) {
      case 'hour':
        options['hour'] = 'numeric';
        break;
      case 'second':
        options['hour'] = 'numeric';
        options['minute'] = 'numeric';
        options['second'] = 'numeric';
        break;
      default:
        options['hour'] = 'numeric';
        options['minute'] = 'numeric';
    }
    const style = resolved['timeZoneStyle'];
    if (style !== undefined) options['timeZoneName'] = style;
  }
  return options as Intl.DateTimeFormatOptions;
}

export function numberFormatOptions(
  functionName: string,
  resolved: Readonly<Record<string, string>>,
): Intl.NumberFormatOptions {
  const formatting: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(resolved)) {
    if (NOT_FORMATTING.includes(name)) continue;
    // One table holds both families, so a name from the other one has to be skipped here rather
    // than handed to `Intl.NumberFormat`, which throws on it. A compiled message cannot produce
    // that, the compiler refuses a date-annotated operand under a numeric function, but this
    // function is also reached from a compiled artifact this runtime did not compile.
    if (!NUMERIC_OPTION_NAMES.has(name)) continue;
    const rule = MESSAGE_OPTION_RULES[name];
    if (rule === undefined) continue;
    if (rule.kind === 'digit-size') {
      if (rule.auto === true && value === 'auto') continue;
      for (const target of rule.writes ?? [name]) {
        formatting[target] = Number(value);
      }
      continue;
    }
    if (rule.kind === 'enumerated' && rule.asFalse === value) {
      formatting[name] = false;
      continue;
    }
    formatting[name] = value;
  }
  switch (functionName) {
    case 'currency':
      formatting['style'] = 'currency';
      break;
    case 'percent':
      formatting['style'] = 'percent';
      break;
    case 'unit':
      formatting['style'] = 'unit';
      break;
    case 'integer':
      formatting['style'] = 'decimal';
      formatting['maximumFractionDigits'] = 0;
      break;
    default:
      formatting['style'] = 'decimal';
  }
  return formatting as Intl.NumberFormatOptions;
}
