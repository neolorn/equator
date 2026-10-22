/**
 * Two message identities that would be generated at one path.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 9 has every projection
 * collision-checked in both directions: two identities that give one path, and one path given
 * twice. A catalog cannot hold either. A message part is lower-case, the projection raises a
 * letter exactly where a hyphen stood, so two identities that differ give two paths, and a catalog
 * is a mapping, so it holds an identity once. The check is the generator's own, for a graph that
 * did not come from a catalog, and it is asked of the generator here.
 */
import { describe, expect, it } from 'vitest';

import { compileProject, parseCatalog, type Catalog } from '../src/index.js';
import { generateContracts } from '../src/generated-contracts.js';
import {
  analyzeCatalogSet,
  type SemanticGraph,
} from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

const configuration = testProjectConfiguration(['en-US']);

function parsed(): Catalog {
  const catalog = parseCatalog(
    'messages:\n  cart.line-items: Items\n  cart.total: Total\n',
    {
      role: 'source',
      providerId: '@example/app',
      scopeId: 'shell',
      locale: 'en-US',
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  return catalog.value;
}

function graph(): SemanticGraph {
  const analyzed = analyzeCatalogSet({ configuration, catalogs: [parsed()] });
  if (!analyzed.ok) throw new Error(JSON.stringify(analyzed.diagnostics));
  return analyzed.value;
}

/** The graph with one more message in its scope, which no catalog could have put there. */
function withMessage(messageId: string): SemanticGraph {
  const base = graph();
  const scope = base.scopes[0];
  const first = scope?.messages.find(
    (message) => message.messageId === 'cart.line-items',
  );
  if (scope === undefined || first === undefined) throw new Error('no scope');
  return {
    ...base,
    scopes: [
      { ...scope, messages: [...scope.messages, { ...first, messageId }] },
    ],
  };
}

function refusals(result: ReturnType<typeof generateContracts>) {
  return result.diagnostics.map(({ code, summary, path }) => ({
    code,
    summary,
    path,
  }));
}

describe('two identities at one generated path', () => {
  it('cannot be handed to a compilation, which refuses the spelling first', () => {
    const catalog = parsed();
    const assembled = {
      ...catalog,
      messages: {
        ...catalog.messages,
        'cart.lineItems': catalog.messages['cart.line-items'],
      },
    } as Catalog;

    const compiled = compileProject({
      configuration,
      catalogs: [assembled],
      owner: { providerId: '@example/app', generatedRootPath: 'src/i18n' },
    });

    const expected = parseCatalog(
      'messages:\n  cart.line-items: "Items"\n  cart.lineItems: "Items"\n  cart.total: "Total"\n',
      {
        role: 'source',
        providerId: '@example/app',
        scopeId: 'shell',
        locale: 'en-US',
      },
    );
    expect(expected.ok).toBe(false);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map(({ code }) => code)).toEqual(
      expected.diagnostics.map(({ code }) => code),
    );
    expect(compiled.diagnostics.map(({ code }) => code)).not.toContain(
      'EQ1305',
    );
  });

  it('are refused by the generator for a graph that holds both', () => {
    const generated = generateContracts(withMessage('cart.lineItems'));

    expect(generated.ok).toBe(false);
    expect(refusals(generated)).toEqual([
      {
        code: 'EQ1305',
        summary:
          'Message identities "cart.line-items" and "cart.lineItems" collide at generated path "cart.lineItems".',
        path: ['messages', 'cart.lineItems'],
      },
    ]);
  });

  it('are refused by the generator for a graph that holds one identity twice', () => {
    const generated = generateContracts(withMessage('cart.line-items'));

    expect(generated.ok).toBe(false);
    expect(refusals(generated)).toEqual([
      {
        code: 'EQ1305',
        summary: 'Generated message path "cart.lineItems" is duplicated.',
        path: ['messages', 'cart.line-items'],
      },
    ]);
  });

  it('are not what a catalog gives, whose graph generates', () => {
    const generated = generateContracts(graph());

    expect(refusals(generated)).toEqual([]);
    expect(generated.ok).toBe(true);
  });
});
