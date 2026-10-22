/**
 * Options written on a markup element, and which kinds let a catalog write them.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8: a catalog may set an option only where
 * a registered kind declares it as a closed, translation-safe value, and may never set a URL, a
 * class, a style, a DOM property, a role or a handler. A declared value on a registered custom kind
 * is the control; the same option with a value the kind does not list, and an option it does not
 * declare, are refused.
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
      kind: 'rich-slot-kind',
      id: 'demo:badge',
      shape: 'paired',
      interactive: false,
      textProjection: 'binding-required',
      options: { tone: ['info', 'warning'] },
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

function refusalCodes(message: string): readonly string[] {
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
      '  subject:',
      `    message: ${JSON.stringify(message)}`,
      '    slots:',
      '      badge: demo:badge',
      '',
    ].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/option-lab',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
      extensions,
    },
  );
  if (!catalog.ok) return catalog.diagnostics.map(({ code }) => code);
  const graph = analyzeCatalogSet({
    configuration: configuration.value,
    catalogs: [catalog.value],
    extensions,
  });
  return graph.ok ? [] : graph.diagnostics.map(({ code }) => code);
}

describe('a markup option', () => {
  it('is accepted where a registered kind declares the value', () => {
    expect(refusalCodes('{#badge tone=warning}New{/badge}')).toEqual([]);
  });

  it.each([
    ['a value the kind does not list', '{#badge tone=danger}New{/badge}'],
    [
      'an option the kind does not declare',
      '{#badge tone=info class=pill}New{/badge}',
    ],
    [
      'a style on a registered kind',
      '{#badge tone=info style=|color: red|}New{/badge}',
    ],
  ])('is refused as %s', (_label, message) => {
    expect(refusalCodes(message)).toContain('EQ1805');
  });
});
