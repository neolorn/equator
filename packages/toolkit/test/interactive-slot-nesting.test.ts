/**
 * Interactive slots nested inside one another.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8: a reader cannot operate one control
 * from inside another, so no interactive slot contains or is contained by another, whether the
 * two are the built-in `link` and `action` or a registered kind that declares itself interactive,
 * and whether they are direct parent and child or have a plain slot between them. Siblings, and a
 * non-interactive slot inside an interactive one, are the controls.
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
      id: 'demo:toggle',
      shape: 'paired',
      interactive: true,
      textProjection: 'children',
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
      '      toggle: demo:toggle',
      '',
    ].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/nesting-lab',
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

describe('interactive slot nesting', () => {
  it.each([
    [
      'siblings',
      '{#link}Open{/link} or {#action}close{/action} {#toggle}more{/toggle}',
    ],
    [
      'a plain slot inside a link',
      '{#link}Open {#strong}now{/strong}{/link} {#toggle}more{/toggle}',
    ],
  ])('accepts %s', (_label, message) => {
    expect(refusalCodes(message)).toEqual([]);
  });

  it.each([
    [
      'an action inside a link',
      '{#link}Open {#action}now{/action}{/link} {#toggle}more{/toggle}',
    ],
    [
      'a link inside an action',
      '{#action}Open {#link}now{/link}{/action} {#toggle}more{/toggle}',
    ],
    [
      'a link inside a link, through a plain slot',
      '{#link}Open {#strong}{#link}now{/link}{/strong}{/link} {#toggle}more{/toggle}',
    ],
    [
      'a registered interactive kind inside a link',
      '{#link}Open {#toggle}more{/toggle}{/link}',
    ],
    [
      'a link inside a registered interactive kind',
      '{#toggle}Open {#link}now{/link}{/toggle}',
    ],
  ])('refuses %s', (_label, message) => {
    expect(refusalCodes(message)).toContain('EQ1303');
  });
});
