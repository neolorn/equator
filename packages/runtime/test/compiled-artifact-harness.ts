import {
  LocalizationError,
  type FormattingContext,
  type LocalizedParts,
  type LocalizedText,
  type MessageHandle,
} from '@neolorn/equator/core';

import type {
  CompiledCatalog,
  CompiledInputContract,
  CompiledSlotContract,
} from '../src/catalog-runtime.js';
import {
  FormatterCache,
  evaluateCandidate,
  findEvaluationCandidate,
} from '../src/evaluator.js';
import { RuntimeExtensions } from '../src/extensions.js';

/**
 * One compiled message, assembled by hand and evaluated by the real evaluator.
 *
 * `message-harness.ts` parses a source and evaluates it as plain text in `en-US`, which is the
 * right tool wherever the parser can produce the message. This one exists for what the parser
 * refuses and what that harness fixes: a body no toolkit would emit, a structured result with its
 * slot contracts, and a catalog in another locale. The runtime's input is a compiled artifact and
 * it has no way to know what produced one, so the artifact is the thing to hand it.
 *
 * Only the catalog envelope is built here, because nothing in the envelope takes part in
 * evaluating a message.
 */
export interface ArtifactMessage {
  /** The compiled body, in the shape the evaluator reads and with nothing checked on the way. */
  readonly body: unknown;
  readonly inputs?: readonly CompiledInputContract[];
  readonly slots?: readonly CompiledSlotContract[];
  readonly resultKind?: 'plain' | 'structured';
  /** The catalog's locale, which is also the locale evaluated for. */
  readonly locale?: string;
}

export const literal = (value: unknown): unknown => ({
  kind: 'literal',
  value,
});

export const variable = (name: unknown): unknown => ({
  kind: 'variable',
  name,
});

export const expression = (
  operand?: unknown,
  annotation?: unknown,
): unknown => ({
  kind: 'expression',
  ...(operand === undefined ? {} : { operand }),
  ...(annotation === undefined ? {} : { function: annotation }),
  attributes: {},
});

export const local = (name: string, value: unknown): unknown => ({
  kind: 'local',
  name,
  value,
});

export const patternBody = (
  pattern: readonly unknown[],
  declarations: readonly unknown[] = [],
): unknown => ({ kind: 'pattern', declarations, pattern });

export function evaluateArtifact(
  message: ArtifactMessage,
  values: unknown = {},
  extensions: RuntimeExtensions = new RuntimeExtensions(),
  formatting?: FormattingContext,
): LocalizedText | LocalizedParts {
  const locale = message.locale ?? 'en-US';
  const inputs = message.inputs ?? [];
  const slots = message.slots ?? [];
  const resultKind = message.resultKind ?? 'plain';
  const resources = {
    irNodes: 1,
    depth: 1,
    selectors: 1,
    variants: 8,
    inputs: inputs.length,
    slots: slots.length,
    outputParts: 64,
  };
  const catalog = {
    profile: 'equator-compiled-ir/1',
    generatedAbi: 'equator-generated/1',
    standardsProfile: 'equator-1',
    key: { providerId: 'artifact', scopeId: 'artifact', catalogLocale: locale },
    applicationContractFingerprint: 'test',
    semanticRegistryFingerprint: 'test',
    requiredExtensions: Object.freeze([]),
    messages: Object.freeze([
      {
        messageId: 'subject',
        kind: 'message' as const,
        resultKind,
        sourceFingerprint: 'test',
        inputs: Object.freeze([...inputs]),
        slots: Object.freeze([...slots]),
        body: message.body,
      },
    ]),
    resources: { ...resources, maximumMessage: resources },
  } as unknown as CompiledCatalog;
  const handle = {
    generatedAbi: 'equator-generated/1',
    providerId: 'artifact',
    scopeId: 'artifact',
    messageId: 'subject',
    identity: 'artifact:artifact:subject',
    resultKind,
    inputNames: Object.freeze(inputs.map(({ name }) => name)),
    slotNames: Object.freeze(slots.map(({ name }) => name)),
  } as MessageHandle;
  return evaluateCandidate(
    handle,
    findEvaluationCandidate(handle, locale, [catalog]),
    values,
    formatting ?? Object.freeze({ locale }),
    new FormatterCache(8),
    extensions,
  );
}

/** The projected text of an artifact, whichever result kind it was evaluated as. */
export function renderArtifact(
  message: ArtifactMessage,
  values: unknown = {},
  extensions: RuntimeExtensions = new RuntimeExtensions(),
  formatting?: FormattingContext,
): string {
  const result = evaluateArtifact(message, values, extensions, formatting);
  return result.kind === 'text' ? result.value : result.text;
}

/**
 * The refusal `run` raises, for a case that asserts its code, reason or cause.
 *
 * Anything else thrown is rethrown as it is: a `TypeError` out of the evaluator is a defect, and a
 * case that only asked "did it throw" would count it as the refusal it was looking for.
 */
export function refusalOf(run: () => unknown): LocalizationError {
  try {
    run();
  } catch (error) {
    if (error instanceof LocalizationError) return error;
    throw error;
  }
  throw new Error('Expected a refusal and nothing was thrown.');
}
