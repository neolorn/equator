import { describe, expect, it } from 'vitest';

import {
  exportXliff22,
  importXliff22,
  parseCatalog,
  type Catalog,
  type CatalogParseOptions,
} from '../src/index.js';
import { writtenCatalog } from './fixtures.js';

/**
 * An interchange document contributes translations and nothing else.
 *
 * The authored catalog owns the source wording and the message identities, so a returned document
 * whose source side was edited, or whose unit was renamed to a message the catalog does not have,
 * changes neither: the edit is not read as wording, and the renamed unit is not a new message.
 */

const sourceOptions: CatalogParseOptions = {
  role: 'source',
  providerId: '@example/app',
  scopeId: 'shell',
  locale: 'en-US',
};

function catalog(text: string, options: CatalogParseOptions): Catalog {
  const parsed = parseCatalog(text, options);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

const SOURCE_TEXT = 'messages:\n  title: Settings\n  farewell: Goodbye\n';
const source = catalog(SOURCE_TEXT, sourceOptions);
const target = catalog(
  'messages:\n  title: Paramètres\n  farewell: Au revoir\n',
  {
    ...sourceOptions,
    role: 'target',
    locale: 'fr-FR',
  },
);

function exported(): string {
  const document = exportXliff22({ source, target });
  if (!document.ok) throw new Error(JSON.stringify(document.diagnostics));
  return document.value;
}

function replaceOnce(text: string, from: string, to: string): string {
  expect(text.split(from).length - 1, from).toBe(1);
  return text.replace(from, () => to);
}

describe('a returned interchange document', () => {
  it('does not turn an edited source into wording', () => {
    const document = replaceOnce(
      exported(),
      '>Settings</source>',
      '>Preferences</source>',
    );
    const imported = importXliff22({ document, source });
    expect(imported.ok, JSON.stringify(imported.diagnostics)).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.messages['title']).toMatchObject({
      message: 'Paramètres',
    });
    expect(writtenCatalog(imported.value)).toBe(writtenCatalog(target));
    expect(writtenCatalog(source)).toBe(
      writtenCatalog(catalog(SOURCE_TEXT, sourceOptions)),
    );
  });

  it('does not add a message by renaming a unit', () => {
    const original = exported();
    const unit = original.slice(
      original.indexOf('<unit id="farewell"'),
      original.indexOf('</unit>', original.indexOf('<unit id="farewell"')) +
        '</unit>'.length,
    );
    const renamed = unit
      .replaceAll('"farewell"', '"welcome"')
      .replaceAll(':farewell&quot;', ':welcome&quot;')
      .replaceAll('&quot;farewell&quot;', '&quot;welcome&quot;');
    expect(renamed).not.toContain('farewell');
    const document = replaceOnce(original, unit, `${unit}\n${renamed}`);

    const imported = importXliff22({ document, source });
    const ids = imported.ok ? Object.keys(imported.value.messages) : [];
    expect(ids).not.toContain('welcome');
    expect(imported.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'EQ1803' })]),
    );
    expect(Object.keys(source.messages).sort()).toEqual(['farewell', 'title']);
  });
});
