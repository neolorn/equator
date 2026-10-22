/**
 * What an external destination's allowlist may hold, and which addresses it then admits.
 *
 * `externalDestination` states the contract in its doc comment: each entry is an HTTPS origin with
 * no credentials, path, query or fragment, and the address is HTTPS at one of them. One entry that
 * is not such an origin refuses the call, even where another entry would have admitted the
 * address, because a list with one wrong entry is a list nobody has read.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 3 tells the two refusals apart: a refused entry
 * carries the reason `malformed-input`, because the list was written wrongly, and an address the
 * list does not hold carries no reason.
 */
import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import { externalDestination } from '../src/destinations.js';
import { RUNTIME_LIMITS } from '../src/runtime-safety.js';

const ADDRESS = 'https://example.com/second';

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

/** The refusal of the address when the allowlist holds exactly these entries. */
const against = (...entries: readonly unknown[]) =>
  refusalOf(() => externalDestination(ADDRESS, entries as readonly string[]));

/** The refusal of this address against the one origin every case here allows. */
const addressed = (href: string) =>
  refusalOf(() => externalDestination(href, ['https://example.com']));

/** The refusal of an address the allowlist does not hold: the list was read and said no. */
function expectPolicyRefusal(refusal: LocalizationError | undefined): void {
  expect(refusal?.diagnostic.code).toBe('invalid-rich-message');
  expect(refusal?.diagnostic.outcome).toBe('operational-failure');
  expect(refusal?.diagnostic.reason).toBeUndefined();
}

/** The refusal of the list itself, for an entry that is not what an entry may be. */
function expectEntryRefusal(refusal: LocalizationError | undefined): void {
  expect(refusal?.diagnostic.code).toBe('invalid-rich-message');
  expect(refusal?.diagnostic.outcome).toBe('operational-failure');
  expect(refusal?.diagnostic.reason).toBe('malformed-input');
}

describe('an allowlist entry', () => {
  it('is an HTTPS origin, with or without its trailing slash', () => {
    expect(against('https://example.com')).toBeUndefined();
    expect(against('https://example.com/')).toBeUndefined();
  });

  it('refuses the call when it is not HTTPS, whatever the other entries allow', () => {
    expectEntryRefusal(against('https://example.com', 'http://other.example'));
    expectEntryRefusal(against('http://other.example', 'https://example.com'));
  });

  it('refuses the call when it carries a user name', () => {
    expectEntryRefusal(against('https://user@example.com'));
  });

  it('refuses the call when it carries a password', () => {
    expectEntryRefusal(against('https://:secret@example.com'));
  });

  it('refuses the call when it carries a path', () => {
    expectEntryRefusal(against('https://example.com/second'));
  });

  it('refuses the call when it carries a query', () => {
    expectEntryRefusal(against('https://example.com?page=1'));
  });

  it('refuses the call when it carries a fragment', () => {
    expectEntryRefusal(against('https://example.com#top'));
  });

  it('refuses the call when it is not a string', () => {
    expectEntryRefusal(against(42));
    expectEntryRefusal(against('https://example.com', undefined));
    expectEntryRefusal(against(''));
  });

  it('refuses the call when it carries an invisible character', () => {
    // A URL parser drops a zero-width space from a host, so the entry would otherwise be read as
    // the origin it only resembles. Built from its code point so that none sits in this file.
    expectEntryRefusal(
      against(`https://exam${String.fromCodePoint(0x200b)}ple.com`),
    );
  });

  it('is admitted at the length bound and refused one code unit past it', () => {
    const label = 'a'.repeat(50);
    const scheme = 'https://';
    const suffix = '.example';
    const bound = RUNTIME_LIMITS.destinationOriginCodeUnits;
    const labels = Math.floor(
      (bound - scheme.length - suffix.length) / (label.length + 1),
    );
    const stem = `${scheme}${`${label}.`.repeat(labels)}`;
    const atBound = `${stem}${'b'.repeat(bound - stem.length - suffix.length)}${suffix}`;
    const pastBound = `${stem}${'b'.repeat(bound - stem.length - suffix.length + 1)}${suffix}`;

    expect(atBound).toHaveLength(bound);
    expect(externalDestination(`${atBound}/second`, [atBound]).href).toBe(
      `${atBound}/second`,
    );
    expectEntryRefusal(
      refusalOf(() => externalDestination(`${pastBound}/second`, [pastBound])),
    );
  });
});

describe('an address against its allowlist', () => {
  it('is refused at an origin the allowlist does not hold', () => {
    expectPolicyRefusal(addressed('https://other.example/second'));
  });

  it('is refused over plain HTTP at an allowed host', () => {
    expectPolicyRefusal(addressed('http://example.com/second'));
  });

  it('is refused under another scheme whose origin is an allowed one', () => {
    // A `blob:` address reports the origin of the address inside it, and the allowlist admits an
    // address only over HTTPS.
    expect(new URL('blob:https://example.com/second').origin).toBe(
      'https://example.com',
    );
    expectPolicyRefusal(addressed('blob:https://example.com/second'));
  });

  it('is refused when it carries a user name', () => {
    expectPolicyRefusal(addressed('https://user@example.com/second'));
  });

  it('is refused when it carries a password', () => {
    expectPolicyRefusal(addressed('https://:secret@example.com/second'));
  });
});
