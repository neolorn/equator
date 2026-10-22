import { describe, expect, it } from 'vitest';

import { compileProject, parseCatalog } from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * The type an input may be declared with when no function annotates it.
 *
 * MessageFormat resolves `{$name}` to the value it was given and fixes no formatting for it: an
 * implementation may treat a date as though `:datetime` had been written, and nothing says it
 * must. `specs/04-message-authoring-and-catalogs.spec.md` section 6 resolves what the standard
 * leaves open as a refusal at compile time, so an unannotated input is text, and a declaration
 * that gives it another type is refused where it is written.
 */

function compile(body: string, type: string) {
  const catalog = parseCatalog(
    [
      'messages:',
      '  total:',
      `    message: ${JSON.stringify(body)}`,
      '    inputs:',
      '      count:',
      `        type: ${type}`,
      '',
    ].join('\n'),
    {
      role: 'source',
      providerId: '@example/app',
      scopeId: 'shell',
      locale: 'en-US',
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  return compileProject({
    owner: {
      providerId: '@example/app',
      generatedRootPath: 'src/generated/i18n',
    },
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog.value],
  });
}

describe('an input no function annotates', () => {
  it.each(['number', 'integer', 'date-time', 'boolean'])(
    'is refused where it is declared as %s',
    (type) => {
      const result = compile('Total: {$count}', type);

      expect(result.ok).toBe(false);
      expect(
        result.diagnostics.map(({ code, summary, path }) => ({
          code,
          summary,
          path,
        })),
      ).toEqual([
        {
          code: 'EQ1302',
          summary: `Input "count" cannot refine inferred string input to ${type}.`,
          path: ['messages', 'total', 'inputs', 'count', 'type'],
        },
      ]);
    },
  );

  it('is text where it is declared as a string', () => {
    const result = compile('Total: {$count}', 'string');

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('takes the type of the function that annotates it elsewhere in the message', () => {
    // The control: the same declaration is taken once a function gives the input that type.
    const result = compile('Total: {$count :number} of {$count}', 'integer');

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
