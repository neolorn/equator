/**
 * Family templates, their segment declarations, and the members they must have.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 10. A template is a fixed sequence of
 * literal parts and whole-part placeholders, so membership is decided by exact comparison and never
 * by a pattern language; a `segments` key names one of those placeholders and its type comes from
 * the registry; and a template no current source message matches describes nothing. `status.{state}`
 * is the accepted control, and each refused template keeps a valid placeholder beside the part under
 * test, so that part is the only thing wrong with it.
 */
import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  parseConfiguration,
  type ExtensionRegistry,
} from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

function registry(): ExtensionRegistry {
  const defined = defineExtensionRegistry([
    {
      kind: 'identifier-segment',
      id: 'demo:state',
      syntax: 'lower-kebab',
      maximumLength: 24,
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

/**
 * The code and the path it points at. A template the grammar refuses would usually also match no
 * message, so the path is what tells a refused template from an empty family.
 */
function refusal({
  code,
  path,
}: {
  readonly code: string;
  readonly path?: readonly (string | number)[];
}): string {
  return `${code} ${(path ?? []).join('.')}`;
}

function refusalCodes(family: readonly string[]): readonly string[] {
  const extensions = registry();
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
    [
      'messages:',
      '  status.ready: Ready',
      '  status.pending: Pending',
      'families:',
      '  status:',
      ...family,
      '',
    ].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/family-lab',
      scopeId: 'orders',
      locale: 'en-US',
      sourcePath: 'i18n/orders/en-US.yaml',
      extensions,
    },
  );
  if (!catalog.ok) return catalog.diagnostics.map(refusal);
  const graph = analyzeCatalogSet({
    configuration: configuration.value,
    catalogs: [catalog.value],
    extensions,
  });
  return graph.ok ? [] : graph.diagnostics.map(refusal);
}

const template = (value: string): readonly string[] => [
  `    template: ${JSON.stringify(value)}`,
];

describe('a family template', () => {
  it('is accepted as literal parts and whole-part placeholders', () => {
    expect(refusalCodes(template('status.{state}'))).toEqual([]);
  });

  it.each([
    ['a glob', 'status.{state}.*'],
    ['a recursive glob', 'status.**.{state}'],
    ['a regular expression', 'status.[a-z]+.{state}'],
    ['an optional part', 'status.{state}.{kind}?'],
    ['a repeated part', 'status.{state}.{kind}+'],
    ['alternation', '(status|state).{state}'],
    ['two placeholders concatenated in one part', 'status.{state}.{a}{b}'],
    ['a placeholder concatenated with a literal', 'status.is-{kind}.{state}'],
    ['a repeated placeholder', 'status.{state}.{state}'],
    ['no literal part', '{state}'],
    ['no placeholder', 'status.ready'],
  ])('is refused with %s', (_label, value) => {
    expect(refusalCodes(template(value))).toContain(
      'EQ1305 families.status.template',
    );
  });

  it('is refused when no current source message matches it', () => {
    expect(refusalCodes(template('shipment.{state}'))).toContain(
      'EQ1305 families.status',
    );
  });
});

describe('a family segments key', () => {
  it('is accepted when it names a placeholder and a registered type', () => {
    expect(
      refusalCodes([
        ...template('status.{state}'),
        '    segments:',
        '      state: demo:state',
      ]),
    ).toEqual([]);
  });

  it('is refused when it names no placeholder of the template', () => {
    expect(
      refusalCodes([
        ...template('status.{state}'),
        '    segments:',
        '      stat: demo:state',
      ]),
    ).toContain('EQ1305 families.status.segments');
  });

  it('is refused when its type is not registered', () => {
    expect(
      refusalCodes([
        ...template('status.{state}'),
        '    segments:',
        '      state: demo:unknown',
      ]),
    ).toContain('EQ1805 families.status.segments.state');
  });
});
