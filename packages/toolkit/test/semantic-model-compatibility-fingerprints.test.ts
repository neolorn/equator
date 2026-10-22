/**
 * What the two compatibility fingerprints are taken over.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 6. The application-contract domain is
 * each message's identity, result kind, typed inputs and slot contracts, and each family's
 * template, segments, contracts and current members. The semantic-registry domain is the built-in
 * slot kinds a scope references with their shapes, and each required extension descriptor by kind,
 * identity and its own fingerprint. Both are computed per scope and rolled up per application, so
 * each expected value below is the digest of exactly those fields written out.
 */
import { describe, expect, it } from 'vitest';

import { defineExtensionRegistry, parseCatalog } from '../src/index.js';
import { digestCanonicalJson } from '../src/canonical-json.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

function analyzed() {
  const registry = defineExtensionRegistry([
    {
      kind: 'identifier-segment',
      id: 'demo:state',
      syntax: 'lower-kebab',
      maximumLength: 24,
    },
  ]);
  if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
  const entry = (label: string): readonly string[] => [
    `    message: "{#link}${label}{/link} for {$tone}"`,
    '    inputs:',
    '      tone:',
    '        type: string',
    '        enum: [calm, loud]',
  ];
  const catalog = parseCatalog(
    [
      'messages:',
      '  status.pending:',
      ...entry('Pending'),
      '  status.ready:',
      ...entry('Ready'),
      'families:',
      '  status:',
      '    template: "status.{state}"',
      '    segments:',
      '      state: demo:state',
      '',
    ].join('\n'),
    {
      role: 'source',
      providerId: '@example/orders',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
      extensions: registry.value,
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
    extensions: registry.value,
  });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  const [scope] = graph.value.scopes;
  const [descriptor] = registry.value.descriptors;
  if (scope === undefined || descriptor === undefined) {
    throw new Error('The fixture produced no scope or no descriptor.');
  }
  return { graph: graph.value, scope, descriptor };
}

const inputs = [
  {
    name: 'tone',
    type: 'string',
    optional: false,
    nullable: false,
    enum: ['calm', 'loud'],
  },
];
const slots = [
  {
    name: 'link',
    kind: 'link',
    shape: 'paired',
    optional: false,
    repeatable: false,
    within: ['@root'],
  },
];
const contract = { resultKind: 'structured', inputs, slots };

describe('the application-contract fingerprint', () => {
  it('is taken per scope over the message and family contracts', () => {
    const { scope } = analyzed();
    expect(scope.applicationContractFingerprint).toBe(
      digestCanonicalJson('equator-scope-application-contract/1', {
        messages: [
          { identity: '@example/orders:shell:status.pending', ...contract },
          { identity: '@example/orders:shell:status.ready', ...contract },
        ],
        families: [
          {
            name: 'status',
            template: 'status.{state}',
            segments: [
              {
                name: 'state',
                type: 'demo:state',
                syntax: 'lower-kebab',
                maximumLength: 24,
              },
            ],
            ...contract,
            members: [
              { messageId: 'status.pending', segments: { state: 'pending' } },
              { messageId: 'status.ready', segments: { state: 'ready' } },
            ],
          },
        ],
      }),
    );
  });

  it('is rolled up over the scopes by provider, scope and fingerprint', () => {
    const { graph, scope } = analyzed();
    expect(graph.applicationContractFingerprint).toBe(
      digestCanonicalJson('equator-application-contract/1', [
        {
          providerId: '@example/orders',
          scopeId: 'shell',
          fingerprint: scope.applicationContractFingerprint,
        },
      ]),
    );
  });
});

describe('the semantic-registry fingerprint', () => {
  it('is taken per scope over the referenced kinds and required descriptors', () => {
    const { scope, descriptor } = analyzed();
    expect(scope.semanticRegistryFingerprint).toBe(
      digestCanonicalJson('equator-scope-semantic-registry/1', {
        builtInKinds: ['link:paired'],
        extensions: [
          {
            kind: 'identifier-segment',
            id: 'demo:state',
            fingerprint: descriptor.fingerprint,
          },
        ],
      }),
    );
  });

  it('is rolled up over the scopes by provider, scope and fingerprint', () => {
    const { graph, scope } = analyzed();
    expect(graph.semanticRegistryFingerprint).toBe(
      digestCanonicalJson('equator-semantic-registry/1', [
        {
          providerId: '@example/orders',
          scopeId: 'shell',
          fingerprint: scope.semanticRegistryFingerprint,
        },
      ]),
    );
  });
});
