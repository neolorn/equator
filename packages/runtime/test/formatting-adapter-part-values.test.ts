import { describe, expect, it } from 'vitest';

import type {
  FormattingContext,
  RuntimeExtensionBinding,
  RuntimeExtensionDescriptor,
} from '@neolorn/equator/core';
import { defineExtensionRegistry } from '../../toolkit/src/extensions.js';
import { RuntimeExtensions } from '../src/extensions.js';
import { FormattingSurface } from '../src/formatting-runtime.js';

/**
 * The value of a part a parts adapter hands back.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 7 treats a malformed answer as a typed
 * refusal. A part's value is text, and a value of another type is refused even where the platform
 * would read it as the same text: a list of one letter is spelled as that letter and is as long as
 * one, so it lines up with the text exactly as the letter would.
 */

const CONTEXT: FormattingContext = Object.freeze({ locale: 'en-US' });
const PARTS_ID = 'test:rich';

/** Built through the compiler's registry, because the runtime checks the fingerprint it derives. */
const registry = defineExtensionRegistry([
  {
    kind: 'formatting-adapter',
    id: PARTS_ID,
    inputType: 'test:code',
    result: 'parts',
    maximumOutputLength: 8,
  },
]);
if (!registry.ok) throw new Error('the descriptor under test was refused');
const [DESCRIPTOR] = registry.value
  .descriptors as unknown as readonly RuntimeExtensionDescriptor[];

/** Formats `a1` through an installed parts adapter that answers with `output`. */
function formatted(output: unknown): unknown {
  const adapter = Object.freeze({
    descriptor: DESCRIPTOR,
    format: () => output,
  }) as unknown as RuntimeExtensionBinding;
  return new FormattingSurface({
    snapshot: () => CONTEXT,
    clock: undefined,
    relativeTimePolicy: undefined,
    personNames: undefined,
    extensions: new RuntimeExtensions([adapter]),
  }).formatWithAdapter(adapter as never, 'a1');
}

describe('a part whose value is not text', () => {
  it('is kept where the value is the text it stands for', () => {
    expect(
      formatted({ text: 'a', parts: [{ kind: 'literal', value: 'a' }] }),
    ).toMatchObject({
      ok: true,
      value: { text: 'a', parts: [{ kind: 'literal', value: 'a' }] },
    });
  });

  it.each([
    ['a list of the one letter', 'a', ['a']],
    ['a list of nothing, for empty text', '', []],
  ])('is refused where the value is %s', (_label, text, value) => {
    expect(
      formatted({ text, parts: [{ kind: 'literal', value }] }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: 'unsupported-formatting-capability' },
    });
  });
});
