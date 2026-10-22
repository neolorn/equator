import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  type MessageFunctionResult,
  type RuntimeMessageFunctionDescriptor,
  type RuntimeRichSlotKindDescriptor,
} from '@neolorn/equator/core';

import { defineExtensionRegistry } from '../../toolkit/src/extensions.js';
import type {
  CompiledInputContract,
  CompiledSlotContract,
} from '../src/catalog-runtime.js';
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
import { parse, renderSemantics } from './message-harness.js';

/**
 * The references a compiled message is made of, read from an artifact nothing vouches for.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 2 makes a catalog data, and the runtime is a
 * separately published package whose input is a compiled artifact: it has no way to know what
 * produced one. The toolkit's parser emits two reference shapes and nothing else, so every other
 * shape here is assembled by hand, which is the only way to hand the evaluator what a foreign or
 * damaged artifact would.
 *
 * Refusals are asserted by code, reason and cause. `invalid-rich-message` says the artifact is
 * wrong and `invalid-message-input` says the caller's values are, and a consumer deciding whom to
 * tell reads exactly that difference.
 */

const NONE: readonly CompiledInputContract[] = Object.freeze([]);

const COUNT: readonly CompiledInputContract[] = Object.freeze([
  { name: 'count', type: 'number', optional: false, nullable: false },
]);

const renderOperand = (operand: unknown): string =>
  renderArtifact(
    { body: patternBody([expression(operand)]), inputs: COUNT },
    { count: 3 },
  );

describe('a reference in a compiled message', () => {
  it('reads a literal as the text it carries', () => {
    expect(renderOperand(literal('written'))).toBe('written');
  });

  it('reads a variable as the value its name was given', () => {
    expect(renderOperand(variable('count'))).toBe('3');
  });

  it('reads a variable by its name whatever else the reference carries', () => {
    expect(
      renderOperand({ kind: 'variable', name: 'count', value: 'stray' }),
    ).toBe('3');
  });

  it('reads a literal by its value whatever else the reference carries', () => {
    expect(
      renderOperand({ kind: 'literal', value: 'written', name: 'count' }),
    ).toBe('written');
  });

  it.each([
    ['null', null],
    ['a bare string', 'count'],
    ['a number', 3],
    ['a list', [literal('written')]],
    ['a reference of no kind', { value: 'written', name: 'count' }],
    [
      'a reference of an unknown kind',
      { kind: 'other', value: 'written', name: 'count' },
    ],
    ['a literal whose value is not text', literal(3)],
    ['a literal with no value', { kind: 'literal' }],
    ['a variable whose name is not text', variable(3)],
    ['a variable with no name', { kind: 'variable' }],
    [
      'a variable whose name is not text beside a value that is',
      { kind: 'variable', name: 3, value: 'written' },
    ],
    [
      'a literal whose value is not text beside a name that is',
      { kind: 'literal', value: 3, name: 'count' },
    ],
  ])('refuses %s as a malformed artifact', (_label, operand) => {
    const failure = refusalOf(() => renderOperand(operand));
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
  });

  it('refuses a variable nothing supplies as a problem with the inputs', () => {
    const failure = refusalOf(() => renderOperand(variable('missing')));
    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
  });

  it('holds an option value to the same shapes as an operand', () => {
    const render = (reference: unknown): string =>
      renderArtifact(
        {
          body: patternBody([
            expression(variable('count'), {
              name: 'number',
              options: { minimumFractionDigits: reference },
            }),
          ]),
          inputs: COUNT,
        },
        { count: 3 },
      );
    expect(render(literal('2'))).toBe('3.00');
    expect(refusalOf(() => render(literal(2))).diagnostic.code).toBe(
      'invalid-rich-message',
    );
    expect(refusalOf(() => render(null)).diagnostic.code).toBe(
      'invalid-rich-message',
    );
    expect(refusalOf(() => render(variable('missing'))).diagnostic.code).toBe(
      'invalid-message-input',
    );
  });

  it('formats through a function that was compiled with no option mapping', () => {
    expect(
      renderArtifact(
        {
          body: patternBody([
            expression(variable('count'), { name: 'number' }),
          ]),
          inputs: COUNT,
        },
        { count: 1234.5 },
      ),
    ).toBe('1,234.5');
    expect(
      renderArtifact({
        body: patternBody([
          expression(literal('written'), { name: 'string', options: null }),
        ]),
      }),
    ).toBe('written');
  });
});

/**
 * The fixed ceilings on what one evaluation may read.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 7 fixes the ceilings in a release and
 * lets no artifact raise one. Each is asserted at its last permitted count and one past it,
 * because a ceiling that is off by one in either direction passes every ordinary message.
 *
 * One reference object is repeated rather than built a quarter of a million times: the artifact
 * is data, and the evaluator counts what it reads, not what the artifact holds by identity.
 */
describe('the ceilings on what one evaluation reads', () => {
  const repeated = (value: unknown, times: number): unknown[] =>
    Array.from({ length: times }, () => value);

  const MARK: readonly CompiledSlotContract[] = [
    {
      name: 'mark',
      kind: 'test:mark',
      shape: 'standalone',
      optional: false,
      repeatable: false,
      within: [],
    },
  ];

  // A slot's options are the cheapest place an artifact can put a literal: each is read once and
  // nothing else is done with it. Thirty-two slots share the reads so no one mapping is large.
  const markWith = (options: number): unknown => {
    const shared = literal('x');
    return {
      kind: 'markup',
      markupKind: 'standalone',
      name: 'mark',
      options: Object.fromEntries(
        Array.from({ length: options }, (_, index) => [
          `option${index}`,
          shared,
        ]),
      ),
      attributes: {},
    };
  };

  const renderLiterals = (count: number): string => {
    const slots = 32;
    const each = Math.floor(count / slots);
    return renderArtifact({
      body: patternBody([
        'done',
        ...repeated(markWith(each), slots),
        ...(count === each * slots ? [] : [markWith(count - each * slots)]),
      ]),
      slots: MARK,
      resultKind: 'structured',
    });
  };

  const variableDeclaration = local('scratch', expression(variable('count')));

  const renderVariables = (count: number): string =>
    renderArtifact(
      {
        body: patternBody(['done'], repeated(variableDeclaration, count)),
        inputs: COUNT,
      },
      { count: 1 },
    );

  it('reads as many literals as the literal ceiling and refuses one more', () => {
    expect(renderLiterals(RUNTIME_LIMITS.evaluationLiterals)).toBe('done');
    expect(
      refusalOf(() => renderLiterals(RUNTIME_LIMITS.evaluationLiterals + 1))
        .diagnostic.code,
    ).toBe('invalid-rich-message');
  });

  it('reads as many variables as the reference ceiling and refuses one more', () => {
    expect(renderVariables(RUNTIME_LIMITS.evaluationReferences)).toBe('done');
    expect(
      refusalOf(() => renderVariables(RUNTIME_LIMITS.evaluationReferences + 1))
        .diagnostic.code,
    ).toBe('invalid-rich-message');
  });

  /**
   * A declaration that reads a variable costs three steps, one of them the read, and a variant
   * whose one key does not match costs three more. The declarations alone stay under the reference
   * ceiling and under the step ceiling, so the variants decide which side of the step ceiling the
   * message lands on, and the reads are what put the larger message over it.
   */
  it('counts every reference read toward the step ceiling', () => {
    const declarations = 262_000;
    expect(declarations).toBeLessThan(RUNTIME_LIMITS.evaluationReferences);
    const stepsDeclared = declarations * 3;
    expect(stepsDeclared).toBeLessThan(RUNTIME_LIMITS.evaluationSteps);
    const variantsToCeiling = Math.ceil(
      (RUNTIME_LIMITS.evaluationSteps - stepsDeclared) / 3,
    );
    // Removing the reads from the larger message must leave it under the ceiling, or the case
    // would not show that the reads are counted.
    expect(
      stepsDeclared - declarations + (variantsToCeiling + 8_000) * 3,
    ).toBeLessThan(RUNTIME_LIMITS.evaluationSteps - 1_000);
    const unmatched = { keys: [literal('no')], pattern: ['no'] };
    const render = (variants: number): string =>
      renderArtifact(
        {
          body: {
            kind: 'select',
            declarations: repeated(variableDeclaration, declarations),
            selectors: ['count'],
            variants: [
              ...repeated(unmatched, variants),
              { keys: [{ kind: 'catchall' }], pattern: ['done'] },
            ],
          },
          inputs: COUNT,
        },
        { count: 1 },
      );
    expect(render(variantsToCeiling - 8_000)).toBe('done');
    expect(
      refusalOf(() => render(variantsToCeiling + 8_000)).diagnostic.code,
    ).toBe('invalid-rich-message');
  });

  /**
   * The same message, sized to the step. Besides three steps for each declaration and each
   * variant it costs one for its selector and two for each text part of the pattern it selects,
   * so the two bodies below differ by exactly one step and sit on either side of the ceiling.
   */
  it('evaluates a message of exactly as many steps as the ceiling and refuses one step more', () => {
    const render = (triples: number, textParts: number): string => {
      const declarations = 262_000;
      const unmatched = { keys: [literal('no')], pattern: ['no'] };
      return renderArtifact(
        {
          body: {
            kind: 'select',
            declarations: repeated(variableDeclaration, declarations),
            selectors: ['count'],
            variants: [
              ...repeated(unmatched, triples - declarations - 1),
              {
                keys: [{ kind: 'catchall' }],
                pattern: repeated('x', textParts),
              },
            ],
          },
          inputs: COUNT,
        },
        { count: 1 },
      );
    };
    const steps = (triples: number, textParts: number): number =>
      triples * 3 + 1 + textParts * 2;
    const atCeiling = [(RUNTIME_LIMITS.evaluationSteps - 1) / 3, 0] as const;
    const onePast = [(RUNTIME_LIMITS.evaluationSteps - 4) / 3, 2] as const;
    expect(steps(...atCeiling)).toBe(RUNTIME_LIMITS.evaluationSteps);
    expect(steps(...onePast)).toBe(RUNTIME_LIMITS.evaluationSteps + 1);
    expect(render(...atCeiling)).toBe('');
    expect(refusalOf(() => render(...onePast)).diagnostic.code).toBe(
      'invalid-rich-message',
    );
    // At the ceiling again with a pattern that has parts, so the refusal above is the ceiling's
    // and not something about a pattern that is not empty.
    expect(steps(onePast[0] - 1, 3)).toBe(RUNTIME_LIMITS.evaluationSteps);
    expect(render(onePast[0] - 1, 3)).toBe('xxx');
  });

  /**
   * The parts are bounded as they are produced, not only when they are projected to a string. A
   * slot whose binding projects its own short text hides its children from the projection, and the
   * children are still what a template binding renders, so the bound has to hold on them too.
   */
  it('counts the text inside a slot toward the output ceiling whatever the slot projects', () => {
    const registry = defineExtensionRegistry([
      {
        kind: 'rich-slot-kind',
        id: 'test:wrap',
        shape: 'paired',
        interactive: false,
        textProjection: 'binding-required',
      },
    ]);
    if (!registry.ok) throw new Error('The descriptor under test was refused.');
    const descriptor = registry.value
      .descriptors[0] as unknown as RuntimeRichSlotKindDescriptor;
    const WRAP: readonly CompiledSlotContract[] = [
      {
        name: 'wrap',
        kind: 'test:wrap',
        shape: 'paired',
        optional: false,
        repeatable: false,
        within: [],
      },
    ];
    const markup = (markupKind: string): unknown => ({
      kind: 'markup',
      markupKind,
      name: 'wrap',
      options: {},
      attributes: {},
    });
    const half = RUNTIME_LIMITS.outputCodePoints / 2;
    const render = (first: number, second: number): string =>
      renderArtifact(
        {
          body: patternBody([
            markup('open'),
            'a'.repeat(first),
            'b'.repeat(second),
            markup('close'),
          ]),
          slots: WRAP,
          resultKind: 'structured',
        },
        {},
        new RuntimeExtensions([{ descriptor, projectText: () => 'short' }]),
      );
    expect(render(half, half)).toBe('short');
    expect(refusalOf(() => render(half, half + 1)).diagnostic.code).toBe(
      'invalid-rich-message',
    );
    expect(refusalOf(() => render(half + 1, half)).diagnostic.code).toBe(
      'invalid-rich-message',
    );
  });
});

/**
 * What a refusal raised while evaluating carries besides its code.
 *
 * `LocalizationDiagnostic.reason` and the error's `cause` are published. A reason is present when
 * the evaluator knows why and absent otherwise, never present and empty; a cause is the platform
 * or consumer error that decided the refusal, and a refusal the evaluator decided alone has none
 * behind it.
 */
describe('what an evaluation refusal carries', () => {
  const extensionsThatThrow = (thrown: Error): RuntimeExtensions => {
    const registry = defineExtensionRegistry([
      {
        kind: 'message-function',
        id: 'test:fails',
        operandType: 'string',
        resultType: 'string',
        selector: 'none',
        maximumOutputLength: 32,
      },
    ]);
    if (!registry.ok) throw new Error('The descriptor under test was refused.');
    return new RuntimeExtensions([
      {
        descriptor: registry.value
          .descriptors[0] as unknown as RuntimeMessageFunctionDescriptor,
        evaluate: (): MessageFunctionResult => {
          throw thrown;
        },
      },
    ]);
  };

  it('names the consumer code that threw and keeps what it threw', () => {
    const thrown = new Error('the consumer function failed');
    const failure = refusalOf(() =>
      renderArtifact(
        {
          body: patternBody([
            expression(literal('x'), { name: 'test:fails', options: {} }),
          ]),
        },
        {},
        extensionsThatThrow(thrown),
      ),
    );
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
    expect(failure.diagnostic.reason).toBe('consumer-code-threw');
    expect(failure.cause).toBe(thrown);
  });

  it('gives a malformed artifact no reason and no cause behind it', () => {
    const failure = refusalOf(() =>
      renderArtifact({
        body: patternBody([expression(literal('x'), { name: 'test:absent' })]),
      }),
    );
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
    expect(Object.keys(failure.diagnostic)).not.toContain('reason');
    // The refusal as it was raised, before the message was named on it.
    const raised = failure.cause;
    expect(raised).toBeInstanceOf(LocalizationError);
    expect('cause' in (raised as LocalizationError)).toBe(false);
  });

  it('names the platform rejection behind options Intl would not take', () => {
    const digits: readonly CompiledInputContract[] = [
      { name: 'least', type: 'integer', optional: false, nullable: false },
      { name: 'most', type: 'integer', optional: false, nullable: false },
    ];
    const failure = refusalOf(() =>
      renderSemantics(
        parse(
          '{1 :number minimumFractionDigits=$least maximumFractionDigits=$most}',
        ),
        digits,
        { least: 5, most: 2 },
      ),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
    expect(failure.diagnostic.reason).toBe('native-capability-rejected');
    expect(failure.cause).toBeInstanceOf(RangeError);
  });

  it('gives a refused input no reason and no cause behind it', () => {
    const failure = refusalOf(() =>
      renderSemantics(parse('{$count :number}'), COUNT, { count: 'three' }),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
    expect(Object.keys(failure.diagnostic)).not.toContain('reason');
    const raised = failure.cause;
    expect(raised).toBeInstanceOf(LocalizationError);
    expect('cause' in (raised as LocalizationError)).toBe(false);
  });

  it('names the message a refusal was raised for', () => {
    const failure = refusalOf(() =>
      renderSemantics(parse('{$count :number}'), NONE, { count: 3 }),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.messageIdentity).toBe(
      'selection:selection:subject',
    );
  });
});
