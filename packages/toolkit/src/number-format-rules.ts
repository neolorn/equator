/**
 * Whether `new Intl.NumberFormat(locale, options)` accepts a set of options, decided by the rules of
 * the ECMA-402 edition `standards/sources.lock.json` pins and never by the machine that compiles.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 6 requires it: a message has one answer
 * on every machine that compiles it. Whether `roundingIncrement` may stand beside the fraction digits
 * an expression resolves to, and whether a `unit` is one ECMAScript sanctions, are rules the edition
 * states, so they are transcribed here step for step and cited by section, and the two bodies of
 * data the rules read are generated from pinned sources: the sanctioned units from the edition's own
 * Table 2 (`sanctioned-units.generated.ts`), and the currency fraction digits ECMA-402 leaves to the
 * implementation from the pinned CLDR release (`currency-digits.generated.ts`).
 *
 * Every step that can throw is here, in the order the edition runs them, including the ones a
 * compiled message cannot reach (`localeMatcher`, `numberingSystem`, `notation`, `compactDisplay`
 * and a `style` of its own). A partial transcription would answer correctly only for the options a
 * caller happens to pass today, and the options are assembled by a function the runtime shares.
 *
 * Locale resolution is left out. It reads the locale list, not the options, and the options it does
 * read are the two named above, which are judged here.
 *
 * `numberFormatRefusal` is the edition and nothing else. What the edition accepts and V8 refuses is
 * answered separately, by `unsupportedNumberFormatCombination`, so the transcription can be held to
 * the text and the declaration to the engine.
 */
import { CURRENCY_DIGITS } from './currency-digits.generated.js';
import { SANCTIONED_SINGLE_UNITS } from './sanctioned-units.generated.js';

/** The edition the rules below are transcribed from, as the lock names it. */
export const NUMBER_FORMAT_RULES_EDITION = 'ECMA-402 13th edition, June 2026';

/**
 * Why a set of options is refused: the section and step of the edition that throws, and the
 * exception it throws.
 */
export interface NumberFormatRefusal {
  readonly step: string;
  readonly exception: 'RangeError' | 'TypeError';
}

/** An ECMAScript value an options object can hold under a name these rules read. */
export type NumberFormatOptionValue = string | number | boolean | undefined;

class Refused extends Error {
  constructor(readonly refusal: NumberFormatRefusal) {
    super(refusal.step);
  }
}

const refuse = (
  step: string,
  exception: NumberFormatRefusal['exception'] = 'RangeError',
): never => {
  throw new Refused({ step, exception });
};

const SANCTIONED: ReadonlySet<string> = new Set(SANCTIONED_SINGLE_UNITS);

/** ECMA-262 ToString over the primitives an options object holds here. */
const toString = (value: string | number | boolean): string => String(value);

/** ECMA-262 ToNumber over the same primitives. `Number` is ToNumber for every one of them. */
const toNumber = (value: string | number | boolean): number => Number(value);

/** 9.2.11 GetOption, for type string. */
function getOption(
  options: Readonly<Record<string, NumberFormatOptionValue>>,
  property: string,
  values: readonly string[] | undefined,
  fallback: string | undefined,
  step: string,
): string | undefined {
  const value = options[property];
  if (value === undefined) return fallback;
  const text = toString(value);
  if (values !== undefined && !values.includes(text))
    refuse(`${step}, 9.2.11 step 5`);
  return text;
}

/** 9.2.13 DefaultNumberOption. */
function defaultNumberOption(
  value: NumberFormatOptionValue,
  minimum: number,
  maximum: number,
  fallback: number | undefined,
  step: string,
): number | undefined {
  if (value === undefined) return fallback;
  const number = toNumber(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    refuse(`${step}, 9.2.13 step 3`);
  }
  return Math.floor(number);
}

/** 6.3.1 IsWellFormedCurrencyCode. */
function isWellFormedCurrencyCode(currency: string): boolean {
  if (currency.length !== 3) return false;
  return /^[A-Z]{3}$/u.test(asciiUppercase(currency));
}

const asciiUppercase = (value: string): string =>
  value.replace(/[a-z]/gu, (letter) => letter.toUpperCase());

/** 6.6.2 IsSanctionedSingleUnitIdentifier. */
const isSanctionedSingleUnitIdentifier = (unit: string): boolean =>
  SANCTIONED.has(unit);

/** 6.6.1 IsWellFormedUnitIdentifier. */
export function isWellFormedUnitIdentifier(unit: string): boolean {
  if (isSanctionedSingleUnitIdentifier(unit)) return true;
  const i = unit.indexOf('-per-');
  if (i === -1 || unit.indexOf('-per-', i + 1) !== -1) return false;
  return (
    isSanctionedSingleUnitIdentifier(unit.slice(0, i)) &&
    isSanctionedSingleUnitIdentifier(unit.slice(i + 5))
  );
}

/** 16.5.1 CurrencyDigits, from the pinned CLDR release. */
const currencyDigits = (currency: string): number =>
  CURRENCY_DIGITS[currency] ?? 2;

/**
 * 9.2.8 ResolveOptions steps 4 and 6, the two that read the options: `localeMatcher`, and the one
 * resolution option `Intl.NumberFormat` declares, `numberingSystem`, which must be matched by the
 * `type` nonterminal of UTS #35.
 */
function resolveOptions(
  options: Readonly<Record<string, NumberFormatOptionValue>>,
): void {
  getOption(
    options,
    'localeMatcher',
    ['lookup', 'best fit'],
    'best fit',
    '9.2.8 step 4',
  );
  const numberingSystem = getOption(
    options,
    'numberingSystem',
    undefined,
    undefined,
    '9.2.8 step 6.c',
  );
  if (
    numberingSystem !== undefined &&
    !/^[0-9A-Za-z]{3,8}(?:-[0-9A-Za-z]{3,8})*$/u.test(numberingSystem)
  ) {
    refuse('9.2.8 step 6.d.ii');
  }
}

/** 16.1.3 SetNumberFormatUnitOptions. Returns the style and the currency the slots hold. */
function setNumberFormatUnitOptions(
  options: Readonly<Record<string, NumberFormatOptionValue>>,
): { readonly style: string; readonly currency: string | undefined } {
  const style = getOption(
    options,
    'style',
    ['decimal', 'percent', 'currency', 'unit'],
    'decimal',
    '16.1.3 step 1',
  ) as string;
  const currency = getOption(
    options,
    'currency',
    undefined,
    undefined,
    '16.1.3 step 3',
  );
  if (currency === undefined) {
    if (style === 'currency') refuse('16.1.3 step 4.a', 'TypeError');
  } else if (!isWellFormedCurrencyCode(currency)) {
    refuse('16.1.3 step 5.a');
  }
  getOption(
    options,
    'currencyDisplay',
    ['code', 'symbol', 'narrowSymbol', 'name'],
    'symbol',
    '16.1.3 step 6',
  );
  getOption(
    options,
    'currencySign',
    ['standard', 'accounting'],
    'standard',
    '16.1.3 step 7',
  );
  const unit = getOption(
    options,
    'unit',
    undefined,
    undefined,
    '16.1.3 step 8',
  );
  if (unit === undefined) {
    if (style === 'unit') refuse('16.1.3 step 9.a', 'TypeError');
  } else if (!isWellFormedUnitIdentifier(unit)) {
    refuse('16.1.3 step 10.a');
  }
  getOption(
    options,
    'unitDisplay',
    ['short', 'narrow', 'long'],
    'short',
    '16.1.3 step 11',
  );
  return {
    style,
    currency:
      style === 'currency' && currency !== undefined
        ? asciiUppercase(currency)
        : undefined,
  };
}

/** 16.1.2 SetNumberFormatDigitOptions, reduced to the steps that read an option or throw. */
function setNumberFormatDigitOptions(
  options: Readonly<Record<string, NumberFormatOptionValue>>,
  mnfdDefault: number,
  mxfdDefault: number,
  notation: string,
  lowersDefaultMaximum: boolean,
): void {
  defaultNumberOption(
    options['minimumIntegerDigits'],
    1,
    21,
    1,
    '16.1.2 step 1',
  );
  let mnfd: NumberFormatOptionValue = options['minimumFractionDigits'];
  let mxfd: NumberFormatOptionValue = options['maximumFractionDigits'];
  const mnsd = options['minimumSignificantDigits'];
  const mxsd = options['maximumSignificantDigits'];
  const roundingIncrement = defaultNumberOption(
    options['roundingIncrement'],
    1,
    5000,
    1,
    '16.1.2 step 7',
  ) as number;
  if (
    ![
      1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
    ].includes(roundingIncrement)
  ) {
    refuse('16.1.2 step 8');
  }
  getOption(
    options,
    'roundingMode',
    [
      'ceil',
      'floor',
      'expand',
      'trunc',
      'halfCeil',
      'halfFloor',
      'halfExpand',
      'halfTrunc',
      'halfEven',
    ],
    'halfExpand',
    '16.1.2 step 9',
  );
  const roundingPriority = getOption(
    options,
    'roundingPriority',
    ['auto', 'morePrecision', 'lessPrecision'],
    'auto',
    '16.1.2 step 10',
  ) as string;
  getOption(
    options,
    'trailingZeroDisplay',
    ['auto', 'stripIfInteger'],
    'auto',
    '16.1.2 step 11',
  );
  if (roundingIncrement !== 1 && lowersDefaultMaximum) {
    mxfdDefault = mnfdDefault;
  }
  const hasSd = mnsd !== undefined || mxsd !== undefined;
  const hasFd = mnfd !== undefined || mxfd !== undefined;
  let needSd = true;
  let needFd = true;
  if (roundingPriority === 'auto') {
    needSd = hasSd;
    if (needSd || (!hasFd && notation === 'compact')) needFd = false;
  }
  if (needSd && hasSd) {
    const minimum = defaultNumberOption(
      mnsd,
      1,
      21,
      1,
      '16.1.2 step 22.a.i',
    ) as number;
    defaultNumberOption(mxsd, minimum, 21, 21, '16.1.2 step 22.a.ii');
  }
  let minimumFractionDigits = mnfdDefault;
  let maximumFractionDigits = mxfdDefault;
  if (needFd && hasFd) {
    mnfd = defaultNumberOption(mnfd, 0, 100, undefined, '16.1.2 step 23.a.i');
    mxfd = defaultNumberOption(mxfd, 0, 100, undefined, '16.1.2 step 23.a.ii');
    if (mnfd === undefined) mnfd = Math.min(mnfdDefault, mxfd as number);
    else if (mxfd === undefined) mxfd = Math.max(mxfdDefault, mnfd);
    else if (mnfd > mxfd) refuse('16.1.2 step 23.a.v');
    minimumFractionDigits = mnfd;
    maximumFractionDigits = mxfd as number;
  }
  if (!needSd && !needFd) {
    minimumFractionDigits = 0;
    maximumFractionDigits = 0;
  }
  // Steps 24 to 28: the rounding type is fraction digits only where no significant digit is needed
  // and the priority is `auto`, and step 24's compact case is more-precision.
  const fractionDigitsRounding =
    (needSd || needFd) && roundingPriority === 'auto' && !hasSd;
  if (roundingIncrement !== 1) {
    if (!fractionDigitsRounding) refuse('16.1.2 step 29.a', 'TypeError');
    if (maximumFractionDigits !== minimumFractionDigits) {
      refuse('16.1.2 step 29.b');
    }
  }
}

/**
 * 16.1.1 `Intl.NumberFormat ( [ locales [ , options ] ] )`: why the constructor throws for these
 * options, or `undefined` when it accepts them.
 */
export function numberFormatRefusal(
  options: Readonly<Record<string, NumberFormatOptionValue>>,
): NumberFormatRefusal | undefined {
  return construct(options, true);
}

/**
 * A set of options the edition accepts only through 16.1.2 step 13, which V8 leaves out, or
 * `undefined` for any other set.
 *
 * Step 13 lowers the default maximum fraction digits to the minimum when `roundingIncrement` is not
 * 1, so `{ roundingIncrement: 5 }` resolves to no fraction digits and is accepted. The step is in
 * the 11th, 12th and 13th editions, and V8, the engine of Node and of Chromium, throws a
 * `RangeError` for the same options: over every combination `number-format-rules.test.ts` builds,
 * it answers exactly as these rules answer without the step. So the combination is declared unsupported, as
 * `specs/01-standards-profile.spec.md` section 5 permits for a host inconsistent with the standard
 * it implements, rather than compiled into a message that would throw where it is rendered.
 */
export function unsupportedNumberFormatCombination(
  options: Readonly<Record<string, NumberFormatOptionValue>>,
): NumberFormatRefusal | undefined {
  if (numberFormatRefusal(options) !== undefined) return undefined;
  const refusal = construct(options, false);
  return refusal === undefined
    ? undefined
    : {
        step: `${refusal.step} without 16.1.2 step 13`,
        exception: refusal.exception,
      };
}

function construct(
  options: Readonly<Record<string, NumberFormatOptionValue>>,
  lowersDefaultMaximum: boolean,
): NumberFormatRefusal | undefined {
  try {
    resolveOptions(options);
    const { style, currency } = setNumberFormatUnitOptions(options);
    const notation = getOption(
      options,
      'notation',
      ['standard', 'scientific', 'engineering', 'compact'],
      'standard',
      '16.1.1 step 11',
    ) as string;
    let mnfdDefault = 0;
    let mxfdDefault = style === 'percent' ? 0 : 3;
    if (style === 'currency' && notation === 'standard') {
      mnfdDefault = currencyDigits(currency as string);
      mxfdDefault = mnfdDefault;
    }
    setNumberFormatDigitOptions(
      options,
      mnfdDefault,
      mxfdDefault,
      notation,
      lowersDefaultMaximum,
    );
    getOption(
      options,
      'compactDisplay',
      ['short', 'long'],
      'short',
      '16.1.1 step 16',
    );
    const useGrouping = options['useGrouping'];
    // 9.2.12 GetBooleanOrStringNumberFormatOption: `true`, and every value ToBoolean makes false,
    // are taken as they are; any other value is compared as a string.
    if (
      useGrouping !== undefined &&
      useGrouping !== true &&
      Boolean(useGrouping)
    ) {
      if (
        !['min2', 'auto', 'always', 'true', 'false'].includes(
          toString(useGrouping),
        )
      ) {
        refuse('16.1.1 step 20, 9.2.12 step 6');
      }
    }
    getOption(
      options,
      'signDisplay',
      ['auto', 'never', 'always', 'exceptZero', 'negative'],
      'auto',
      '16.1.1 step 24',
    );
    return undefined;
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}
