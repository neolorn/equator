import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  type LocalizedPart,
  type LocalizedParts,
  type LocalizedSlotPart,
  type LocalizedText,
  type LocalizedValuePart,
  type MessageHandle,
} from '@neolorn/equator/core';

import type {
  CompiledCatalog,
  CompiledInputContract,
} from '../src/catalog-runtime.js';
import {
  FormatterCache,
  catalogConsultationOrder,
  evaluateCandidate,
  findEvaluationCandidate,
  projectLocalizedParts,
} from '../src/evaluator.js';
import { RuntimeExtensions } from '../src/extensions.js';
import { RUNTIME_LIMITS } from '../src/runtime-safety.js';
import {
  evaluateArtifact,
  expression,
  literal,
  patternBody,
  refusalOf,
  renderArtifact,
  variable,
} from './compiled-artifact-harness.js';

const LRI = '⁦';
const RLI = '⁧';
const FSI = '⁨';
const PDI = '⁩';

const text = (value: string): LocalizedPart => ({
  kind: 'text',
  value,
  language: 'en',
  direction: 'ltr',
  supplyingLocale: 'en-US',
});

const value = (
  printed: string,
  contentDirection: LocalizedValuePart['contentDirection'],
  isolate = false,
): LocalizedPart => ({
  kind: 'value',
  value: printed,
  language: 'en',
  direction: 'ltr',
  contentDirection,
  isolate,
  supplyingLocale: 'en-US',
});

const wrap = (children: readonly LocalizedPart[]): LocalizedSlotPart => ({
  kind: 'slot',
  name: 'wrap',
  slotKind: 'test:wrap',
  shape: 'paired',
  children,
  options: {},
  language: 'en',
  direction: 'ltr',
  supplyingLocale: 'en-US',
});

const refusedAsMalformed = (run: () => unknown): void => {
  const failure = refusalOf(run);
  expect(failure.diagnostic.code).toBe('invalid-rich-message');
  expect(failure.diagnostic.outcome).toBe('operational-failure');
};

/**
 * MessageFormat 2's Default Bidi Strategy, as the string projection applies it: a value is
 * isolated by its own direction, and a left-to-right value only where the message runs the other
 * way or the author asked.
 */
describe('how a value is isolated in projected text', () => {
  it('leaves a left-to-right value bare when no message direction is given', () => {
    expect(projectLocalizedParts([text('a '), value('b', 'ltr')])).toBe('a b');
  });

  it('leaves a left-to-right value bare in a left-to-right message', () => {
    expect(projectLocalizedParts([value('b', 'ltr')], undefined, 'ltr')).toBe(
      'b',
    );
  });

  it('isolates a left-to-right value in a right-to-left message', () => {
    expect(projectLocalizedParts([value('b', 'ltr')], undefined, 'rtl')).toBe(
      `${LRI}b${PDI}`,
    );
  });

  it('isolates a left-to-right value the author asked to isolate', () => {
    expect(projectLocalizedParts([value('b', 'ltr', true)])).toBe(
      `${LRI}b${PDI}`,
    );
  });

  it.each([
    ['rtl', RLI],
    ['auto', FSI],
  ] as const)('isolates a value whose content runs %s', (direction, mark) => {
    expect(projectLocalizedParts([value('b', direction)])).toBe(
      `${mark}b${PDI}`,
    );
  });

  it.each(['ltr', 'rtl', 'auto'] as const)(
    'puts nothing around an empty value whose content runs %s',
    (direction) => {
      expect(
        projectLocalizedParts([value('', direction, true)], undefined, 'rtl'),
      ).toBe('');
    },
  );

  it('prints an empty value written with a direction as nothing', () => {
    expect(
      renderArtifact({
        body: patternBody([
          expression(literal(''), {
            name: 'string',
            options: { 'u:dir': literal('rtl') },
          }),
        ]),
      }),
    ).toBe('');
  });
});

describe('what the string projection of parts is held to', () => {
  it('projects the children of a slot when no extensions are given', () => {
    expect(
      projectLocalizedParts([text('a '), wrap([text('b'), wrap([text('c')])])]),
    ).toBe('a bc');
  });

  it('projects text up to the output ceiling and refuses one code point more', () => {
    const half = RUNTIME_LIMITS.outputCodePoints / 2;
    const projecting = (first: number, second: number): string =>
      projectLocalizedParts([
        text('a'.repeat(first)),
        text('b'.repeat(second)),
      ]);
    expect(projecting(half, half)).toHaveLength(
      RUNTIME_LIMITS.outputCodePoints,
    );
    refusedAsMalformed(() => projecting(half, half + 1));
    refusedAsMalformed(() => projecting(half + 1, half));
    refusedAsMalformed(() =>
      projecting(RUNTIME_LIMITS.outputCodePoints + 1, 0),
    );
  });

  it('refuses with nothing behind the refusal, since nothing was thrown at it', () => {
    const failure = refusalOf(() =>
      projectLocalizedParts([
        text('a'.repeat(RUNTIME_LIMITS.outputCodePoints + 1)),
      ]),
    );
    expect(Object.hasOwn(failure, 'cause')).toBe(false);
  });

  it('projects as many parts as the part ceiling and refuses one more', () => {
    const empty = text('');
    const projecting = (parts: number): string =>
      projectLocalizedParts(Array.from({ length: parts }, () => empty));
    expect(projecting(RUNTIME_LIMITS.outputParts)).toBe('');
    refusedAsMalformed(() => projecting(RUNTIME_LIMITS.outputParts + 1));
  });

  it('counts the parts inside a slot toward the part ceiling', () => {
    const empty = text('');
    const projecting = (inside: number): string =>
      projectLocalizedParts([
        wrap(Array.from({ length: inside }, () => empty)),
      ]);
    expect(projecting(RUNTIME_LIMITS.outputParts - 1)).toBe('');
    refusedAsMalformed(() => projecting(RUNTIME_LIMITS.outputParts));
  });

  // The top level is depth one and each slot's children are one deeper than the slot.
  it('projects slots nested to the depth ceiling and refuses one level more', () => {
    const nested = (slots: number): LocalizedPart => {
      let part: LocalizedPart = text('deep');
      for (let level = 0; level < slots; level += 1) part = wrap([part]);
      return part;
    };
    expect(projectLocalizedParts([nested(RUNTIME_LIMITS.jsonDepth - 1)])).toBe(
      'deep',
    );
    refusedAsMalformed(() =>
      projectLocalizedParts([nested(RUNTIME_LIMITS.jsonDepth)]),
    );
  });
});

describe('the value part an expression produces', () => {
  const parts = (pattern: readonly unknown[]): readonly LocalizedPart[] =>
    (
      evaluateArtifact(
        {
          body: patternBody(pattern),
          inputs: [
            { name: 'count', type: 'number', optional: false, nullable: false },
          ],
          resultKind: 'structured',
        },
        { count: 3 },
      ) as LocalizedParts
    ).value;

  it('names the function that formatted it', () => {
    const [part] = parts([
      expression(variable('count'), { name: 'number', options: {} }),
    ]);
    expect(part).toStrictEqual({
      kind: 'value',
      value: '3',
      functionName: 'number',
      language: 'en',
      direction: 'ltr',
      contentDirection: 'ltr',
      isolate: false,
      supplyingLocale: 'en-US',
    });
  });

  it('carries neither a function name nor an id when the message wrote neither', () => {
    const [part] = parts([expression(variable('count'))]);
    expect(Object.keys(part!).sort()).toEqual([
      'contentDirection',
      'direction',
      'isolate',
      'kind',
      'language',
      'supplyingLocale',
      'value',
    ]);
  });
});

/**
 * One catalog per locale named, each carrying the messages listed, evaluated through the same two
 * functions the runtime calls. The shared harness builds a single catalog holding one message
 * with a body, and the metadata of a result is about which catalog answered.
 */
interface Shipped {
  readonly locale: string;
  readonly messages: readonly {
    readonly messageId: string;
    readonly kind?: 'empty' | 'message';
    readonly resultKind?: 'plain' | 'structured';
    readonly body?: unknown;
    readonly inputs?: readonly CompiledInputContract[];
  }[];
}

const catalogOf = ({ locale, messages }: Shipped): CompiledCatalog => {
  const resources = {
    irNodes: 1,
    depth: 1,
    selectors: 0,
    variants: 0,
    inputs: 0,
    slots: 0,
    outputParts: 8,
  };
  return {
    profile: 'equator-compiled-ir/1',
    generatedAbi: 'equator-generated/1',
    standardsProfile: 'equator-1',
    key: { providerId: 'shop', scopeId: 'cart', catalogLocale: locale },
    applicationContractFingerprint: 'test',
    semanticRegistryFingerprint: 'test',
    requiredExtensions: [],
    messages: messages.map((message) => ({
      kind: 'message',
      resultKind: 'plain',
      sourceFingerprint: 'test',
      inputs: [],
      slots: [],
      body: patternBody(['printed']),
      ...message,
    })),
    resources: { ...resources, maximumMessage: resources },
  } as unknown as CompiledCatalog;
};

const handleFor = (
  messageId: string,
  resultKind: 'plain' | 'structured' = 'plain',
): MessageHandle =>
  ({
    generatedAbi: 'equator-generated/1',
    providerId: 'shop',
    scopeId: 'cart',
    messageId,
    identity: `shop:cart:${messageId}`,
    resultKind,
    inputNames: [],
    slotNames: [],
  }) as MessageHandle;

const evaluateIn = (
  targetLocale: string,
  shipped: readonly Shipped[],
  messageId = 'title',
  resultKind: 'plain' | 'structured' = 'plain',
  inputs: unknown = {},
): LocalizedText | LocalizedParts => {
  const handle = handleFor(messageId, resultKind);
  return evaluateCandidate(
    handle,
    findEvaluationCandidate(handle, targetLocale, shipped.map(catalogOf)),
    inputs,
    { locale: targetLocale },
    new FormatterCache(8),
    new RuntimeExtensions(),
  );
};

describe('what a result says about where it came from', () => {
  const TITLE = [{ messageId: 'title' }];

  it('reports no fallback and no diagnostic when the target locale answered', () => {
    const result = evaluateIn('en-US', [{ locale: 'en-US', messages: TITLE }]);
    expect(result).toStrictEqual({
      kind: 'text',
      value: 'printed',
      targetLocale: 'en-US',
      supplyingLocale: 'en-US',
      language: 'en',
      direction: 'ltr',
      attemptedLocales: ['en-US'],
      fallback: false,
      diagnostics: [],
    });
  });

  it('reports the fallback, every locale tried and one diagnostic when another locale answered', () => {
    const result = evaluateIn('ar-EG', [
      { locale: 'ar-EG', messages: [] },
      { locale: 'ar', messages: [] },
      { locale: 'en-US', messages: TITLE },
    ]);
    expect(result).toMatchObject({
      value: 'printed',
      targetLocale: 'ar-EG',
      supplyingLocale: 'en-US',
      language: 'en',
      direction: 'ltr',
      attemptedLocales: ['ar-EG', 'ar', 'en-US'],
      fallback: true,
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'message-unavailable',
      outcome: 'localized-representation-unavailable',
      targetLocale: 'ar-EG',
      supplyingLocale: 'en-US',
      providerId: 'shop',
      scopeId: 'cart',
    });
  });

  it('refuses a message no consulted catalog carries, naming the locale and the scope', () => {
    const failure = refusalOf(() =>
      evaluateIn('ar-EG', [
        { locale: 'ar-EG', messages: [] },
        { locale: 'en-US', messages: [{ messageId: 'other' }] },
      ]),
    );
    expect(failure.diagnostic).toMatchObject({
      code: 'message-unavailable',
      outcome: 'localized-representation-unavailable',
      targetLocale: 'ar-EG',
      providerId: 'shop',
      scopeId: 'cart',
    });
  });
});

/**
 * A generated handle is evaluated only against the catalog it was generated for: the same ABI,
 * provider, scope and result kind. A message id that happens to exist in another scope's catalog
 * is not that handle's message.
 */
describe('a handle evaluated against a catalog it was not generated for', () => {
  it.each([
    ['ABI', { generatedAbi: 'equator-generated/0' }],
    ['provider', { providerId: 'blog' }],
    ['scope', { scopeId: 'checkout' }],
    ['result kind', { resultKind: 'structured' }],
  ])('is refused when the %s differs', (_label, difference) => {
    const handle = { ...handleFor('title'), ...difference } as MessageHandle;
    const failure = refusalOf(() =>
      evaluateCandidate(
        handle,
        findEvaluationCandidate(handle, 'en-US', [
          catalogOf({ locale: 'en-US', messages: [{ messageId: 'title' }] }),
        ]),
        {},
        { locale: 'en-US' },
        new FormatterCache(8),
        new RuntimeExtensions(),
      ),
    );
    expect(failure.diagnostic.code).toBe('invalid-rich-message');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
  });
});

describe('a message compiled as empty', () => {
  const EMPTY = (resultKind: 'plain' | 'structured'): readonly Shipped[] => [
    {
      locale: 'en-US',
      messages: [
        { messageId: 'title', kind: 'empty', resultKind, body: undefined },
      ],
    },
  ];

  it('is answered as empty text when it is plain', () => {
    expect(evaluateIn('en-US', EMPTY('plain'))).toStrictEqual({
      kind: 'text',
      value: '',
      targetLocale: 'en-US',
      supplyingLocale: 'en-US',
      language: 'en',
      direction: 'ltr',
      attemptedLocales: ['en-US'],
      fallback: false,
      diagnostics: [],
    });
  });

  it('is answered as no parts and empty text when it is structured', () => {
    expect(
      evaluateIn('en-US', EMPTY('structured'), 'title', 'structured'),
    ).toStrictEqual({
      kind: 'parts',
      value: [],
      text: '',
      targetLocale: 'en-US',
      supplyingLocale: 'en-US',
      language: 'en',
      direction: 'ltr',
      attemptedLocales: ['en-US'],
      fallback: false,
      diagnostics: [],
    });
  });

  it('still holds its inputs to the contract', () => {
    const failure = refusalOf(() =>
      evaluateIn('en-US', EMPTY('plain'), 'title', 'plain', { extra: 1 }),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
  });
});

describe('what is thrown out of an evaluation', () => {
  const TITLE: readonly Shipped[] = [
    {
      locale: 'en-US',
      messages: [
        {
          messageId: 'title',
          inputs: [
            { name: 'extra', type: 'string', optional: true, nullable: false },
          ],
        },
      ],
    },
  ];
  const throwing = (thrown: unknown): unknown => ({
    get extra(): never {
      throw thrown;
    },
  });
  const thrownBy = (run: () => unknown): unknown => {
    try {
      run();
    } catch (error) {
      return error;
    }
    throw new Error('Expected a throw and nothing was thrown.');
  };

  it('names the message, the provider and the scope on a refusal', () => {
    const failure = refusalOf(() =>
      evaluateIn('en-US', TITLE, 'title', 'plain', { extra: 1 }),
    );
    expect(failure.diagnostic).toMatchObject({
      code: 'invalid-message-input',
      outcome: 'operational-failure',
      messageIdentity: 'shop:cart:title',
      providerId: 'shop',
      scopeId: 'cart',
    });
  });

  it('passes on an error that is not a refusal as it was thrown', () => {
    const thrown = new Error('the consumer getter failed');
    expect(
      thrownBy(() =>
        evaluateIn('en-US', TITLE, 'title', 'plain', throwing(thrown)),
      ),
    ).toBe(thrown);
  });

  it('passes on a refusal that already names a message as it was thrown', () => {
    const thrown = new LocalizationError({
      code: 'invalid-message-input',
      outcome: 'operational-failure',
      message: 'Raised for another message.',
      messageIdentity: 'shop:cart:other',
    });
    expect(
      thrownBy(() =>
        evaluateIn('en-US', TITLE, 'title', 'plain', throwing(thrown)),
      ),
    ).toBe(thrown);
  });
});

describe('the order a scope consults its catalogs in', () => {
  it('consults a locale once however often the chain names it', () => {
    const order = catalogConsultationOrder(
      'en-AU',
      ['en-AU', 'en', 'en'],
      'fr',
      () => true,
    );
    expect(order.locales).toEqual(['en-AU', 'en', 'fr']);
    expect([...order.inherited]).toEqual(['en-AU', 'en']);
  });

  it('leaves out a locale the scope has no catalog for and still ends on the source', () => {
    const order = catalogConsultationOrder(
      'en-AU',
      ['en'],
      'fr',
      (locale) => locale === 'en',
    );
    expect(order.locales).toEqual(['en', 'fr']);
    expect([...order.inherited]).toEqual(['en']);
  });
});
