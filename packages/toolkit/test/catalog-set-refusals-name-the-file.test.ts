import { describe, expect, it } from 'vitest';

import { compileProject, parseCatalog, type Catalog } from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * What a refusal of a catalog set says about where to look.
 *
 * A catalog that is of a locale nobody declared, that is a second one for its locale, that has the
 * wrong role, or that leaves its scope with no source is wrong as a whole, so there is no line in
 * it to point at and the diagnostic carries no position. The sentence is then the only place the
 * file and the scope can be named, and a project has one such file per scope and locale.
 */

function catalog(
  role: 'source' | 'target',
  scopeId: string,
  locale: string,
  sourcePath?: string,
): Catalog {
  const parsed = parseCatalog('messages:\n  title: Home\n', {
    role,
    providerId: '@example/app',
    scopeId,
    locale,
    ...(sourcePath === undefined ? {} : { sourcePath }),
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function refusals(catalogs: readonly Catalog[]): readonly string[] {
  const compiled = compileProject({
    owner: {
      providerId: '@example/app',
      generatedRootPath: 'src/generated/i18n',
    },
    configuration: testProjectConfiguration(['en-US', 'fr']),
    catalogs,
  });
  expect(compiled.ok).toBe(false);
  return compiled.diagnostics
    .filter(({ code }) => code === 'EQ1301')
    .map(({ summary }) => summary);
}

const source = catalog('source', 'shell', 'en-US', 'i18n/shell/en-US.yaml');

describe('a refusal of a catalog set', () => {
  it('names the file and the scope of a catalog for a locale the project does not declare', () => {
    expect(
      refusals([
        source,
        catalog('target', 'shell', 'de', 'i18n/shell/de.yaml'),
      ]),
    ).toEqual([
      'Catalog i18n/shell/de.yaml of scope @example/app/shell is for locale "de", which the project does not declare.',
    ]);
  });

  it('names both files of a scope that has two catalogs for one locale', () => {
    expect(
      refusals([
        source,
        catalog('target', 'shell', 'fr', 'i18n/shell/fr.yaml'),
        catalog('target', 'shell', 'fr', 'i18n/shell/fr.yml'),
      ]),
    ).toEqual([
      'Scope @example/app/shell has two catalogs for locale "fr": i18n/shell/fr.yaml and i18n/shell/fr.yml.',
    ]);
  });

  it('names the files a scope has when none is its source catalog', () => {
    expect(
      refusals([
        source,
        catalog('target', 'orders', 'fr', 'i18n/orders/fr.yaml'),
      ]),
    ).toEqual([
      'Scope @example/app/orders requires one source catalog for en-US, and has i18n/orders/fr.yaml.',
    ]);
  });

  it('names every file a scope has when none is its source catalog', () => {
    expect(
      refusals([
        source,
        catalog('target', 'orders', 'fr', 'i18n/orders/fr.yaml'),
        catalog('target', 'orders', 'en-US', 'i18n/orders/en-US.yaml'),
      ]),
    ).toEqual([
      'Scope @example/app/orders requires one source catalog for en-US, and has i18n/orders/fr.yaml, i18n/orders/en-US.yaml.',
    ]);
  });

  it('names the file and the scope of a catalog with the wrong role', () => {
    expect(
      refusals([
        source,
        catalog('source', 'shell', 'fr', 'i18n/shell/fr.yaml'),
      ]),
    ).toEqual([
      'Catalog i18n/shell/fr.yaml of scope @example/app/shell is for locale "fr" and must use role target.',
    ]);
  });

  it('says so when the catalog was not read from a file', () => {
    expect(refusals([source, catalog('target', 'shell', 'de')])).toEqual([
      'Catalog of scope @example/app/shell, read from no file, is for locale "de", which the project does not declare.',
    ]);
  });
});
