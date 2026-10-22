import { signal } from '@angular/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GENERATED_ABI, type MessageHandle } from '@neolorn/equator/core';

import { PROVIDER, compileSet, scope } from './catalog-store-harness.js';
import { runtime, type Runtime } from './transaction-runtime-harness.js';

/**
 * The parts of a structured message as a signal: which signal a call gives back, and what it holds.
 *
 * A call with the same handle and the same inputs gives back the same signal, so a binding made in
 * a loop is one computation and not one per pass. "The same inputs" is the same object or the same
 * signal, since those are what a caller holds on to: two objects that happen to carry equal values
 * are two bindings. What the signal holds is what `parts` answers for that handle and those inputs
 * at the moment it is read, so it follows a signal of inputs and it follows the locale.
 */

const RICH = scope('rich');

interface StructuredHandle<Inputs> extends MessageHandle {
  readonly resultKind: 'structured';
  readonly __contract?: {
    readonly inputs: Inputs;
    readonly slots: 'b';
    readonly resultKind: 'structured';
  };
}

const structured = <Inputs>(
  messageId: string,
  inputNames: readonly string[],
): StructuredHandle<Inputs> =>
  Object.freeze({
    generatedAbi: GENERATED_ABI,
    providerId: PROVIDER,
    scopeId: RICH.scopeId,
    messageId,
    identity: `${PROVIDER}:${RICH.scopeId}:${messageId}`,
    resultKind: 'structured' as const,
    inputNames: Object.freeze([...inputNames]),
    slotNames: Object.freeze(['b']),
  });

const NOTICE = structured<Record<never, never>>('notice', []);
const NOTE = structured<{ readonly name: string }>('note', ['name']);
const BADGE = structured<Record<never, never>>('badge', []);

describe('the parts of a structured message as a signal', () => {
  let localization: Runtime;

  beforeAll(async () => {
    ({ localization } = runtime({
      set: compileSet(undefined, {
        rich: {
          'en-US':
            'messages:\n  notice: "{#b}Fixed{/b} notice"\n  badge: "{#b}New{/b}"\n  note: "Hello {#b}{$name}{/b}"\n',
          'ar-EG':
            'messages:\n  notice: "إشعار {#b}ثابت{/b}"\n  badge: "{#b}جديد{/b}"\n  note: "مرحبا {#b}{$name}{/b}"\n',
        },
      }),
      options: { bootstrapScopes: [RICH] },
    }));
    await localization.initialize();
  });

  afterAll(() => {
    localization.dispose();
  });

  it('holds what parts answers for a message with no inputs', () => {
    const parts = localization.partsSignal(NOTICE)();

    expect(parts).toStrictEqual(localization.parts(NOTICE));
    expect(parts.text).toBe('Fixed notice');
  });

  it('is the same signal for the same handle with no inputs', () => {
    expect(localization.partsSignal(NOTICE)).toBe(
      localization.partsSignal(NOTICE),
    );
  });

  it('is a signal of its own for each handle', () => {
    const notice = localization.partsSignal(NOTICE);
    const badge = localization.partsSignal(BADGE);

    expect(badge).not.toBe(notice);
    expect(badge().text).toBe('New');
    expect(notice().text).toBe('Fixed notice');
    expect(localization.partsSignal(BADGE)).toBe(badge);
  });

  it('holds what parts answers for the inputs it was given', () => {
    const inputs = { name: 'Ada' };

    expect(localization.partsSignal(NOTE, inputs)()).toStrictEqual(
      localization.parts(NOTE, inputs),
    );
    expect(localization.partsSignal(NOTE, inputs)().text).toBe('Hello Ada');
  });

  it('is the same signal for the same inputs object, and another for another object', () => {
    const ada = { name: 'Ada' };
    const grace = { name: 'Grace' };
    const first = localization.partsSignal(NOTE, ada);
    const second = localization.partsSignal(NOTE, grace);

    expect(localization.partsSignal(NOTE, ada)).toBe(first);
    expect(second).not.toBe(first);
    expect(first().text).toBe('Hello Ada');
    expect(second().text).toBe('Hello Grace');
    // Equal values in another object are another binding.
    expect(localization.partsSignal(NOTE, { name: 'Ada' })).not.toBe(first);
  });

  it('follows a signal of inputs', () => {
    const inputs = signal({ name: 'Ada' });
    const parts = localization.partsSignal(NOTE, inputs);

    expect(parts().text).toBe('Hello Ada');
    inputs.set({ name: 'Grace' });
    expect(parts()).toStrictEqual(localization.parts(NOTE, { name: 'Grace' }));
    expect(parts().text).toBe('Hello Grace');
  });

  it('is the same signal for the same signal of inputs, and another for another signal', () => {
    const ada = signal({ name: 'Ada' });
    const grace = signal({ name: 'Grace' });
    const first = localization.partsSignal(NOTE, ada);
    const second = localization.partsSignal(NOTE, grace);

    expect(localization.partsSignal(NOTE, ada)).toBe(first);
    expect(second).not.toBe(first);
    expect(first().text).toBe('Hello Ada');
    expect(second().text).toBe('Hello Grace');
  });

  it('keeps a call with inputs apart from a call with none on the same handle', () => {
    const bare = localization.partsSignal(NOTICE);
    const withInputs = localization.partsSignal(
      NOTICE,
      {} as unknown as undefined,
    );

    expect(withInputs).not.toBe(bare);
    expect(localization.partsSignal(NOTICE)).toBe(bare);
  });

  it('takes inputs given as null for a call with none', () => {
    expect(localization.partsSignal(NOTICE, null as unknown as undefined)).toBe(
      localization.partsSignal(NOTICE),
    );
  });

  it('follows the locale', async () => {
    const parts = localization.partsSignal(BADGE);
    expect(parts().text).toBe('New');

    await localization.changeLocale('ar-EG');

    expect(parts().text).toBe('جديد');
    expect(parts().direction).toBe('rtl');
  });
});
