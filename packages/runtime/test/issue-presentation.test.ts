import { describe, expect, it } from 'vitest';

import type { Localization } from '../src/localization.js';
import { presentExternalValue, presentIssue } from '../src/presentation.js';
import { GENERATED_ABI, type PlainMessageHandle } from '@neolorn/equator/core';

/**
 * Which message a code or an external value is shown with.
 *
 * The runtime is replaced by one that answers with the identity of the message it was handed, so
 * each case reads which message was chosen rather than what a catalog says in it. Choosing is all
 * `presentation.ts` does; evaluating is the runtime's and is proven elsewhere.
 */

const handle = (identity: string): PlainMessageHandle =>
  Object.freeze({
    generatedAbi: GENERATED_ABI,
    providerId: 'shell',
    scopeId: 'shell',
    messageId: identity,
    identity: `shell:shell:${identity}`,
    resultKind: 'plain',
    inputNames: Object.freeze([]),
    slotNames: Object.freeze([]),
  }) as PlainMessageHandle;

const CHOSEN = {
  evaluateText: (message: PlainMessageHandle) =>
    Object.freeze({ kind: 'text', value: message.identity }),
} as unknown as Localization;

const shown = (presentation: { readonly localized: unknown }): unknown =>
  (presentation.localized as { readonly value: unknown }).value;

const UNKNOWN = handle('issue.unknown');
const STOCK = handle('issue.insufficient-stock');
const OUTAGE = handle('legacy.outage');

describe('an issue code', () => {
  it('finds the message its name derives', () => {
    const presentation = presentIssue(
      CHOSEN,
      { code: 'INSUFFICIENT_STOCK' },
      { messages: { insufficientStock: STOCK }, unknown: UNKNOWN },
    );
    expect(presentation.status).toBe('known');
    expect(shown(presentation)).toBe(STOCK.identity);
  });

  it('takes an explicit binding over the message its name derives', () => {
    const presentation = presentIssue(
      CHOSEN,
      { code: 'INSUFFICIENT_STOCK' },
      {
        messages: { insufficientStock: STOCK },
        unknown: UNKNOWN,
        bindings: { INSUFFICIENT_STOCK: { message: OUTAGE } },
      },
    );
    expect(presentation.status).toBe('known');
    expect(shown(presentation)).toBe(OUTAGE.identity);
  });

  it('refuses a member of the right name whose identity is another message', () => {
    // The wrong group handed in: the member is named for the code and is about something else.
    const presentation = presentIssue(
      CHOSEN,
      { code: 'INSUFFICIENT_STOCK' },
      {
        messages: { insufficientStock: handle('billing.card-declined') },
        unknown: UNKNOWN,
      },
    );
    expect(presentation.status).toBe('unknown');
    expect(shown(presentation)).toBe(UNKNOWN.identity);
  });
});

describe('an external value', () => {
  const BINDINGS = Object.freeze({ ready: handle('status.ready') });

  it('is shown with the message bound to it', () => {
    expect(
      presentExternalValue(CHOSEN, 'ready', BINDINGS, UNKNOWN),
    ).toMatchObject({ status: 'known', value: 'ready' });
  });

  it('stays a typed unknown, with its own value, when nothing is bound to it', () => {
    const presentation = presentExternalValue(
      CHOSEN,
      'archived',
      BINDINGS,
      UNKNOWN,
    );
    expect(presentation).toMatchObject({
      status: 'unknown',
      value: 'archived',
      diagnostic: { code: 'unknown-presentation-code' },
    });
    expect(shown(presentation)).toBe(UNKNOWN.identity);
  });
});
