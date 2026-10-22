/**
 * What a project writes once, and what the release keeps no second copy of.
 *
 * `specs/README.md` rules out a second record of anything derived: no digest, version or revision
 * field in an authored file, and nothing a project has to update when its work changes. Two halves
 * are asserted. The owner a compilation records moves with the project and never with the scopes it
 * has, so adding a scope costs no Equator step. And an authored catalog offers no field for a
 * version or a digest, so there is nowhere to keep one by hand.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { compileLocalArtifacts } from '../src/compiled-artifacts.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

const OWNER = {
  providerId: '@example/app',
  generatedRootPath: 'src/generated',
};

function catalogOf(scopeId: string, text: string) {
  return parseCatalog(text, {
    role: 'source',
    providerId: OWNER.providerId,
    scopeId,
    locale: 'en-US',
    sourcePath: `i18n/${scopeId}/en-US.yaml`,
  });
}

function ownerAfter(scopeIds: readonly string[]): string {
  const catalogs: Catalog[] = scopeIds.map((scopeId) => {
    const parsed = catalogOf(scopeId, 'messages:\n  title: Title\n');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    return parsed.value;
  });
  const graph = analyzeCatalogSet({
    configuration: testProjectConfiguration(['en-US']),
    catalogs,
  });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  const compiled = compileLocalArtifacts({
    owner: OWNER,
    graph: graph.value,
    catalogs,
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.value.ownerId;
}

describe('no second record', () => {
  it('records the same owner before and after a scope is added', () => {
    expect(ownerAfter(['shell', 'orders'])).toBe(ownerAfter(['shell']));
  });

  it('accepts a catalog that carries no version or digest', () => {
    expect(catalogOf('shell', 'messages:\n  title: Title\n').ok).toBe(true);
  });

  it.each(['version', 'digest', 'revision'])(
    'offers no %s field in an authored catalog',
    (field) => {
      const parsed = catalogOf(
        'shell',
        `${field}: "1"\nmessages:\n  title: Title\n`,
      );
      expect(parsed.ok).toBe(false);
      expect(parsed.diagnostics.map(({ path }) => path)).toContainEqual([
        field,
      ]);
    },
  );
});
