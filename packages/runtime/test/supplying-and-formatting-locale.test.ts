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
 * A target locale without a catalog of its own, answered by the English source. The words are the
 * English catalog's; the number the reader supplied is the reader's, in the target locale's digits,
 * which for Egyptian Arabic are Arabic-Indic. Which variant carries it is
 * `fallback-plural-selection.test.ts`'s subject.
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

describe('a message supplied by a fallback catalog', () => {
  it("writes the reader's value in the target locale's digits", () => {
    const result = renderUnder('ar-EG', 3);
    expect(result.fallback).toBe(true);
    expect(result.value).toContain('many items: ');
    expect(result.value).toContain('٣');
    expect(result.value).not.toContain('3');
  });
});
