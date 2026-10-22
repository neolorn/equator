/**
 * A pattern part is read by its kind, whatever other fields a caller left on it.
 *
 * A parsed markup element has no operand and no function. A catalog a caller assembled can hold one
 * that carries both, and it is still markup: it types no input and calls nothing, so neither the
 * input contract nor the function checks see what those fields say.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

type Analysis =
  | { readonly inputs: readonly string[] }
  | { readonly refused: readonly string[] };

/** One message whose markup element also carries a call to `functionName` on `$count`. */
function analyze(functionName: string): Analysis {
  const parsed = parseCatalog(
    ['messages:', '  subject: "{$count} {#mark/}"', ''].join('\n'),
    {
      role: 'source',
      providerId: 'home',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const subject = parsed.value.messages['subject'];
  if (subject?.kind !== 'message' || subject.semantics.kind !== 'pattern') {
    throw new Error('Catalog fixture failed');
  }
  const pattern = subject.semantics.pattern.map((part) =>
    typeof part === 'string' || part.kind !== 'markup'
      ? part
      : {
          ...part,
          operand: { kind: 'variable', name: 'count' },
          function: { name: functionName, options: {} },
        },
  );
  const catalog = {
    ...parsed.value,
    messages: {
      subject: { ...subject, semantics: { ...subject.semantics, pattern } },
    },
  } as unknown as Catalog;
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog],
  });
  return graph.ok
    ? {
        inputs: (graph.value.scopes[0]?.messages[0]?.inputs ?? []).map(
          ({ name, type }) => `${name}: ${type}`,
        ),
      }
    : {
        refused: graph.diagnostics.map(
          ({ code, path }) => `${code} ${path.join('/')}`,
        ),
      };
}

describe('a markup element that carries the fields of a function call', () => {
  it('does not type the input those fields name', () => {
    expect(analyze('number')).toEqual({ inputs: ['count: string'] });
  });

  it('is not checked as a call to the function those fields name', () => {
    expect(analyze('demo:absent')).toEqual({ inputs: ['count: string'] });
  });
});
