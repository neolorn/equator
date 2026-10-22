import { describe, expect, it } from 'vitest';

import type {
  MessageFunctionResult,
  RuntimeMessageFunctionDescriptor,
  RuntimeRichSlotKindDescriptor,
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
import { render } from './message-harness.js';

const repeated = (value: unknown, times: number): unknown[] =>
  Array.from({ length: times }, () => value);

const refusedAsMalformed = (run: () => unknown): void => {
  const failure = refusalOf(run);
  expect(failure.diagnostic.code).toBe('invalid-rich-message');
  expect(failure.diagnostic.outcome).toBe('operational-failure');
};

/**
 * LDML 48 Part 9, "Compare Variants", over more than one selector.
 *
 * Two variants that both match are compared key by key from the left, and the first position
 * where they differ decides. A position where they agree decides nothing, whether they agree on
 * a key or on the catch-all, and a catch-all loses to any key at the position it is compared.
 */
describe('how two matching variants over two selectors are ranked', () => {
  const PAIR: readonly CompiledInputContract[] = [
    { name: 'first', type: 'number', optional: false, nullable: false },
    { name: 'second', type: 'number', optional: false, nullable: false },
  ];
  const choose = (...variants: readonly string[]): string =>
    render(
      [
        '.input {$first :number}',
        '.input {$second :number}',
        '.match $first $second',
        ...variants,
        '* * {{none}}',
      ].join('\n'),
      PAIR,
      { first: 1, second: 1 },
    );

  it('lets the first selector decide before the second is looked at', () => {
    expect(choose('one * {{by first}}', '* 1 {{by second}}')).toBe('by first');
    expect(choose('* 1 {{by second}}', 'one * {{by first}}')).toBe('by first');
  });

  it('moves on to the second selector when both write the catch-all for the first', () => {
    expect(choose('* one {{category}}', '* 1 {{exact}}')).toBe('exact');
  });

  it('moves on to the second selector when both write the same key for the first', () => {
    expect(choose('1 one {{category}}', '1 1 {{exact}}')).toBe('exact');
    expect(choose('one one {{category}}', 'one 1 {{exact}}')).toBe('exact');
  });

  // The toolkit refuses two variants with the same keys, so the artifact is assembled by hand.
  it.each([
    ['the same keys', [literal('1'), literal('1')]],
    ['the catch-all throughout', [{ kind: 'catchall' }, { kind: 'catchall' }]],
  ])('keeps the earlier of two variants that write %s', (_label, keys) => {
    expect(
      renderArtifact(
        {
          body: {
            kind: 'select',
            declarations: [],
            selectors: ['first', 'second'],
            variants: [
              { keys, pattern: ['earlier'] },
              { keys, pattern: ['later'] },
            ],
          },
          inputs: PAIR,
        },
        { first: 1, second: 1 },
      ),
    ).toBe('earlier');
  });
});

/**
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 7 fixes the ceilings in a release.
 * Each is asserted at its last permitted count and one past it.
 */
describe('the ceilings on what one evaluation does', () => {
  const COUNT: readonly CompiledInputContract[] = [
    { name: 'count', type: 'number', optional: false, nullable: false },
  ];

  it('calls as many functions as the function ceiling and refuses one more', () => {
    const call = local(
      'scratch',
      expression(variable('count'), { name: 'number', options: {} }),
    );
    const calling = (calls: number): string =>
      renderArtifact(
        { body: patternBody(['done'], repeated(call, calls)), inputs: COUNT },
        { count: 1 },
      );
    expect(calling(RUNTIME_LIMITS.evaluationFunctions)).toBe('done');
    refusedAsMalformed(() => calling(RUNTIME_LIMITS.evaluationFunctions + 1));
  });

  /**
   * A variant of one catch-all costs three steps to read and match, and one more to compare with
   * the best so far, which every variant after the first is. With one step for the selector that
   * is four steps a variant, so a quarter of the ceiling in variants lands exactly on it.
   */
  it('counts the comparison of two matching variants toward the step ceiling', () => {
    const selecting = (variants: number): string =>
      renderArtifact(
        {
          body: {
            kind: 'select',
            declarations: [],
            selectors: ['count'],
            variants: repeated(
              { keys: [{ kind: 'catchall' }], pattern: [] },
              variants,
            ),
          },
          inputs: COUNT,
        },
        { count: 1 },
      );
    const atCeiling = RUNTIME_LIMITS.evaluationSteps / 4;
    expect(Number.isInteger(atCeiling)).toBe(true);
    expect(selecting(atCeiling)).toBe('');
    refusedAsMalformed(() => selecting(atCeiling + 1));
  });
});

/**
 * A catalog states the most parts any of its messages produces, and an evaluation is held to
 * that. The harness's catalog states 64. Text, a value and a slot are each one part.
 */
describe('the output-part bound a catalog states', () => {
  const BOUND = 64;
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

  it.each([
    ['text', 'x', 'x'],
    ['value', expression(literal('x')), 'x'],
    [
      'slot',
      {
        kind: 'markup',
        markupKind: 'standalone',
        name: 'mark',
        options: {},
        attributes: {},
      },
      '',
    ],
  ])('holds a message of %s parts to the bound', (_label, part, printed) => {
    const producing = (parts: number): string =>
      renderArtifact({
        body: patternBody(repeated(part, parts)),
        slots: MARK,
        resultKind: 'structured',
      });
    expect(producing(BOUND)).toBe(printed.repeat(BOUND));
    refusedAsMalformed(() => producing(BOUND + 1));
  });

  it('counts a slot and what it wraps as separate parts', () => {
    const WRAP: readonly CompiledSlotContract[] = [
      { ...MARK[0]!, shape: 'paired' },
    ];
    const wrapping = (inside: number): string =>
      renderArtifact({
        body: patternBody([
          { kind: 'markup', markupKind: 'open', name: 'mark', options: {} },
          ...repeated('x', inside),
          { kind: 'markup', markupKind: 'close', name: 'mark', options: {} },
        ]),
        slots: WRAP,
        resultKind: 'structured',
      });
    expect(wrapping(BOUND - 1)).toBe('x'.repeat(BOUND - 1));
    refusedAsMalformed(() => wrapping(BOUND));
  });
});

/**
 * The output ceiling is counted as parts are produced. A slot whose binding projects its own
 * short text hides its children from the projected string, and the children are still what a
 * template renders, so a value inside one counts the same as a value outside.
 */
describe('the output ceiling on the values of one message', () => {
  it('counts a value inside a slot whatever the slot projects', () => {
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
    const markup = (markupKind: string): unknown => ({
      kind: 'markup',
      markupKind,
      name: 'wrap',
      options: {},
      attributes: {},
    });
    const half = RUNTIME_LIMITS.outputCodePoints / 2;
    const printing = (first: number, second: number): string =>
      renderArtifact(
        {
          body: patternBody([
            markup('open'),
            expression(variable('first')),
            expression(variable('second')),
            markup('close'),
          ]),
          inputs: [
            { name: 'first', type: 'string', optional: false, nullable: false },
            {
              name: 'second',
              type: 'string',
              optional: false,
              nullable: false,
            },
          ],
          slots: [
            {
              name: 'wrap',
              kind: 'test:wrap',
              shape: 'paired',
              optional: false,
              repeatable: false,
              within: [],
            },
          ],
          resultKind: 'structured',
        },
        { first: 'a'.repeat(first), second: 'b'.repeat(second) },
        new RuntimeExtensions([{ descriptor, projectText: () => 'short' }]),
      );
    expect(printing(half, half)).toBe('short');
    refusedAsMalformed(() => printing(half, half + 1));
  });
});

/**
 * A function that selects returns the keys it matches, and the list is consumer data walked once
 * for every variant, so it has a length the evaluator stops at.
 */
describe('the keys a selecting function returns', () => {
  const selectingBy = (selectKeys: readonly string[]): string => {
    const registry = defineExtensionRegistry([
      {
        kind: 'message-function',
        id: 'test:rank',
        operandType: 'string',
        resultType: 'string',
        selector: 'exact',
        maximumOutputLength: 64,
      },
    ]);
    if (!registry.ok) throw new Error('The descriptor under test was refused.');
    return renderArtifact(
      {
        body: {
          kind: 'select',
          declarations: [
            local(
              'ranked',
              expression(literal('word'), { name: 'test:rank', options: {} }),
            ),
          ],
          selectors: ['ranked'],
          variants: [
            { keys: [literal('key1')], pattern: ['second key'] },
            { keys: [literal('key0')], pattern: ['first key'] },
            { keys: [literal('absent')], pattern: ['no key'] },
            { keys: [{ kind: 'catchall' }], pattern: ['none'] },
          ],
        },
      },
      {},
      new RuntimeExtensions([
        {
          descriptor: registry.value
            .descriptors[0] as unknown as RuntimeMessageFunctionDescriptor,
          evaluate: (): MessageFunctionResult => ({
            text: 'ranked',
            selectKeys,
          }),
        },
      ]),
    );
  };
  const keys = (count: number): string[] =>
    Array.from({ length: count }, (_, index) => `key${index}`);

  it('are taken up to the ceiling and refused one past it', () => {
    expect(selectingBy(keys(RUNTIME_LIMITS.extensionSelectKeys))).toBe(
      'first key',
    );
    refusedAsMalformed(() =>
      selectingBy(keys(RUNTIME_LIMITS.extensionSelectKeys + 1)),
    );
  });

  it('rank the variants in the order the function gave them', () => {
    expect(selectingBy(['key1', 'key0'])).toBe('second key');
    expect(selectingBy(['key0', 'key1'])).toBe('first key');
    expect(selectingBy([])).toBe('none');
  });
});
