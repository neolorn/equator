import { describe, expect, it } from 'vitest';

import {
  compileProject,
  defineExtensionRegistry,
  parseCatalog,
  parseConfiguration,
  type Catalog,
  type ProjectConfiguration,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * A catalog or a configuration handed to `compileProject` as an object the caller assembled.
 *
 * `compileProject` takes what `parseCatalog` and `parseConfiguration` return, and a caller can
 * hand it an object neither function has seen. `specs/10-compiler-and-tooling.spec.md` section 2
 * has such content judged as those functions judge it, so each case here states the diagnostic
 * the parser gives for the same mistake and asks the compiler for it.
 */

const owner = {
  providerId: '@example/app',
  generatedRootPath: 'src/generated/i18n',
};

const identity = {
  role: 'source' as const,
  providerId: '@example/app',
  scopeId: 'shell',
  locale: 'en-US',
};

function parsedCatalog(): Catalog {
  const parsed = parseCatalog('messages:\n  title: Home\n', identity);
  if (!parsed.ok) throw new Error('The catalog under test does not parse.');
  return parsed.value;
}

function codes(result: {
  readonly diagnostics: readonly { readonly code: string }[];
}): readonly string[] {
  return result.diagnostics.map(({ code }) => code);
}

function compile(
  catalogs: readonly unknown[],
  configuration: unknown = testProjectConfiguration(['en-US']),
) {
  return compileProject({
    owner,
    configuration: configuration as ProjectConfiguration,
    catalogs: catalogs as readonly Catalog[],
  });
}

describe('a catalog handed to compileProject as an object', () => {
  it('compiles as the parsed catalog does when it holds the same content', () => {
    const parsed = compile([parsedCatalog()]);
    const assembled = compile([{ ...parsedCatalog() }]);
    expect(parsed.ok).toBe(true);
    expect(assembled.ok).toBe(true);
    if (!parsed.ok || !assembled.ok) return;
    expect(assembled.value.artifacts.outputPlan.planDigest).toBe(
      parsed.value.artifacts.outputPlan.planDigest,
    );
  });

  it.each([
    ['no scope identity', { scopeId: undefined }],
    ['a scope identity that is not text', { scopeId: 7 }],
    ['a scope identity no catalog file can have', { scopeId: 'shell.tsb' }],
    ['a provider identity that is not one', { providerId: 'Not A Provider' }],
  ])('is refused as parseCatalog refuses %s', (_what, change) => {
    const expected = parseCatalog('messages:\n  title: Home\n', {
      ...identity,
      ...(change as object),
    } as typeof identity);
    expect(expected.ok).toBe(false);
    const result = compile([{ ...parsedCatalog(), ...change }]);
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(codes(expected));
    expect(result.diagnostics.map(({ summary }) => summary)).toEqual(
      expected.diagnostics.map(({ summary }) => summary),
    );
  });

  it('is refused as parseCatalog refuses a locale that is not a tag', () => {
    const expected = parseCatalog('messages:\n  title: Home\n', {
      ...identity,
      locale: 'not a locale',
    });
    const result = compile([{ ...parsedCatalog(), locale: 'not a locale' }]);
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(codes(expected));
  });

  it('is refused as parseCatalog refuses a message that does not parse', () => {
    const expected = parseCatalog(
      'messages:\n  title: "{unclosed"\n',
      identity,
    );
    expect(expected.ok).toBe(false);
    const catalog = parsedCatalog();
    const result = compile([
      {
        ...catalog,
        messages: {
          title: { ...catalog.messages['title'], message: '{unclosed' },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(codes(expected));
  });

  it.each([
    ['messages that are not a record', { messages: 7 }],
    ['a message that is not a record', { messages: { title: 7 } }],
    ['no messages', { messages: undefined }],
    ['families that are not a record', { families: 7 }],
    ['a role that is neither', { role: 'neither' }],
  ])(
    'is refused with a diagnostic, and nothing thrown, for %s',
    (_w, change) => {
      const result = compile([{ ...parsedCatalog(), ...change }]);
      expect(result.ok).toBe(false);
      expect(codes(result).every((code) => /^EQ11\d\d$/u.test(code))).toBe(
        true,
      );
    },
  );

  describe('when it calls a function of a registry', () => {
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
    const text = 'messages:\n  title: "Hello {$name :demo:uppercase}"\n';
    const calling = parseCatalog(text, {
      ...identity,
      extensions: registry.value,
    });
    if (!calling.ok) throw new Error(JSON.stringify(calling.diagnostics));
    const parsed = calling.value;

    it('compiles as the parsed catalog does when the request carries that registry', () => {
      const compileWith = (catalog: Catalog) =>
        compileProject({
          owner,
          configuration: testProjectConfiguration(['en-US']),
          catalogs: [catalog],
          extensions: registry.value,
        });
      const fromParsed = compileWith(parsed);
      const assembled = compileWith({ ...parsed });

      expect(fromParsed.ok).toBe(true);
      expect(assembled.diagnostics).toEqual(fromParsed.diagnostics);
      expect(assembled.ok).toBe(true);
      if (!fromParsed.ok || !assembled.ok) return;
      expect(assembled.value.artifacts.outputPlan.planDigest).toBe(
        fromParsed.value.artifacts.outputPlan.planDigest,
      );
    });

    it('is refused as parseCatalog refuses it when the request carries none', () => {
      // The control: the same object, judged with no registry, names a function nobody registered.
      const expected = parseCatalog(text, identity);
      expect(expected.ok).toBe(false);
      const result = compile([{ ...parsed }]);
      expect(result.ok).toBe(false);
      expect(codes(result)).toEqual(codes(expected));
    });
  });

  it('carries no position, since no file holds what the diagnostic is about', () => {
    const result = compile([{ ...parsedCatalog(), scopeId: 'shell.tsb' }]);
    expect(result.diagnostics.every(({ span }) => span === undefined)).toBe(
      true,
    );
  });
});

describe('a configuration handed to compileProject as an object', () => {
  const text = (locales: unknown): string =>
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales,
    });

  it('compiles as the parsed configuration does when it holds the same content', () => {
    const parsed = compile([parsedCatalog()]);
    const assembled = compile([parsedCatalog()], {
      ...testProjectConfiguration(['en-US']),
    });
    expect(assembled.ok).toBe(true);
    if (!parsed.ok || !assembled.ok) return;
    expect(assembled.value.state.inputFingerprint).toBe(
      parsed.value.state.inputFingerprint,
    );
  });

  it.each([
    ['a locale that is not text', ['en-US', 7]],
    ['a locale that is not a tag', ['en-US', 'not a locale']],
    ['locales that are not a list', 'en-US'],
  ])('is refused as parseConfiguration refuses %s', (_what, locales) => {
    const expected = parseConfiguration(text(locales));
    expect(expected.ok).toBe(false);
    const result = compile([parsedCatalog()], {
      ...testProjectConfiguration(['en-US']),
      locales,
    });
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(codes(expected));
  });
});
