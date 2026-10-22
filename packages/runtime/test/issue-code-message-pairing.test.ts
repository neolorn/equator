import { describe, expect, it } from 'vitest';

import { issueMessage, issueMessageId } from '../src/issue-convention.js';
import { GENERATED_ABI, type PlainMessageHandle } from '@neolorn/equator/core';

/**
 * How a code names its message, and which member of a group answers for it.
 *
 * Section 9 of `specs/08-formatting-parsing-and-domain.spec.md` has a code read as a sequence of
 * words and written back as one lower-kebab identifier, whichever casing or separator convention
 * the originating system uses, and has a message found by name accepted only when its own identity
 * ends in that identifier.
 */

const handle = (identity: string): PlainMessageHandle =>
  Object.freeze({
    generatedAbi: GENERATED_ABI,
    providerId: 'shell',
    scopeId: 'shell',
    messageId: identity,
    identity,
    resultKind: 'plain',
    inputNames: Object.freeze([]),
    slotNames: Object.freeze([]),
  }) as PlainMessageHandle;

describe('the message identifier a code derives', () => {
  it.each([
    ['INSUFFICIENT_STOCK', 'insufficient-stock'],
    ['insufficientStock', 'insufficient-stock'],
    ['Payment.Declined', 'payment-declined'],
    ['ORDER_2_EXPIRED', 'order-2-expired'],
    ['step2Failed', 'step2-failed'],
  ])('reads %s as %s', (code, expected) => {
    expect(issueMessageId(code)).toBe(expected);
  });

  it('keeps the first and the last letter of each alphabet and each end of the digits', () => {
    expect(issueMessageId('AZ_ZA')).toBe('az-za');
    expect(issueMessageId('az_za')).toBe('az-za');
    expect(issueMessageId('E09_90')).toBe('e09-90');
  });

  it('keeps a word written in one case as one word', () => {
    expect(issueMessageId('lowercase')).toBe('lowercase');
    expect(issueMessageId('UPPERCASE')).toBe('uppercase');
    expect(issueMessageId('error404')).toBe('error404');
  });

  it('separates words at the characters on either side of the letters and the digits', () => {
    // The neighbours of each range in code order: `/` and `:` around the digits, `@` and `[`
    // around the capitals, and the grave accent and `{` around the small letters.
    expect(issueMessageId('a/b:c@d[e`f{g')).toBe('a-b-c-d-e-f-g');
    expect(issueMessageId('1/2:3@4[5`6{7')).toBe('1-2-3-4-5-6-7');
  });

  it('reads a run of separators as one, and none at either end as a word', () => {
    expect(issueMessageId('__STOCK__LOW__')).toBe('stock-low');
    expect(issueMessageId('.payment')).toBe('payment');
    expect(issueMessageId('payment.')).toBe('payment');
  });

  it('starts a word where a capital follows a small letter', () => {
    expect(issueMessageId('schemaError')).toBe('schema-error');
    expect(issueMessageId('fizzBuzz')).toBe('fizz-buzz');
  });

  it('starts a word where a capital follows a digit', () => {
    expect(issueMessageId('step2Failed')).toBe('step2-failed');
    expect(issueMessageId('v0Beta')).toBe('v0-beta');
    expect(issueMessageId('v9Beta')).toBe('v9-beta');
  });

  it('reads only ASCII letters and digits, whichever way another letter is encoded', () => {
    const composed = `caf${String.fromCharCode(0xe9)}`;
    const decomposed = `cafe${String.fromCharCode(0x301)}`;

    expect(issueMessageId(composed)).toBe('caf');
    expect(issueMessageId(decomposed)).toBe('cafe');
    expect(issueMessageId(`${composed}Closed`)).toBe('caf-closed');
    expect(issueMessageId(`stra${String.fromCharCode(0xdf)}e`)).toBe('stra-e');
    expect(issueMessageId(String.fromCharCode(0x661, 0x662))).toBe('');
  });

  it('answers with the empty identifier for a code with nothing usable in it', () => {
    expect(issueMessageId('')).toBe('');
    expect(issueMessageId('._-')).toBe('');
  });
});

describe('the member of a group a code names', () => {
  it('is found where its identity is the derived identifier itself', () => {
    const message = handle('insufficient-stock');

    expect(
      issueMessage({ insufficientStock: message }, 'INSUFFICIENT_STOCK'),
    ).toBe(message);
  });

  it('is found where its identity ends in the derived identifier', () => {
    const message = handle('shell:shell:issue.step2-failed');

    expect(issueMessage({ step2Failed: message }, 'STEP2_FAILED')).toBe(
      message,
    );
    expect(issueMessage({ step2Failed: message }, 'step2Failed')).toBe(message);
  });

  it('is nothing for a code with a word that begins with a digit, which no catalog can hold', () => {
    // The only identity that ends in the derived identifier is one generation never writes, so a
    // member that carries a real identity under the derived name is another message.
    const message = handle('shell:shell:issue.order2-expired');

    expect(
      issueMessage({ order2Expired: message }, 'ORDER_2_EXPIRED'),
    ).toBeUndefined();
  });

  it('is not a member that holds nothing', () => {
    expect(
      issueMessage({ insufficientStock: null }, 'INSUFFICIENT_STOCK'),
    ).toBeUndefined();
    expect(
      issueMessage({ insufficientStock: undefined }, 'INSUFFICIENT_STOCK'),
    ).toBeUndefined();
  });

  it('is not a member generated for another contract version', () => {
    const member = { ...handle('insufficient-stock'), generatedAbi: 'other/1' };

    expect(
      issueMessage({ insufficientStock: member }, 'INSUFFICIENT_STOCK'),
    ).toBeUndefined();
  });

  it('is not a member whose result is not plain text', () => {
    const member = { ...handle('insufficient-stock'), resultKind: 'rich' };

    expect(
      issueMessage({ insufficientStock: member }, 'INSUFFICIENT_STOCK'),
    ).toBeUndefined();
  });

  it('is not a member that states no identity', () => {
    const member = { ...handle('insufficient-stock'), identity: 7 };

    expect(
      issueMessage({ insufficientStock: member }, 'INSUFFICIENT_STOCK'),
    ).toBeUndefined();
  });

  it('is nothing for a code with nothing usable in it, whatever the group holds', () => {
    expect(issueMessage({ '': handle('') }, '._-')).toBeUndefined();
    expect(issueMessage({ '': handle('issue.') }, '')).toBeUndefined();
  });
});
