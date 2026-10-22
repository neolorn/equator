import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/catalog.js';
import { fingerprintCompilerInputs } from '../src/compiler.js';
import {
  defineExtensionRegistry,
  type ExtensionRegistry,
} from '../src/extensions.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * The inputs a compilation is fingerprinted by, beyond the configuration and the catalogs.
 *
 * The fingerprint is what a later run compares to decide whether anything moved. An input the
 * compiler reads and the fingerprint leaves out is a change the next run reports as none: an
 * extension registry replaced, or a different recovery message selected, with the outputs of the
 * previous run still called fresh.
 */

const owner = {
  providerId: '@example/app',
  generatedRootPath: 'src/generated/i18n',
};

function registry(): ExtensionRegistry {
  const defined = defineExtensionRegistry([
    {
      kind: 'identifier-segment',
      id: 'demo:state',
      syntax: 'lower-kebab',
      maximumLength: 24,
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

function digests(
  request: Partial<Parameters<typeof fingerprintCompilerInputs>[0]>,
): Readonly<Record<string, string>> {
  const { inputs } = fingerprintCompilerInputs({
    owner,
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [],
    ...request,
  });
  return Object.fromEntries(
    inputs.map(({ identity, digest }) => [identity, digest]),
  );
}

describe('the inputs a compilation is fingerprinted by', () => {
  it('are the configuration alone when nothing else is passed', () => {
    expect(Object.keys(digests({}))).toEqual(['configuration']);
  });

  it('include the extension registry, by the fingerprint the registry states', () => {
    const extensions = registry();

    expect(digests({ extensions })).toMatchObject({
      'extension-registry': extensions.fingerprint,
    });
  });

  it('include the recovery messages that were selected', () => {
    const selected = digests({
      recoveryMessageIdentities: ['@example/app:shell:recovery.unavailable'],
    });

    expect(Object.keys(selected)).toEqual([
      'configuration',
      'recovery-message-identities',
    ]);
    expect(selected['recovery-message-identities']).toMatch(/^sha256-/u);
  });

  it('leave the recovery messages out when the selection is empty', () => {
    expect(Object.keys(digests({ recoveryMessageIdentities: [] }))).toEqual([
      'configuration',
    ]);
  });

  it('digest a recovery selection by what it holds and not by the order it was passed in', () => {
    const first = '@example/app:shell:recovery.unavailable';
    const second = '@example/app:shell:recovery.offline';
    const recovery = (identities: readonly string[]): string | undefined =>
      digests({ recoveryMessageIdentities: identities })[
        'recovery-message-identities'
      ];

    expect(recovery([first, second])).toBe(recovery([second, first]));
    expect(recovery([first])).not.toBe(recovery([second]));
    expect(recovery([first])).not.toBe(recovery([first, second]));
  });
});

/**
 * What of a catalog's message reaches the catalog's digest.
 *
 * A description and a context are what a translator is handed with the text, and both are written
 * into the interchange files. Changing one without the text is still a change to what the catalog
 * says, so a later run has to see it.
 */

function catalogDigest(...entry: readonly string[]): string | undefined {
  const parsed = parseCatalog(
    ['messages:', '  checkout:', ...entry, ''].join('\n'),
    {
      role: 'source',
      providerId: '@example/app',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return digests({ catalogs: [parsed.value] })[
    'catalog:@example/app:shell:en-US:source'
  ];
}

describe('the digest of a catalog', () => {
  const text = '    message: "Place order"';

  it('moves when a message gains a description, and when the description changes', () => {
    const bare = catalogDigest(text);
    const described = catalogDigest(text, '    description: "A button"');

    expect(bare).toMatch(/^sha256-/u);
    expect(described).not.toBe(bare);
    expect(catalogDigest(text, '    description: "A heading"')).not.toBe(
      described,
    );
  });

  it('moves when a message gains a context, and when the context changes', () => {
    const bare = catalogDigest(text);
    const placed = catalogDigest(text, '    context: "Checkout page"');

    expect(placed).not.toBe(bare);
    expect(catalogDigest(text, '    context: "Cart page"')).not.toBe(placed);
  });

  it('tells a description from a context that says the same thing', () => {
    expect(catalogDigest(text, '    description: "Checkout page"')).not.toBe(
      catalogDigest(text, '    context: "Checkout page"'),
    );
  });

  it('is stated for a message declared with no text yet', () => {
    // An empty entry has no parsed text to digest, and is digested by the rest of what it declares.
    const empty = catalogDigest('    empty: true');

    expect(empty).toMatch(/^sha256-/u);
    expect(empty).not.toBe(catalogDigest(text));
    expect(catalogDigest('    empty: true', '    description: "A"')).not.toBe(
      empty,
    );
  });
});
