import { describe, expect, it } from 'vitest';

import {
  documentMessage,
  refuseUnboundDocumentMessage,
} from '../router/src/document-messages.js';
import {
  GENERATED_ABI,
  LocalizationError,
  type PlainMessageHandle,
} from '@neolorn/equator/core';

/**
 * How the refusal of an unbound document message is classified.
 *
 * `document-message-binding.test.ts` asserts that the refusal happens. A caller that catches it
 * reads the code and the outcome, which say it is the declaration that is wrong and not the page.
 */

const takesAName: PlainMessageHandle = Object.freeze({
  generatedAbi: GENERATED_ABI,
  providerId: 'fixture',
  scopeId: 'shell',
  messageId: 'document.greeting',
  identity: 'fixture/shell/document.greeting',
  resultKind: 'plain' as const,
  inputNames: Object.freeze(['name']),
  slotNames: Object.freeze([]),
});

function refusal(act: () => unknown): LocalizationError {
  try {
    act();
  } catch (error: unknown) {
    if (error instanceof LocalizationError) return error;
    throw error;
  }
  throw new Error('nothing was refused');
}

describe('the refusal of a document message declared without its values', () => {
  it('is an invalid configuration, reported as an operational failure', () => {
    const error = refusal(() =>
      refuseUnboundDocumentMessage(takesAName, undefined),
    );

    expect(error.diagnostic.code).toBe('invalid-configuration');
    expect(error.diagnostic.outcome).toBe('operational-failure');
  });

  it('is classified the same way at the call that binds it', () => {
    const error = refusal(() => documentMessage(takesAName));

    expect(error.diagnostic.code).toBe('invalid-configuration');
    expect(error.diagnostic.outcome).toBe('operational-failure');
  });
});
