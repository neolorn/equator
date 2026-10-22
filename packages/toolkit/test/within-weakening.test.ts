/**
 * A `within` refinement that names a parent the global nesting rules forbid.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8: `within` may narrow a compatible
 * placement and must not weaken a registered or global nesting constraint. An interactive slot
 * cannot sit inside another, and `code` holds only text and values, so a refinement permitting
 * either placement opens a target to a structure no source could author. The source messages below
 * do not use the refined slot, which is the case where only the refinement decides what a target
 * may do. Kept apart from `slot-refinements.test.ts` because these are accepted today.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, parseConfiguration } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

function refusalCodes(entry: readonly string[]): readonly string[] {
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
    ['messages:', '  subject:', ...entry, ''].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/slot-lab',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!catalog.ok) return catalog.diagnostics.map(({ code }) => code);
  const graph = analyzeCatalogSet({
    configuration: configuration.value,
    catalogs: [catalog.value],
  });
  return graph.ok ? [] : graph.diagnostics.map(({ code }) => code);
}

describe('a within refinement that loosens a global nesting rule', () => {
  it('is refused for an interactive slot placed inside another', () => {
    expect(
      refusalCodes([
        '    message: "Open {#link}support{/link}."',
        '    slots:',
        '      action:',
        '        within: [link]',
      ]),
    ).toContain('EQ1303');
  });

  it('is refused for a slot placed inside code', () => {
    expect(
      refusalCodes([
        '    message: "Run {#code}npm test{/code}."',
        '    slots:',
        '      strong:',
        '        within: [code]',
      ]),
    ).toContain('EQ1303');
  });
});
