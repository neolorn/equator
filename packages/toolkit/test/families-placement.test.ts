/**
 * Where a `families` mapping may be written.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 10: a family is declared once, in the
 * source catalog of the scope it belongs to. A translation inherits it and does not repeat it, and a
 * scope with no family carries no empty mapping for one.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type CatalogParseOptions } from '../src/index.js';
import { writtenCatalog } from './fixtures.js';

const source: CatalogParseOptions = {
  role: 'source',
  providerId: '@neolorn/example',
  scopeId: 'orders',
  locale: 'en-US',
  sourcePath: 'i18n/orders/en-US.yaml',
};

const target: CatalogParseOptions = {
  ...source,
  role: 'target',
  locale: 'ar-EG',
  sourcePath: 'i18n/orders/ar-EG.yaml',
};

const withFamily = [
  'messages:',
  '  status.ready: Ready',
  '  status.pending: Pending',
  'families:',
  '  status: "status.{state}"',
  '',
].join('\n');

describe('a families mapping', () => {
  it('is accepted in a source catalog and written back', () => {
    const parsed = parseCatalog(withFamily, source);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(writtenCatalog(parsed.value)).toMatch(/^families:$/mu);
  });

  it('is omitted from a source catalog whose scope has none', () => {
    const parsed = parseCatalog('messages:\n  status.ready: Ready\n', source);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(writtenCatalog(parsed.value)).not.toContain('families');
  });

  it('is refused in a target catalog', () => {
    const parsed = parseCatalog(
      [
        'messages:',
        '  status.ready: جاهز',
        '  status.pending: قيد الانتظار',
        'families:',
        '  status: "status.{state}"',
        '',
      ].join('\n'),
      target,
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.map(({ code }) => code)).toContain('EQ1102');
  });
});
