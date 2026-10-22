/**
 * Which registered descriptors a scope is recorded as requiring.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 6: a required descriptor is identified by
 * its kind and its identity together. Identities are unique within a kind and not across kinds, so
 * a registry may hold a slot kind and a segment type under one identity, and several descriptors of
 * one kind; a scope requires the one it references and no neighbour of it.
 */
import { describe, expect, it } from 'vitest';

import { defineExtensionRegistry, parseCatalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

function required(lines: readonly string[]): readonly string[] {
  const registry = defineExtensionRegistry([
    {
      kind: 'identifier-segment',
      id: 'demo:area',
      syntax: 'lower-kebab',
      maximumLength: 24,
    },
    {
      kind: 'identifier-segment',
      id: 'demo:state',
      syntax: 'lower-kebab',
      maximumLength: 24,
    },
    {
      kind: 'rich-slot-kind',
      id: 'demo:area',
      shape: 'paired',
      interactive: false,
      textProjection: 'children',
    },
    {
      kind: 'rich-slot-kind',
      id: 'demo:state',
      shape: 'paired',
      interactive: false,
      textProjection: 'children',
    },
  ]);
  if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
  const catalog = parseCatalog([...lines, ''].join('\n'), {
    role: 'source',
    providerId: '@example/orders',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
    extensions: registry.value,
  });
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
    extensions: registry.value,
  });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  return (graph.value.scopes[0]?.requiredExtensions ?? []).map(
    ({ kind, id }) => `${kind} ${id}`,
  );
}

describe('the descriptors a scope requires', () => {
  it('are the segment type a family declares, not its neighbours', () => {
    expect(
      required([
        'messages:',
        '  status.ready: Ready',
        'families:',
        '  status:',
        '    template: "status.{state}"',
        '    segments:',
        '      state: demo:state',
      ]),
    ).toEqual(['identifier-segment demo:state']);
  });

  it('are the slot kind a message declares, not a segment type of the same identity', () => {
    expect(
      required([
        'messages:',
        '  status:',
        '    message: "{#badge}Ready{/badge}"',
        '    slots:',
        '      badge:',
        '        kind: demo:state',
      ]),
    ).toEqual(['rich-slot-kind demo:state']);
  });
});
