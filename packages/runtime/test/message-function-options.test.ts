import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  isPinnedTimeZoneName,
  type MessageExpression,
  type MessageSemanticModel,
  type PatternMessageSemanticModel,
} from '../../toolkit/src/message-format.js';
import type { CompiledInputContract } from '../src/catalog-runtime.js';
import { timeZone } from '../src/formatting.js';
import {
  MESSAGE_OPTION_RULES,
  MESSAGE_FUNCTION_OPTIONS,
  dateTimeFormatOptions,
  isUnicodeKeywordType,
  messageOptionProblem,
  numberFormatOptions,
  type DigitSizeRule,
  type MessageOptionRule,
} from '../src/message-function-options.js';
import { TIME_ZONE_IDENTITIES } from '../src/time-zone-identities.generated.js';
import { parse, render, renderSemantics } from './message-harness.js';

/**
 * The option table, checked against the three things it claims to be true to: the copy in the other
 * package, `Intl.NumberFormat`, and `Intl.DateTimeFormat`.
 *
 * None can be checked by reading the table, which is the point. A duplicated file agrees with itself
 * by construction and a declared limit agrees with its own comment; a check drawn from the same
 * source as its subject agrees whatever the subject does. So the copy is compared byte for byte
 * and every bound is probed against the implementation that imposes it.
 *
 * The table holds all ten built-ins, because a function absent from it is a function whose options
 * are accepted unread, and the cases below run over whatever the table declares rather than over a
 * hand-kept list.
 */

const NONE: readonly CompiledInputContract[] = Object.freeze([]);

const repositoryRoot = new URL('../../../', import.meta.url);

const sourceOf = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, repositoryRoot)), 'utf8');

/**
 * The twins, read from the list the mutation configuration reads. Stryker instruments the files it
 * mutates, which changes their bytes, so a twin it mutates fails this test in the dry run and no
 * reading is taken at all. A second list of exclusions kept in step by a comment drifts; one list
 * cannot drift from itself.
 */
/**
 * The toolkit resolves modules as Node does, which needs the extension on a relative import, and the
 * runtime's bundler resolution does not take one. That spelling is the only difference a twin may
 * have.
 */
const withoutImportExtensions = (source: string): string =>
  source.replace(/(from '\.\/[^']+)\.js';/gu, "$1';");

const twins: readonly { runtime: string; toolkit: string }[] = (
  JSON.parse(sourceOf('tools/twin-sources.json')) as {
    twins: { runtime: string; toolkit: string }[];
  }
).twins;

describe('the option table', () => {
  /**
   * `packages/runtime` cannot import from `packages/toolkit`: the toolkit is a build-time tool
   * with `ajv`, `yaml` and `messageformat` behind it and none of that belongs in a browser bundle.
   * So a file both packages need is duplicated, and duplication without a check is drift with a
   * delay on it. A test can read both sources from disk where the shipped packages cannot, so every
   * twin in the repository is listed in `tools/twin-sources.json` rather than beside whichever copy
   * was written first.
   */
  it.each(twins.map(({ runtime, toolkit }) => [runtime, toolkit]))(
    '%s and %s are the same file',
    (runtimePath, toolkitPath) => {
      expect(sourceOf(runtimePath)).toBe(
        withoutImportExtensions(sourceOf(toolkitPath)),
      );
    },
  );

  /**
   * The compiler judges the zone a message names and the runtime the zone a value is made with,
   * each from its own copy of the pinned table. One rule, so a name is a zone to both or to
   * neither.
   */
  it('gives a time zone name one answer where a message compiles and where a value is made', () => {
    const names = TIME_ZONE_IDENTITIES.split(' ').map(
      (entry) => entry.split('>')[0] as string,
    );
    const asked = [
      ...names,
      ...names.map((name) => name.toUpperCase()),
      ...names.map((name) => name.toLowerCase()),
      '+05:00',
      'Nowhere/Nowhere',
      'UTC ',
      '',
      'Europe/' + String.fromCodePoint(0x212a) + 'iev',
    ];
    expect(names.length).toBeGreaterThan(400);
    for (const name of asked) {
      let made = true;
      try {
        timeZone(name);
      } catch {
        made = false;
      }
      expect(isPinnedTimeZoneName(name), name).toBe(made);
    }
    expect(isPinnedTimeZoneName('+05:00')).toBe(false);
    expect(isPinnedTimeZoneName('europe/paris')).toBe(true);
  });

  it('declares every option each function has and no others', () => {
    for (const [name, profile] of Object.entries(MESSAGE_FUNCTION_OPTIONS)) {
      for (const option of profile.accepts) {
        expect(
          MESSAGE_OPTION_RULES[option],
          `:${name} accepts ${option} and no rule says what a valid value of it is`,
        ).toBeDefined();
      }
      // A discarded option is one that could arrive from an operand, so it has to be a real option
      // somewhere: a typo here would silently discard nothing at all.
      for (const option of [
        ...profile.discardedFromOperand,
        ...profile.excludedFromResolved,
      ]) {
        expect(
          MESSAGE_OPTION_RULES[option],
          `:${name} names ${option} in a discard list and no rule defines it`,
        ).toBeDefined();
      }
    }
  });

  /**
   * The digit-size bounds, asked of the implementation that enforces them rather than read back
   * out of the table that declares them. A bound one past where `Intl` actually stops is a message
   * that compiles and throws; a bound one short is a message refused for being formattable.
   */
  it('declares digit-size bounds where Intl.NumberFormat actually puts them', () => {
    const accepts = (option: string, size: number): boolean => {
      try {
        new Intl.NumberFormat('en', {
          [option]: size,
          // A minimum needs a maximum above it or the pair itself is what is refused.
          ...(option === 'minimumFractionDigits'
            ? { maximumFractionDigits: 100 }
            : {}),
          ...(option === 'minimumSignificantDigits'
            ? { maximumSignificantDigits: 21 }
            : {}),
        });
        return true;
      } catch {
        return false;
      }
    };
    const digitRules = Object.entries(MESSAGE_OPTION_RULES).filter(
      (entry): entry is [string, DigitSizeRule] =>
        entry[1].kind === 'digit-size',
    );
    expect(digitRules.length).toBeGreaterThan(0);
    for (const [option, rule] of digitRules) {
      // `add`, `subtract` and `fractionDigits` are Equator's or the specification's own names; only
      // the five that reach `Intl` under their own name can be probed against it.
      if (!(option in new Intl.NumberFormat().resolvedOptions())) continue;
      expect(accepts(option, rule.minimum), `${option} minimum`).toBe(true);
      expect(accepts(option, rule.maximum), `${option} maximum`).toBe(true);
      expect(accepts(option, rule.minimum - 1), `${option} below minimum`).toBe(
        false,
      );
      // 99 is the ABNF's ceiling, so a maximum there is the grammar's limit rather than Intl's and
      // there is nothing above it to refuse.
      if (rule.maximum < 99) {
        expect(
          accepts(option, rule.maximum + 1),
          `${option} above maximum`,
        ).toBe(false);
      }
    }
  });

  /**
   * A calendar is a name, and whether a name is one is the same answer on every machine. The
   * host's own list is the witness that the rule is not narrower than what exists: every calendar
   * this host publishes is written the way the rule requires.
   */
  it('judges a calendar by how its name is written and never by the host', () => {
    const supported = vi.spyOn(Intl, 'supportedValuesOf');
    const accepts = (value: string): boolean =>
      messageOptionProblem('date', 'calendar', value) === undefined;

    expect(accepts('nosuch')).toBe(true);
    expect(accepts('ethiopic-amete-alem')).toBe(true);
    for (const value of ['HEBREW', 'ab', 'gregorian', 'hebrew-', '', 'a b']) {
      expect(accepts(value), value).toBe(false);
    }
    expect(supported).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    for (const calendar of Intl.supportedValuesOf('calendar')) {
      expect(accepts(calendar), calendar).toBe(true);
      expect(isUnicodeKeywordType(calendar), calendar).toBe(true);
    }
  });

  /**
   * Every value the date half of the table declares, through the mapping, into the constructor that
   * will receive it. This is the check the compiler runs on one written expression, asked of the
   * whole vocabulary at once: a declared value that `Intl.DateTimeFormat` will not take is a
   * message Equator accepts and throws on, which is the failure the specification's *"What
   * compiles, renders"* clause exists to make impossible.
   */
  it('builds a formatter for every value of every date option', () => {
    const valuesOf = (rule: MessageOptionRule): readonly string[] => {
      switch (rule.kind) {
        case 'enumerated':
          return rule.values;
        case 'boolean':
          return ['true', 'false'];
        case 'identifier':
          // The date family has one, the calendar, and the names this host publishes are the ones
          // a formatter can be built with.
          return Intl.supportedValuesOf('calendar');
        case 'constructed':
          // `input` is not a zone; it names where to find one, and it is answered before the
          // formatter is built.
          return ['UTC', 'Asia/Tokyo', 'America/Sao_Paulo'];
        default:
          return [];
      }
    };
    let built = 0;
    for (const [name, profile] of Object.entries(MESSAGE_FUNCTION_OPTIONS)) {
      if (profile.operand !== 'date-time') continue;
      for (const option of profile.accepts) {
        const rule = MESSAGE_OPTION_RULES[option];
        if (rule === undefined) throw new Error(option + ' has no rule');
        for (const value of valuesOf(rule)) {
          const options = dateTimeFormatOptions(name, { [option]: value });
          expect(
            () =>
              new Intl.DateTimeFormat('en', { timeZone: 'UTC', ...options }),
            ':' + name + ' ' + option + '=' + value,
          ).not.toThrow();
          built += 1;
        }
      }
    }
    expect(built).toBeGreaterThan(0);
  });

  /**
   * `hour12` is a boolean everywhere except in a message, where every option value is text. `"false"`
   * is truthy, so a value passed through unconverted gives a twelve-hour clock to an author who
   * wrote the opposite: accepted, carried, and read as its own negation.
   */
  it('converts hour12 to the boolean Intl reads', () => {
    expect(dateTimeFormatOptions('time', { hour12: 'false' })).toMatchObject({
      hour12: false,
    });
    expect(dateTimeFormatOptions('time', { hour12: 'true' })).toMatchObject({
      hour12: true,
    });
  });

  /**
   * One table holding both families means a name from one can be handed to the other's constructor,
   * which throws. The compiler cannot produce that, it refuses a date-annotated operand under a
   * numeric function, but a compiled artifact this runtime did not compile can.
   */
  it('keeps a date option out of Intl.NumberFormat', () => {
    const options = numberFormatOptions('number', {
      timeZone: 'UTC',
      minimumFractionDigits: '2',
    });
    expect(options).not.toHaveProperty('timeZone');
    expect(() => new Intl.NumberFormat('en', options)).not.toThrow();
  });

  /**
   * The `roundingIncrement` list is fifteen values the specification spells out, and this asks
   * `Intl` whether they are the fifteen it takes. If CLDR ever adds one, this fails rather than
   * Equator quietly refusing an increment the platform supports.
   */
  it('lists exactly the rounding increments Intl accepts', () => {
    const rule = MESSAGE_OPTION_RULES['roundingIncrement'];
    if (rule?.kind !== 'enumerated') throw new Error('rule shape changed');
    const takes = (value: number): boolean => {
      try {
        // The type declares the fifteen literals this test exists to check, so asking it about a
        // sixteenth has to go around the type rather than through it.
        new Intl.NumberFormat('en', {
          roundingIncrement: value,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        } as unknown as Intl.NumberFormatOptions);
        return true;
      } catch {
        return false;
      }
    };
    const accepted: string[] = [];
    for (let value = 1; value <= 5000; value += 1) {
      if (takes(value)) accepted.push(String(value));
    }
    expect(accepted).toEqual([...rule.values]);
  });
});

describe('numeric options at render', () => {
  it('applies an option that reaches Intl rather than being dropped', () => {
    // A `roundingMode` nothing reads leaves 2.5 coming out as 3 whatever the message asks for,
    // because `halfExpand` is the default.
    const at = (mode: string): string =>
      render(
        `{2.5 :number maximumFractionDigits=0 roundingMode=${mode}}`,
        NONE,
        {},
      );
    expect(at('halfExpand')).toBe('3');
    expect(at('halfEven')).toBe('2');
    expect(at('floor')).toBe('2');
    expect(at('ceil')).toBe('3');
  });

  it('fixes currency fraction digits with the option the specification gives it', () => {
    // `fractionDigits` sets both ends at once. Equator ignored it and took the two names :currency
    // does not have, so `fractionDigits=0` printed the cents it was asked to drop.
    expect(
      render('{42.5 :currency currency=USD fractionDigits=0}', NONE, {}),
    ).toBe('$43');
    expect(
      render('{42.5 :currency currency=USD fractionDigits=3}', NONE, {}),
    ).toBe('$42.500');
  });

  it('formats an accounting sign and a stripped trailing zero', () => {
    expect(
      render('{-5 :currency currency=USD currencySign=accounting}', NONE, {}),
    ).toBe('($5.00)');
    expect(
      render(
        '{5 :currency currency=USD trailingZeroDisplay=stripIfInteger}',
        NONE,
        {},
      ),
    ).toBe('$5');
  });

  /**
   * The option whose validity is not a property of its value. `roundingIncrement` needs an explicit
   * fraction-digit range and `:percent` has one by default, so the same option is refused on one
   * function and formats on another, which is why the compiler judges the whole option set rather
   * than each option alone.
   */
  it('accepts roundingIncrement where the surrounding options allow it', () => {
    expect(
      render(
        '{1234.567 :number roundingIncrement=5 minimumFractionDigits=2 maximumFractionDigits=2}',
        NONE,
        {},
      ),
    ).toBe('1,234.55');
  });

  /**
   * An option value that arrives through a variable never passes the compiler, so this is the half
   * of the rule the runtime answers for alone.
   */
  it('refuses an option value that arrives from a variable and is not valid', () => {
    const contracts: readonly CompiledInputContract[] = Object.freeze([
      { name: 'mode', type: 'string', optional: false, nullable: false },
    ]);
    const source = '{2.5 :number maximumFractionDigits=0 roundingMode=$mode}';
    expect(() => render(source, contracts, { mode: 'nearest' })).toThrow(
      /roundingMode/,
    );
    expect(render(source, contracts, { mode: 'floor' })).toBe('2');
  });
});

/**
 * The half of the rule the compiler cannot be the only answer to.
 *
 * `packages/toolkit/src/message-format.ts` refuses an unrecognized option name at compile time, so
 * no catalog carries this shape and the source below does not parse. The evaluator keeps the rule
 * anyway, because its input is a compiled artifact and it has no way to know what produced one. So
 * the model is assembled by parsing a message that does compile and renaming the option on it:
 * the same technique, and for the same reason, as the assembled-IR case in
 * `declaration-values.test.ts`.
 */
describe('numeric options in IR the compiler did not produce', () => {
  const withOptionRenamed = (
    source: string,
    from: string,
    to: string,
  ): MessageSemanticModel => {
    const model = parse(source) as PatternMessageSemanticModel;
    const expression = model.pattern[0] as MessageExpression;
    const options = { ...expression.function?.options } as Record<
      string,
      unknown
    >;
    options[to] = options[from];
    delete options[from];
    return {
      ...model,
      pattern: Object.freeze([
        {
          ...expression,
          function: { ...expression.function, options },
        } as MessageExpression,
      ]),
    };
  };

  it('refuses an option name the function does not have', () => {
    expect(() =>
      renderSemantics(
        withOptionRenamed(
          '{1 :number minimumFractionDigits=2}',
          'minimumFractionDigits',
          'fractionDigits',
        ),
        NONE,
        {},
      ),
    ).toThrow(/fractionDigits is not an option of :number/);
  });

  it('leaves the same name alone on the function that does have it', () => {
    expect(
      renderSemantics(
        withOptionRenamed(
          '{1 :currency currency=EUR minimumSignificantDigits=3}',
          'minimumSignificantDigits',
          'fractionDigits',
        ),
        NONE,
        {},
      ),
    ).toContain('1.00');
  });
});
