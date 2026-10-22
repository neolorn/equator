import { describe, expect, it } from 'vitest';

import { parseCatalog, type Catalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * A translation that drops the link or the button out of a message.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 9: a target catalog MUST NOT cause a required
 * semantic action to disappear, and the message is refused rather than rendered without it. A
 * translation that leaves the words and loses the slot reads as finished, and the reader in that
 * locale is the only one who cannot follow the link or press the button.
 */

const configuration = testProjectConfiguration(['en-US', 'ar-EG']);

function catalog(
  role: 'source' | 'target',
  locale: string,
  body: string,
): Catalog {
  const result = parseCatalog(body, {
    role,
    providerId: '@example/slots',
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
  [
    'messages:',
    '  help: "Open {#link}help{/link}."',
    '  save: "Choose {#action}save{/action}."',
    '',
  ].join('\n'),
);

describe('a target that omits a required slot', () => {
  it('is refused, naming each slot it lost', () => {
    const target = catalog(
      'target',
      'ar-EG',
      'messages:\n  help: افتح المساعدة.\n  save: اختر الحفظ.\n',
    );
    const result = analyzeCatalogSet({
      configuration,
      catalogs: [source, target],
    });
    expect(result.ok).toBe(false);
    const omitted = result.diagnostics
      .filter(
        ({ code, summary }) =>
          code === 'EQ1304' && summary.includes('omits required rich slot'),
      )
      .map(({ summary }) => summary);
    expect(omitted).toHaveLength(2);
    expect(omitted.some((summary) => summary.includes('"link"'))).toBe(true);
    expect(omitted.some((summary) => summary.includes('"action"'))).toBe(true);
  });

  it('is accepted once the slots are back', () => {
    const target = catalog(
      'target',
      'ar-EG',
      [
        'messages:',
        '  help: "افتح {#link}المساعدة{/link}."',
        '  save: "اختر {#action}الحفظ{/action}."',
        '',
      ].join('\n'),
    );
    expect(
      analyzeCatalogSet({ configuration, catalogs: [source, target] }).ok,
    ).toBe(true);
  });
});
