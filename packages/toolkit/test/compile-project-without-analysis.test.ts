import { describe, expect, it } from 'vitest';

import { compileProject, parseCatalog, type Catalog } from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * What `compileProject` returns when it was asked for no analysis.
 *
 * The result carries the application analysis only when the pass ran. A caller tells the two
 * compilations apart by whether the result has the property, so a compilation from catalogs alone
 * has no `analysis` at all, not one that is present and holds nothing.
 */

function catalog(): Catalog {
  const parsed = parseCatalog(
    ['messages:', '  app-title: Probe', ''].join('\n'),
    {
      role: 'source',
      providerId: '@example/app',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

describe('a compilation that was asked for no analysis', () => {
  it('returns a result that has no analysis property', () => {
    const compiled = compileProject({
      owner: {
        providerId: '@example/app',
        generatedRootPath: 'src/generated/i18n',
      },
      configuration: testProjectConfiguration(['en-US']),
      catalogs: [catalog()],
    });

    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(Object.keys(compiled.value).sort()).toEqual([
      'artifacts',
      'graph',
      'invalidation',
      'state',
    ]);
  });
});
