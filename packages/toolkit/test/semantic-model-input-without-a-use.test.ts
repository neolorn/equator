/**
 * The type of an external input that no expression of its message uses.
 *
 * `parseCatalog` lists an input as external because an expression names it, so a message that
 * lists one nothing uses was assembled by a caller. Such an input has no operand use to infer a
 * type from, and the analysis gives it the type an input has when nothing says otherwise: a
 * string.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

function parsed(): Catalog {
  const result = parseCatalog(
    ['messages:', '  greeting: "Hello {$name}"', ''].join('\n'),
    {
      role: 'source',
      providerId: '@example/app',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

/** The parsed catalog with its message's external inputs replaced. */
function listing(catalog: Catalog, externalInputs: readonly string[]): Catalog {
  const message = catalog.messages['greeting'];
  if (message?.kind !== 'message') throw new Error('Catalog fixture failed');
  return {
    ...catalog,
    messages: {
      greeting: {
        ...message,
        semantics: { ...message.semantics, externalInputs },
      },
    },
  } as unknown as Catalog;
}

describe('an external input no expression uses', () => {
  it('is a string, like an input used with no function', () => {
    const graph = analyzeCatalogSet({
      configuration: testProjectConfiguration(['en-US']),
      catalogs: [listing(parsed(), ['name', 'unused'])],
    });

    if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
    expect(
      graph.value.scopes[0]?.messages[0]?.inputs.map(({ name, type }) => ({
        name,
        type,
      })),
    ).toEqual([
      { name: 'name', type: 'string' },
      { name: 'unused', type: 'string' },
    ]);
  });
});
