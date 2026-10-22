/**
 * What a fixed part of a family template, and a value standing in a placeholder, may be spelled as.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 10. A part is written the way a part of
 * a message key is: lower-case words joined by hyphens, each word beginning with a letter. A
 * template whose fixed part is spelled another way is refused at the template, before membership is
 * looked at.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

type Analysis =
  | { readonly members: readonly string[] }
  | { readonly refused: readonly string[] };

function analyze(lines: readonly string[]): Analysis {
  const catalog = parseCatalog([...lines, ''].join('\n'), {
    role: 'source',
    providerId: '@neolorn/family-lab',
    scopeId: 'orders',
    locale: 'en-US',
    sourcePath: 'i18n/orders/en-US.yaml',
  });
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
  });
  return graph.ok
    ? {
        members: (graph.value.scopes[0]?.families[0]?.members ?? []).map(
          ({ messageId }) => messageId,
        ),
      }
    : {
        refused: graph.diagnostics.map(
          ({ code, path }) => `${code} ${path.join('/')}`,
        ),
      };
}

const refusedAtTheTemplate = {
  refused: ['EQ1305 families/status/template'],
};

describe('a fixed part of a family template', () => {
  it('may be several hyphenated words of any length', () => {
    expect(
      analyze([
        'messages:',
        '  order-status-v2.ready: Ready',
        'families:',
        '  status: "order-status-v2.{state}"',
      ]),
    ).toEqual({ members: ['order-status-v2.ready'] });
  });

  it.each([
    ['begins with a capital letter', 'Status'],
    ['begins with a digit', '9status'],
    ['has a word that begins with a digit', 'order-9status'],
    ['ends with a hyphen', 'status-'],
  ])('is refused at the template when it %s', (_label, part) => {
    expect(
      analyze([
        'messages:',
        '  status.ready: Ready',
        'families:',
        `  status: "${part}.{state}"`,
      ]),
    ).toEqual(refusedAtTheTemplate);
  });
});

describe('a value standing in a placeholder', () => {
  it('may be several hyphenated words of any length', () => {
    expect(
      analyze([
        'messages:',
        '  status.not-yet-ready: Waiting',
        'families:',
        '  status: "status.{state}"',
      ]),
    ).toEqual({ members: ['status.not-yet-ready'] });
  });
});
