import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * A markup name a catalog writes is a slot, never a component.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 4: a release provides no catalog-addressable
 * component registry, because a catalog that can name a component can name any component in the
 * application. What stands in its place is the message-local slot: a name that is not a built-in
 * kind resolves to one, and a message-local slot renders only through a template or text binding
 * the application writes for it. So a catalog naming something that looks like a component gets a
 * slot with that name and nothing behind it.
 */

const configuration = testProjectConfiguration(['en-US']);

function analyze(message: string) {
  const parsed = parseCatalog(
    `messages:\n  panel: ${JSON.stringify(message)}\n`,
    {
      role: 'source',
      providerId: '@example/registry',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return analyzeCatalogSet({ configuration, catalogs: [parsed.value] });
}

describe('a markup name that is not a built-in slot kind', () => {
  it('resolves to a message-local slot', () => {
    const result = analyze('Open {#app-admin-panel}settings{/app-admin-panel}');
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const message = result.value.scopes[0]?.messages.find(
      ({ messageId }) => messageId === 'panel',
    );
    expect(message?.resultKind).toBe('structured');
    expect(message?.slots).toEqual([
      expect.objectContaining({
        name: 'app-admin-panel',
        kind: 'message-local',
      }),
    ]);
  });

  it('keeps a built-in name as the built-in kind', () => {
    const result = analyze('Open {#strong}settings{/strong}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scopes[0]?.messages[0]?.slots).toEqual([
      expect.objectContaining({ name: 'strong', kind: 'strong' }),
    ]);
  });
});
