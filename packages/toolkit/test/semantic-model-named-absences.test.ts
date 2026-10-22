/**
 * What the analysis says where the thing it would name is not there.
 *
 * Three refusals name something a catalog may lack: the file a catalog was read from, the slot a
 * closing tag closes, and the plural categories of a language CLDR lists none for. Each is reached
 * here from `compileProject`, with the sentence a reader gets.
 */
import { describe, expect, it } from 'vitest';

import {
  compileProject,
  parseCatalog,
  parseConfiguration,
  type Catalog,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

const owner = { providerId: '@example/app', generatedRootPath: 'src/i18n' };

function catalog(
  text: string,
  locale: string,
  role: 'source' | 'target',
): Catalog {
  const parsed = parseCatalog(text, {
    role,
    providerId: '@example/app',
    scopeId: 'shell',
    locale,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function refusals(result: {
  readonly diagnostics: readonly {
    readonly code: string;
    readonly summary: string;
    readonly path: readonly (string | number)[];
  }[];
}) {
  return result.diagnostics.map(({ code, summary, path }) => ({
    code,
    summary,
    path,
  }));
}

describe('two catalogs for one locale that were read from no file', () => {
  it('are named by their locale', () => {
    const compiled = compileProject({
      configuration: testProjectConfiguration(['en-US']),
      owner,
      catalogs: [
        catalog('messages:\n  title: Home\n', 'en-US', 'source'),
        catalog('messages:\n  title: House\n', 'en-US', 'source'),
      ],
    });

    expect(compiled.ok).toBe(false);
    expect(refusals(compiled)).toEqual([
      {
        code: 'EQ1301',
        summary:
          'Scope @example/app/shell has two catalogs for locale "en-US": a en-US catalog read from no file and a en-US catalog read from no file.',
        path: [],
      },
    ]);
  });
});

describe('a closing tag with nothing open', () => {
  it('is refused as closing no open slot', () => {
    const compiled = compileProject({
      configuration: testProjectConfiguration(['en-US']),
      owner,
      catalogs: [
        catalog('messages:\n  title: "Home {/strong}"\n', 'en-US', 'source'),
      ],
    });

    expect(compiled.ok).toBe(false);
    expect(refusals(compiled)).toEqual([
      {
        code: 'EQ1303',
        summary: 'Rich slot "strong" closes "no open slot".',
        path: ['messages', 'title'],
      },
    ]);
  });
});

describe('a target in a language CLDR lists no plural categories for', () => {
  const source = [
    'messages:',
    '  count: |',
    '    .input {$count :number}',
    '    .match $count',
    '    one {{One}}',
    '    * {{Many}}',
    '',
  ].join('\n');
  const target = [
    'messages:',
    '  count: |',
    '    .input {$count :number}',
    '    .match $count',
    '    * {{Multa}}',
    '',
  ].join('\n');

  function compile(locale: string) {
    const configuration = parseConfiguration(
      JSON.stringify({
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', locale],
      }),
    );
    if (!configuration.ok) {
      throw new Error(JSON.stringify(configuration.diagnostics));
    }
    return compileProject({
      configuration: configuration.value,
      owner,
      catalogs: [
        catalog(source, 'en-US', 'source'),
        catalog(target, locale, 'target'),
      ],
    });
  }

  it('is asked for no category, the catch-all being all the language has', () => {
    // Latin is in neither CLDR plural table.
    const compiled = compile('la');

    expect(refusals(compiled)).toEqual([]);
    expect(compiled.ok).toBe(true);
  });

  it('is asked for them where CLDR lists some', () => {
    // Hawaiian has `one` and `other`, so the same target is told what it leaves out.
    expect(refusals(compile('haw')).map(({ code }) => code)).toEqual([
      'EQ1308',
    ]);
  });
});
