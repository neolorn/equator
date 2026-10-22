import { describe, expect, it } from 'vitest';

import type { Localization } from '../src/localization.js';
import { presentExternalValue, presentIssue } from '../src/presentation.js';
import { GENERATED_ABI, type PlainMessageHandle } from '@neolorn/equator/core';

/**
 * Which codes may choose a message, and which values the chosen message is evaluated with.
 *
 * The runtime is replaced by one that records the message and the inputs it was handed, as
 * `issue-presentation.test.ts` does for the message alone, because choosing both is all
 * `presentation.ts` does.
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

interface Evaluated {
  readonly message: string;
  readonly inputs: unknown;
}

const RECORDING = {
  evaluateText: (message: PlainMessageHandle, inputs: unknown): Evaluated =>
    Object.freeze({ message: message.identity, inputs }),
} as unknown as Localization;

const evaluated = (presentation: { readonly localized: unknown }): Evaluated =>
  presentation.localized as Evaluated;

const UNKNOWN = handle('issue.unknown');
const STOCK = handle('issue.insufficient-stock');
const OUTAGE = handle('legacy.outage');

/** Codes a binding exists for and that are still not codes: each is shown as unknown. */
const UNSAFE_CODES = [
  ['a leading character outside the code alphabet', '!STOCK'],
  ['a trailing character outside the code alphabet', 'STOCK!'],
  ['more characters than a code may have', 'S'.repeat(129)],
] as const;

describe('a code that is not shaped like one', () => {
  it.each(UNSAFE_CODES)('is an unknown issue with %s', (_, code) => {
    const presentation = presentIssue(
      RECORDING,
      { code },
      {
        messages: {},
        unknown: UNKNOWN,
        bindings: { [code]: { message: OUTAGE } },
      },
    );

    expect(presentation.status).toBe('unknown');
    expect(evaluated(presentation).message).toBe(UNKNOWN.identity);
  });

  it.each(UNSAFE_CODES)('is an unknown value with %s', (_, code) => {
    const presentation = presentExternalValue(
      RECORDING,
      code,
      { [code]: OUTAGE },
      UNKNOWN,
    );

    expect(presentation.status).toBe('unknown');
    expect(evaluated(presentation).message).toBe(UNKNOWN.identity);
  });

  it('admits a code exactly as long as the bound', () => {
    const code = 'S'.repeat(128);
    const presentation = presentExternalValue(
      RECORDING,
      code,
      { [code]: OUTAGE },
      UNKNOWN,
    );

    expect(presentation).toEqual({
      status: 'known',
      value: code,
      localized: { message: OUTAGE.identity, inputs: {} },
    });
  });
});

describe('the unknown presentation', () => {
  it('carries the diagnostic that names it for an external value', () => {
    const presentation = presentExternalValue(
      RECORDING,
      'refunded',
      {},
      UNKNOWN,
    );

    expect(presentation).toMatchObject({
      status: 'unknown',
      value: 'refunded',
      localized: { message: UNKNOWN.identity, inputs: {} },
      diagnostic: {
        code: 'unknown-presentation-code',
        outcome: 'consumer-domain-outcome',
      },
    });
  });

  it('carries the same diagnostic for an issue code', () => {
    const presentation = presentIssue(
      RECORDING,
      { code: 'NEVER_HEARD_OF_IT', parameters: { order: 7 } },
      { messages: {}, unknown: UNKNOWN },
    );

    expect(presentation).toMatchObject({
      status: 'unknown',
      code: 'NEVER_HEARD_OF_IT',
      localized: { message: UNKNOWN.identity, inputs: {} },
      diagnostic: {
        code: 'unknown-presentation-code',
        outcome: 'consumer-domain-outcome',
      },
    });
  });
});

describe('the values an explicit binding is evaluated with', () => {
  const issue = { code: 'OUTAGE', parameters: { region: 'eu' } };

  it('takes what the binding derives over what the issue carries', () => {
    const presentation = presentIssue(RECORDING, issue, {
      messages: {},
      unknown: UNKNOWN,
      bindings: {
        OUTAGE: { message: OUTAGE, parameters: () => ({ minutes: 5 }) },
      },
    });

    expect(evaluated(presentation)).toEqual({
      message: OUTAGE.identity,
      inputs: { minutes: 5 },
    });
  });

  it('takes what the issue carries when the binding derives nothing', () => {
    const presentation = presentIssue(RECORDING, issue, {
      messages: {},
      unknown: UNKNOWN,
      bindings: { OUTAGE: { message: OUTAGE } },
    });

    expect(evaluated(presentation).inputs).toEqual({ region: 'eu' });
  });

  it('takes no values when neither names any', () => {
    const presentation = presentIssue(
      RECORDING,
      { code: 'OUTAGE' },
      {
        messages: {},
        unknown: UNKNOWN,
        bindings: { OUTAGE: { message: OUTAGE } },
      },
    );

    expect(evaluated(presentation).inputs).toEqual({});
  });
});

describe('the values a message found by its name is evaluated with', () => {
  const issue = { code: 'INSUFFICIENT_STOCK', parameters: { left: 2 } };

  it('takes what the source derives over what the issue carries', () => {
    const presentation = presentIssue(RECORDING, issue, {
      messages: { insufficientStock: STOCK },
      unknown: UNKNOWN,
      parameters: () => ({ available: 2 }),
    });

    expect(evaluated(presentation)).toEqual({
      message: STOCK.identity,
      inputs: { available: 2 },
    });
  });

  it('takes what the issue carries when the source derives nothing', () => {
    const presentation = presentIssue(RECORDING, issue, {
      messages: { insufficientStock: STOCK },
      unknown: UNKNOWN,
    });

    expect(evaluated(presentation).inputs).toEqual({ left: 2 });
  });

  it('takes no values when neither names any', () => {
    const presentation = presentIssue(
      RECORDING,
      { code: 'INSUFFICIENT_STOCK' },
      { messages: { insufficientStock: STOCK }, unknown: UNKNOWN },
    );

    expect(evaluated(presentation).inputs).toEqual({});
  });
});
