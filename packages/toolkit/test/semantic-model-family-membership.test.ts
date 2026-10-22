/**
 * Which source messages a family takes as members, and what it records about each.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 10. Every source message satisfying the
 * template, the segments and the contract becomes a member, so membership is decided part by part:
 * the same number of parts, each literal equal, each placeholder value inside its segment type's
 * bounds. A duplicate template, an ambiguous overlap and an incompatible contract fail, each
 * reported once against the family that caused it.
 */
import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  type ExtensionRegistry,
  type ToolkitDiagnostic,
} from '../src/index.js';
import {
  analyzeCatalogSet,
  type SemanticFamily,
} from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

const configuration = testProjectConfiguration(['en-US']);

function registry(): ExtensionRegistry {
  const defined = defineExtensionRegistry([
    {
      kind: 'identifier-segment',
      id: 'demo:state',
      syntax: 'lower-kebab',
      maximumLength: 8,
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

type Analysis =
  | { readonly families: readonly SemanticFamily[] }
  | { readonly refused: readonly string[] };

/** The code and the pointer of each refusal, which is what tells one family's fault from another's. */
function refusal({ code, path }: ToolkitDiagnostic): string {
  return `${code} ${path.join('/')}`;
}

function analyze(lines: readonly string[]): Analysis {
  const extensions = registry();
  const catalog = parseCatalog([...lines, ''].join('\n'), {
    role: 'source',
    providerId: '@neolorn/family-lab',
    scopeId: 'orders',
    locale: 'en-US',
    sourcePath: 'i18n/orders/en-US.yaml',
    extensions,
  });
  if (!catalog.ok) return { refused: catalog.diagnostics.map(refusal) };
  const graph = analyzeCatalogSet({
    configuration,
    catalogs: [catalog.value],
    extensions,
  });
  return graph.ok
    ? { families: graph.value.scopes[0]?.families ?? [] }
    : { refused: graph.diagnostics.map(refusal) };
}

function memberIds(analysis: Analysis): readonly string[] {
  if (!('families' in analysis)) {
    throw new Error(`refused: ${analysis.refused.join(', ')}`);
  }
  return (analysis.families[0]?.members ?? []).map(
    ({ messageId }) => messageId,
  );
}

const typedStatus = [
  'families:',
  '  status:',
  '    template: "status.{state}"',
  '    segments:',
  '      state: demo:state',
];

describe('a family placeholder', () => {
  it('may be named in several hyphenated words', () => {
    const analysis = analyze([
      'messages:',
      '  status.ready: Ready',
      'families:',
      '  status:',
      '    template: "status.{order-state}"',
      '    segments:',
      '      order-state: demo:state',
    ]);
    expect(analysis).toMatchObject({
      families: [
        {
          segments: [{ name: 'order-state' }],
          members: [
            { messageId: 'status.ready', segments: { 'order-state': 'ready' } },
          ],
        },
      ],
    });
  });
});

describe('a family member', () => {
  it('has exactly as many parts as the template', () => {
    expect(
      memberIds(
        analyze([
          'messages:',
          '  status: Status',
          '  status.ready: Ready',
          '  status.ready.detail: Ready to ship',
          'families:',
          '  status: "status.{state}"',
        ]),
      ),
    ).toEqual(['status.ready']);
  });

  it('keeps a segment value as long as its type allows and no longer', () => {
    expect(
      memberIds(
        analyze([
          'messages:',
          '  status.ready: Ready',
          '  status.packaged: Packaged',
          '  status.cancelled: Cancelled',
          ...typedStatus,
        ]),
      ),
    ).toEqual(['status.packaged', 'status.ready']);
  });

  it('is bounded at 128 characters where the placeholder declares no type', () => {
    const longest = 'a'.repeat(128);
    expect(
      memberIds(
        analyze([
          'messages:',
          `  status.${longest}: At the bound`,
          `  status.${longest}a: Past the bound`,
          'families:',
          '  status: "status.{state}"',
        ]),
      ),
    ).toEqual([`status.${longest}`]);
  });

  it('lists its segment values by name in code point order', () => {
    const analysis = analyze([
      'messages:',
      '  route.north.early: North, early',
      'families:',
      '  route: "route.{zone}.{band}"',
    ]);
    if (!('families' in analysis)) throw new Error(analysis.refused.join());
    expect(
      Object.entries(analysis.families[0]?.members[0]?.segments ?? {}),
    ).toEqual([
      ['band', 'early'],
      ['zone', 'north'],
    ]);
  });
});

describe('a family segment', () => {
  it('carries the syntax and the bound of its registered type', () => {
    const analysis = analyze([
      'messages:',
      '  status.ready: Ready',
      ...typedStatus,
    ]);
    if (!('families' in analysis)) throw new Error(analysis.refused.join());
    expect(analysis.families[0]?.segments).toEqual([
      {
        name: 'state',
        type: 'demo:state',
        syntax: 'lower-kebab',
        maximumLength: 8,
      },
    ]);
  });
});

describe('two families', () => {
  it('are accepted where their names differ only in the letter after a hyphen', () => {
    expect(
      analyze([
        'messages:',
        '  monthly.basic: Basic, monthly',
        '  yearly.basic: Basic, yearly',
        'families:',
        '  plan-a: "monthly.{tier}"',
        '  plan-b: "yearly.{tier}"',
      ]),
    ).toMatchObject({
      families: [{ name: 'plan-a' }, { name: 'plan-b' }],
    });
  });

  it('are refused once, at the second, where they share a template', () => {
    expect(
      analyze([
        'messages:',
        '  status.ready: Ready',
        '  status.pending: Pending',
        'families:',
        '  first: "status.{state}"',
        '  second: "status.{state}"',
      ]),
    ).toEqual({ refused: ['EQ1305 families/second'] });
  });

  it('are refused, at the second, where one message matches both', () => {
    expect(
      analyze([
        'messages:',
        '  status.ready: Ready',
        'families:',
        '  by-state: "status.{state}"',
        '  ready-of: "{subject}.ready"',
      ]),
    ).toEqual({ refused: ['EQ1305 families/ready-of'] });
  });
});

describe('a family whose members disagree on their contract', () => {
  it('is refused at the family', () => {
    expect(
      analyze([
        'messages:',
        '  status.ready: Ready',
        '  status.pending: "Pending for {$days :number} days"',
        'families:',
        '  status: "status.{state}"',
      ]),
    ).toEqual({ refused: ['EQ1305 families/status'] });
  });
});
