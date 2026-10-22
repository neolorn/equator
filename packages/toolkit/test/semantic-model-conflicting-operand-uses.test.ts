/**
 * Where an input used under two operand types is refused.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 7 lets a refinement narrow the type
 * inferred for an input, so an input used under two types has no single contract. The two uses can
 * sit anywhere in the message and neither is the wrong one, so the refusal points at the message
 * rather than at an input entry the catalog may not have.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

interface Refusal {
  readonly code: string;
  readonly path: readonly (string | number)[];
}

function refusals(message: string): readonly Refusal[] {
  const catalog = parseCatalog(
    ['messages:', `  subject: ${JSON.stringify(message)}`, ''].join('\n'),
    {
      role: 'source',
      providerId: 'home',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
  });
  return graph.ok
    ? []
    : graph.diagnostics.map(({ code, path }) => ({ code, path: [...path] }));
}

describe('an input used under two operand types', () => {
  it('is accepted where both uses agree', () => {
    expect(refusals('{$value :number} and {$value :percent}')).toEqual([]);
  });

  it('is refused on its message', () => {
    expect(refusals('{$value :string} and {$value :number}')).toEqual([
      { code: 'EQ1302', path: ['messages', 'subject'] },
    ]);
  });
});
