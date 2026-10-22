import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  parseCatalog,
  parseConfiguration,
  type Catalog,
  type ExtensionRegistry,
  type ProjectConfiguration,
} from '../src/index.js';
import { generateContracts } from '../src/generated-contracts.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

/**
 * What this guards is that a generated scope module compiles under the options its consumer
 * compiles with.
 *
 * The family runtime is three functions and the type they carry, and a scope that declares no
 * family reads none of them. Emitted anyway, a consumer that sets `noUnusedLocals` is told its own
 * build has three unread declarations in a file it did not write and may not edit.
 */

const familyHelpers = [
  'GeneratedMessageFamily',
  'defineMessageFamily',
  'hasExactFamilySegments',
  'isFamilySegment',
] as const;

function configuration(): ProjectConfiguration {
  const parsed = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    }),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

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

function catalog(body: string, extensions?: ExtensionRegistry): Catalog {
  const parsed = parseCatalog(body, {
    role: 'source',
    providerId: '@example/scope-helpers',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
    ...(extensions === undefined ? {} : { extensions }),
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function scopeModule(body: string, extensions?: ExtensionRegistry): string {
  const graph = analyzeCatalogSet({
    configuration: configuration(),
    catalogs: [catalog(body, extensions)],
    ...(extensions === undefined ? {} : { extensions }),
  });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  const contracts = generateContracts(graph.value);
  if (!contracts.ok) throw new Error(JSON.stringify(contracts.diagnostics));
  const file = contracts.value.find(({ path }) => path === 'shell.ts');
  if (file === undefined) throw new Error('no shell.ts was generated');
  return file.contents;
}

const withoutFamilies = 'messages:\n  nav.home: Home\n';
const withFamilies = [
  'messages:',
  '  status.ready: Ready',
  '  status.pending: Pending',
  'families:',
  '  status:',
  '    template: "status.{state}"',
  '    segments:',
  '      state: demo:state',
  '',
].join('\n');

describe('a generated scope module for a scope with no message family', () => {
  it('carries the handle runtime it uses', () => {
    const contents = scopeModule(withoutFamilies);

    expect(contents).toContain('function defineMessageHandle<');
    expect(contents).not.toMatch(/\bexport const families\b/u);
  });

  it('carries none of the family runtime it does not use', () => {
    const contents = scopeModule(withoutFamilies);

    for (const helper of familyHelpers) {
      expect(
        contents,
        `${helper} is emitted into a scope with no family`,
      ).not.toContain(helper);
    }
  });
});

describe('a generated scope module for a scope that declares one', () => {
  it('carries the family runtime and uses it', () => {
    const contents = scopeModule(withFamilies, registry());

    for (const helper of familyHelpers) {
      expect(
        contents,
        `${helper} is missing from a scope with a family`,
      ).toContain(helper);
    }
    expect(contents).toContain('defineMessageFamily<"status"');
  });
});
