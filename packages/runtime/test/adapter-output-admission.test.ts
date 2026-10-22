import { describe, expect, it } from 'vitest';

import type {
  FormattingContext,
  RuntimeExtensionBinding,
  RuntimeExtensionDescriptor,
} from '@neolorn/equator/core';
import { defineExtensionRegistry } from '../../toolkit/src/extensions.js';
import { RuntimeExtensions } from '../src/extensions.js';
import { FormattingSurface } from '../src/formatting-runtime.js';

/**
 * What the runtime makes of the value an installed adapter hands back.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 7 resolves an adapter through the
 * calling context's own registry and treats one that is unregistered, throwing, malformed or over
 * its bound as a typed refusal. An adapter is consumer code, so nothing about its answer is taken
 * on trust: the answer is rebuilt field by field, and a field outside its closed shape refuses the
 * whole answer without throwing into the caller.
 *
 * The context is Arabic so that the locale, language and direction a result reports are visibly
 * the context's and not a default.
 */

const CONTEXT: FormattingContext = Object.freeze({ locale: 'ar-EG' });
const MAXIMUM = 8;
const TEXT_ID = 'test:code';
const PARTS_ID = 'test:rich';
const PARSE_ID = 'test:code-parse';

type Kind = 'text' | 'parts' | 'parse';

/** Built through the compiler's registry, because the runtime checks the fingerprint it derives. */
function declared(kind: Kind): RuntimeExtensionDescriptor {
  const registry = defineExtensionRegistry([
    {
      kind: 'formatting-adapter',
      id: TEXT_ID,
      inputType: 'test:code',
      result: 'text',
      maximumOutputLength: MAXIMUM,
    },
    {
      kind: 'formatting-adapter',
      id: PARTS_ID,
      inputType: 'test:code',
      result: 'parts',
      maximumOutputLength: MAXIMUM,
    },
    {
      kind: 'parsing-adapter',
      id: PARSE_ID,
      outputType: 'test:code',
      maximumInputLength: MAXIMUM,
    },
  ]);
  if (!registry.ok) throw new Error('the descriptors under test were refused');
  const id = { text: TEXT_ID, parts: PARTS_ID, parse: PARSE_ID }[kind];
  const found = registry.value.descriptors.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no descriptor for ${id}`);
  return found as unknown as RuntimeExtensionDescriptor;
}

function binding(
  kind: Kind,
  handler: (input: unknown) => unknown,
): RuntimeExtensionBinding {
  const descriptor = declared(kind);
  return Object.freeze(
    kind === 'parse'
      ? { descriptor, parse: ({ text }: { text: unknown }) => handler(text) }
      : {
          descriptor,
          format: ({ value }: { value: unknown }) => handler(value),
        },
  ) as unknown as RuntimeExtensionBinding;
}

function surfaceWith(
  ...installed: readonly RuntimeExtensionBinding[]
): FormattingSurface {
  return new FormattingSurface({
    snapshot: () => CONTEXT,
    clock: undefined,
    relativeTimePolicy: undefined,
    personNames: undefined,
    extensions: new RuntimeExtensions(installed),
  });
}

/** Formats `a1` through an installed adapter of `kind` that answers with `output`. */
function formatted(kind: 'text' | 'parts', output: unknown): unknown {
  const adapter = binding(kind, () => output);
  return surfaceWith(adapter).formatWithAdapter(adapter as never, 'a1');
}

/** Parses `text` through an installed adapter that answers with `output`. */
function parsed(output: unknown, text: unknown = 'a1'): unknown {
  const adapter = binding('parse', () => output);
  return surfaceWith(adapter).parseWithAdapter(adapter as never, text as never);
}

const partsOf = (result: unknown): unknown =>
  (result as { value?: { parts?: unknown } }).value?.parts;

const FORMAT_REFUSAL = {
  ok: false,
  diagnostic: {
    code: 'unsupported-formatting-capability',
    outcome: 'operational-failure',
    message: expect.any(String) as unknown,
    targetLocale: 'ar-EG',
  },
};

const inputRefusal = (
  status: string,
  text: unknown,
  message: unknown = expect.any(String),
) => ({
  status,
  text,
  diagnostic: {
    code:
      status === 'unsupported-capability'
        ? 'unsupported-input-capability'
        : 'invalid-localized-input',
    outcome: 'operational-failure',
    message,
    targetLocale: 'ar-EG',
  },
});

const literal = (value: string, more: object = {}) => ({
  kind: 'literal',
  value,
  ...more,
});

describe('the value a formatting adapter produces', () => {
  it("is a formatted value in the context's locale, carrying its source", () => {
    expect(formatted('text', { text: '#a1', note: 'dropped' })).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'extension',
        extensionId: TEXT_ID,
        text: '#a1',
        parts: [{ kind: 'semantic-unit', value: '#a1' }],
        locale: 'ar-EG',
        language: 'ar',
        direction: 'rtl',
        source: 'a1',
      },
    });
  });

  it('keeps the parts a parts adapter wrote, each with only what it stated', () => {
    const result = formatted('parts', {
      text: '#a1',
      parts: [
        literal('#'),
        literal('a', { language: 'en', direction: 'ltr', weight: 3 }),
        literal('1', { direction: 'rtl' }),
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: { extensionId: PARTS_ID, text: '#a1' },
    });
    expect(partsOf(result)).toStrictEqual([
      { kind: 'literal', value: '#' },
      { kind: 'literal', value: 'a', language: 'en', direction: 'ltr' },
      { kind: 'literal', value: '1', direction: 'rtl' },
    ]);
  });

  it('may be empty text with no parts at all', () => {
    const result = formatted('parts', { text: '', parts: [] });
    expect(result).toMatchObject({ ok: true, value: { text: '' } });
    expect(partsOf(result)).toStrictEqual([]);
  });
});

describe('a formatting adapter the caller passes', () => {
  it('is refused, with nothing thrown and no failure reason, when the context never installed it', () => {
    const adapter = binding('text', () => ({ text: 'x' }));
    expect(
      surfaceWith().formatWithAdapter(adapter as never, 'a1'),
    ).toStrictEqual(FORMAT_REFUSAL);
    // A parsing adapter under the same name is not a formatting adapter.
    expect(
      surfaceWith(binding('parse', () => undefined)).formatWithAdapter(
        { descriptor: { id: PARSE_ID } } as never,
        'a1',
      ),
    ).toStrictEqual(FORMAT_REFUSAL);
  });

  it.each([
    ['nothing', undefined],
    ['a record with no descriptor', {}],
    ['a descriptor with no identifier', { descriptor: {} }],
    ['an identifier that is a number', { descriptor: { id: 7 } }],
    // Reads as the installed name once it is turned into text, and is not that name.
    ['an identifier that is a list', { descriptor: { id: [TEXT_ID] } }],
    [
      'the installed name with text before it',
      { descriptor: { id: 'x' + TEXT_ID } },
    ],
    [
      'the installed name with text after it',
      { descriptor: { id: TEXT_ID + 'x' } },
    ],
    ['an identifier in another casing', { descriptor: { id: 'Test:code' } }],
  ])('is refused when it is %s', (_label, passed) => {
    const surface = surfaceWith(binding('text', () => ({ text: 'x' })));
    let result: unknown;
    expect(() => {
      result = surface.formatWithAdapter(passed as never, 'a1');
    }).not.toThrow();
    expect(result).toStrictEqual(FORMAT_REFUSAL);
  });

  it('is refused with the reason that consumer code threw when it throws', () => {
    const adapter = binding('text', () => {
      throw new Error('adapter failure');
    });
    expect(
      surfaceWith(adapter).formatWithAdapter(adapter as never, 'a1'),
    ).toStrictEqual({
      ok: false,
      diagnostic: {
        ...FORMAT_REFUSAL.diagnostic,
        reason: 'consumer-code-threw',
      },
    });
  });
});

describe('the answer of a text adapter', () => {
  it.each([
    ['a function carrying text', Object.assign(() => undefined, { text: 'x' })],
    ['a list carrying text', Object.assign([], { text: 'x' })],
    ['nothing', null],
    [
      'a record whose then cannot be read',
      Object.defineProperty({ text: 'x' }, 'then', {
        enumerable: true,
        get: () => {
          throw new Error('unreadable');
        },
      }),
    ],
    // Well-formed parts, so that carrying any is the only thing wrong with the answer.
    ['text with parts beside it', { text: 'x', parts: [literal('x')] }],
    ['text with a parts field that is not a list', { text: 'x', parts: 'x' }],
  ])('is refused when it is %s', (_label, output) => {
    let result: unknown;
    expect(() => {
      result = formatted('text', output);
    }).not.toThrow();
    expect(result).toStrictEqual(FORMAT_REFUSAL);
  });
});

describe('the answer of a parts adapter', () => {
  const astral = String.fromCodePoint(0x1f600);

  it.each([
    ['no parts', { text: 'x' }],
    ['parts that are not a list', { text: 'x', parts: { length: 0 } }],
    ['parts that spell other text', { text: 'ab', parts: [literal('ba')] }],
    [
      'parts that spell less than the text',
      { text: 'ab', parts: [literal('a')] },
    ],
    [
      'parts that spell the text in another order',
      { text: 'ab', parts: [literal('b'), literal('a')] },
    ],
    [
      'a part of the text that is not the next stretch of it',
      { text: 'aba', parts: [literal('a'), literal('a'), literal('b')] },
    ],
    [
      'parts that spell the text and then more',
      { text: 'ab', parts: [literal('ab'), literal('a')] },
    ],
    [
      'parts that stop one short of the text',
      { text: 'abc', parts: [literal('a'), literal('b')] },
    ],
    ['a part that is nothing', { text: 'x', parts: [null] }],
    ['a part that is bare text', { text: 'x', parts: ['x'] }],
    ['a part that is a list', { text: 'x', parts: [['x']] }],
    ['a part with no kind', { text: 'x', parts: [{ value: 'x' }] }],
    [
      'a part whose kind is a number',
      { text: 'x', parts: [{ kind: 7, value: 'x' }] },
    ],
    [
      'a part whose kind is empty',
      { text: 'x', parts: [{ kind: '', value: 'x' }] },
    ],
    [
      'a part whose kind runs to 65 characters',
      { text: 'x', parts: [{ kind: 'k'.repeat(65), value: 'x' }] },
    ],
    ['a part with no value', { text: '', parts: [{ kind: 'literal' }] }],
    [
      'a part whose value is a number',
      { text: '7', parts: [{ kind: 'literal', value: 7 }] },
    ],
    [
      'a part whose language is a number',
      { text: 'x', parts: [literal('x', { language: 7 })] },
    ],
    [
      'a part whose language runs to 65 characters',
      { text: 'x', parts: [literal('x', { language: 'l'.repeat(65) })] },
    ],
    [
      'a part whose direction is outside the two',
      { text: 'x', parts: [literal('x', { direction: 'auto' })] },
    ],
    [
      'one part longer than its bound',
      {
        text: 'x'.repeat(MAXIMUM),
        parts: [literal('x'.repeat(MAXIMUM + 1))],
      },
    ],
    [
      'parts that together run past its bound',
      {
        text: 'x'.repeat(MAXIMUM),
        parts: [literal('x'.repeat(MAXIMUM)), literal('x'.repeat(MAXIMUM))],
      },
    ],
    [
      'a part outside the basic plane that carries it past its bound',
      {
        text: astral.repeat(MAXIMUM),
        parts: [literal('x'), literal(astral.repeat(MAXIMUM))],
      },
    ],
    [
      'two more parts than its bound in characters',
      {
        text: 'x'.repeat(MAXIMUM),
        parts: [
          ...Array.from({ length: MAXIMUM }, () => literal('x')),
          literal(''),
          literal(''),
        ],
      },
    ],
  ])('is refused when it has %s', (_label, output) => {
    let result: unknown;
    expect(() => {
      result = formatted('parts', output);
    }).not.toThrow();
    expect(result).toStrictEqual(FORMAT_REFUSAL);
  });

  it.each([
    ['a kind of 64 characters', 'x', [{ kind: 'k'.repeat(64), value: 'x' }]],
    [
      'a language of 64 characters',
      'x',
      [literal('x', { language: 'l'.repeat(64) })],
    ],
    ['an empty language', 'x', [literal('x', { language: '' })]],
    [
      'an empty part between two others',
      'ab',
      [literal('a'), literal(''), literal('b')],
    ],
    ['the same stretch twice', 'aa', [literal('a'), literal('a')]],
    [
      'either direction',
      'ab',
      [literal('a', { direction: 'ltr' }), literal('b', { direction: 'rtl' })],
    ],
    [
      'one more part than its bound in characters',
      'x'.repeat(MAXIMUM),
      [...Array.from({ length: MAXIMUM }, () => literal('x')), literal('')],
    ],
    // Twice the bound in UTF-16 units and exactly the bound in characters.
    [
      'its bound in characters outside the basic plane',
      astral.repeat(MAXIMUM),
      [literal(astral.repeat(MAXIMUM))],
    ],
    [
      'its bound spread over parts outside the basic plane',
      astral.repeat(MAXIMUM),
      [literal(astral.repeat(MAXIMUM - 1)), literal(astral)],
    ],
  ])('is kept as written with %s', (_label, text, parts) => {
    const result = formatted('parts', { text, parts });
    expect(result).toMatchObject({ ok: true, value: { text } });
    expect(partsOf(result)).toStrictEqual(parts);
  });
});

describe('a parsing adapter the caller passes', () => {
  it('is refused as an unsupported capability when the context never installed it', () => {
    const adapter = binding('parse', () => undefined);
    expect(
      surfaceWith().parseWithAdapter(adapter as never, 'a1'),
    ).toStrictEqual(inputRefusal('unsupported-capability', 'a1'));
  });

  it.each([
    ['nothing', undefined],
    ['a record with no descriptor', {}],
    ['an identifier that is a number', { descriptor: { id: 7 } }],
    // Reads as the installed name once it is turned into text, and is not that name.
    ['an identifier that is a list', { descriptor: { id: [PARSE_ID] } }],
    [
      'an identifier in another casing',
      { descriptor: { id: 'Test:code-parse' } },
    ],
    ['the name of a formatting adapter', { descriptor: { id: TEXT_ID } }],
  ])('is refused when it is %s', (_label, passed) => {
    let invoked = false;
    const surface = surfaceWith(
      binding('parse', () => {
        invoked = true;
        return { status: 'valid', text: 'a1', value: 'A1' };
      }),
      binding('text', () => ({ text: 'x' })),
    );
    let result: unknown;
    expect(() => {
      result = surface.parseWithAdapter(passed as never, 'a1');
    }).not.toThrow();
    expect(result).toStrictEqual(inputRefusal('unsupported-capability', 'a1'));
    expect(invoked).toBe(false);
  });

  it('is not handed input past its bound, or input that is not text', () => {
    const long = 'x'.repeat(MAXIMUM + 1);
    expect(
      parsed({ status: 'valid', text: long, value: 1 }, long),
    ).toStrictEqual(inputRefusal('out-of-range', long));
    let result: unknown;
    expect(() => {
      result = parsed({ status: 'valid', text: '7', value: 1 }, 7);
    }).not.toThrow();
    expect(result).toStrictEqual(inputRefusal('out-of-range', 7));
  });

  it('is handed input exactly at its bound', () => {
    const atBound = 'x'.repeat(MAXIMUM);
    expect(
      parsed({ status: 'valid', text: atBound, value: 1 }, atBound),
    ).toStrictEqual({ status: 'valid', text: atBound, value: 1 });
  });

  it('is refused as invalid when it throws', () => {
    const adapter = binding('parse', () => {
      throw new Error('adapter failure');
    });
    expect(
      surfaceWith(adapter).parseWithAdapter(adapter as never, 'a1'),
    ).toStrictEqual(inputRefusal('invalid', 'a1'));
  });
});

describe('the answer of a parsing adapter', () => {
  const diagnostic = { message: 'The code is not known.' };

  it('is the value and the text the adapter settled on, and nothing else it held', () => {
    expect(
      parsed({ status: 'valid', text: 'A1', value: 161, note: 'dropped' }),
    ).toStrictEqual({ status: 'valid', text: 'A1', value: 161 });
    expect(
      parsed({ status: 'valid', text: 'A1', value: undefined }),
    ).toStrictEqual({ status: 'valid', text: 'A1', value: undefined });
  });

  it.each([
    ['incomplete'],
    ['invalid'],
    ['ambiguous'],
    ['out-of-range'],
    ['unsupported-capability'],
    ['policy-rejected'],
  ])('keeps the status %s with the message the adapter gave', (status) => {
    expect(
      parsed({ status, text: 'A1', value: 161, diagnostic }),
    ).toStrictEqual(inputRefusal(status, 'A1', diagnostic.message));
  });

  it('still carries a message when the adapter gave an empty one', () => {
    const result = parsed({
      status: 'incomplete',
      text: 'a1',
      diagnostic: { message: '' },
    }) as { status: string; diagnostic: { message: unknown } };
    expect(result.status).toBe('incomplete');
    expect(typeof result.diagnostic.message).toBe('string');
    expect(result.diagnostic.message).not.toBe('');
  });

  it('keeps a message of 1,024 characters', () => {
    const message = 'm'.repeat(1_024);
    expect(
      parsed({ status: 'incomplete', text: 'a1', diagnostic: { message } }),
    ).toStrictEqual(inputRefusal('incomplete', 'a1', message));
  });

  it('keeps text up to 1,024 characters longer than the input', () => {
    const text = 'x'.repeat(2 + 1_024);
    expect(parsed({ status: 'valid', text, value: 1 })).toStrictEqual({
      status: 'valid',
      text,
      value: 1,
    });
  });

  it.each([
    ['nothing', null],
    ['a list', Object.assign([], { status: 'valid', text: 'a1', value: 1 })],
    [
      'a thenable that is otherwise a valid answer',
      { status: 'valid', text: 'a1', value: 1, then: () => undefined },
    ],
    ['a status that is not text', { status: 7, text: 'a1', value: 1 }],
    ['a status outside the result model', { status: '', text: 'a1', value: 1 }],
    ['no text', { status: 'valid', value: 1 }],
    ['text that is a number', { status: 'valid', text: 7, value: 1 }],
    [
      'text 1,025 characters longer than the input',
      { status: 'valid', text: 'x'.repeat(2 + 1_025), value: 1 },
    ],
    [
      'an incomplete status with no diagnostic',
      { status: 'incomplete', text: 'a1' },
    ],
    [
      'an incomplete status whose diagnostic is nothing',
      { status: 'incomplete', text: 'a1', diagnostic: null },
    ],
    [
      'an incomplete status whose diagnostic is a list',
      {
        status: 'incomplete',
        text: 'a1',
        diagnostic: Object.assign([], diagnostic),
      },
    ],
    [
      'an incomplete status whose diagnostic has no message',
      { status: 'incomplete', text: 'a1', diagnostic: {} },
    ],
    [
      'an incomplete status whose message is a number',
      { status: 'incomplete', text: 'a1', diagnostic: { message: 7 } },
    ],
    [
      'an incomplete status whose message runs to 1,025 characters',
      {
        status: 'incomplete',
        text: 'a1',
        diagnostic: { message: 'm'.repeat(1_025) },
      },
    ],
    // A value does not make a status other than valid into a value.
    [
      'an incomplete status with a value and no diagnostic',
      { status: 'incomplete', text: 'a1', value: 1 },
    ],
  ])('is refused as invalid when it is %s', (_label, output) => {
    let result: unknown;
    expect(() => {
      result = parsed(output);
    }).not.toThrow();
    expect(result).toStrictEqual(inputRefusal('invalid', 'a1'));
  });
});
