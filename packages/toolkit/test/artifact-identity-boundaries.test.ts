/**
 * Where one artifact's identity ends: at its provider, and at its scope.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 5 keeps each provider's catalog-set
 * identity over that provider's own addresses, and section 6 makes an artifact's compatibility
 * identity its own scope's. Both are asserted the same way: compile, change something on one side
 * of the boundary, compile again, and require the other side to be byte-identical.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { compileLocalArtifacts } from '../src/compiled-artifacts.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

interface Source {
  readonly providerId: string;
  readonly scopeId: string;
  readonly text: string;
}

function catalogOf({ providerId, scopeId, text }: Source): Catalog {
  const parsed = parseCatalog(text, {
    role: 'source',
    providerId,
    scopeId,
    locale: 'en-US',
    sourcePath: `i18n/${providerId}/${scopeId}/en-US.yaml`,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function compile(sources: readonly Source[]) {
  const catalogs = sources.map(catalogOf);
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs,
  });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  const compiled = compileLocalArtifacts({
    owner: { providerId: '@example/app', generatedRootPath: 'src/generated' },
    graph: graph.value,
    catalogs,
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.value.descriptor;
}

function addressesOf(
  descriptor: ReturnType<typeof compile>,
  scopeId: string,
): string {
  return JSON.stringify(
    descriptor.providers.flatMap(({ artifacts }) =>
      artifacts
        .filter(({ address }) => address.key.scopeId === scopeId)
        .map(({ address }) => address),
    ),
  );
}

describe('artifact identity boundaries', () => {
  it('keeps two providers apart, each set identified by its own addresses alone', () => {
    const application = {
      providerId: '@example/app',
      scopeId: 'shell',
      text: 'messages:\n  title: Application\n',
    };
    const library = {
      providerId: '@example/widgets',
      scopeId: 'widgets',
      text: 'messages:\n  close: Close\n',
    };
    const before = compile([application, library]);
    expect(before.providers.map(({ providerId }) => providerId)).toEqual([
      '@example/app',
      '@example/widgets',
    ]);
    const [appSet, librarySet] = before.providers;
    expect(appSet?.catalogSetId).not.toBe(librarySet?.catalogSetId);
    expect(
      appSet?.artifacts.every(
        ({ address }) => address.key.providerId === '@example/app',
      ),
    ).toBe(true);

    const after = compile([
      application,
      { ...library, text: 'messages:\n  close: Dismiss\n' },
    ]);
    expect(after.providers[0]?.catalogSetId).toBe(appSet?.catalogSetId);
    expect(after.providers[1]?.catalogSetId).not.toBe(librarySet?.catalogSetId);
  });

  it("leaves one scope's addresses unchanged by a contract change confined to another", () => {
    const shell = {
      providerId: '@example/app',
      scopeId: 'shell',
      text: 'messages:\n  title: Application\n',
    };
    const account = {
      providerId: '@example/app',
      scopeId: 'account',
      text: 'messages:\n  greeting: Hello\n',
    };
    const before = compile([shell, account]);
    const after = compile([
      shell,
      { ...account, text: 'messages:\n  greeting: "Hello {$name}"\n' },
    ]);
    expect(addressesOf(after, 'account')).not.toBe(
      addressesOf(before, 'account'),
    );
    expect(addressesOf(after, 'shell')).toBe(addressesOf(before, 'shell'));
  });
});
