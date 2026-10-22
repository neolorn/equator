import { describe, expect, it } from 'vitest';

import type { LocalizedSlotPart } from '@neolorn/equator/core';

import type {
  CompiledInputContract,
  CompiledSlotContract,
} from '../src/catalog-runtime.js';
import {
  evaluateArtifact,
  expression,
  literal,
  local,
  patternBody,
  refusalOf,
  renderArtifact,
  variable,
} from './compiled-artifact-harness.js';
import { parse, render } from './message-harness.js';

/**
 * How the options written on one expression become the options its function is called with.
 *
 * LDML 48 Part 9 resolves an expression's options in three steps and the evaluator is the only
 * place a compiled artifact meets all three: the `u:` options are taken out and applied to the
 * resolved value, the options written on the expression are checked against the function's own
 * vocabulary, and what the operand carried is merged underneath them. The toolkit refuses most
 * mistakes in any of the three where they are written. What is left for render is an option whose
 * value arrives through a variable, and an artifact the toolkit did not produce, so the cases
 * below are those two.
 */

const NONE: readonly CompiledInputContract[] = Object.freeze([]);

const inputs = (
  ...declared: readonly (readonly [
    string,
    CompiledInputContract['type'],
    Partial<CompiledInputContract>?,
  ])[]
): readonly CompiledInputContract[] =>
  declared.map(([name, type, extra]) => ({
    name,
    type,
    optional: false,
    nullable: false,
    ...extra,
  }));

const annotated = (
  operand: unknown,
  name: string,
  options: Readonly<Record<string, unknown>> = {},
): unknown => expression(operand, { name, options });

describe('the u: options of an expression', () => {
  const TEXT = inputs(['text', 'string'], ['count', 'number']);

  const withUnicode = (
    options: Readonly<Record<string, unknown>>,
    name = 'string',
  ): string =>
    renderArtifact(
      {
        body: patternBody([annotated(variable('text'), name, options)]),
        inputs: TEXT,
      },
      { text: 'word', count: 3 },
    );

  it.each(['ltr', 'rtl', 'auto', 'inherit'])(
    'accepts u:dir=%s',
    (direction) => {
      expect(withUnicode({ 'u:dir': literal(direction) })).toContain('word');
    },
  );

  it.each([
    ['a direction MessageFormat does not define', literal('sideways')],
    ['a defined direction in another case', literal('RTL')],
    ['the empty string', literal('')],
    ['a number that arrived through a variable', variable('count')],
  ])('refuses u:dir holding %s', (_label, reference) => {
    const failure = refusalOf(() => withUnicode({ 'u:dir': reference }));
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
  });

  it('carries u:id on the value and keeps it away from the function', () => {
    const result = evaluateArtifact(
      {
        body: patternBody([
          annotated(variable('count'), 'number', { 'u:id': literal('total') }),
        ]),
        inputs: TEXT,
        resultKind: 'structured',
      },
      { text: 'word', count: 3 },
    );
    expect(result.kind).toBe('parts');
    expect(result.value).toEqual([
      expect.objectContaining({ kind: 'value', value: '3', id: 'total' }),
    ]);
  });

  it('refuses a u:id that is not text', () => {
    const failure = refusalOf(() => withUnicode({ 'u:id': variable('count') }));
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
  });

  it.each(['u:locale', 'u:', 'u:ID', 'u:direction'])(
    'refuses %s, which the profile does not implement',
    (name) => {
      const failure = refusalOf(() => withUnicode({ [name]: literal('en') }));
      expect(failure.diagnostic.code).toBe('invalid-rich-message');
      expect(failure.diagnostic.outcome).toBe('operational-failure');
    },
  );

  it('refuses an unimplemented u: option on a function that takes options of its own', () => {
    const failure = refusalOf(() =>
      withUnicode({ 'u:locale': literal('en') }, 'number'),
    );
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
  });
});

describe('the u: options of markup', () => {
  const MARK: readonly CompiledSlotContract[] = [
    {
      name: 'mark',
      kind: 'test:mark',
      shape: 'paired',
      optional: false,
      repeatable: false,
      within: [],
    },
  ];

  const marked = (
    options: Readonly<Record<string, unknown>>,
    declared: readonly CompiledInputContract[] = NONE,
    values: Readonly<Record<string, unknown>> = {},
  ) =>
    evaluateArtifact(
      {
        inputs: declared,
        body: patternBody([
          {
            kind: 'markup',
            markupKind: 'open',
            name: 'mark',
            options,
            attributes: {},
          },
          'inside',
          {
            kind: 'markup',
            markupKind: 'close',
            name: 'mark',
            options: {},
            attributes: {},
          },
        ]),
        slots: MARK,
        resultKind: 'structured',
      },
      values,
    );

  it('lifts u:id out of the options a slot carries', () => {
    const result = marked({ 'u:id': literal('first'), tone: literal('calm') });
    const slot = (result.value as readonly LocalizedSlotPart[])[0]!;
    expect(slot.kind).toBe('slot');
    expect(slot.id).toBe('first');
    expect(slot.options).toEqual({ tone: 'calm' });
  });

  it('gives a slot written without u:id no id', () => {
    const result = marked({ tone: literal('calm') });
    const slot = (result.value as readonly LocalizedSlotPart[])[0]!;
    expect(Object.keys(slot)).not.toContain('id');
    expect(slot.options).toEqual({ tone: 'calm' });
  });

  it.each([
    ['was omitted', {}],
    ['is null', { tone: null }],
  ])(
    'gives a slot no option where the variable written for it %s',
    (_label, values) => {
      const result = marked(
        { tone: variable('tone'), weight: literal('bold') },
        inputs(['tone', 'string', { optional: true, nullable: true }]),
        values,
      );
      const slot = (result.value as readonly LocalizedSlotPart[])[0]!;
      expect(slot.options).toEqual({ weight: 'bold' });
    },
  );

  it('still refuses a u:id whose variable was omitted', () => {
    const failure = refusalOf(() =>
      marked(
        { 'u:id': variable('tone') },
        inputs(['tone', 'string', { optional: true }]),
      ),
    );
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
  });

  it.each(['ltr', 'rtl', 'auto', 'inherit'])(
    'refuses u:dir=%s, because markup resolves to no value',
    (direction) => {
      const failure = refusalOf(() => marked({ 'u:dir': literal(direction) }));
      expect(failure.diagnostic.code).toBe('invalid-rich-message');
      expect(failure.diagnostic.outcome).toBe('operational-failure');
    },
  );

  it('refuses a u: option the profile does not implement', () => {
    const failure = refusalOf(() => marked({ 'u:locale': literal('en') }));
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
  });
});

describe('an option whose value arrives through a variable', () => {
  const DIGITS = inputs(
    ['count', 'number'],
    ['digits', 'integer', { optional: true, nullable: true }],
  );
  const SOURCE = '{$count :number minimumFractionDigits=$digits}';

  it('is applied when the variable holds a value', () => {
    expect(render(SOURCE, DIGITS, { count: 1, digits: 2 })).toBe('1.00');
  });

  it('is left unwritten when the variable was omitted', () => {
    expect(render(SOURCE, DIGITS, { count: 1 })).toBe('1');
  });

  it('is left unwritten when the variable is null', () => {
    expect(render(SOURCE, DIGITS, { count: 1, digits: null })).toBe('1');
  });

  const CARRIED =
    '.local $shown = {$count :number minimumFractionDigits=2}\n' +
    '{{{$shown :number minimumFractionDigits=$digits}}}';

  it('is written over what the operand carried when the variable holds a value', () => {
    expect(render(CARRIED, DIGITS, { count: 1, digits: 3 })).toBe('1.000');
  });

  it.each([
    ['was omitted', {}],
    ['is null', { digits: null }],
  ])(
    'leaves what the operand carried in force when the variable %s',
    (_label, values) => {
      expect(render(CARRIED, DIGITS, { count: 1, ...values })).toBe('1.00');
    },
  );

  it('is read as the text of a number where the option is one of a list of numerals', () => {
    expect(
      render(
        '{$count :number roundingIncrement=$step maximumFractionDigits=0}',
        inputs(['count', 'number'], ['step', 'integer']),
        { count: 12, step: 5 },
      ),
    ).toBe('10');
  });

  it('is read as the text of a boolean where the option is true or false', () => {
    const CLOCK = inputs(['when', 'date-time'], ['twelve', 'boolean']);
    const source = '{$when :time hour12=$twelve timeZone=UTC}';
    const when = new Date(Date.UTC(2024, 0, 2, 15, 4));
    expect(render(source, CLOCK, { when, twelve: true })).toMatch(
      /^3:04\sPM$/u,
    );
    expect(render(source, CLOCK, { when, twelve: false })).toBe('15:04');
  });

  it('is refused when it is not a value the option takes', () => {
    const failure = refusalOf(() =>
      render(
        '{$count :number roundingMode=$mode}',
        inputs(['count', 'number'], ['mode', 'string']),
        { count: 1, mode: 'nearest' },
      ),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
  });
});

describe('an option the function does not define', () => {
  const WHEN = inputs(['when', 'date-time']);
  const when = new Date(Date.UTC(2024, 0, 2, 15, 4));

  it.each(['date', 'time', 'datetime'])(
    'is refused when written on :%s',
    (name) => {
      const failure = refusalOf(() =>
        renderArtifact(
          {
            body: patternBody([
              annotated(variable('when'), name, {
                timeZone: literal('UTC'),
                signDisplay: literal('always'),
              }),
            ]),
            inputs: WHEN,
          },
          { when },
        ),
      );
      expect(failure.diagnostic.code).toBe('invalid-message-input');
      expect(failure.diagnostic.outcome).toBe('operational-failure');
    },
  );

  it('is refused when written on :string, which has no options', () => {
    const failure = refusalOf(() =>
      renderArtifact({
        body: patternBody([
          annotated(literal('word'), 'string', { length: literal('long') }),
        ]),
      }),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
  });

  it.each([
    ['number', { fractionDigits: literal('2') }],
    ['integer', { minimumFractionDigits: literal('2') }],
    ['percent', { select: literal('exact') }],
    ['offset', { add: literal('1'), signDisplay: literal('always') }],
    ['currency', { currency: literal('EUR'), unit: literal('meter') }],
    ['unit', { unit: literal('meter'), currency: literal('EUR') }],
  ])('is refused when written on :%s', (name, options) => {
    const failure = refusalOf(() =>
      renderArtifact({
        body: patternBody([annotated(literal('1'), name, options)]),
      }),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
  });
});

describe('a built-in function written with no operand', () => {
  it.each([
    ['number', {}],
    ['integer', {}],
    ['percent', {}],
    ['offset', { add: literal('1') }],
    ['currency', { currency: literal('EUR') }],
    ['unit', { unit: literal('meter') }],
    ['date', { timeZone: literal('UTC') }],
    ['time', { timeZone: literal('UTC') }],
    ['datetime', { timeZone: literal('UTC') }],
  ])('refuses :%s as an input the function cannot format', (name, options) => {
    const failure = refusalOf(() =>
      renderArtifact({
        body: patternBody([annotated(undefined, name, options)]),
      }),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
  });
});

/**
 * `select` is the one option MessageFormat does not let a number function inherit, and only the
 * two functions that have a `select` option are bound by that. LDML 48 Part 9 has `:percent`
 * discard it, and gives `:currency`, `:offset` and `:unit` no selection behaviour for an inherited
 * one to have decided.
 */
describe('a select option carried by the operand', () => {
  const carrying = (reannotation: string): string =>
    ['.local $n = {1 :number select=exact}', `{{${reannotation}}}`].join('\n');

  it.each([
    ['{$n :percent}', '100%'],
    ['{$n :offset add=1}', '2'],
    ['{$n :currency currency=EUR}', '€1.00'],
    ['{$n :unit unit=meter}', '1 m'],
  ])('does not stop %s from formatting', (reannotation, expected) => {
    expect(render(carrying(reannotation), NONE, {})).toBe(expected);
  });

  it.each(['number', 'integer'])(
    'is overridden by a select the :%s expression writes itself',
    (name) => {
      expect(render(carrying(`{$n :${name} select=plural}`), NONE, {})).toBe(
        '1',
      );
    },
  );

  // The toolkit refuses this where it is written, so the artifact is assembled by hand.
  it.each(['number', 'integer'])(
    'is refused by an :%s expression that writes no select of its own',
    (name) => {
      const failure = refusalOf(() =>
        renderArtifact({
          body: patternBody(
            [annotated(variable('n'), name)],
            [
              local(
                'n',
                annotated(literal('1'), 'number', { select: literal('exact') }),
              ),
            ],
          ),
        }),
      );
      expect(failure.diagnostic.code).toBe('invalid-message-input');
      expect(failure.diagnostic.outcome).toBe('operational-failure');
    },
  );
});

describe('what an :offset value carries forward', () => {
  it('lets a second :offset apply its own option to the offset value', () => {
    expect(
      render(
        [
          '.local $a = {41 :offset add=1}',
          '.local $b = {$a :offset subtract=2}',
          '{{{$b}}}',
        ].join('\n'),
        NONE,
        {},
      ),
    ).toBe('40');
    expect(
      render(
        [
          '.local $a = {52 :offset subtract=10}',
          '.local $b = {$a :offset add=1}',
          '{{{$b}}}',
        ].join('\n'),
        NONE,
        {},
      ),
    ).toBe('43');
  });

  it('still carries the display options the offset was written beside', () => {
    expect(
      render(
        [
          '.local $a = {41 :integer signDisplay=always}',
          '.local $b = {$a :offset add=1}',
          '{{{$b :number}}}',
        ].join('\n'),
        NONE,
        {},
      ),
    ).toBe('+42');
  });
});

/**
 * The six CLDR plural categories are the only keys a numeric selector takes besides a number.
 * Arabic is the locale that uses all six, so one message there shows each is recognized.
 */
describe('the plural categories a numeric selector matches', () => {
  const COUNT = inputs(['count', 'number']);
  const categories = (): unknown =>
    parse(
      [
        '.input {$count :number}',
        '.match $count',
        'zero {{zero}}',
        'one {{one}}',
        'two {{two}}',
        'few {{few}}',
        'many {{many}}',
        'other {{other}}',
        '* {{none}}',
      ].join('\n'),
    );

  it.each([
    [0, 'zero'],
    [1, 'one'],
    [2, 'two'],
    [3, 'few'],
    [11, 'many'],
    [100, 'other'],
  ])('selects for %d in Arabic by the category %s', (count, expected) => {
    expect(
      renderArtifact(
        { body: categories(), inputs: COUNT, locale: 'ar' },
        { count },
      ),
    ).toBe(expected);
  });

  it.each([
    [1, 'one'],
    [5, 'other'],
  ])('selects for %d in English by the category %s', (count, expected) => {
    expect(
      renderArtifact({ body: categories(), inputs: COUNT }, { count }),
    ).toBe(expected);
  });

  it('matches no key that is neither a number nor a category', () => {
    const body = parse(
      [
        '.input {$count :number}',
        '.match $count',
        'One {{capital}}',
        'singular {{word}}',
        '* {{none}}',
      ].join('\n'),
    );
    expect(renderArtifact({ body, inputs: COUNT }, { count: 1 })).toBe('none');
  });
});
