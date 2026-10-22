/**
 * Where a slot or its refinement is refused once every variant of a message has been read.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8: one slot has one shape, a built-in
 * kind is paired and a registered kind has the shape its descriptor declares, `optional` and
 * `repeatable` state what the source already shows, and `within` narrows a placement without
 * opening one the nesting rules forbid. Each refusal points at the field of the entry that is
 * wrong, so the path is asserted with the code.
 */
import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  parseConfiguration,
  type Catalog,
  type ExtensionRegistry,
  type SlotRefinement,
} from '../src/index.js';
import {
  analyzeCatalogSet,
  type EffectiveSlotContract,
} from '../src/semantic-model.js';

function registry(): ExtensionRegistry {
  const defined = defineExtensionRegistry([
    {
      kind: 'rich-slot-kind',
      id: 'demo:badge',
      shape: 'paired',
      interactive: false,
      textProjection: 'binding-required',
    },
    {
      kind: 'rich-slot-kind',
      id: 'demo:toggle',
      shape: 'paired',
      interactive: true,
      textProjection: 'children',
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
  | { readonly slots: readonly EffectiveSlotContract[] };

function catalog(
  role: 'source' | 'target',
  locale: string,
  entry: readonly string[],
): Catalog {
  const parsed = parseCatalog(
    ['messages:', '  subject:', ...entry, ''].join('\n'),
    {
      role,
      providerId: '@neolorn/slot-lab',
      scopeId: 'shell',
      locale,
      sourcePath: `i18n/shell/${locale}.yaml`,
      extensions: registry(),
    },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function analyzed(catalogs: readonly Catalog[]): Analysis {
  const configuration = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: catalogs.map(({ locale }) => locale),
    }),
  );
  if (!configuration.ok) throw new Error('Configuration fixture failed');
  const graph = analyzeCatalogSet({
    configuration: configuration.value,
    catalogs,
    extensions: registry(),
  });
  if (!graph.ok) {
    return {
      refusals: graph.diagnostics.map(({ code, path }) => ({
        code,
        path: [...path],
      })),
    };
  }
  return { slots: graph.value.scopes[0]?.messages[0]?.slots ?? [] };
}

function analyze(entry: readonly string[]): Analysis {
  return analyzed([catalog('source', 'en-US', entry)]);
}

function refusedAt(...path: readonly string[]): Analysis {
  return {
    refusals: [{ code: 'EQ1303', path: ['messages', 'subject', ...path] }],
  };
}

const message = (text: string): string =>
  `    message: ${JSON.stringify(text)}`;

describe('the shape of a slot', () => {
  it('is refused at the slot when one message uses it both ways', () => {
    expect(analyze([message('{#mark}Now{/mark} and {#mark/}')])).toEqual(
      refusedAt('slots', 'mark'),
    );
  });

  it('is refused at the shape when a built-in kind stands alone', () => {
    expect(analyze([message('Saved {#strong/}')])).toEqual(
      refusedAt('slots', 'strong', 'shape'),
    );
  });

  it('is refused at the shape when it is not the one a registered kind declares', () => {
    expect(
      analyze([
        message('New {#badge/}'),
        '    slots:',
        '      badge: demo:badge',
      ]),
    ).toEqual(refusedAt('slots', 'badge', 'shape'));
  });

  it('is refused at the slot when an unused slot gives no way to determine it', () => {
    expect(
      analyze([
        message('Plain'),
        '    slots:',
        '      marker:',
        '        description: A marker the translator may place.',
      ]),
    ).toEqual(refusedAt('slots', 'marker'));
  });
});

describe('the kind of a slot', () => {
  it('is refused at the kind when no registry declares it', () => {
    expect(
      analyze([
        message('{#chip}New{/chip}'),
        '    slots:',
        '      chip: demo:chip',
      ]),
    ).toEqual(refusedAt('slots', 'chip', 'kind'));
  });
});

describe('the cardinality of a slot', () => {
  const counted = (one: string, other: string): readonly string[] => [
    '    message: |-',
    '      .input {$count :number}',
    '      .match $count',
    `      1 {{${one}}}`,
    `      * {{${other}}}`,
  ];

  it('places a slot one variant leaves out only where the other variant has it', () => {
    expect(analyze(counted('{#strong}One{/strong}', 'Many'))).toEqual({
      slots: [
        {
          name: 'strong',
          kind: 'strong',
          shape: 'paired',
          optional: true,
          repeatable: false,
          within: ['@root'],
        },
      ],
    });
  });

  it('is optional for a slot declared on an explicitly empty message', () => {
    expect(
      analyze(['    empty: true', '    slots:', '      note: emphasis']),
    ).toEqual({
      slots: [
        {
          name: 'note',
          kind: 'emphasis',
          shape: 'paired',
          optional: true,
          repeatable: false,
          within: [],
        },
      ],
    });
  });

  it('is refused at optional when every variant uses the slot', () => {
    expect(
      analyze([
        message('{#strong}Saved{/strong}'),
        '    slots:',
        '      strong:',
        '        optional: true',
      ]),
    ).toEqual(refusedAt('slots', 'strong', 'optional'));
  });

  it('is refused at repeatable when no variant uses the slot twice', () => {
    expect(
      analyze([
        message('{#strong}Saved{/strong}'),
        '    slots:',
        '      strong:',
        '        repeatable: true',
      ]),
    ).toEqual(refusedAt('slots', 'strong', 'repeatable'));
  });
});

describe('a within refinement', () => {
  const within = (text: string, slot: string, parents: string) => [
    message(text),
    '    slots:',
    `      ${slot}:`,
    `        within: ${parents}`,
  ];

  it('is refused at within when the source uses the slot under a parent it leaves out', () => {
    expect(
      analyze(
        within('{#emphasis}{#mark}a{/mark}{/emphasis}', 'mark', '[strong]'),
      ),
    ).toEqual(refusedAt('slots', 'mark', 'within'));
    expect(
      analyze(
        within(
          '{#emphasis}{#mark}a{/mark}{/emphasis} {#strong}{#mark}b{/mark}{/strong}',
          'mark',
          '[strong]',
        ),
      ),
    ).toEqual(refusedAt('slots', 'mark', 'within'));
  });

  it('may place a slot that is not interactive inside an interactive one', () => {
    expect(
      analyze(within('Open {#link}support{/link}.', 'strong', '[link]')),
    ).toMatchObject({
      slots: [{ name: 'link' }, { name: 'strong', within: ['link'] }],
    });
  });

  it('is refused at within when it places a registered interactive kind inside a link', () => {
    expect(
      analyze([
        message('Open {#link}support{/link}.'),
        '    slots:',
        '      switch:',
        '        kind: demo:toggle',
        '        within: [link]',
      ]),
    ).toEqual(refusedAt('slots', 'switch', 'within'));
  });

  it('is refused at within when it names a slot declared as code', () => {
    expect(
      analyze([
        message('Run {#snippet}npm test{/snippet}.'),
        '    slots:',
        '      snippet: code',
        '      strong:',
        '        within: [snippet]',
      ]),
    ).toEqual(refusedAt('slots', 'strong', 'within'));
  });

  it('is read against the source contract on a target catalog built with one', () => {
    const target = catalog('target', 'ar-EG', [
      message('{#link}support{/link}'),
    ]);
    const subject = target.messages['subject'];
    if (subject === undefined) throw new Error('Catalog fixture failed');
    const slots: Readonly<Record<string, SlotRefinement>> = {
      link: { optional: false, repeatable: false, within: ['panel'] },
    };
    expect(
      analyzed([
        catalog('source', 'en-US', [message('Open {#link}support{/link}.')]),
        { ...target, messages: { subject: { ...subject, slots } } },
      ]),
    ).toEqual({
      refusals: [
        {
          code: 'EQ1303',
          path: ['messages', 'subject', 'slots', 'link', 'within'],
        },
        { code: 'EQ1304', path: ['messages', 'subject'] },
      ],
    });
  });
});
