import { describe, expect, it } from 'vitest';

import type {
  CompiledCatalog,
  CompiledInputContract,
} from '../src/catalog-runtime.js';
import {
  FormatterCache,
  evaluateCandidate,
  findEvaluationCandidate,
} from '../src/evaluator.js';
import { RuntimeExtensions } from '../src/extensions.js';
import { LocalizationError, type MessageHandle } from '@neolorn/equator/core';

import { COUNT, parse } from './message-harness.js';

/**
 * A target locale with no catalog of its own, answered by a source catalog that cannot answer.
 *
 * Fallback is where an incompatible artifact would be easiest to let through: the target has
 * nothing, the source has something under the right name, and rendering it looks better than
 * refusing. Each case makes the source's message wrong in one way and requires a typed refusal
 * that names no message text, with a compatible source as the control.
 */

const SOURCE = 'You have {$count :number} items';

interface Departure {
  readonly generatedAbi?: string;
  readonly resultKind?: 'plain' | 'structured';
}

function sourceCatalog(departure: Departure = {}): CompiledCatalog {
  const semantics = parse(SOURCE);
  if (semantics.kind !== 'pattern') throw new Error('Expected a pattern.');
  const inputs: readonly CompiledInputContract[] = COUNT;
  const resources = {
    irNodes: 1,
    depth: 1,
    selectors: 0,
    variants: 0,
    inputs: inputs.length,
    slots: 0,
    outputParts: 64,
  };
  return {
    profile: 'equator-compiled-ir/1',
    generatedAbi: departure.generatedAbi ?? 'equator-generated/1',
    standardsProfile: 'equator-1',
    key: { providerId: 'shell', scopeId: 'shell', catalogLocale: 'en' },
    applicationContractFingerprint: 'test',
    semanticRegistryFingerprint: 'test',
    requiredExtensions: Object.freeze([]),
    messages: Object.freeze([
      {
        messageId: 'cart.count',
        kind: 'message' as const,
        resultKind: departure.resultKind ?? ('plain' as const),
        sourceFingerprint: 'test',
        inputs: Object.freeze(inputs),
        slots: Object.freeze([]),
        body: {
          kind: 'pattern',
          declarations: semantics.declarations,
          pattern: semantics.pattern,
        },
      },
    ]),
    resources: { ...resources, maximumMessage: resources },
  } as unknown as CompiledCatalog;
}

const HANDLE = {
  generatedAbi: 'equator-generated/1',
  providerId: 'shell',
  scopeId: 'shell',
  messageId: 'cart.count',
  identity: 'shell:shell:cart.count',
  resultKind: 'plain',
  inputNames: Object.freeze(['count']),
  slotNames: Object.freeze([]),
} as MessageHandle;

/** What a French reader is shown, or the refusal they are shown instead. */
function shownInFrench(
  catalog: CompiledCatalog,
  inputs: unknown = { count: 3 },
): { readonly text?: string; readonly refusal?: LocalizationError } {
  try {
    const result = evaluateCandidate(
      HANDLE,
      findEvaluationCandidate(HANDLE, 'fr-FR', [catalog]),
      inputs,
      Object.freeze({ locale: 'fr-FR' }),
      new FormatterCache(8),
      new RuntimeExtensions(),
    );
    return { text: result.kind === 'text' ? result.value : result.text };
  } catch (error) {
    if (error instanceof LocalizationError) return { refusal: error };
    throw error;
  }
}

function expectRefused(outcome: ReturnType<typeof shownInFrench>): void {
  expect(outcome.text).toBeUndefined();
  expect(outcome.refusal?.diagnostic.outcome).toBe('operational-failure');
  // Neither the words nor the key reach the reader through the diagnostic's own message.
  expect(outcome.refusal?.diagnostic.message).not.toContain('You have');
  expect(outcome.refusal?.diagnostic.message).not.toContain('cart.count');
}

describe('a fallback to the source catalog', () => {
  it('renders the source message when it is compatible', () => {
    expect(shownInFrench(sourceCatalog()).text).toContain('You have');
  });

  it('refuses a source artifact built against another generated ABI', () => {
    expectRefused(
      shownInFrench(sourceCatalog({ generatedAbi: 'equator-generated/0' })),
    );
  });

  it('refuses a source message of another result kind', () => {
    expectRefused(shownInFrench(sourceCatalog({ resultKind: 'structured' })));
  });

  it('refuses inputs the source message does not accept', () => {
    expectRefused(shownInFrench(sourceCatalog(), { count: 'three' }));
    expectRefused(shownInFrench(sourceCatalog(), { count: 3, extra: 1 }));
  });
});
