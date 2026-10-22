import { describe, expect, it } from 'vitest';

import type {
  MessageFunctionInvocation,
  MessageFunctionResult,
  RuntimeMessageFunctionDescriptor,
} from '@neolorn/equator/core';

import {
  defineExtensionRegistry,
  type MessageFunctionDescriptorInput,
} from '../../toolkit/src/extensions.js';
import type { CompiledInputContract } from '../src/catalog-runtime.js';
import { RuntimeExtensions } from '../src/extensions.js';
import { RUNTIME_LIMITS } from '../src/runtime-safety.js';
import {
  expression,
  literal,
  local,
  patternBody,
  refusalOf,
  renderArtifact,
  variable,
} from './compiled-artifact-harness.js';

/**
 * A message function's descriptor is a contract, and the evaluator holds both sides to it.
 *
 * The descriptor declares what the function may be applied to, which options it takes and what it
 * produces. The compiler refuses a message that breaks the first two where it is written, but a
 * value that arrives through a variable is only known at render, a compiled artifact need not
 * have come through that compiler, and nothing but the evaluator ever sees what the consumer's
 * function returns. So each of the three is asserted here against values the compiler cannot see.
 *
 * Every refusal is `invalid-rich-message`: the function was never called with something outside
 * its contract, and nothing outside its contract was let out of it.
 */

type Described = Omit<MessageFunctionDescriptorInput, 'kind' | 'id'>;

const BASE: Described = {
  operandType: 'string',
  resultType: 'string',
  selector: 'none',
  maximumOutputLength: 64,
};

const describeOptions = (
  options: MessageFunctionInvocation['options'],
): string =>
  Object.keys(options)
    .sort()
    .map((name) => `${name}=${String(options[name])}`)
    .join(',');

/** Prints what it was called with, so a case can read the call off the rendered text. */
const echo = ({
  options,
}: MessageFunctionInvocation): MessageFunctionResult => ({
  text: `ok(${describeOptions(options)})`,
  value: 'ok',
});

const extensionsOf = (
  described: Partial<Described>,
  evaluate: (
    invocation: MessageFunctionInvocation,
  ) => MessageFunctionResult = echo,
): RuntimeExtensions => {
  const registry = defineExtensionRegistry([
    { kind: 'message-function', id: 'test:subject', ...BASE, ...described },
  ]);
  if (!registry.ok) {
    throw new Error(
      `the descriptor under test was refused: ${registry.diagnostics
        .map(({ summary }) => summary)
        .join('; ')}`,
    );
  }
  return new RuntimeExtensions([
    {
      descriptor: registry.value
        .descriptors[0] as unknown as RuntimeMessageFunctionDescriptor,
      evaluate,
    },
  ]);
};

const inputOf = (
  type: CompiledInputContract['type'],
  extra: Partial<CompiledInputContract> = {},
): readonly CompiledInputContract[] => [
  { name: 'value', type, optional: false, nullable: false, ...extra },
];

const call = (
  operand: unknown,
  options: Readonly<Record<string, unknown>> = {},
): unknown => expression(operand, { name: 'test:subject', options });

const LONGEST = 'a'.repeat(RUNTIME_LIMITS.outputCodePoints);

describe('the operand a message function declares', () => {
  const applied = (
    operandType: Described['operandType'],
    contract: CompiledInputContract['type'],
    value: unknown,
  ): string =>
    renderArtifact(
      {
        body: patternBody([call(variable('value'))]),
        inputs: inputOf(contract),
      },
      { value },
      extensionsOf({ operandType }),
    );

  it.each([
    ['boolean', 'a boolean input holding true', 'boolean', true],
    ['boolean', 'a boolean input holding false', 'boolean', false],
    [
      'date-time',
      'a date-time input holding a date',
      'date-time',
      new Date(Date.UTC(2024, 0, 2)),
    ],
    [
      'date-time',
      'a date-time input holding a timestamp',
      'date-time',
      1_700_000_000_000,
    ],
    ['date-time', 'a number input holding zero', 'number', 0],
    ['integer', 'an integer input', 'integer', 3],
    ['integer', 'a number input holding a whole number', 'number', -3],
    ['integer', 'a string input holding a whole number', 'string', '3'],
    ['number', 'a number input holding a fraction', 'number', 1.5],
    ['number', 'an integer input', 'integer', 3],
    ['number', 'a string input holding a number literal', 'string', '1.5'],
    ['string', 'a string input holding a word', 'string', 'word'],
    ['string', 'a string input holding nothing', 'string', ''],
    [
      'string',
      'a string input as long as the output ceiling',
      'string',
      LONGEST,
    ],
  ] as const)(
    'applies a function over %s to %s',
    (operandType, _label, contract, value) => {
      expect(applied(operandType, contract, value)).toBe('ok()');
    },
  );

  it.each([
    ['boolean', 'a string input holding the word true', 'string', 'true'],
    ['boolean', 'a number input holding one', 'number', 1],
    ['boolean', 'a number input holding zero', 'number', 0],
    [
      'date-time',
      'a string input holding a written date',
      'string',
      '2024-01-02T00:00:00Z',
    ],
    [
      'date-time',
      'a string input holding a written timestamp',
      'string',
      '1700000000000',
    ],
    ['date-time', 'a boolean input', 'boolean', true],
    ['integer', 'a number input holding a fraction', 'number', 1.5],
    [
      'integer',
      'a number input holding an integer past the safe range',
      'number',
      2 ** 53,
    ],
    ['integer', 'a string input holding a fraction', 'string', '1.5'],
    ['integer', 'a string input holding a word', 'string', 'three'],
    ['integer', 'a boolean input', 'boolean', true],
    ['number', 'a string input holding a word', 'string', 'three'],
    ['number', 'a string input holding nothing', 'string', ''],
    ['number', 'a boolean input', 'boolean', true],
    ['number', 'a date-time input holding a date', 'date-time', new Date(0)],
    ['string', 'a number input', 'number', 5],
    ['string', 'a boolean input', 'boolean', false],
    ['string', 'a date-time input holding a date', 'date-time', new Date(0)],
  ] as const)(
    'refuses to apply a function over %s to %s',
    (operandType, _label, contract, value) => {
      const failure = refusalOf(() => applied(operandType, contract, value));
      expect(failure.diagnostic.code).toBe('invalid-rich-message');
      expect(failure.diagnostic.outcome).toBe('operational-failure');
    },
  );

  it.each(['boolean', 'date-time', 'integer', 'number', 'string'] as const)(
    'refuses a function over %s written with no operand',
    (operandType) => {
      const failure = refusalOf(() =>
        renderArtifact(
          { body: patternBody([call(undefined)]) },
          {},
          extensionsOf({ operandType }),
        ),
      );
      expect(failure.diagnostic.code).toBe('invalid-rich-message');
    },
  );

  it.each(['boolean', 'date-time', 'integer', 'number', 'string'] as const)(
    'refuses a function over %s applied to an input that is null',
    (operandType) => {
      const failure = refusalOf(() =>
        renderArtifact(
          {
            body: patternBody([call(variable('value'))]),
            inputs: inputOf('string', { nullable: true }),
          },
          { value: null },
          extensionsOf({ operandType }),
        ),
      );
      expect(failure.diagnostic.code).toBe('invalid-rich-message');
    },
  );

  it('reads a literal operand as a number where the function is over numbers', () => {
    const seen: unknown[] = [];
    const extensions = extensionsOf(
      { operandType: 'integer' },
      (invocation) => {
        seen.push(invocation.operand);
        return { text: 'ok', value: 'ok' };
      },
    );
    expect(
      renderArtifact(
        { body: patternBody([call(literal('42'))]) },
        {},
        extensions,
      ),
    ).toBe('ok');
    expect(seen).toEqual([42]);
    expect(
      refusalOf(() =>
        renderArtifact(
          { body: patternBody([call(literal('4.2'))]) },
          {},
          extensions,
        ),
      ).diagnostic.code,
    ).toBe('invalid-rich-message');
  });

  it('applies a function over text to a literal as long as the output ceiling and no longer', () => {
    const extensions = extensionsOf({}, () => ({ text: 'ok', value: 'ok' }));
    expect(
      renderArtifact(
        { body: patternBody([call(literal(LONGEST))]) },
        {},
        extensions,
      ),
    ).toBe('ok');
    const failure = refusalOf(() =>
      renderArtifact(
        { body: patternBody([call(literal(`${LONGEST}a`))]) },
        {},
        extensions,
      ),
    );
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
  });
});

describe('the value a message function returns', () => {
  const returned = (
    resultType: Described['resultType'],
    value: unknown,
  ): string =>
    renderArtifact(
      { body: patternBody([call(literal('operand'))]) },
      {},
      extensionsOf(
        { resultType },
        () => ({ text: 'ok', value }) as unknown as MessageFunctionResult,
      ),
    );

  it.each([
    ['string', 'a word', 'word'],
    ['string', 'the empty string', ''],
    ['string', 'text as long as the output ceiling', LONGEST],
    ['number', 'a fraction', 1.5],
    ['number', 'zero', 0],
    ['date-time', 'a date', new Date(Date.UTC(2024, 0, 2))],
    ['date-time', 'a timestamp', 1_700_000_000_000],
  ] as const)(
    'lets a %s result out holding %s',
    (resultType, _label, value) => {
      expect(returned(resultType, value)).toBe('ok');
    },
  );

  it.each([
    ['string', 'a number', 5],
    ['string', 'a boolean', true],
    ['string', 'a list of strings', ['a']],
    ['string', 'text one code point past the output ceiling', `${LONGEST}a`],
    ['number', 'a number written as text', '1.5'],
    ['number', 'not a number', Number.NaN],
    ['number', 'infinity', Number.POSITIVE_INFINITY],
    ['number', 'a boolean', true],
    ['date-time', 'a date that holds no time', new Date(Number.NaN)],
    ['date-time', 'not a number', Number.NaN],
    ['date-time', 'negative infinity', Number.NEGATIVE_INFINITY],
    ['date-time', 'a date written as text', '2024-01-02T00:00:00Z'],
    ['date-time', 'an object that is not a date', { getTime: (): number => 0 }],
  ] as const)('refuses a %s result holding %s', (resultType, _label, value) => {
    const failure = refusalOf(() => returned(resultType, value));
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
  });

  it('takes the operand as the value when the function returns none', () => {
    const textOnly = (): MessageFunctionResult => ({ text: 'ok' });
    expect(
      renderArtifact(
        { body: patternBody([call(literal('operand'))]) },
        {},
        extensionsOf({ resultType: 'string' }, textOnly),
      ),
    ).toBe('ok');
    // The operand is text, so it cannot stand in for a number the function did not return.
    expect(
      refusalOf(() =>
        renderArtifact(
          { body: patternBody([call(literal('operand'))]) },
          {},
          extensionsOf({ resultType: 'number' }, textOnly),
        ),
      ).diagnostic.code,
    ).toBe('invalid-rich-message');
  });
});

describe('the options a message function declares', () => {
  const OPTIONS: NonNullable<Described['options']> = {
    label: { type: 'string', required: true },
    level: { type: 'integer', values: [0, 1] },
    size: { type: 'integer' },
    ratio: { type: 'number' },
    flag: { type: 'boolean' },
  };

  const SIZE: readonly CompiledInputContract[] = [
    { name: 'size', type: 'number', optional: true, nullable: true },
  ];

  const withOptions = (
    options: Readonly<Record<string, unknown>>,
    values: Readonly<Record<string, unknown>> = {},
  ): string =>
    renderArtifact(
      { body: patternBody([call(literal('operand'), options)]), inputs: SIZE },
      values,
      extensionsOf({ options: OPTIONS }),
    );

  const refused = (
    options: Readonly<Record<string, unknown>>,
    values: Readonly<Record<string, unknown>> = {},
  ): void => {
    const failure = refusalOf(() => withOptions(options, values));
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
  };

  it('calls the function with the options the message wrote', () => {
    expect(
      withOptions({
        label: literal('x'),
        level: literal('1'),
        size: literal('12'),
        ratio: literal('0.5'),
        flag: literal('true'),
      }),
    ).toBe('ok(flag=true,label=x,level=1,ratio=0.5,size=12)');
  });

  it('calls the function when only the required option is written', () => {
    expect(withOptions({ label: literal('x') })).toBe('ok(label=x)');
  });

  it('refuses a call that leaves a required option out', () => {
    refused({});
    refused({ size: literal('12') });
  });

  it('refuses an option the descriptor does not declare', () => {
    refused({ label: literal('x'), colour: literal('red') });
  });

  it.each([
    ['an integer option given a word', { size: literal('twelve') }],
    ['an integer option given a fraction', { size: literal('1.5') }],
    ['a number option given a word', { ratio: literal('half') }],
    ['a boolean option given a word', { flag: literal('yes') }],
    ['a closed option given a value outside its list', { level: literal('2') }],
    ['a closed option given a word', { level: literal('low') }],
  ])('refuses %s', (_label, options) => {
    refused({ label: literal('x'), ...options });
  });

  it('holds an option that arrives through a variable to its declared type', () => {
    expect(
      withOptions(
        { label: literal('x'), size: variable('size') },
        { size: 12 },
      ),
    ).toBe('ok(label=x,size=12)');
    refused({ label: literal('x'), size: variable('size') }, { size: 1.5 });
  });

  it.each([
    ['was omitted', {}],
    ['is null', { size: null }],
  ])(
    'calls the function without an option whose variable %s',
    (_label, values) => {
      expect(
        withOptions({ label: literal('x'), size: variable('size') }, values),
      ).toBe('ok(label=x)');
    },
  );

  it.each([
    ['was omitted', {}],
    ['is null', { size: null }],
  ])(
    'refuses a call whose required option is written as a variable that %s',
    (_label, values) => {
      refused({ label: variable('size') }, values);
    },
  );

  it.each([
    ['was omitted', {}],
    ['is null', { size: null }],
  ])(
    'leaves what the operand carried in force for an option whose variable %s',
    (_label, values) => {
      expect(
        renderArtifact(
          {
            body: patternBody(
              [
                call(variable('first'), {
                  label: literal('y'),
                  size: variable('size'),
                }),
              ],
              [
                local(
                  'first',
                  call(literal('operand'), {
                    label: literal('x'),
                    size: literal('12'),
                  }),
                ),
              ],
            ),
            inputs: SIZE,
          },
          values,
          extensionsOf({ options: OPTIONS }),
        ),
      ).toBe('ok(label=y,size=12)');
    },
  );

  it('refuses a required option whose variable holds the wrong type', () => {
    refused({ label: variable('size') }, { size: 12 });
  });

  it('calls a function that declares no options', () => {
    expect(
      renderArtifact(
        { body: patternBody([call(literal('operand'))]) },
        {},
        extensionsOf({}),
      ),
    ).toBe('ok()');
  });

  it('refuses any option on a function that declares none', () => {
    const failure = refusalOf(() =>
      renderArtifact(
        {
          body: patternBody([call(literal('operand'), { size: literal('1') })]),
        },
        {},
        extensionsOf({}),
      ),
    );
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
  });

  it('carries a declared option from a declaration into a later call', () => {
    expect(
      renderArtifact(
        {
          body: patternBody(
            [call(variable('first'), { label: literal('y') })],
            [
              local(
                'first',
                call(literal('operand'), {
                  label: literal('x'),
                  size: literal('12'),
                }),
              ),
            ],
          ),
        },
        {},
        extensionsOf({ options: OPTIONS }),
      ),
    ).toBe('ok(label=y,size=12)');
  });
});
