/**
 * The ceilings on how many selectors and how many variants one source message may have.
 *
 * Each is a bound a message may sit exactly at. One past it is refused against the message.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/index.js';
import { RESOURCE_LIMITS } from '../src/resource-limits.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

function refusals(body: readonly string[]): readonly string[] {
  const catalog = parseCatalog(
    [
      'messages:',
      '  subject: |-',
      ...body.map((line) => `    ${line}`),
      '',
    ].join('\n'),
    {
      role: 'source',
      providerId: 'home',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  return analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
  }).diagnostics.map(({ code, path }) => `${code} ${path.join('/')}`);
}

function withSelectors(count: number): readonly string[] {
  const names = Array.from({ length: count }, (_, index) => `s${index}`);
  return [
    ...names.map((name) => `.input {$${name} :string}`),
    `.match ${names.map((name) => `$${name}`).join(' ')}`,
    `${names.map(() => '*').join(' ')} {{Text}}`,
  ];
}

function withVariants(count: number): readonly string[] {
  return [
    '.input {$choice :string}',
    '.match $choice',
    ...Array.from({ length: count - 1 }, (_, index) => `k${index} {{Text}}`),
    '* {{Text}}',
  ];
}

describe('the selector ceiling', () => {
  it('admits a message with exactly that many selectors', () => {
    expect(
      refusals(withSelectors(RESOURCE_LIMITS.selectorsPerMessage)),
    ).toEqual([]);
  });

  it('refuses a message with one more', () => {
    expect(
      refusals(withSelectors(RESOURCE_LIMITS.selectorsPerMessage + 1)),
    ).toEqual(['EQ1302 messages/subject']);
  });
});

describe('the variant ceiling', () => {
  it('admits a message with exactly that many variants', () => {
    expect(refusals(withVariants(RESOURCE_LIMITS.variantsPerMessage))).toEqual(
      [],
    );
  });

  it('refuses a message with one more', () => {
    expect(
      refusals(withVariants(RESOURCE_LIMITS.variantsPerMessage + 1)),
    ).toEqual(['EQ1302 messages/subject']);
  });
});
