import { describe, expect, it } from 'vitest';

import type {
  FormattingContext,
  LocalizedParts,
  MessageHandle,
} from '@neolorn/equator/core';
import { parseMessageSemanticModel } from '../../toolkit/src/message-format.js';
import type { CompiledCatalog } from '../src/catalog-runtime.js';
import {
  FormatterCache,
  evaluateCandidate,
  findEvaluationCandidate,
} from '../src/evaluator.js';
import { RuntimeExtensions } from '../src/extensions.js';

/**
 * The plain text a structured message projects to.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 3: every rich contract projects to plain text,
 * and the projection keeps the localized text, the formatted values and the children of a
 * container slot, and carries no destination, handler or binding data. The projection is what a
 * notification, a title or a screen reader receives in place of the rendered parts, so a slot
 * whose children fell out of it is a sentence with its words missing, and a slot whose options
 * leaked into it is a catalog writing into text the application presents as its own.
 *
 * Built-in slots are used here because they carry no registry projection: the text is the
 * evaluator's own, which is the rule under test.
 */

function catalogFor(
  source: string,
  slots: readonly { name: string; kind: string }[],
): CompiledCatalog {
  const parsed = parseMessageSemanticModel(source);
  if (!parsed.ok) {
    throw new Error(
      `The message under test did not parse: ${parsed.diagnostics
        .map(({ summary }) => summary)
        .join('; ')}`,
    );
  }
  const semantics = parsed.value;
  if (semantics.kind !== 'pattern') throw new Error('Expected a pattern.');
  const resources = {
    irNodes: 1,
    depth: 1,
    selectors: 0,
    variants: 0,
    inputs: 1,
    slots: slots.length,
    outputParts: 64,
  };
  return {
    profile: 'equator-compiled-ir/1',
    generatedAbi: 'equator-generated/1',
    standardsProfile: 'equator-1',
    key: { providerId: 'slot', scopeId: 'slot', catalogLocale: 'en-US' },
    applicationContractFingerprint: 'test',
    semanticRegistryFingerprint: 'test',
    requiredExtensions: Object.freeze([]),
    messages: Object.freeze([
      {
        messageId: 'subject',
        kind: 'message' as const,
        resultKind: 'structured' as const,
        sourceFingerprint: 'test',
        inputs: Object.freeze([
          { name: 'n', type: 'number', optional: false, nullable: false },
        ]),
        slots: Object.freeze(
          slots.map(({ name, kind }) => ({
            name,
            kind,
            shape: 'paired' as const,
            optional: false,
            repeatable: false,
            within: Object.freeze([]),
          })),
        ),
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

function evaluateParts(
  source: string,
  slots: readonly { name: string; kind: string }[],
): LocalizedParts {
  const handle = {
    generatedAbi: 'equator-generated/1',
    providerId: 'slot',
    scopeId: 'slot',
    messageId: 'subject',
    identity: 'slot:slot:subject',
    resultKind: 'structured',
    inputNames: Object.freeze(['n']),
    slotNames: Object.freeze(slots.map(({ name }) => name)),
  } as MessageHandle;
  const context: FormattingContext = Object.freeze({ locale: 'en-US' });
  const result = evaluateCandidate(
    handle,
    findEvaluationCandidate(handle, 'en-US', [catalogFor(source, slots)]),
    { n: 1234.5 },
    context,
    new FormatterCache(8),
    new RuntimeExtensions(),
  );
  if (result.kind !== 'parts') throw new Error('Expected a structured result.');
  return result;
}

describe('the text projection of a structured message', () => {
  it('keeps the children of a container slot, formatted values included', () => {
    const parts = evaluateParts('Paid {#strong}total {$n :number}{/strong}.', [
      { name: 'strong', kind: 'strong' },
    ]);

    expect(parts.text).toBe('Paid total 1,234.5.');
  });

  it('carries no option a catalog wrote on a link slot', () => {
    // The destination is the binding's, and the binding is not part of the projection. What a
    // catalog writes on the slot is not a destination either, and it stays out of the text.
    const parts = evaluateParts(
      'Open {#link href=|https://attacker.invalid| target=|_blank|}help {$n :number}{/link}.',
      [{ name: 'link', kind: 'link' }],
    );

    expect(parts.text).toBe('Open help 1,234.5.');
    expect(parts.text).not.toContain('attacker');
  });
});
