import { describe, expect, it } from 'vitest';

import { compileProject, parseCatalog, type Catalog } from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * Content that parsed and did not validate is not compiled.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 1: build trust follows bounded parsing and
 * complete validation, and nothing extends it to content that has passed only the first. A
 * compiled artifact is what the runtime admits as trusted build output, so a target catalog that
 * parses cleanly and then fails the semantic contract has to stop before one is produced for it,
 * rather than reach a reader with a diagnostic nobody has to act on.
 */

const configuration = testProjectConfiguration(['en-US', 'ar-EG']);
const owner = {
  providerId: '@example/test-owner',
  generatedRootPath: 'src/generated/i18n',
};

function catalog(
  role: 'source' | 'target',
  locale: string,
  body: string,
): Catalog {
  const result = parseCatalog(body, {
    role,
    providerId: owner.providerId,
    scopeId: 'shell',
    locale,
    sourcePath: `i18n/shell/${locale}.yaml`,
  });
  if (!result.ok) throw new Error(`fixture ${locale} failed to parse`);
  return result.value;
}

const source = catalog(
  'source',
  'en-US',
  'messages:\n  help: Read the guide.\n',
);

describe('build trust', () => {
  it('compiles a catalog set that parsed and validated', () => {
    const valid = catalog(
      'target',
      'ar-EG',
      'messages:\n  help: اقرأ الدليل.\n',
    );
    const result = compileProject({
      owner,
      configuration,
      catalogs: [source, valid],
    });
    expect(result.ok).toBe(true);
  });

  it('produces no artifact for a target that parsed and failed validation', () => {
    // Parsing accepts this: the markup is well formed. The source declares no slot, so the
    // target's `strong` is a structure no trusted binding was written for.
    const invalid = catalog(
      'target',
      'ar-EG',
      'messages:\n  help: "اقرأ {#strong}الدليل{/strong}."\n',
    );
    const result = compileProject({
      owner,
      configuration,
      catalogs: [source, invalid],
    });
    expect(result.ok).toBe(false);
    expect('value' in result).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'EQ1304', severity: 'error' }),
    );
  });
});
