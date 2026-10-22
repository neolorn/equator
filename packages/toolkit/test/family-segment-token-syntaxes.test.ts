/**
 * Family membership under a segment type whose syntax is a token.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 10 makes a source message a member of
 * a family when each placeholder value is inside its segment type's bounds. A segment type states
 * a syntax, and a message key part, which is what a placeholder value is, is spelled within both
 * of the token syntaxes. So a family over an `ascii-token` or a `unicode-token` type takes the
 * same members a family over a `lower-kebab` type does, up to the length the type allows.
 */
import { describe, expect, it } from 'vitest';

import { defineExtensionRegistry, parseCatalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

type Syntax = 'lower-kebab' | 'ascii-token' | 'unicode-token';

/** The members of a family `status.{state}` whose segment type has this syntax. */
function members(syntax: Syntax): readonly string[] {
  const defined = defineExtensionRegistry([
    { kind: 'identifier-segment', id: 'demo:state', syntax, maximumLength: 8 },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  const catalog = parseCatalog(
    [
      'messages:',
      '  status.ready: Ready',
      '  status.on-hold: On hold',
      '  status.cancelled: Cancelled',
      'families:',
      '  status:',
      '    template: "status.{state}"',
      '    segments:',
      '      state: demo:state',
      '',
    ].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/family-lab',
      scopeId: 'orders',
      locale: 'en-US',
      sourcePath: 'i18n/orders/en-US.yaml',
      extensions: defined.value,
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
    extensions: defined.value,
  });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  return (graph.value.scopes[0]?.families[0]?.members ?? []).map(
    ({ messageId }) => messageId,
  );
}

describe('a family over a segment type', () => {
  // The third message is one character past the eight the type allows.
  it.each<Syntax>(['lower-kebab', 'ascii-token', 'unicode-token'])(
    'takes the messages within its length when its syntax is %s',
    (syntax) => {
      expect(members(syntax)).toEqual(['status.on-hold', 'status.ready']);
    },
  );
});
