import { describe, expect, it } from 'vitest';

import type {
  LocalizedSlotPart,
  MessageFunctionInvocation,
  MessageFunctionResult,
  RuntimeMessageFunctionDescriptor,
} from '@neolorn/equator/core';

import { defineExtensionRegistry } from '../../toolkit/src/extensions.js';
import type {
  CompiledInputContract,
  CompiledSlotContract,
} from '../src/catalog-runtime.js';
import { RuntimeExtensions } from '../src/extensions.js';
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

/**
 * A compiled body the evaluator was not built to read is refused, and refused as itself.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` treats a compiled catalog as data that has to
 * be checked where it is read, and the evaluator reads every node of a message body. Each case
 * here hands it one node in a shape no toolkit emits and asserts the same outcome:
 * `invalid-rich-message`, raised by the evaluator. `refusalOf` rethrows anything that is not a
 * refusal, so a body that got past its check and failed later as a `TypeError`, or rendered as
 * though it were well formed, fails the case.
 */

const COUNT: readonly CompiledInputContract[] = [
  { name: 'count', type: 'number', optional: false, nullable: false },
];

const slot = (
  name: string,
  shape: CompiledSlotContract['shape'],
): CompiledSlotContract => ({
  name,
  kind: `test:${name}`,
  shape,
  optional: false,
  repeatable: false,
  within: [],
});

const markup = (
  name: unknown,
  markupKind: unknown,
  kind: unknown = 'markup',
): unknown => ({ kind, markupKind, name, options: {}, attributes: {} });

const expectMalformed = (run: () => unknown): void => {
  const failure = refusalOf(run);
  expect(failure.diagnostic.code).toBe('invalid-rich-message');
  expect(failure.diagnostic.outcome).toBe('operational-failure');
};

describe('the body of a compiled message', () => {
  it.each([
    ['nothing', null],
    ['text', 'pattern'],
    ['a list', []],
  ])('is refused when it is %s', (_label, body) => {
    expectMalformed(() => renderArtifact({ body }));
  });

  it('is refused when its kind is neither a pattern nor a selection', () => {
    expectMalformed(() =>
      renderArtifact({
        body: {
          kind: 'choice',
          declarations: [],
          selectors: [],
          variants: [{ keys: [], pattern: ['chosen'] }],
        },
      }),
    );
  });

  it.each([
    ['text', 'printed'],
    ['absent', undefined],
    ['a record', { 0: 'printed' }],
  ])('is refused when its pattern is %s', (_label, pattern) => {
    expectMalformed(() =>
      renderArtifact({ body: { kind: 'pattern', declarations: [], pattern } }),
    );
  });
});

describe('the inputs a message is evaluated with', () => {
  it.each([
    ['a number', 5],
    ['a boolean', true],
    ['a list', []],
    ['null', null],
    ['text', 'count'],
  ])('are refused when they are %s', (_label, values) => {
    const failure = refusalOf(() =>
      renderArtifact({ body: patternBody(['printed']) }, values),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
  });

  it('may be left out when the message declares none', () => {
    expect(renderArtifact({ body: patternBody(['printed']) }, undefined)).toBe(
      'printed',
    );
  });
});

describe('the declarations of a compiled message', () => {
  const declaring = (declarations: unknown): string =>
    renderArtifact({
      body: { kind: 'pattern', declarations, pattern: ['printed'] },
    });

  it.each([
    ['absent', undefined],
    ['a record', {}],
    ['text', 'local'],
  ])('are refused when they are %s', (_label, declarations) => {
    expectMalformed(() => declaring(declarations));
  });

  it.each([
    ['nothing', null],
    ['text', 'local'],
    [
      'of a kind that is not a declaration',
      { kind: 'match', name: 'n', value: expression(literal('1')) },
    ],
    ['named by a number', { kind: 'local', name: 5, value: expression() }],
    ['unnamed', { kind: 'local', value: expression(literal('1')) }],
  ])('refuses a declaration that is %s', (_label, declaration) => {
    expectMalformed(() => declaring([declaration]));
  });

  it.each([
    ['nothing', null],
    ['text', 'value'],
    ['a reference', literal('value')],
    ['a list', [expression(literal('value'))]],
  ])('refuses a declaration whose value is %s', (_label, value) => {
    expectMalformed(() => declaring([local('n', value)]));
  });

  it('accepts both kinds of declaration', () => {
    expect(
      renderArtifact(
        {
          body: patternBody(
            [expression(variable('count')), ' ', expression(variable('n'))],
            [
              {
                kind: 'input',
                name: 'count',
                value: expression(variable('count'), {
                  name: 'number',
                  options: { minimumFractionDigits: literal('1') },
                }),
              },
              local('n', expression(literal('word'))),
            ],
          ),
          inputs: COUNT,
        },
        { count: 2 },
      ),
    ).toBe('2.0 word');
  });
});

describe('the function of a compiled expression', () => {
  const calling = (annotation: unknown, extensions?: RuntimeExtensions) =>
    renderArtifact(
      {
        body: patternBody([
          {
            kind: 'expression',
            operand: literal('word'),
            function: annotation,
          },
        ]),
      },
      {},
      extensions,
    );

  const registered = (
    evaluate: (invocation: MessageFunctionInvocation) => MessageFunctionResult,
    selector: 'none' | 'exact' = 'none',
  ): RuntimeExtensions => {
    const registry = defineExtensionRegistry([
      {
        kind: 'message-function',
        id: 'test:subject',
        operandType: 'string',
        resultType: 'string',
        selector,
        maximumOutputLength: 64,
      },
    ]);
    if (!registry.ok) throw new Error('The descriptor under test was refused.');
    return new RuntimeExtensions([
      {
        descriptor: registry.value
          .descriptors[0] as unknown as RuntimeMessageFunctionDescriptor,
        evaluate,
      },
    ]);
  };

  it.each([
    ['nothing', null],
    ['text', 'string'],
    ['a list', [{ name: 'string' }]],
  ])('is refused when it is %s', (_label, annotation) => {
    expectMalformed(() => calling(annotation));
  });

  it('is refused when it names nothing this runtime has', () => {
    expectMalformed(() => calling({ name: 'test:absent', options: {} }));
  });

  // A list of one name reads as that name wherever it is turned into text, so the registered
  // function is the one a lookup would find.
  it('is refused, and not called, when its name is not text', () => {
    let calls = 0;
    const extensions = registered(() => {
      calls += 1;
      return { text: 'called' };
    });
    expect(calling({ name: 'test:subject', options: {} }, extensions)).toBe(
      'called',
    );
    expect(calls).toBe(1);
    expectMalformed(() =>
      calling({ name: ['test:subject'], options: {} }, extensions),
    );
    expect(calls).toBe(1);
  });

  it.each([
    ['nothing', null],
    ['text', 'printed'],
    ['a list', [{ text: 'printed' }]],
    ['a record whose text is a number', { text: 5 }],
    ['a record with no text', { value: 'printed' }],
  ])('is refused when what it returns is %s', (_label, result) => {
    expectMalformed(() =>
      calling(
        { name: 'test:subject', options: {} },
        registered(() => result as unknown as MessageFunctionResult),
      ),
    );
  });

  it.each([
    ['text', 'word'],
    ['a record', { 0: 'word' }],
  ])('is refused when the keys it selects by are %s', (_label, selectKeys) => {
    expectMalformed(() =>
      calling(
        { name: 'test:subject', options: {} },
        registered(
          () =>
            ({
              text: 'printed',
              selectKeys,
            }) as unknown as MessageFunctionResult,
          'exact',
        ),
      ),
    );
  });
});

/**
 * MessageFormat's grammar gives every expression a literal, a variable or a function, and the
 * pinned conformance suite lists the source `{}` among its syntax errors. The toolkit's parser has
 * no way to write an expression with neither, and the loader does not read inside a body, so the
 * evaluator is where one is refused.
 */
describe('a compiled expression with neither an operand nor a function', () => {
  it('is refused where it is printed', () => {
    expectMalformed(() =>
      renderArtifact({ body: patternBody(['a', expression(), 'b']) }),
    );
  });

  it('is refused where a declaration binds it', () => {
    expectMalformed(() =>
      renderArtifact({
        body: patternBody(['a'], [local('nothing', expression())]),
      }),
    );
  });

  it('is still an expression when it names only a function', () => {
    expect(
      renderArtifact({
        body: patternBody([expression(undefined, { name: 'string' })]),
      }),
    ).toBe('');
  });
});

describe('the selectors and variants of a compiled selection', () => {
  const selection = (extra: Readonly<Record<string, unknown>>): string =>
    renderArtifact(
      { body: { kind: 'select', declarations: [], ...extra }, inputs: COUNT },
      { count: 1 },
    );
  const catchall = { keys: [{ kind: 'catchall' }], pattern: ['none'] };
  const choosing = (...variants: readonly unknown[]): string =>
    selection({ selectors: ['count'], variants });

  it.each([
    ['no selectors', { variants: [catchall] }],
    ['no variants', { selectors: ['count'] }],
    ['neither', {}],
    ['selectors that are not a list', { selectors: 'count', variants: [] }],
    ['variants that are not a list', { selectors: ['count'], variants: {} }],
  ])('refuses a selection with %s', (_label, extra) => {
    expectMalformed(() => selection(extra));
  });

  it('refuses a selector that names no value', () => {
    expectMalformed(() =>
      selection({ selectors: ['absent'], variants: [catchall] }),
    );
  });

  it('refuses a selector that is not a name', () => {
    expectMalformed(() => selection({ selectors: [5], variants: [catchall] }));
  });

  it.each([
    ['nothing', null],
    ['text', 'one'],
    ['a record with no keys', { pattern: ['printed'] }],
    ['a record whose keys are text', { keys: '1', pattern: ['printed'] }],
  ])('refuses a variant that is %s', (_label, variant) => {
    expectMalformed(() => choosing(variant, catchall));
  });

  it('refuses a variant with fewer keys than there are selectors', () => {
    expectMalformed(() => choosing({ keys: [], pattern: ['printed'] }));
  });

  it('refuses a variant with more keys than there are selectors', () => {
    expectMalformed(() =>
      choosing({ keys: [literal('1'), literal('1')], pattern: ['printed'] }),
    );
  });

  it.each([
    ['nothing', null],
    ['text', '1'],
    ['of a kind that is not a key', { kind: 'variable', value: '1' }],
    ['a literal whose value is a number', { kind: 'literal', value: 1 }],
    ['a literal with no value', { kind: 'literal' }],
  ])('refuses a key that is %s', (_label, key) => {
    expectMalformed(() =>
      choosing({ keys: [key], pattern: ['printed'] }, catchall),
    );
  });

  // The better variant written after it would otherwise be what renders.
  it('refuses a matching variant whose pattern is not a list', () => {
    expectMalformed(() =>
      choosing(
        { keys: [{ kind: 'catchall' }], pattern: 'printed' },
        { keys: [literal('1')], pattern: ['exact'] },
      ),
    );
  });

  it('leaves the pattern of a variant that does not match unread', () => {
    expect(
      choosing({ keys: [literal('2')], pattern: 'unread' }, catchall),
    ).toBe('none');
  });

  it('refuses a selection in which no variant matches', () => {
    expectMalformed(() => choosing({ keys: [literal('2')], pattern: ['two'] }));
  });
});

describe('the parts of a compiled pattern', () => {
  const MARK = [slot('mark', 'standalone'), slot('wrap', 'paired')];
  const structured = (pattern: readonly unknown[]) =>
    evaluateArtifact({
      body: patternBody(pattern),
      slots: MARK,
      resultKind: 'structured',
    });

  it.each([
    ['nothing', null],
    ['a number', 5],
    ['a list', ['printed']],
    ['a record of no kind', { value: 'printed' }],
  ])('refuses a part that is %s', (_label, part) => {
    expectMalformed(() => structured([part]));
  });

  it('refuses a part of another kind that is written like markup', () => {
    expectMalformed(() => structured([markup('mark', 'standalone', 'slot')]));
  });

  it.each([
    ['a name that is not text', markup(5, 'standalone')],
    ['no name', markup(undefined, 'standalone')],
    ['a kind of markup that is not text', markup('mark', 5)],
    ['a kind of markup that does not exist', markup('mark', 'self-closing')],
    ['a slot the message does not declare', markup('absent', 'standalone')],
  ])('refuses markup with %s', (_label, part) => {
    expectMalformed(() => structured([part]));
  });

  it('refuses markup in a plain message', () => {
    expectMalformed(() =>
      evaluateArtifact({
        body: patternBody([markup('mark', 'standalone')]),
        slots: MARK,
      }),
    );
  });

  it('refuses a standalone slot written as a pair', () => {
    expectMalformed(() =>
      structured([markup('mark', 'open'), markup('mark', 'close')]),
    );
  });

  it('refuses a paired slot written standalone', () => {
    expectMalformed(() => structured([markup('wrap', 'standalone')]));
  });

  it('refuses a closing slot nothing opened', () => {
    expectMalformed(() => structured([markup('wrap', 'close')]));
  });

  it('refuses a slot closed by another slot', () => {
    const slots = [slot('wrap', 'paired'), slot('other', 'paired')];
    expectMalformed(() =>
      evaluateArtifact({
        body: patternBody([markup('wrap', 'open'), markup('other', 'close')]),
        slots,
        resultKind: 'structured',
      }),
    );
  });

  it('refuses a slot left open at the end of the pattern', () => {
    expectMalformed(() => structured([markup('wrap', 'open'), 'inside']));
  });

  it('gives a standalone slot no children and a paired slot what it wraps', () => {
    const result = structured([
      markup('mark', 'standalone'),
      markup('wrap', 'open'),
      'inside',
      markup('wrap', 'close'),
    ]);
    const [mark, wrap] = result.value as readonly LocalizedSlotPart[];
    expect(mark).toMatchObject({ kind: 'slot', name: 'mark', children: [] });
    expect(mark!.children).toHaveLength(0);
    expect(wrap).toMatchObject({
      kind: 'slot',
      name: 'wrap',
      children: [{ kind: 'text', value: 'inside' }],
    });
  });
});
