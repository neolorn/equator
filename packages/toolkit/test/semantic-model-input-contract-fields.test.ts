/**
 * What the effective contract of an input holds once its refinement is applied.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 7. A refinement may name any type of the
 * portable registry the message's own use allows, and may mark the input optional or nullable; the
 * contract carries each of those as authored. Where a message uses one input in conflicting ways,
 * the refusal does not depend on which use is written first.
 */
import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  type ExtensionRegistry,
} from '../src/index.js';
import {
  analyzeCatalogSet,
  type EffectiveInputContract,
} from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

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

type Analysis =
  | { readonly inputs: readonly EffectiveInputContract[] }
  | { readonly refused: readonly string[] };

function analyze(entry: readonly string[]): Analysis {
  const extensions = registry();
  const catalog = parseCatalog(
    ['messages:', '  subject:', ...entry, ''].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/refinement-lab',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
      extensions,
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
    extensions,
  });
  return graph.ok
    ? { inputs: graph.value.scopes[0]?.messages[0]?.inputs ?? [] }
    : {
        refused: graph.diagnostics.map(
          ({ code, path }) => `${code} ${path.join('/')}`,
        ),
      };
}

const message = (text: string): string =>
  `    message: ${JSON.stringify(text)}`;

describe('a refinement type', () => {
  it('may be boolean where the message uses the input as one', () => {
    expect(
      analyze([
        message('{$on :demo:flag}'),
        '    inputs:',
        '      on: boolean',
      ]),
    ).toEqual({
      inputs: [
        { name: 'on', type: 'boolean', optional: false, nullable: false },
      ],
    });
  });
});

describe('a refinement that marks an input', () => {
  it('makes it optional and leaves it non-nullable', () => {
    expect(
      analyze([
        message('Hello {$name}'),
        '    inputs:',
        '      name:',
        '        optional: true',
      ]),
    ).toEqual({
      inputs: [
        { name: 'name', type: 'string', optional: true, nullable: false },
      ],
    });
  });

  it('makes it nullable and leaves it required', () => {
    expect(
      analyze([
        message('Hello {$name}'),
        '    inputs:',
        '      name:',
        '        nullable: true',
      ]),
    ).toEqual({
      inputs: [
        { name: 'name', type: 'string', optional: false, nullable: true },
      ],
    });
  });
});

describe('an input a message uses as two types', () => {
  // The refinement is compatible with one of the two uses only, so a second refusal would appear
  // if the use written first decided the type the refinement is judged against.
  const refined = (text: string): readonly string[] => [
    message(text),
    '    inputs:',
    '      count: integer',
  ];

  it.each([
    ['the text use is written first', '{$count :string} {$count :number}'],
    ['the number use is written first', '{$count :number} {$count :string}'],
  ])('is refused once, on the message, when %s', (_label, text) => {
    expect(analyze(refined(text))).toEqual({
      refused: ['EQ1302 messages/subject'],
    });
  });
});
