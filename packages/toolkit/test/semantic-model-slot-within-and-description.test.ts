/**
 * What a slot refinement's `within` and `description` become in the slot contract.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8 gives a refinement both fields and
 * forbids a `within` that weakens a nesting constraint. The contract lists the permitted parents in
 * code point order whatever order they were authored in and carries the description as written,
 * and a `within` naming a parent that cannot hold the slot is refused at that field.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

function analyze(entry: readonly string[]) {
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
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  return analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
  });
}

describe('a slot refinement', () => {
  it('lists its permitted parents in code point order and keeps its description', () => {
    const result = analyze([
      '    message: "{#strong}Read {#link}this{/link}{/strong}"',
      '    slots:',
      '      link:',
      '        within: [strong, emphasis]',
      '        description: Opens the guide.',
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scopes[0]?.messages[0]?.slots).toEqual([
      {
        name: 'link',
        kind: 'link',
        shape: 'paired',
        optional: false,
        repeatable: false,
        within: ['emphasis', 'strong'],
        description: 'Opens the guide.',
      },
      {
        name: 'strong',
        kind: 'strong',
        shape: 'paired',
        optional: false,
        repeatable: false,
        within: ['@root'],
      },
    ]);
  });

  it('is refused at its within field when that permits a parent that cannot hold it', () => {
    const result = analyze([
      '    message: Plain',
      '    slots:',
      '      note:',
      '        kind: emphasis',
      '        within: [code]',
    ]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(({ code, path }) => [code, path])).toEqual([
      ['EQ1303', ['messages', 'subject', 'slots', 'note', 'within']],
    ]);
  });
});
