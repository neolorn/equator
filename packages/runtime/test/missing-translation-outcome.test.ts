import { describe, expect, it } from 'vitest';

import { parseMessageSemanticModel } from '../../toolkit/src/message-format.js';
import type { CompiledCatalog } from '../src/catalog-runtime.js';
import {
  FormatterCache,
  evaluateCandidate,
  findEvaluationCandidate,
} from '../src/evaluator.js';
import { RuntimeExtensions } from '../src/extensions.js';
import type { MessageHandle } from '@neolorn/equator/core';

/**
 * A translation missing from one locale is not a page missing from the application.
 *
 * Section 5 of `specs/07-routing-rendering-and-seo.spec.md` keeps the outcome classes apart and
 * forbids turning the first into the second. The page is still there and still says what it says
 * in the source; what is missing is one locale's copy of one sentence, and a render that refused
 * the message would leave the page with nothing to draw where a reader expects the entity.
 */

function patternOf(source: string) {
  const parsed = parseMessageSemanticModel(source);
  if (!parsed.ok || parsed.value.kind !== 'pattern') {
    throw new Error(`The message under test did not parse: ${source}`);
  }
  return {
    kind: 'pattern',
    declarations: parsed.value.declarations,
    pattern: parsed.value.pattern,
  };
}

function catalogFor(
  locale: string,
  messages: Readonly<Record<string, string>>,
): CompiledCatalog {
  const resources = {
    irNodes: 1,
    depth: 1,
    selectors: 0,
    variants: 0,
    inputs: 0,
    slots: 0,
    outputParts: 8,
  };
  return {
    profile: 'equator-compiled-ir/1',
    generatedAbi: 'equator-generated/1',
    standardsProfile: 'equator-1',
    key: { providerId: 'home', scopeId: 'article', catalogLocale: locale },
    applicationContractFingerprint: 'test',
    semanticRegistryFingerprint: 'test',
    requiredExtensions: Object.freeze([]),
    messages: Object.freeze(
      Object.entries(messages).map(([messageId, text]) => ({
        messageId,
        kind: 'message' as const,
        resultKind: 'plain' as const,
        sourceFingerprint: 'test',
        inputs: Object.freeze([]),
        slots: Object.freeze([]),
        body: patternOf(text),
      })),
    ),
    resources: { ...resources, maximumMessage: resources },
  } as unknown as CompiledCatalog;
}

const HANDLE = {
  generatedAbi: 'equator-generated/1',
  providerId: 'home',
  scopeId: 'article',
  messageId: 'article.byline',
  identity: 'home:article:article.byline',
  resultKind: 'plain',
  inputNames: Object.freeze([]),
  slotNames: Object.freeze([]),
} as MessageHandle;

// The Arabic catalog carries the page's heading and not its byline, which is the ordinary state of
// a catalog a translator has not finished.
const CATALOGS = [
  catalogFor('ar-EG', { 'article.heading': 'المقال' }),
  catalogFor('en-US', {
    'article.heading': 'The article',
    'article.byline': 'By the editors',
  }),
];

describe('a message the requested locale has no translation for', () => {
  it('renders from the source and names the miss as a missing translation', () => {
    const evaluate = () =>
      evaluateCandidate(
        HANDLE,
        findEvaluationCandidate(HANDLE, 'ar-EG', CATALOGS),
        {},
        Object.freeze({ locale: 'ar-EG' }),
        new FormatterCache(8),
        new RuntimeExtensions([]),
      );

    expect(evaluate).not.toThrow();
    const result = evaluate();

    expect(result).toMatchObject({
      kind: 'text',
      value: 'By the editors',
      targetLocale: 'ar-EG',
      supplyingLocale: 'en-US',
      fallback: true,
    });
    expect(
      result.diagnostics.map(({ code, outcome }) => ({ code, outcome })),
    ).toStrictEqual([
      {
        code: 'message-unavailable',
        outcome: 'localized-representation-unavailable',
      },
    ]);
  });
});
