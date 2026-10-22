import { describe, expect, it } from 'vitest';

import { parseCatalog, parseConfiguration } from '../src/index.js';
import {
  createMessageIdentity,
  parseMessageId,
  parseProviderId,
  parseScopeId,
} from '../src/identities.js';
import { canonicalizeLocale, parseLocaleAlias } from '../src/locales.js';
import { parseMessageSemanticModel } from '../src/message-format.js';

/**
 * Validators handed something that is not text.
 *
 * These functions exist to be given untrusted input: a value out of a JSON configuration, off a
 * command line, out of a consumer's build script. A parameter declared `string` stops nobody, since
 * TypeScript is not present at the boundary where those values arrive, and the declaration means
 * the check that would catch a non-string is never written.
 *
 * What that produces is not a crash. `RegExp.prototype.test` coerces its argument, so `42` is
 * tested as `"42"` and `undefined` as `"undefined"`, both of which satisfy an identifier grammar as
 * readily as a real identity does. The validator returns success and brands the original value,
 * still a number or still `undefined`, as an Equator identity, and every later consumer of that
 * value works with a type that lies.
 *
 * The parameters are `unknown`, because that is what a validator's callers actually hold, and
 * saying so is what makes the check exist.
 *
 * `specs/12-verification.spec.md` section 4 asks for refusal to be verified as thoroughly as
 * acceptance, and for a validator to be handed values that are not text at all, which is the
 * case a declared parameter type never stops.
 */

const NOT_TEXT = [42, undefined, null, true, ['ar-EG'], {}, Symbol('x')];

describe('identities', () => {
  it('refuses a value that is not a string', () => {
    for (const value of NOT_TEXT) {
      expect(parseProviderId(value).ok).toBe(false);
      expect(parseScopeId(value).ok).toBe(false);
      expect(parseMessageId(value).ok).toBe(false);
    }
  });

  it('refuses a number that reads as a valid provider identity', () => {
    // 42 tested as a string is "42", which matches the provider grammar, so a parser that tests
    // the coerced form hands the number back branded as ProviderId.
    const result = parseProviderId(42);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('EQ1104');
    expect(result.diagnostics[0]?.summary).toContain('must be a string');
  });

  it('names the type it received without echoing the value', () => {
    // A value that reached a validator by mistake is exactly the kind of value not to repeat in a
    // diagnostic. The type is enough to find the bug.
    const result = parseScopeId({ secret: 'token' });

    expect(result.diagnostics[0]?.summary).toContain('an object');
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret');
  });

  it('refuses an identity longer than any identity is', () => {
    expect(parseProviderId('a'.repeat(257)).ok).toBe(false);
  });

  it('accepts well-formed identifiers', () => {
    expect(parseProviderId('@example/app').ok).toBe(true);
    expect(parseScopeId('shell').ok).toBe(true);
    expect(parseMessageId('nav.products').ok).toBe(true);
    expect(
      createMessageIdentity('@example/app', 'shell', 'nav.products').ok,
    ).toBe(true);
  });

  it('reports every part of a composite identity that is wrong at once', () => {
    const result = createMessageIdentity(42, undefined, null);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(3);
  });
});

describe('locales and aliases', () => {
  it('refuses a value that is not a string', () => {
    for (const value of NOT_TEXT) {
      expect(parseLocaleAlias(value).ok).toBe(false);
      expect(canonicalizeLocale(value).ok).toBe(false);
    }
  });

  it('refuses undefined as a locale alias', () => {
    // The alias path is the ordinary one for mapping a bare `en` to `en-US`, and "undefined"
    // satisfies the alias grammar, so a parser that tests the coerced form returns a usable alias
    // that becomes a configuration key.
    const result = parseLocaleAlias(undefined);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('EQ1005');
  });

  it('reports rather than throwing for a locale that is not a string', () => {
    // Unguarded, canonicalizeLocale reaches `.includes` on a number and throws a raw
    // TypeError out of a function whose contract is to return diagnostics.
    expect(() => canonicalizeLocale(42)).not.toThrow();
    expect(canonicalizeLocale(42).ok).toBe(false);
  });

  it('accepts a well-formed alias and locale', () => {
    expect(parseLocaleAlias('ar').ok).toBe(true);
    const canonical = canonicalizeLocale('ar-eg');
    expect(canonical.ok).toBe(true);
    if (canonical.ok) expect(canonical.value).toBe('ar-EG');
  });
});

describe('sources', () => {
  it('reports rather than throwing when handed something that is not text', () => {
    // The second face of the same defect: these reached Buffer.byteLength and threw a TypeError
    // out of a function whose whole contract is a result type.
    for (const value of [42, undefined, null, {}]) {
      expect(() => parseConfiguration(value)).not.toThrow();
      expect(parseConfiguration(value).ok).toBe(false);
      expect(() => parseMessageSemanticModel(value)).not.toThrow();
      expect(parseMessageSemanticModel(value).ok).toBe(false);
      expect(() =>
        parseCatalog(value, {
          role: 'source',
          providerId: '@example/app',
          scopeId: 'shell',
          locale: 'en-US',
        }),
      ).not.toThrow();
    }
  });

  it('still parses real sources', () => {
    expect(parseMessageSemanticModel('Hello').ok).toBe(true);
    expect(
      parseCatalog(['messages:', '  hi: "Hello"', ''].join('\n'), {
        role: 'source',
        providerId: '@example/app',
        scopeId: 'shell',
        locale: 'en-US',
      }).ok,
    ).toBe(true);
  });
});
