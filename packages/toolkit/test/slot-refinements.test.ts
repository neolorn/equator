/**
 * The slot contract a source message implies, and what an expanded `slots` refinement may add.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8. Cardinality is read across every
 * variant a selector can reach rather than by counting markup in the text, a declared slot the
 * source never uses still needs a kind and a shape, and a refinement may narrow a placement but
 * never loosen one or carry anything beyond the six fields the section lists.
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

type Analysis =
  | { readonly codes: readonly string[] }
  | {
      readonly slots: Readonly<
        Record<
          string,
          {
            readonly kind: string;
            readonly shape: string;
            readonly optional: boolean;
            readonly repeatable: boolean;
            readonly within: readonly string[];
          }
        >
      >;
    };

function analyze(entry: readonly string[]): Analysis {
  const catalog = parseCatalog(
    ['messages:', '  subject:', ...entry, ''].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/slot-lab',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!catalog.ok)
    return { codes: catalog.diagnostics.map(({ code }) => code) };
  const graph = analyzeCatalogSet({
    configuration: configuration(),
    catalogs: [catalog.value],
  });
  if (!graph.ok) return { codes: graph.diagnostics.map(({ code }) => code) };
  return {
    slots: Object.fromEntries(
      (graph.value.scopes[0]?.messages[0]?.slots ?? []).map(
        ({ name, kind, shape, optional, repeatable, within }) => [
          name,
          { kind, shape, optional, repeatable, within },
        ],
      ),
    ),
  };
}

const counted = (one: string, other: string): readonly string[] => [
  '    message: |-',
  '      .input {$count :number}',
  '      .match $count',
  `      1 {{${one}}}`,
  `      * {{${other}}}`,
];

describe('slot cardinality', () => {
  it('is exactly one where every reachable variant uses the slot once', () => {
    expect(
      analyze(counted('{#strong}One{/strong}', '{#strong}{$count}{/strong}')),
    ).toMatchObject({
      slots: { strong: { optional: false, repeatable: false } },
    });
  });

  it('is optional where one reachable variant leaves the slot out', () => {
    expect(analyze(counted('{#strong}One{/strong}', 'Many'))).toMatchObject({
      slots: { strong: { optional: true, repeatable: false } },
    });
  });

  it('is repeatable where one reachable path uses the slot twice', () => {
    expect(
      analyze(
        counted(
          '{#strong}One{/strong}',
          '{#strong}{$count}{/strong} of {#strong}all{/strong}',
        ),
      ),
    ).toMatchObject({
      slots: { strong: { optional: false, repeatable: true } },
    });
  });
});

describe('a declared slot the source does not use', () => {
  it('is optional and keeps the kind and shape it was given', () => {
    expect(
      analyze([
        '    message: Plain',
        '    slots:',
        '      note:',
        '        kind: emphasis',
      ]),
    ).toMatchObject({
      slots: { note: { kind: 'emphasis', shape: 'paired', optional: true } },
    });
    expect(
      analyze([
        '    message: Plain',
        '    slots:',
        '      marker:',
        '        shape: standalone',
      ]),
    ).toMatchObject({
      slots: {
        marker: { kind: 'message-local', shape: 'standalone', optional: true },
      },
    });
  });

  it('is refused without a determinable shape', () => {
    expect(
      analyze([
        '    message: Plain',
        '    slots:',
        '      marker:',
        '        description: A marker the translator may place.',
      ]),
    ).toEqual({ codes: expect.arrayContaining(['EQ1303']) });
  });
});

describe('a within constraint', () => {
  it('narrows a placement the source already keeps', () => {
    expect(
      analyze([
        '    message: "{#emphasis}Read {#strong}this{/strong}{/emphasis}"',
        '    slots:',
        '      strong:',
        '        within: [emphasis]',
      ]),
    ).toMatchObject({ slots: { strong: { within: ['emphasis'] } } });
  });

  it('is refused where the source places the slot outside it', () => {
    expect(
      analyze([
        '    message: "Read {#strong}this{/strong}"',
        '    slots:',
        '      strong:',
        '        within: [emphasis]',
      ]),
    ).toEqual({ codes: expect.arrayContaining(['EQ1303']) });
  });
});

describe('an expanded slot refinement', () => {
  it.each([
    ['component', 'BadgeComponent'],
    ['template', 'badgeTemplate'],
    ['element', 'span'],
    ['class', 'badge'],
    ['style', 'color-red'],
    ['url', 'https-example'],
  ])('is refused with %s', (field, value) => {
    expect(
      analyze([
        '    message: "{#badge}New{/badge}"',
        '    slots:',
        '      badge:',
        '        shape: paired',
        `        ${field}: ${value}`,
      ]),
    ).toEqual({ codes: expect.arrayContaining(['EQ1102']) });
  });

  it.each([
    ['a shape outside the two', ['        shape: container']],
    ['an empty within', ['        within: []']],
  ])('is refused with %s', (_label, lines) => {
    expect(
      analyze([
        '    message: "{#badge}New{/badge}"',
        '    slots:',
        '      badge:',
        ...lines,
      ]),
    ).toEqual({ codes: expect.arrayContaining(['EQ1102']) });
  });
});
