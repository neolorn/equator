/**
 * The portable type a message's own use of an input implies.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 7 lets a refinement narrow what was
 * inferred, so what is inferred has to be read from every place an input is used: the operand of a
 * built-in function, the operand of a registered one, a typed option of a registered one, and the
 * patterns of every variant. An input used under two types has no single contract and is refused.
 */
import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  parseConfiguration,
  type ExtensionRegistry,
  type ToolkitDiagnostic,
} from '../src/index.js';
import {
  analyzeCatalogSet,
  type EffectiveInputContract,
} from '../src/semantic-model.js';

function registry(): ExtensionRegistry {
  const defined = defineExtensionRegistry([
    {
      kind: 'message-function',
      id: 'demo:quantity',
      operandType: 'number',
      options: { precision: { type: 'integer' } },
      resultType: 'string',
      selector: 'none',
      maximumOutputLength: 64,
    },
    {
      kind: 'message-function',
      id: 'demo:plain',
      operandType: 'string',
      resultType: 'string',
      selector: 'none',
      maximumOutputLength: 64,
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

type Analysis =
  | { readonly refusals: readonly ToolkitDiagnostic[] }
  | { readonly inputs: readonly EffectiveInputContract[] };

/**
 * Analyses one source message. The catalog is parsed under `parsedWith` and analysed under
 * `analyzedWith`, which differ where a case needs a registry that changed between the two.
 */
function analyze(
  message: string,
  parsedWith: ExtensionRegistry = registry(),
  analyzedWith: ExtensionRegistry = parsedWith,
): Analysis {
  const configuration = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    }),
  );
  if (!configuration.ok) throw new Error('Configuration fixture failed');
  const catalog = parseCatalog(
    ['messages:', '  subject: |-', ...indented(message), ''].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/inference-lab',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
      extensions: parsedWith,
    },
  );
  if (!catalog.ok) return { refusals: catalog.diagnostics };
  const graph = analyzeCatalogSet({
    configuration: configuration.value,
    catalogs: [catalog.value],
    extensions: analyzedWith,
  });
  if (!graph.ok) return { refusals: graph.diagnostics };
  return { inputs: graph.value.scopes[0]?.messages[0]?.inputs ?? [] };
}

function indented(message: string): readonly string[] {
  return message.split('\n').map((line) => `    ${line}`);
}

function typesOf(message: string): Readonly<Record<string, string>> {
  const analysis = analyze(message);
  if ('refusals' in analysis) {
    throw new Error(JSON.stringify(analysis.refusals));
  }
  return Object.fromEntries(
    analysis.inputs.map(({ name, type }) => [name, type]),
  );
}

function refusalCodes(analysis: Analysis): readonly string[] {
  return 'refusals' in analysis
    ? analysis.refusals.map(({ code }) => code)
    : [];
}

describe('the type inferred from a built-in function operand', () => {
  it.each([
    ['string', '{$value :string}', 'string'],
    ['integer', '{$value :integer}', 'integer'],
    ['number', '{$value :number}', 'number'],
    ['offset', '{$value :offset add=1}', 'number'],
    ['percent', '{$value :percent}', 'number'],
    ['unit', '{$value :unit unit=meter}', 'number'],
    ['datetime', '{$value :datetime}', 'date-time'],
    ['date', '{$value :date}', 'date-time'],
    ['time', '{$value :time}', 'date-time'],
  ])('is the operand type of :%s', (_name, message, type) => {
    expect(typesOf(message)).toEqual({ value: type });
  });

  it.each([
    ['string', 'number'],
    ['offset add=1', 'string'],
    ['percent', 'string'],
    ['unit unit=meter', 'string'],
    ['date', 'string'],
    ['time', 'string'],
  ])('counts :%s as a use that :%s contradicts', (first, second) => {
    expect(
      refusalCodes(analyze(`{$value :${first}} and {$value :${second}}`)),
    ).toEqual(['EQ1302']);
  });
});

describe('the type inferred from a registered function', () => {
  it('is the operand type its descriptor declares', () => {
    expect(typesOf('{$amount :demo:quantity}')).toEqual({ amount: 'number' });
  });

  it('is the declared type of an option an input is passed to', () => {
    expect(typesOf('{$amount :demo:quantity precision=$digits}')).toEqual({
      amount: 'number',
      digits: 'integer',
    });
  });

  it('is absent for an option the descriptor stopped declaring', () => {
    const before = registry();
    const after = defineExtensionRegistry([
      {
        kind: 'message-function',
        id: 'demo:quantity',
        operandType: 'number',
        options: { rounding: { type: 'string' } },
        resultType: 'string',
        selector: 'none',
        maximumOutputLength: 64,
      },
    ]);
    if (!after.ok) throw new Error(JSON.stringify(after.diagnostics));
    expect(
      refusalCodes(
        analyze(
          '{$amount :demo:quantity precision=$digits}',
          before,
          after.value,
        ),
      ),
    ).toEqual(['EQ1805']);
  });

  it('is not asked of a function called without an operand', () => {
    expect(refusalCodes(analyze('{:demo:plain}'))).toEqual(['EQ1805']);
  });
});

describe('the type inferred across variants', () => {
  it('reads an input that only the variant patterns use', () => {
    expect(
      typesOf(
        [
          '.input {$count :number}',
          '.match $count',
          '1 {{One of {$total :integer}}}',
          '* {{{$count} of {$total :integer}}}',
        ].join('\n'),
      ),
    ).toEqual({ count: 'number', total: 'integer' });
  });
});
