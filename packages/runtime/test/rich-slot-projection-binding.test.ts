/**
 * The text projection a custom rich-slot kind's trusted binding supplies.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8: every rich contract has a
 * deterministic safe text projection, and a standalone kind, which has no children to fall back
 * on, has to provide its own. The runtime takes that projection only from the binding, so a
 * binding without one is refused when the extensions are assembled, and one that answers with
 * something other than text is refused when a message is projected.
 */
import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  type LocalizedPart,
  type LocalizedSlotPart,
  type RuntimeRichSlotKindDescriptor,
} from '@neolorn/equator/core';
import { defineExtensionRegistry } from '../../toolkit/src/extensions.js';
import { projectLocalizedParts } from '../src/evaluator.js';
import { RuntimeExtensions } from '../src/extensions.js';

const MARKER = (() => {
  const registry = defineExtensionRegistry([
    {
      kind: 'rich-slot-kind',
      id: 'feature:marker',
      shape: 'standalone',
      interactive: false,
      textProjection: 'binding-required',
    },
  ]);
  if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
  return registry.value
    .descriptors[0] as unknown as RuntimeRichSlotKindDescriptor;
})();

const PARTS: readonly LocalizedPart[] = Object.freeze([
  Object.freeze({
    kind: 'text',
    value: 'Step ',
    language: 'en',
    direction: 'ltr',
    supplyingLocale: 'en-US',
  }),
  Object.freeze({
    kind: 'slot',
    name: 'marker',
    slotKind: 'feature:marker',
    shape: 'standalone',
    options: Object.freeze({}),
    children: Object.freeze([]),
    language: 'en',
    direction: 'ltr',
    supplyingLocale: 'en-US',
  }),
] as unknown as readonly LocalizedPart[]);

function refusal(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return error instanceof LocalizationError ? error.diagnostic : error;
  }
}

describe('a custom rich-slot kind binding', () => {
  it('supplies the same projection every time a message is projected', () => {
    const extensions = new RuntimeExtensions([
      Object.freeze({
        descriptor: MARKER,
        projectText: (part: LocalizedSlotPart) => `[${part.name}]`,
      }),
    ]);

    const first = projectLocalizedParts(PARTS, extensions);
    expect(first).toBe('Step [marker]');
    expect(projectLocalizedParts(PARTS, extensions)).toBe(first);
  });

  it('is refused without a projection', () => {
    expect(
      refusal(
        () =>
          new RuntimeExtensions([
            Object.freeze({ descriptor: MARKER }),
          ] as never),
      ),
    ).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
  });

  it('is refused when its projection answers with something other than text', () => {
    const extensions = new RuntimeExtensions([
      Object.freeze({
        descriptor: MARKER,
        projectText: () => 42 as unknown as string,
      }),
    ]);

    expect(
      refusal(() => projectLocalizedParts(PARTS, extensions)),
    ).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
  });
});
