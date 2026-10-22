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
import {
  type FormattingContext,
  type MessageHandle,
} from '@neolorn/equator/core';

import { COUNT, parse } from './message-harness.js';

/**
 * A target locale without a catalog of its own, answered by the English source. The variants are
 * English, so the grammar that chooses among them is English too: French puts zero in `one`, and a
 * French reader shown the English catalog would otherwise read "one item: 0".
 */

const SOURCE =
  '.input {$count :number}\n.match $count\none {{one item: {$count}}}\n* {{many items: {$count}}}';

function sourceCatalog(
  inputs: readonly CompiledInputContract[],
): CompiledCatalog {
  const semantics = parse(SOURCE);
  if (semantics.kind !== 'select')
    throw new Error('Expected a select message.');
  const resources = {
    irNodes: 1,
    depth: 1,
    selectors: 1,
    variants: 8,
    inputs: inputs.length,
    slots: 0,
    outputParts: 64,
  };
  return {
    profile: 'equator-compiled-ir/1',
    generatedAbi: 'equator-generated/1',
    standardsProfile: 'equator-1',
    key: { providerId: 'shell', scopeId: 'shell', catalogLocale: 'en' },
    applicationContractFingerprint: 'test',
    semanticRegistryFingerprint: 'test',
    requiredExtensions: Object.freeze([]),
    messages: Object.freeze([
      {
        messageId: 'items',
        kind: 'message' as const,
        resultKind: 'plain' as const,
        sourceFingerprint: 'test',
        inputs: Object.freeze(inputs),
        slots: Object.freeze([]),
        body: {
          kind: 'select',
          declarations: semantics.declarations,
          selectors: semantics.selectors,
          variants: semantics.variants,
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
  messageId: 'items',
  identity: 'shell:shell:items',
  resultKind: 'plain',
  inputNames: Object.freeze(['count']),
  slotNames: Object.freeze([]),
} as MessageHandle;

function renderUnder(target: string, count: number) {
  const context: FormattingContext = Object.freeze({ locale: target });
  const result = evaluateCandidate(
    HANDLE,
    findEvaluationCandidate(HANDLE, target, [sourceCatalog(COUNT)]),
    { count },
    context,
    new FormatterCache(8),
    new RuntimeExtensions(),
  );
  if (result.kind !== 'text') throw new Error('Expected a plain text result.');
  return result;
}

describe('a variant of a message supplied by a fallback catalog', () => {
  it("chooses its variant by the supplying catalog's plural rules", () => {
    const result = renderUnder('fr-FR', 0);
    expect(result.fallback).toBe(true);
    expect(result.supplyingLocale).toBe('en');
    // English reads zero as `other`; French would read it as `one`.
    expect(result.value).toBe('many items: 0');
  });
});
