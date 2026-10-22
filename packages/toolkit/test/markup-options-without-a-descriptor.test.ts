/**
 * Options written on a built-in or message-local slot, which no registered kind declares.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8 lets a catalog set an option only where
 * a registered kind declares it, so an option on `link`, `action`, `strong`, `emphasis`, `code` or a
 * message-local slot has nothing that admits it. Refusing it at build is what keeps a catalog from
 * choosing a destination, a handler, a class or a style (`specs/09-safe-content-and-ux.spec.md`
 * sections 3 and 4): the option never reaches a part, so no renderer has to be the one that ignores
 * it.
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

describe('a markup option on a kind with no descriptor', () => {
  it.each([
    [
      'a destination on a link',
      '{#badge tone=info}New{/badge} {#link href=|https://example.com|}here{/link}',
    ],
    [
      'a handler on an action',
      '{#badge tone=info}New{/badge} {#action onclick=|go()|}go{/action}',
    ],
    [
      'a class on strong',
      '{#badge tone=info}New{/badge} {#strong class=loud}now{/strong}',
    ],
    [
      'a role on emphasis',
      '{#badge tone=info}New{/badge} {#emphasis role=alert}now{/emphasis}',
    ],
    [
      'a style on code',
      '{#badge tone=info}New{/badge} {#code style=|color: red|}x{/code}',
    ],
    [
      'a property on a message-local slot',
      '{#badge tone=info}New{/badge} {#panel hidden=true}x{/panel}',
    ],
  ])('is refused as %s', (_label, message) => {
    expect(refusalCodes(message).length).toBeGreaterThan(0);
  });
});
