/**
 * Workflow metadata written inside a catalog entry.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 5: an entry carries its message and the
 * localization-intrinsic fields and nothing else, because a catalog that also records who owns,
 * approved or last touched a message becomes a second workflow system that drifts from the real
 * one. Each field is written beside an otherwise valid entry, in a source and in a target catalog,
 * so the only thing that can refuse it is the field itself.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, type CatalogParseOptions } from '../src/index.js';

const source: CatalogParseOptions = {
  role: 'source',
  providerId: '@neolorn/example',
  scopeId: 'account',
  locale: 'en-US',
  sourcePath: 'i18n/account/en-US.yaml',
};

const target: CatalogParseOptions = {
  ...source,
  role: 'target',
  locale: 'ar-EG',
  sourcePath: 'i18n/account/ar-EG.yaml',
};

const workflowFields = [
  ['id', 'account-title'],
  ['identity', '"@neolorn/example:account:title"'],
  ['locale', 'en-US'],
  ['owner', 'accounts-team'],
  ['revision', '3'],
  ['approved', 'true'],
  ['ticket', 'LOC-42'],
  ['vendor', 'acme-translations'],
  ['status', 'reviewed'],
] as const;

function entry(field: string, value: string): string {
  return [
    'messages:',
    '  title:',
    '    message: Account',
    '    description: The heading of the account page.',
    `    ${field}: ${value}`,
    '',
  ].join('\n');
}

describe('a catalog entry carries no workflow field', () => {
  it('accepts the entry without one', () => {
    for (const options of [source, target]) {
      expect(
        parseCatalog(
          'messages:\n  title:\n    message: Account\n    description: The heading of the account page.\n',
          options,
        ).ok,
      ).toBe(true);
    }
  });

  it.each(workflowFields)(
    'refuses %s in a source or a target entry',
    (field, value) => {
      for (const options of [source, target]) {
        const result = parseCatalog(entry(field, value), options);
        expect({ role: options.role, ok: result.ok }).toEqual({
          role: options.role,
          ok: false,
        });
        expect(result.diagnostics.map(({ code }) => code)).toContain('EQ1102');
      }
    },
  );
});
