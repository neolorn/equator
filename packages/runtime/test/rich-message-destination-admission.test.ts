/**
 * What a link slot's destination is admitted as, and what refuses it.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` gives a structured message its link slots, and
 * the two builders in `destinations.ts` are the only way to make a binding for one. Their doc
 * comments state the contract: an internal address is origin-relative and bounded, an external one
 * is HTTPS at an origin on a required, non-empty, bounded allowlist, and neither may carry a
 * character, written or percent-encoded, that makes a rendered address read as somewhere else.
 *
 * A refusal by policy and a refusal by the URL parser are told apart by `reason` and `cause`: a
 * consumer filtering on them is reading whether its own value was malformed or merely not allowed.
 */
import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import {
  externalDestination,
  internalDestination,
} from '../src/destinations.js';
import { RUNTIME_LIMITS } from '../src/runtime-safety.js';

const ORIGINS = Object.freeze(['https://example.com']);

/** The refusal an action raises, or `undefined` when it was admitted. */
function refusalOf(action: () => unknown): LocalizationError | undefined {
  try {
    action();
  } catch (error) {
    // Anything else is a crash in the builder and not a refusal, so it fails the case as itself.
    if (error instanceof LocalizationError) return error;
    throw error;
  }
  return undefined;
}

// Built from code points so that no invisible character sits in this file.
const character = (codePoint: number): string =>
  String.fromCodePoint(codePoint);

describe('a destination refused by policy', () => {
  it('is an operational failure of the rich message, with no reason and no cause', () => {
    const refusal = refusalOf(() => internalDestination('second'));

    expect(refusal?.diagnostic.code).toBe('invalid-rich-message');
    expect(refusal?.diagnostic.outcome).toBe('operational-failure');
    // Absent and not undefined: a diagnostic is logged as its own keys.
    expect(Object.keys(refusal?.diagnostic ?? {}).sort()).toStrictEqual([
      'code',
      'message',
      'outcome',
    ]);
    expect(refusal !== undefined && 'cause' in refusal).toBe(false);
  });

  it('is told apart from one the URL parser refused', () => {
    const refusal = refusalOf(() => externalDestination('https://', ORIGINS));

    expect(refusal?.diagnostic.reason).toBe('malformed-input');
    expect(refusal?.cause).toBeInstanceOf(TypeError);
  });
});

describe('an internal destination', () => {
  // Only a leading pair of slashes names another host; anywhere else it is part of the path.
  it('may end in two slashes', () => {
    expect(internalDestination('/archive//')).toMatchObject({
      kind: 'internal',
      href: '/archive//',
    });
  });
});

describe('the text of a destination', () => {
  const policyRefusal = (href: unknown) =>
    refusalOf(() => externalDestination(href as string, ORIGINS));

  it('is refused as malformed input when it is not a string', () => {
    for (const href of [42, null, undefined, {}, ['https://example.com/']]) {
      for (const refusal of [
        policyRefusal(href),
        refusalOf(() => internalDestination(href as string)),
      ]) {
        expect(refusal?.diagnostic.code).toBe('invalid-rich-message');
        expect(refusal?.diagnostic.outcome).toBe('operational-failure');
        expect(refusal?.diagnostic.reason).toBe('malformed-input');
        expect(refusal?.diagnostic.message).toBe(
          'A rich-message destination must be text.',
        );
      }
    }
  });

  it('is refused as malformed input when it is not a string, before the allowlist is read', () => {
    const refusal = refusalOf(() =>
      externalDestination(42 as unknown as string, []),
    );

    expect(refusal?.diagnostic.reason).toBe('malformed-input');
  });

  it('is refused by policy when it is empty', () => {
    const refusal = policyRefusal('');

    expect(refusal?.diagnostic.code).toBe('invalid-rich-message');
    expect(refusal?.diagnostic.reason).toBeUndefined();
  });

  it('is admitted at the bound and refused one code unit past it', () => {
    const atBound = `/${'a'.repeat(RUNTIME_LIMITS.destinationCodeUnits - 1)}`;

    expect(internalDestination(atBound)).toStrictEqual({
      kind: 'internal',
      href: atBound,
    });
    expect(
      refusalOf(() => internalDestination(`${atBound}a`))?.diagnostic.code,
    ).toBe('invalid-rich-message');

    const prefix = 'https://example.com/';
    const externalAtBound = `${prefix}${'a'.repeat(RUNTIME_LIMITS.destinationCodeUnits - prefix.length)}`;
    expect(externalDestination(externalAtBound, ORIGINS).href).toBe(
      externalAtBound,
    );
    expect(policyRefusal(`${externalAtBound}a`)?.diagnostic.code).toBe(
      'invalid-rich-message',
    );
  });

  it('is refused when it carries a control or an invisible direction character', () => {
    for (const codePoint of [
      0x00, 0x1f, 0x7f, 0x200b, 0x202e, 0x2066, 0xfeff,
    ]) {
      const hidden = character(codePoint);
      expect(
        refusalOf(() => internalDestination(`/second${hidden}`))?.diagnostic
          .code,
      ).toBe('invalid-rich-message');
      expect(
        policyRefusal(`https://example.com/second${hidden}`)?.diagnostic.code,
      ).toBe('invalid-rich-message');
    }
  });

  it('is refused when it carries one of those characters percent-encoded', () => {
    for (const encoded of [
      '%00',
      '%09',
      '%0a',
      '%0F',
      '%10',
      '%19',
      '%1f',
      '%1A',
      '%7f',
      '%7F',
      '%e2%80%8b',
      '%E2%80%8C',
      '%e2%80%8d',
      '%e2%80%8e',
      '%e2%80%8f',
      '%e2%80%aa',
      '%E2%80%AB',
      '%e2%80%ac',
      '%e2%80%ad',
      '%e2%80%ae',
    ]) {
      expect(
        refusalOf(() => internalDestination(`/second${encoded}`))?.diagnostic
          .code,
      ).toBe('invalid-rich-message');
      expect(
        policyRefusal(`https://example.com/second${encoded}`)?.diagnostic.code,
      ).toBe('invalid-rich-message');
    }
  });

  it('is admitted with the percent-encodings an ordinary address carries', () => {
    // A space, a slash, a non-Latin letter, and the encodings one hexadecimal digit away from a
    // refused one on each side.
    for (const encoded of [
      '%20',
      '%2F',
      '%D8%AF',
      '%7e',
      '%80',
      '%e2%80%90',
      '%e2%80%87',
      '%e2%80%a9',
      '%e2%80%af',
      '%e2%81%8b',
    ]) {
      expect(internalDestination(`/second${encoded}`)).toStrictEqual({
        kind: 'internal',
        href: `/second${encoded}`,
      });
    }
  });
});

describe('an external destination', () => {
  it('is admitted at an allowed origin, opening a new tab unless told otherwise', () => {
    expect(
      externalDestination('https://example.com/second', ORIGINS),
    ).toStrictEqual({
      kind: 'external',
      href: 'https://example.com/second',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(
      externalDestination('https://example.com/second', ORIGINS, '_self'),
    ).toStrictEqual({
      kind: 'external',
      href: 'https://example.com/second',
      target: '_self',
      rel: 'noopener',
    });
  });

  it('is refused for a target that is neither of the two', () => {
    const refusal = refusalOf(() =>
      externalDestination(
        'https://example.com/second',
        ORIGINS,
        '_top' as '_self',
      ),
    );

    expect(refusal?.diagnostic.code).toBe('invalid-rich-message');
  });

  it('is refused by policy when its text is unsafe, whatever the allowlist holds', () => {
    const refusal = refusalOf(() =>
      externalDestination(
        `https://example.com/second${character(0x200b)}`,
        ORIGINS,
      ),
    );

    expect(refusal?.diagnostic.code).toBe('invalid-rich-message');
    expect(refusal?.diagnostic.reason).toBeUndefined();
  });

  it('is refused when the allowlist is not an array', () => {
    for (const allowlist of [
      'https://example.com',
      new Set(ORIGINS),
      { 0: 'https://example.com', length: 1 },
      undefined,
    ]) {
      const refusal = refusalOf(() =>
        externalDestination(
          'https://example.com/second',
          allowlist as unknown as readonly string[],
        ),
      );
      expect(refusal?.diagnostic.code).toBe('invalid-rich-message');
      expect(refusal?.diagnostic.reason).toBeUndefined();
    }
  });

  it('is refused by policy when the allowlist is empty, before the address is parsed', () => {
    const refusal = refusalOf(() => externalDestination('not an address', []));

    expect(refusal?.diagnostic.code).toBe('invalid-rich-message');
    // The parser would have refused this address with a reason; the empty allowlist decided first.
    expect(refusal?.diagnostic.reason).toBeUndefined();
    expect(refusal !== undefined && 'cause' in refusal).toBe(false);
  });

  it('is admitted against an allowlist at its bound and refused one entry past it', () => {
    const others = Array.from(
      { length: RUNTIME_LIMITS.destinationOrigins - 1 },
      (_, index) => `https://host-${index}.example`,
    );
    const atBound = [...others, 'https://example.com'];

    expect(
      externalDestination('https://example.com/second', atBound).href,
    ).toBe('https://example.com/second');
    expect(
      refusalOf(() =>
        externalDestination('https://example.com/second', [
          'https://one-more.example',
          ...atBound,
        ]),
      )?.diagnostic.code,
    ).toBe('invalid-rich-message');
  });
});
