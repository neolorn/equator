import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  diffCatalogSets,
  parseCatalog,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * The extension registry of a snapshot.
 *
 * A snapshot is a project at one moment, and a project whose catalogs name a segment type is
 * read through the registry that declares the type. The snapshot states it as a compilation's
 * request does, and one that leaves it out is refused for the type nobody registered.
 */

const registry = defineExtensionRegistry([
  {
    kind: 'identifier-segment',
    id: 'demo:state',
    syntax: 'lower-kebab',
    maximumLength: 8,
  },
]);
if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));

const catalog = parseCatalog(
  [
    'messages:',
    '  status.ready: Ready',
    'families:',
    '  status:',
    '    template: "status.{state}"',
    '    segments:',
    '      state: demo:state',
    '',
  ].join('\n'),
  {
    role: 'source',
    providerId: '@example/app',
    scopeId: 'orders',
    locale: 'en-US',
    extensions: registry.value,
  },
);
if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));

const configuration = testProjectConfiguration(['en-US']);

describe('a snapshot whose catalogs name a registered segment type', () => {
  it('is compared when it states the registry', () => {
    const result = diffCatalogSets({
      before: {
        configuration,
        catalogs: [catalog.value],
        extensions: registry.value,
      },
      after: {
        configuration,
        catalogs: [catalog.value],
        extensions: registry.value,
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('is refused for the type when it states none', () => {
    const result = diffCatalogSets({
      before: { configuration, catalogs: [catalog.value] },
      after: {
        configuration,
        catalogs: [catalog.value],
        extensions: registry.value,
      },
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: 'EQ1805', path: ['families', 'status', 'segments', 'state'] },
    ]);
  });

  it('is thrown back when the registry is not one', () => {
    expect(() =>
      diffCatalogSets({
        before: { configuration, catalogs: [], extensions: {} as never },
        after: { configuration, catalogs: [] },
      }),
    ).toThrow(
      'diffCatalogSets: request.before.extensions.descriptors must be an array, not undefined.',
    );
  });
});
