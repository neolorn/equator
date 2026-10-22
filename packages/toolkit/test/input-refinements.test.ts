/**
 * Source input refinements that name an input the message does not have, or describe a value the
 * portable model cannot carry.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 7. A refinement narrows what MessageFormat
 * already infers; it is keyed by the inferred external variable, its type comes from the portable
 * registry and never from the application's source, and its record has no field that would give an
 * input a value the caller did not pass. Each case sits beside a control that differs only in the
 * refused part.
 */
import { describe, expect, it } from 'vitest';

import {
  parseCatalog,
  parseConfiguration,
  type ProjectConfiguration,
} from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

function configuration(): ProjectConfiguration {
  const result = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    }),
  );
  if (!result.ok) throw new Error('Configuration fixture failed');
  return result.value;
}

function parsed(entry: readonly string[]) {
  return parseCatalog(['messages:', '  greeting:', ...entry, ''].join('\n'), {
    role: 'source',
    providerId: '@neolorn/refinement-lab',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
  });
}

/** The codes that refuse the entry, from whichever stage refuses it first. */
function refusal(entry: readonly string[]): readonly string[] {
  const catalog = parsed(entry);
  if (!catalog.ok) return catalog.diagnostics.map(({ code }) => code);
  const graph = analyzeCatalogSet({
    configuration: configuration(),
    catalogs: [catalog.value],
  });
  return graph.ok ? [] : graph.diagnostics.map(({ code }) => code);
}

const hello = '    message: "Hello {$name}"';
const counted = '    message: "{$count :number} items"';

describe('an inputs key', () => {
  it('is accepted when it is the inferred external variable', () => {
    expect(refusal([hello, '    inputs:', '      name: string'])).toEqual([]);
  });

  it.each([
    ['misspelled', [hello, '    inputs:', '      nmae: string']],
    ['written with its sigil', [hello, '    inputs:', '      $name: string']],
    [
      'for an input the message does not use',
      [hello, '    inputs:', '      name: string', '      count: number'],
    ],
    [
      'naming a local declaration',
      [
        '    message: |-',
        '      .local $shown = {$name}',
        '      {{Hello {$shown}}}',
        '    inputs:',
        '      shown: string',
      ],
    ],
  ])('is refused when %s', (_label, entry) => {
    expect(refusal(entry)).toContain('EQ1302');
  });
});

describe('a refinement type', () => {
  it('is accepted from the portable registry', () => {
    expect(refusal([counted, '    inputs:', '      count: integer'])).toEqual(
      [],
    );
    expect(
      refusal([
        counted,
        '    inputs:',
        '      count:',
        '        type: integer',
      ]),
    ).toEqual([]);
  });

  it.each([
    ['a TypeScript symbol', 'Date'],
    ['an import', `"import('./model').Count"`],
    ['a type expression', '"number | string"'],
    ['a source path', './types.ts'],
  ])('is refused when it is %s', (_label, type) => {
    expect(refusal([hello, '    inputs:', `      name: ${type}`])).toContain(
      'EQ1302',
    );
    expect(
      refusal([hello, '    inputs:', '      name:', `        type: ${type}`]),
    ).toContain('EQ1302');
  });
});

describe('a refinement enum', () => {
  it('is accepted as unique literals of the effective type', () => {
    expect(
      refusal([
        hello,
        '    inputs:',
        '      name:',
        '        enum: [ada, grace]',
      ]),
    ).toEqual([]);
  });

  it('is refused with a literal of another type', () => {
    expect(
      refusal([
        counted,
        '    inputs:',
        '      count:',
        '        enum: [one, 2]',
      ]),
    ).toContain('EQ1302');
  });

  it.each([
    ['empty', '[]'],
    ['repeating a literal', '[ada, ada]'],
    ['carrying null', '[ada, null]'],
  ])('is refused when %s', (_label, literals) => {
    expect(
      refusal([
        hello,
        '    inputs:',
        '      name:',
        `        enum: ${literals}`,
      ]),
    ).toContain('EQ1102');
  });
});

describe('a refinement record', () => {
  it.each([
    ['default', 'Friend'],
    ['coerce', 'true'],
    ['substitute', 'Friend'],
    ['convert', 'string'],
  ])('is refused with %s', (field, value) => {
    expect(
      refusal([
        hello,
        '    inputs:',
        '      name:',
        '        optional: true',
        `        ${field}: ${value}`,
      ]),
    ).toContain('EQ1102');
  });
});
