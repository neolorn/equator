/**
 * Where an input refinement is refused, and what the analysis keeps of one it accepts.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 7: a refinement narrows what the message
 * infers and never contradicts it, its type comes from the portable registry, and its `enum` holds
 * literals compatible with the effective type. Each refusal points at the part of the entry that is
 * wrong, so the path is asserted with the code.
 */
import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  parseConfiguration,
  type Catalog,
  type ExtensionRegistry,
} from '../src/index.js';
import {
  analyzeCatalogSet,
  type EffectiveInputContract,
} from '../src/semantic-model.js';

function registry(): ExtensionRegistry {
  const defined = defineExtensionRegistry([
    {
      kind: 'message-function',
      id: 'demo:flag',
      operandType: 'boolean',
      resultType: 'string',
      selector: 'none',
      maximumOutputLength: 16,
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

interface Refusal {
  readonly code: string;
  readonly path: readonly (string | number)[];
}

type Analysis =
  | { readonly refusals: readonly Refusal[] }
  | { readonly inputs: readonly EffectiveInputContract[] };

function parsed(entry: readonly string[]): Catalog {
  const catalog = parseCatalog(
    ['messages:', '  subject:', ...entry, ''].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/refinement-lab',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
      extensions: registry(),
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  return catalog.value;
}

function analyzed(
  catalog: Catalog,
  extensions: ExtensionRegistry = registry(),
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
  const graph = analyzeCatalogSet({
    configuration: configuration.value,
    catalogs: [catalog],
    extensions,
  });
  if (!graph.ok) {
    return {
      refusals: graph.diagnostics.map(({ code, path }) => ({
        code,
        path: [...path],
      })),
    };
  }
  return { inputs: graph.value.scopes[0]?.messages[0]?.inputs ?? [] };
}

function analyze(entry: readonly string[]): Analysis {
  return analyzed(parsed(entry));
}

function refusedAt(...path: readonly string[]): Analysis {
  return {
    refusals: [{ code: 'EQ1302', path: ['messages', 'subject', ...path] }],
  };
}

const message = (text: string): string =>
  `    message: ${JSON.stringify(text)}`;

describe('a refinement type', () => {
  it('narrows an inferred number to an integer', () => {
    expect(
      analyze([
        message('{$count :number}'),
        '    inputs:',
        '      count: integer',
      ]),
    ).toEqual({
      inputs: [
        { name: 'count', type: 'integer', optional: false, nullable: false },
      ],
    });
  });

  it('is refused at its type when it contradicts the inferred one', () => {
    expect(
      analyze([
        message('{$name :string}'),
        '    inputs:',
        '      name: integer',
      ]),
    ).toEqual(refusedAt('inputs', 'name', 'type'));
    expect(
      analyze([
        message('{$count :integer}'),
        '    inputs:',
        '      count: number',
      ]),
    ).toEqual(refusedAt('inputs', 'count', 'type'));
  });

  it('is refused at its type when the portable registry does not hold it', () => {
    expect(
      analyze([
        message('{$name}'),
        '    inputs:',
        '      name:',
        '        type: text',
      ]),
    ).toEqual(refusedAt('inputs', 'name', 'type'));
  });

  it('is refused outside the portable registry even where a descriptor names the same type', () => {
    const declared = registry();
    const renamed = {
      ...declared,
      descriptors: declared.descriptors.map((descriptor) => ({
        ...descriptor,
        operandType: 'flag',
      })),
    } as unknown as ExtensionRegistry;
    expect(
      analyzed(
        parsed([message('{$on :demo:flag}'), '    inputs:', '      on: flag']),
        renamed,
      ),
    ).toEqual(refusedAt('inputs', 'on', 'type'));
  });
});

describe('a refinement key', () => {
  it('is refused at the key when the message infers no such input', () => {
    expect(
      analyze([message('Hello {$name}'), '    inputs:', '      nmae: string']),
    ).toEqual(refusedAt('inputs', 'nmae'));
  });

  it('is refused at the mapping on an explicitly empty message', () => {
    expect(
      analyze(['    empty: true', '    inputs:', '      name: string']),
    ).toEqual(refusedAt('inputs'));
  });
});

describe('a refinement enum', () => {
  const closed = (text: string, name: string, literals: string) => [
    message(text),
    '    inputs:',
    `      ${name}:`,
    `        enum: ${literals}`,
  ];

  it.each([
    ['strings for a string', '{$value :string}', '[ada, grace]', 'string'],
    [
      'strings for a date-time',
      '{$value :datetime}',
      '["2020-02-29"]',
      'date-time',
    ],
    ['booleans for a boolean', '{$value :demo:flag}', '[true]', 'boolean'],
    ['fractions for a number', '{$value :number}', '[1.5, 2]', 'number'],
    ['integers for an integer', '{$value :integer}', '[1, 2]', 'integer'],
  ])('is accepted as %s', (_label, text, literals, type) => {
    expect(analyze(closed(text, 'value', literals))).toMatchObject({
      inputs: [{ name: 'value', type }],
    });
  });

  it.each([
    ['a number for a string', '{$value :string}', '[1, 2]'],
    ['a number for a date-time', '{$value :datetime}', '[1582]'],
    ['a string for a boolean', '{$value :demo:flag}', '["true"]'],
    ['a string for a number', '{$value :number}', '["1"]'],
    ['a fraction for an integer', '{$value :integer}', '[1.5]'],
  ])('is refused at the enum with %s', (_label, text, literals) => {
    expect(analyze(closed(text, 'value', literals))).toEqual(
      refusedAt('inputs', 'value', 'enum'),
    );
  });
});

describe('a refinement description', () => {
  it('is carried into the effective contract', () => {
    expect(
      analyze([
        message('Hello {$name}'),
        '    inputs:',
        '      name:',
        '        description: The reader the greeting is addressed to.',
      ]),
    ).toEqual({
      inputs: [
        {
          name: 'name',
          type: 'string',
          optional: false,
          nullable: false,
          description: 'The reader the greeting is addressed to.',
        },
      ],
    });
  });
});
