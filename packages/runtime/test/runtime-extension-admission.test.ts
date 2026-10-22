import { describe, expect, it } from 'vitest';

import {
  EXTENSION_DESCRIPTOR_PROFILE,
  type LocalizedSlotPart,
  type RuntimeExtensionBinding,
  type RuntimeExtensionDescriptor,
} from '@neolorn/equator/core';

import { digestCanonicalJson } from '../../toolkit/src/canonical-json.js';
import { defineExtensionRegistry } from '../../toolkit/src/extensions.js';
import {
  RuntimeExtensions,
  defineRuntimeExtensions,
} from '../src/extensions.js';
import { RUNTIME_LIMITS } from '../src/runtime-safety.js';
import { refusalOf } from './compiled-artifact-harness.js';

/**
 * What the runtime admits as an extension descriptor and as the binding that carries one.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 15 gives an extension the capabilities its
 * contract declares and no way out of validation, and
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 6 has the runtime compare the
 * descriptor a binding carries with the one a catalog was compiled against. The runtime cannot
 * know that a descriptor came through the compiler's registry, so it holds each field to its
 * closed vocabulary and its bound itself.
 *
 * A descriptor whose fingerprint does not match is refused whatever else it holds. Every
 * descriptor below therefore carries the fingerprint of exactly what it declares, so that a
 * refusal is of the field under test and an admission is of the whole descriptor.
 */

type Fields = Readonly<Record<string, unknown>>;

const FINGERPRINTED: Readonly<Record<string, readonly string[]>> = {
  'message-function': [
    'kind',
    'id',
    'operandType',
    'options',
    'resultType',
    'selector',
    'maximumOutputLength',
  ],
  'identifier-segment': ['kind', 'id', 'syntax', 'maximumLength'],
  'rich-slot-kind': [
    'kind',
    'id',
    'shape',
    'interactive',
    'textProjection',
    'options',
  ],
  'formatting-adapter': [
    'kind',
    'id',
    'inputType',
    'result',
    'maximumOutputLength',
  ],
  'parsing-adapter': ['kind', 'id', 'outputType', 'maximumInputLength'],
};

const HANDLER: Readonly<Record<string, string>> = {
  'message-function': 'evaluate',
  'rich-slot-kind': 'projectText',
  'formatting-adapter': 'format',
  'parsing-adapter': 'parse',
};

const fingerprintOf = (fields: Fields): string => {
  const declared: Record<string, unknown> = {};
  for (const name of FINGERPRINTED[String(fields['kind'])] ?? []) {
    if (fields[name] !== undefined) declared[name] = fields[name];
  }
  return digestCanonicalJson(EXTENSION_DESCRIPTOR_PROFILE, declared as never);
};

const signed = (fields: Fields, stamp: Fields = {}): Fields => ({
  ...fields,
  profile: EXTENSION_DESCRIPTOR_PROFILE,
  fingerprint: fingerprintOf(fields),
  ...stamp,
});

const handler = (): undefined => undefined;

const bindingOf = (descriptor: unknown): RuntimeExtensionBinding => {
  const name =
    typeof descriptor === 'object' && descriptor !== null
      ? HANDLER[String((descriptor as Fields)['kind'])]
      : undefined;
  return (name === undefined
    ? { descriptor }
    : { descriptor, [name]: handler }) as unknown as RuntimeExtensionBinding;
};

const admit = (descriptor: unknown): readonly RuntimeExtensionBinding[] =>
  defineRuntimeExtensions([bindingOf(descriptor)]);

const expectAdmitted = (fields: Fields): void => {
  const bindings = admit(signed(fields));
  expect(bindings).toHaveLength(1);
  expect(bindings[0]?.descriptor.kind).toBe(fields['kind']);
};

const expectRefused = (run: () => unknown): void => {
  const failure = refusalOf(run);
  expect(failure.diagnostic.code).toBe('invalid-configuration');
  expect(failure.diagnostic.outcome).toBe('operational-failure');
};

const FUNCTION: Fields = {
  kind: 'message-function',
  id: 'test:subject',
  operandType: 'string',
  resultType: 'string',
  selector: 'none',
  maximumOutputLength: 64,
};

const SEGMENT: Fields = {
  kind: 'identifier-segment',
  id: 'test:state',
  syntax: 'lower-kebab',
  maximumLength: 32,
};

const SLOT: Fields = {
  kind: 'rich-slot-kind',
  id: 'test:marker',
  shape: 'standalone',
  interactive: false,
  textProjection: 'binding-required',
};

const FORMAT: Fields = {
  kind: 'formatting-adapter',
  id: 'test:code',
  inputType: 'test:code',
  result: 'text',
  maximumOutputLength: 16,
};

const PARSE: Fields = {
  kind: 'parsing-adapter',
  id: 'test:code-parse',
  outputType: 'test:code',
  maximumInputLength: 16,
};

const KINDS: readonly (readonly [string, Fields])[] = [
  ['message-function', FUNCTION],
  ['identifier-segment', SEGMENT],
  ['rich-slot-kind', SLOT],
  ['formatting-adapter', FORMAT],
  ['parsing-adapter', PARSE],
];

const LONGEST_TYPE_NAME = 'a'.repeat(128);
const distinct = (count: number): string[] =>
  Array.from({ length: count }, (_unused, index) => `v${String(index)}`);

describe('the identity a descriptor carries', () => {
  it.each(KINDS)('admits a well-formed %s descriptor', (_kind, fields) => {
    expectAdmitted(fields);
  });

  it('derives the fingerprint the registry stamps on a descriptor', () => {
    const registry = defineExtensionRegistry([
      FUNCTION,
      SEGMENT,
      SLOT,
      FORMAT,
      PARSE,
    ] as never);
    if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
    for (const descriptor of registry.value.descriptors) {
      expect(fingerprintOf(descriptor as unknown as Fields)).toBe(
        descriptor.fingerprint,
      );
      expect(admit(descriptor)).toHaveLength(1);
    }
  });

  it.each(KINDS)(
    'refuses a %s descriptor stamped with another profile',
    (_kind, fields) => {
      expectRefused(() =>
        admit(signed(fields, { profile: 'equator-extension-descriptor/2' })),
      );
    },
  );

  it.each(KINDS)(
    'refuses a %s descriptor whose fingerprint is of something else',
    (_kind, fields) => {
      expectRefused(() =>
        admit(signed(fields, { fingerprint: `sha256-${'A'.repeat(43)}` })),
      );
      expectRefused(() => admit(signed(fields, { fingerprint: 7 })));
    },
  );

  it.each([
    ['one character either side of the colon', 'a:b'],
    ['digits and hyphens after the first letter', 'a-1:b-2'],
    ['a namespace of 32 characters', `${'n'.repeat(32)}:name`],
    ['a name of 64 characters', `space:${'n'.repeat(64)}`],
  ])('admits an id with %s', (_label, id) => {
    expectAdmitted({ ...SEGMENT, id });
  });

  it.each([
    ['a namespace of 33 characters', `${'n'.repeat(33)}:name`],
    ['a name of 65 characters', `space:${'n'.repeat(65)}`],
    ['a namespace that starts with a capital', 'Test:state'],
    ['a namespace that starts with a digit', '9test:state'],
    ['a name that starts with a capital', 'test:State'],
    ['a name that starts with a digit', 'test:9state'],
    ['a name followed by punctuation', 'test:state!'],
    ['no name', 'test:'],
    ['no namespace', ':state'],
    ['no colon', 'teststate'],
    ['a list holding a well-formed id', ['test:state']],
    ['a number', 5],
  ])('refuses an id with %s', (_label, id) => {
    expectRefused(() => admit(signed({ ...SEGMENT, id })));
  });

  it('refuses a descriptor that is not an object', () => {
    expectRefused(() => admit(null));
    expectRefused(() => admit('test:state'));
    expectRefused(() => admit([signed(SEGMENT)]));
  });

  describe('that is not inert data', () => {
    class Declared {
      readonly kind = 'identifier-segment';
      readonly id = 'test:state';
      readonly syntax = 'lower-kebab';
      readonly maximumLength = 32;
    }
    const holding = (fields: Fields, change: Fields): Fields => ({
      ...signed(fields),
      ...change,
    });
    const cyclic = (): Fields => {
      const descriptor: Record<string, unknown> = { ...signed(SEGMENT) };
      descriptor['self'] = descriptor;
      return descriptor;
    };

    const NOT_INERT: readonly (readonly [string, () => unknown])[] = [
      ['nothing at all', () => undefined],
      ['a function', () => handler],
      ['an instance of a class', () => new Declared()],
      ['a symbol', () => Symbol('test:state')],
      ['a big integer', () => 32n],
      [
        'a field that is not a finite number',
        () => holding(FORMAT, { maximumOutputLength: Infinity }),
      ],
      [
        'a field that is not a number at all',
        () => holding(SEGMENT, { maximumLength: Number.NaN }),
      ],
      [
        'a field that is negative zero',
        () => holding(SEGMENT, { maximumLength: -0 }),
      ],
      [
        'a field that is a function',
        () => holding(SEGMENT, { syntax: handler }),
      ],
      [
        'a field that is undefined',
        () => holding(FUNCTION, { options: undefined }),
      ],
      [
        'a field that is an instance of a class',
        () => holding(FUNCTION, { options: new Declared() }),
      ],
      [
        'a field read through an accessor',
        () =>
          Object.defineProperty({ ...signed(SEGMENT) }, 'syntax', {
            get: () => 'lower-kebab',
            enumerable: true,
          }),
      ],
      [
        'a field named by a symbol',
        () => holding(SEGMENT, { [Symbol('extra')]: 1 }),
      ],
      ['a field that holds the descriptor itself', cyclic],
      [
        'text that is not well-formed Unicode',
        () => holding(FORMAT, { inputType: String.fromCharCode(0xd800) }),
      ],
      [
        'a list with a hole in it',
        () => holding(SLOT, { options: { tone: new Array<string>(2) } }),
      ],
    ];

    it.each(NOT_INERT)(
      'refuses a binding whose descriptor is %s',
      (_label, descriptor) => {
        const failure = refusalOf(() =>
          defineRuntimeExtensions([
            { descriptor: descriptor() } as unknown as RuntimeExtensionBinding,
          ]),
        );
        expect(failure.diagnostic.code).toBe('invalid-configuration');
        expect(failure.diagnostic.outcome).toBe('operational-failure');
      },
    );

    it.each(NOT_INERT)(
      'refuses a catalog whose required descriptor is %s',
      (_label, descriptor) => {
        expectRefused(
          () =>
            new RuntimeExtensions(
              [],
              [descriptor() as unknown as RuntimeExtensionDescriptor],
            ),
        );
      },
    );

    it('keeps what made the descriptor unreadable as the cause of the refusal', () => {
      const failure = refusalOf(() =>
        admit({ ...signed(SEGMENT), maximumLength: Infinity }),
      );
      expect(failure.cause).toBeInstanceOf(TypeError);
    });

    it('gives the refusal of a readable descriptor no cause', () => {
      const failure = refusalOf(() =>
        admit(signed({ ...SEGMENT, maximumLength: 0 })),
      );
      expect(Object.hasOwn(failure, 'cause')).toBe(false);
    });
  });

  it('refuses a kind Equator does not define, whichever handler comes with it', () => {
    const descriptor = signed({ kind: 'collation-adapter', id: 'test:sort' });
    expectRefused(() => admit(descriptor));
    for (const name of Object.values(HANDLER)) {
      expectRefused(() =>
        defineRuntimeExtensions([
          { descriptor, [name]: handler } as unknown as RuntimeExtensionBinding,
        ]),
      );
    }
  });
});

describe('the bound a descriptor declares', () => {
  it.each([
    ['the smallest bound, one', 1],
    ['the largest bound a segment may declare', 128],
  ])('admits %s', (_label, maximumLength) => {
    expectAdmitted({ ...SEGMENT, maximumLength });
  });

  it.each([
    ['zero', 0],
    ['a negative bound', -1],
    ['one past the largest bound a segment may declare', 129],
    ['a fraction inside the range', 1.5],
    ['a bound written as text', '5'],
    ['a bound written as a list', [5]],
  ])('refuses %s', (_label, maximumLength) => {
    expectRefused(() => admit(signed({ ...SEGMENT, maximumLength })));
  });

  it('holds an output bound to the output ceiling', () => {
    expectAdmitted({
      ...FORMAT,
      maximumOutputLength: RUNTIME_LIMITS.outputCodePoints,
    });
    expectRefused(() =>
      admit(
        signed({
          ...FORMAT,
          maximumOutputLength: RUNTIME_LIMITS.outputCodePoints + 1,
        }),
      ),
    );
    expectRefused(() => admit(signed({ ...FORMAT, maximumOutputLength: 0 })));
  });

  it('holds an input bound to the localized input ceiling', () => {
    expectAdmitted({
      ...PARSE,
      maximumInputLength: RUNTIME_LIMITS.localizedInputCodePoints,
    });
    expectRefused(() =>
      admit(
        signed({
          ...PARSE,
          maximumInputLength: RUNTIME_LIMITS.localizedInputCodePoints + 1,
        }),
      ),
    );
    expectRefused(() => admit(signed({ ...PARSE, maximumInputLength: 0 })));
  });
});

describe('the fields each kind declares', () => {
  it.each(KINDS)(
    'refuses a %s descriptor carrying a field its kind does not declare',
    (_kind, fields) => {
      expectRefused(() => admit(signed({ ...fields, trusted: true })));
    },
  );

  it.each(['boolean', 'date-time', 'integer', 'number', 'string'])(
    'admits a message function over %s',
    (operandType) => {
      expectAdmitted({ ...FUNCTION, operandType });
    },
  );

  it.each(['lower-kebab', 'ascii-token', 'unicode-token'])(
    'admits a segment written as %s',
    (syntax) => {
      expectAdmitted({ ...SEGMENT, syntax });
    },
  );

  it.each([
    ['a syntax Equator does not define', 'upper-snake'],
    ['an empty syntax', ''],
  ])('refuses a segment with %s', (_label, syntax) => {
    expectRefused(() => admit(signed({ ...SEGMENT, syntax })));
  });

  it.each([
    ['a paired shape', { shape: 'paired' }],
    ['children as its text projection', { textProjection: 'children' }],
    ['an interactive kind', { interactive: true }],
  ])('admits a rich-slot kind with %s', (_label, change) => {
    expectAdmitted({ ...SLOT, ...change });
  });

  it.each([
    ['a shape Equator does not define', { shape: 'triple' }],
    ['an empty shape', { shape: '' }],
    ['interactive written as text', { interactive: 'false' }],
    ['a text projection Equator does not define', { textProjection: 'none' }],
    ['an empty text projection', { textProjection: '' }],
  ])('refuses a rich-slot kind with %s', (_label, change) => {
    expectRefused(() => admit(signed({ ...SLOT, ...change })));
  });

  it.each([
    ['a result in parts', { result: 'parts' }],
    ['an input type name of 128 characters', { inputType: LONGEST_TYPE_NAME }],
  ])('admits a formatting adapter with %s', (_label, change) => {
    expectAdmitted({ ...FORMAT, ...change });
  });

  it.each([
    ['a result Equator does not define', { result: 'html' }],
    ['an empty result', { result: '' }],
    ['an empty input type name', { inputType: '' }],
    [
      'an input type name of 129 characters',
      { inputType: `${LONGEST_TYPE_NAME}a` },
    ],
    ['an input type name written as a list', { inputType: ['test:code'] }],
  ])('refuses a formatting adapter with %s', (_label, change) => {
    expectRefused(() => admit(signed({ ...FORMAT, ...change })));
  });

  it('admits a parsing adapter with an output type name of 128 characters', () => {
    expectAdmitted({ ...PARSE, outputType: LONGEST_TYPE_NAME });
  });

  it.each([
    ['an empty output type name', { outputType: '' }],
    [
      'an output type name of 129 characters',
      { outputType: `${LONGEST_TYPE_NAME}a` },
    ],
    ['an output type name written as a list', { outputType: ['test:code'] }],
  ])('refuses a parsing adapter with %s', (_label, change) => {
    expectRefused(() => admit(signed({ ...PARSE, ...change })));
  });
});

describe('the options a message function descriptor declares', () => {
  const withOptions = (options: unknown): Fields => ({ ...FUNCTION, options });
  const withOption = (option: unknown): Fields => withOptions({ size: option });
  const typed = (count: number): Fields =>
    Object.fromEntries(
      distinct(count).map((name) => [name, { type: 'string' }]),
    );

  it.each([
    ['no options at all', {}],
    ['a typed option', { size: { type: 'integer' } }],
    ['a required option', { size: { type: 'string', required: true } }],
    ['an optional option', { size: { type: 'string', required: false } }],
    ['an option closed over text', { size: { type: 'string', values: ['a'] } }],
    [
      'an option closed over text of 128 characters',
      { size: { type: 'string', values: [LONGEST_TYPE_NAME] } },
    ],
    [
      'an option closed over numbers',
      { size: { type: 'number', values: [0, 1.5] } },
    ],
    [
      'an option closed over both booleans',
      { size: { type: 'boolean', values: [true, false] } },
    ],
    [
      'an option closed over as many values as the ceiling',
      {
        size: {
          type: 'string',
          values: distinct(RUNTIME_LIMITS.extensionOptionValues),
        },
      },
    ],
    ['as many options as the ceiling', typed(RUNTIME_LIMITS.extensionOptions)],
  ])('admits %s', (_label, options) => {
    expectAdmitted(withOptions(options));
  });

  it.each([
    ['options written as a list', []],
    ['options written as text', 'size'],
    ['one option past the ceiling', typed(RUNTIME_LIMITS.extensionOptions + 1)],
    [
      'an option name that is not a MessageFormat name',
      { '1st': { type: 'string' } },
    ],
    ['an option name holding a space', { 'a b': { type: 'string' } }],
  ])('refuses %s', (_label, options) => {
    expectRefused(() => admit(signed(withOptions(options))));
  });

  it.each([
    ['null', null],
    ['text', 'string'],
    ['a list', ['string']],
    ['no type', {}],
    ['a type Equator does not define', { type: 'text' }],
    [
      'a field beside the ones an option declares',
      { type: 'string', unit: 'px' },
    ],
    ['required written as text', { type: 'string', required: 'yes' }],
    ['required set to null', { type: 'string', required: null }],
    ['values written as text', { type: 'string', values: 'a' }],
    ['values written as a record', { type: 'string', values: { a: true } }],
    ['an empty list of values', { type: 'string', values: [] }],
    [
      'one value past the ceiling',
      {
        type: 'string',
        values: distinct(RUNTIME_LIMITS.extensionOptionValues + 1),
      },
    ],
    ['a value that is null', { type: 'string', values: [null] }],
    ['a value that is a list', { type: 'string', values: [['a']] }],
    ['a value that is a record', { type: 'string', values: [{}] }],
    [
      'an unusable value after a usable one',
      { type: 'string', values: ['a', null] },
    ],
    [
      'a text value of 129 characters',
      { type: 'string', values: [`${LONGEST_TYPE_NAME}a`] },
    ],
    ['the same value twice', { type: 'number', values: [1, 1] }],
  ])('refuses an option that is %s', (_label, option) => {
    expectRefused(() => admit(signed(withOption(option))));
  });
});

describe('the options a rich-slot kind descriptor declares', () => {
  const withOptions = (options: unknown): Fields => ({ ...SLOT, options });
  const withOption = (option: unknown): Fields => withOptions({ tone: option });
  const listed = (count: number): Fields =>
    Object.fromEntries(distinct(count).map((name) => [name, ['a']]));

  it.each([
    ['no options at all', {}],
    ['an option with one value', { tone: ['calm'] }],
    ['an option with a value of 128 characters', { tone: [LONGEST_TYPE_NAME] }],
    [
      'an option with as many values as the ceiling',
      { tone: distinct(RUNTIME_LIMITS.extensionOptionValues) },
    ],
    ['an option name of 64 characters', { ['n'.repeat(64)]: ['a'] }],
    ['an option name with digits and hyphens', { 'tone-2': ['a'] }],
    ['as many options as the ceiling', listed(RUNTIME_LIMITS.extensionOptions)],
  ])('admits %s', (_label, options) => {
    expectAdmitted(withOptions(options));
  });

  it.each([
    ['options written as a list', []],
    [
      'one option past the ceiling',
      listed(RUNTIME_LIMITS.extensionOptions + 1),
    ],
    ['an option name of 65 characters', { ['n'.repeat(65)]: ['a'] }],
    ['an option name that starts with a digit', { '9tone': ['a'] }],
    ['an option name that starts with a capital', { Tone: ['a'] }],
    ['an option name holding an underscore', { tone_of: ['a'] }],
    ['an option name ending in punctuation', { 'tone!': ['a'] }],
  ])('refuses %s', (_label, options) => {
    expectRefused(() => admit(signed(withOptions(options))));
  });

  it.each([
    ['text', 'calm'],
    ['a record', { calm: true }],
    ['null', null],
    ['an empty list', []],
    [
      'one value past the ceiling',
      distinct(RUNTIME_LIMITS.extensionOptionValues + 1),
    ],
    ['a list holding a number', [1]],
    ['a list holding a number after text', ['calm', 1]],
    ['a list holding text of 129 characters', [`${LONGEST_TYPE_NAME}a`]],
    ['a list holding the same value twice', ['calm', 'calm']],
  ])('refuses an option that is %s', (_label, option) => {
    expectRefused(() => admit(signed(withOption(option))));
  });
});

describe('the binding that carries a descriptor', () => {
  const descriptor = (): RuntimeExtensionDescriptor =>
    signed(SLOT) as unknown as RuntimeExtensionDescriptor;
  const define = (binding: unknown): readonly RuntimeExtensionBinding[] =>
    defineRuntimeExtensions([binding as RuntimeExtensionBinding]);

  it('is admitted as a plain object holding the descriptor and its handler', () => {
    const bindings = define({ descriptor: descriptor(), projectText: handler });
    expect(bindings).toHaveLength(1);
    expect(Object.keys(bindings[0] ?? {}).sort()).toEqual([
      'descriptor',
      'projectText',
    ]);
    expect(
      (bindings[0] as unknown as Record<string, unknown>)['projectText'],
    ).toBe(handler);
  });

  it('is refused when it is an instance of a class', () => {
    class Binding {
      readonly descriptor = descriptor();
      readonly projectText = handler;
    }
    expectRefused(() => define(new Binding()));
  });

  it('is refused when it is not an object', () => {
    expectRefused(() => define(null));
    expectRefused(() => define('test:marker'));
  });

  it('is refused without a descriptor', () => {
    expectRefused(() => define({}));
    expectRefused(() => define({ projectText: handler }));
  });

  it('is refused when its descriptor is read through an accessor', () => {
    const held = descriptor();
    expectRefused(() =>
      define({
        get descriptor() {
          return held;
        },
        projectText: handler,
      }),
    );
    expectRefused(() =>
      define({
        set descriptor(_value: unknown) {
          // A write-only property holds nothing to admit.
        },
        projectText: handler,
      }),
    );
  });

  it.each([
    ['message-function', FUNCTION],
    ['rich-slot-kind', SLOT],
    ['formatting-adapter', FORMAT],
    ['parsing-adapter', PARSE],
  ] as const)(
    'is refused when a %s binding names the handler of another kind',
    (kind, fields) => {
      for (const name of Object.values(HANDLER)) {
        const binding = { descriptor: signed(fields), [name]: handler };
        if (name === HANDLER[kind]) {
          expect(define(binding)).toHaveLength(1);
        } else {
          expectRefused(() => define(binding));
        }
      }
    },
  );

  it.each([
    ['text', 'projectText'],
    ['a number', 5],
    ['null', null],
    ['a record', { call: handler }],
  ])('is refused when its handler is %s', (_label, value) => {
    expectRefused(() =>
      define({ descriptor: descriptor(), projectText: value }),
    );
  });

  it('is refused when its handler is read through an accessor', () => {
    expectRefused(() =>
      define({
        descriptor: descriptor(),
        get projectText() {
          return handler;
        },
      }),
    );
  });
});

describe('the list of bindings an application defines', () => {
  const segments = (count: number): RuntimeExtensionBinding[] =>
    distinct(count).map((name) =>
      bindingOf(signed({ ...SEGMENT, id: `test:${name}` })),
    );

  it('is admitted up to the descriptor ceiling and refused past it', () => {
    expect(
      defineRuntimeExtensions(segments(RUNTIME_LIMITS.extensionDescriptors)),
    ).toHaveLength(RUNTIME_LIMITS.extensionDescriptors);
    expectRefused(() =>
      defineRuntimeExtensions(
        segments(RUNTIME_LIMITS.extensionDescriptors + 1),
      ),
    );
  });

  it('is refused when it is not a list', () => {
    expectRefused(() =>
      defineRuntimeExtensions({
        length: 1,
        0: bindingOf(signed(SEGMENT)),
      } as never),
    );
  });

  it('is refused when two bindings declare the same kind and id', () => {
    expectRefused(() =>
      defineRuntimeExtensions([
        bindingOf(signed(SEGMENT)),
        bindingOf(signed({ ...SEGMENT, maximumLength: 64 })),
      ]),
    );
    expectRefused(() =>
      defineRuntimeExtensions([
        bindingOf(signed(FORMAT)),
        bindingOf(signed(SEGMENT)),
        bindingOf(signed(FORMAT)),
      ]),
    );
  });

  it('admits one id declared under two kinds', () => {
    expect(
      defineRuntimeExtensions([
        bindingOf(signed({ ...FORMAT, id: 'test:shared' })),
        bindingOf(signed({ ...PARSE, id: 'test:shared' })),
      ]),
    ).toHaveLength(2);
  });

  it('comes back frozen and in the same order however it was written', () => {
    const written = [
      bindingOf(signed(SLOT)),
      bindingOf(signed({ ...SEGMENT, id: 'test:b' })),
      bindingOf(signed(FUNCTION)),
      bindingOf(signed({ ...SEGMENT, id: 'test:a' })),
    ];
    const order = (
      bindings: readonly RuntimeExtensionBinding[],
    ): readonly string[] =>
      bindings.map(({ descriptor }) => `${descriptor.kind}/${descriptor.id}`);
    const defined = defineRuntimeExtensions(written);
    expect(Object.isFrozen(defined)).toBe(true);
    expect(order(defined)).toEqual([
      'identifier-segment/test:a',
      'identifier-segment/test:b',
      'message-function/test:subject',
      'rich-slot-kind/test:marker',
    ]);
    expect(order(defineRuntimeExtensions([...written].reverse()))).toEqual(
      order(defined),
    );
  });
});

describe('the bindings a runtime holds', () => {
  const held = (fields: Fields): RuntimeExtensionDescriptor =>
    signed(fields) as unknown as RuntimeExtensionDescriptor;

  it('satisfies a catalog that requires the descriptor it was given', () => {
    expect(
      () => new RuntimeExtensions([bindingOf(held(SEGMENT))], [held(SEGMENT)]),
    ).not.toThrow();
  });

  it('refuses a catalog compiled against the same id declared differently', () => {
    expectRefused(
      () =>
        new RuntimeExtensions(
          [bindingOf(held(SEGMENT))],
          [held({ ...SEGMENT, maximumLength: 64 })],
        ),
    );
    expectRefused(
      () =>
        new RuntimeExtensions(
          [bindingOf(held(FORMAT))],
          [held({ ...FORMAT, result: 'parts' })],
        ),
    );
  });

  it('answers with nothing for an id it does not hold', () => {
    const empty = new RuntimeExtensions();
    expect(empty.messageFunction('test:absent')).toBeUndefined();
    expect(empty.formattingAdapter('test:absent')).toBeUndefined();
    expect(empty.parsingAdapter('test:absent')).toBeUndefined();
  });

  it('answers with a binding only under the kind it was declared as', () => {
    const extensions = new RuntimeExtensions([
      bindingOf(held({ ...FUNCTION, id: 'test:shared' })),
      bindingOf(held({ ...FORMAT, id: 'test:only-format' })),
      bindingOf(held({ ...PARSE, id: 'test:only-parse' })),
    ]);
    expect(extensions.messageFunction('test:shared')?.descriptor.id).toBe(
      'test:shared',
    );
    expect(
      extensions.formattingAdapter('test:only-format')?.descriptor.kind,
    ).toBe('formatting-adapter');
    expect(extensions.parsingAdapter('test:only-parse')?.descriptor.kind).toBe(
      'parsing-adapter',
    );
    expect(extensions.messageFunction('test:only-format')).toBeUndefined();
    expect(extensions.formattingAdapter('test:only-parse')).toBeUndefined();
    expect(extensions.parsingAdapter('test:shared')).toBeUndefined();
  });
});

describe('the text a rich-slot binding projects', () => {
  const part = {
    kind: 'slot',
    name: 'marker',
    slotKind: 'test:marker',
    shape: 'standalone',
    options: {},
    children: [],
    language: 'en',
    direction: 'ltr',
  } as unknown as LocalizedSlotPart;

  const projecting = (text: unknown): RuntimeExtensions =>
    new RuntimeExtensions([
      {
        descriptor: signed(SLOT),
        projectText: () => text,
      } as unknown as RuntimeExtensionBinding,
    ]);

  it('is returned up to the output ceiling', () => {
    const longest = 'a'.repeat(RUNTIME_LIMITS.outputCodePoints);
    expect(projecting(longest).projectSlot(part)).toBe(longest);
    expect(projecting('').projectSlot(part)).toBe('');
  });

  it('is refused one code point past the output ceiling', () => {
    const extensions = projecting(
      'a'.repeat(RUNTIME_LIMITS.outputCodePoints + 1),
    );
    expectRefused(() => extensions.projectSlot(part));
  });

  it('is left to the children for a kind that has no binding', () => {
    expect(new RuntimeExtensions().projectSlot(part)).toBeUndefined();
  });
});
