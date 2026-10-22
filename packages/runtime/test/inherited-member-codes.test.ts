import { describe, expect, it } from 'vitest';

import type { Localization } from '../src/localization.js';
import { presentExternalValue, presentIssue } from '../src/presentation.js';
import {
  GENERATED_ABI,
  type IssueMessageSource,
  type PlainMessageHandle,
} from '@neolorn/equator/core';

/**
 * A code or a value from another system spelled like a member every object inherits.
 *
 * `constructor` and `toString` are safe codes by the pattern `presentation.ts` checks, and the
 * bindings an application passes are ordinary object literals, so a lookup that is not limited to
 * own members finds `Object.prototype`'s. Such a code is one nothing was bound to, and it is shown
 * the way any unknown one is. The runtime is replaced as in `issue-presentation.test.ts`, by one
 * that answers with the identity of whatever it was handed.
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
  evaluateText: (message: unknown) =>
    Object.freeze({
      kind: 'text',
      value: (message as { readonly identity?: unknown } | undefined)?.identity,
    }),
} as unknown as Localization;

const UNKNOWN = handle('issue.unknown');
const INHERITED = ['constructor', 'toString', 'hasOwnProperty'] as const;

describe('an issue code spelled like an inherited member', () => {
  const source: IssueMessageSource = {
    messages: { insufficientStock: handle('issue.insufficient-stock') },
    unknown: UNKNOWN,
    bindings: { INSUFFICIENT_STOCK: { message: handle('legacy.outage') } },
  };

  it.each(INHERITED)('is unknown when it is %s', (code) => {
    const presentation = presentIssue(CHOSEN, { code }, source);
    expect(presentation.status).toBe('unknown');
    expect(presentation.localized).toMatchObject({ value: UNKNOWN.identity });
  });
});

describe('an external value spelled like an inherited member', () => {
  const bindings = { ready: handle('status.ready') };

  it.each(INHERITED)('is unknown when it is %s', (value) => {
    const presentation = presentExternalValue(CHOSEN, value, bindings, UNKNOWN);
    expect(presentation).toMatchObject({
      status: 'unknown',
      value,
      diagnostic: { code: 'unknown-presentation-code' },
    });
  });
});
