import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  formatCatalog,
  parseCatalog,
  type Catalog,
} from '../src/index.js';

/**
 * What `formatCatalog` answers with.
 *
 * It returns a result holding the text of the file, as the other functions that write a catalog
 * out do. `specs/10-compiler-and-tooling.spec.md` section 2 has a catalog the caller assembled
 * judged as `parseCatalog` judges the same content, so one that no file could hold comes back as
 * that function's refusal and never as an error thrown from the code that writes the text.
 */

const identity = {
  role: 'source' as const,
  providerId: '@example/app',
  scopeId: 'shell',
  locale: 'en-US',
};

function parsed(text = 'messages:\n  title: Home\n'): Catalog {
  const result = parseCatalog(text, identity);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

function codes(result: {
  readonly diagnostics: readonly { readonly code: string }[];
}): readonly string[] {
  return result.diagnostics.map(({ code }) => code);
}

describe('formatCatalog', () => {
  it('returns the canonical text of a parsed catalog', () => {
    expect(formatCatalog(parsed())).toEqual({
      ok: true,
      value: 'messages:\n  title: "Home"\n',
      diagnostics: [],
    });
  });

  it.each([
    ['a message that is null', { title: null }, 'messages:\n  title: null\n'],
    ['a message that is a number', { title: 7 }, 'messages:\n  title: 7\n'],
    [
      'a message whose text no parser accepts',
      { title: { ...parsed().messages['title'], message: 'Home {$' } },
      'messages:\n  title: "Home {$"\n',
    ],
  ])(
    'refuses %s as parseCatalog refuses it in a file',
    (_what, messages, file) => {
      const expected = parseCatalog(file, identity);
      expect(expected.ok).toBe(false);

      const result = formatCatalog({
        ...parsed(),
        messages,
      } as unknown as Catalog);

      expect(result.ok).toBe(false);
      expect(codes(result)).toEqual(codes(expected));
      expect(result.diagnostics.every(({ span }) => span === undefined)).toBe(
        true,
      );
    },
  );

  it('refuses a catalog with none of a catalog members', () => {
    const result = formatCatalog({} as Catalog);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['EQ1102']);
  });

  it('takes the registry an assembled catalog calls a function from', () => {
    const registry = defineExtensionRegistry([
      {
        kind: 'message-function',
        id: 'demo:uppercase',
        operandType: 'string',
        options: {},
        resultType: 'string',
        selector: 'none',
        maximumOutputLength: 128,
      },
    ]);
    if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
    const calling = parseCatalog(
      'messages:\n  title: "Hello {$name :demo:uppercase}"\n',
      { ...identity, extensions: registry.value },
    );
    if (!calling.ok) throw new Error(JSON.stringify(calling.diagnostics));
    const assembled: Catalog = { ...calling.value };

    // With no registry the function is one nobody registered, as it is to `parseCatalog`.
    expect(formatCatalog(assembled).ok).toBe(false);
    expect(formatCatalog(assembled, { extensions: registry.value })).toEqual(
      formatCatalog(calling.value),
    );
  });
});
