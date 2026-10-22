import { describe, expect, it } from 'vitest';

import type {
  FormattingAdapterOutput,
  FormattingContext,
  LocalizedInputResult,
  RuntimeFormattingAdapterBinding,
  RuntimeFormattingAdapterDescriptor,
  RuntimeParsingAdapterBinding,
  RuntimeParsingAdapterDescriptor,
} from '@neolorn/equator/core';
import { defineExtensionRegistry } from '../../toolkit/src/extensions.js';
import { RuntimeExtensions } from '../src/extensions.js';
import { FormattingSurface } from '../src/formatting-runtime.js';

/**
 * What a formatting or parsing adapter can hand back, and what the runtime does with each.
 *
 * An adapter is consumer code, so every way it can go wrong has to arrive as a typed refusal rather
 * than as text on the page or as an exception in the caller. Each refusal below is paired with the
 * well-behaved adapter it departs from, so a runtime that refused everything would fail the
 * controls.
 */

const CONTEXT: FormattingContext = Object.freeze({ locale: 'en-US' });
const MAXIMUM = 16;

/** Built through the compiler's registry, because the runtime checks the fingerprint it derives. */
const registry = defineExtensionRegistry([
  {
    kind: 'formatting-adapter',
    id: 'test:code',
    inputType: 'test:code',
    result: 'text',
    maximumOutputLength: MAXIMUM,
  },
  {
    kind: 'parsing-adapter',
    id: 'test:code-parse',
    outputType: 'test:code',
    maximumInputLength: MAXIMUM,
  },
]);
if (!registry.ok) {
  throw new Error(
    `the descriptors under test were refused: ${registry.diagnostics
      .map(({ summary }) => summary)
      .join('; ')}`,
  );
}
const [FORMAT, PARSE] = registry.value.descriptors as unknown as readonly [
  RuntimeFormattingAdapterDescriptor,
  RuntimeParsingAdapterDescriptor,
];

const formatter = (
  format: (value: string) => unknown,
): RuntimeFormattingAdapterBinding<string> =>
  Object.freeze<RuntimeFormattingAdapterBinding<string>>({
    descriptor: FORMAT,
    format: ({ value }) => format(value) as FormattingAdapterOutput,
  });

const parser = (
  parse: (text: string) => unknown,
): RuntimeParsingAdapterBinding<string> =>
  Object.freeze<RuntimeParsingAdapterBinding<string>>({
    descriptor: PARSE,
    parse: ({ text }) => parse(text) as LocalizedInputResult<string>,
  });

const surfaceWith = (
  ...bindings: readonly (
    | RuntimeFormattingAdapterBinding<string>
    | RuntimeParsingAdapterBinding<string>
  )[]
): FormattingSurface =>
  new FormattingSurface({
    snapshot: () => CONTEXT,
    clock: undefined,
    relativeTimePolicy: undefined,
    personNames: undefined,
    extensions: new RuntimeExtensions(bindings as never),
  });

const WELL_BEHAVED = formatter((value) => ({ text: `#${value}` }));
const REFUSED = {
  ok: false,
  diagnostic: { code: 'unsupported-formatting-capability' },
};

describe('a formatting adapter', () => {
  it('formats through the binding the context installed', () => {
    expect(
      surfaceWith(WELL_BEHAVED).formatWithAdapter(WELL_BEHAVED, 'a1'),
    ).toMatchObject({ ok: true, value: { text: '#a1' } });
  });

  it('is refused when the context did not install it', () => {
    expect(surfaceWith().formatWithAdapter(WELL_BEHAVED, 'a1')).toMatchObject(
      REFUSED,
    );
  });

  it("is run as the calling context's binding, not as the one passed", () => {
    // Another context's binding under the same identity: the caller's copy is never invoked.
    const foreign = formatter((value) => ({ text: `foreign ${value}` }));
    expect(
      surfaceWith(WELL_BEHAVED).formatWithAdapter(foreign, 'a1'),
    ).toMatchObject({ ok: true, value: { text: '#a1' } });
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('adapter failure');
      },
    ],
    ['answers later', () => Promise.resolve({ text: 'late' })],
    // A thenable carrying text reads as a result to every check but the one for asynchrony.
    [
      'answers with a thenable',
      () => ({ text: 'late', then: () => undefined }),
    ],
    ['returns no text', () => ({ value: 'x' })],
    ['returns something other than a record', () => 'bare text'],
    ['returns parts from a text adapter', () => ({ text: 'x', parts: [] })],
    ['writes past its bound', () => ({ text: 'x'.repeat(MAXIMUM + 1) })],
  ])('is refused when it %s', (_label, format) => {
    const adapter = formatter(format);
    let result: unknown;
    // A refusal the caller has to catch is not a typed result, so throwing fails here too.
    expect(() => {
      result = surfaceWith(adapter).formatWithAdapter(adapter, 'a1');
    }).not.toThrow();
    expect(result).toMatchObject(REFUSED);
  });

  it('writes up to its bound', () => {
    const adapter = formatter(() => ({ text: 'x'.repeat(MAXIMUM) }));
    expect(surfaceWith(adapter).formatWithAdapter(adapter, 'a1')).toMatchObject(
      { ok: true },
    );
  });
});

describe('a parsing adapter', () => {
  const WELL_PARSED = parser((text) => ({
    status: 'valid',
    text,
    value: text.toUpperCase(),
  }));

  it('returns the value the adapter produced', () => {
    expect(
      surfaceWith(WELL_PARSED).parseWithAdapter(WELL_PARSED, 'a1'),
    ).toStrictEqual({ status: 'valid', text: 'a1', value: 'A1' });
  });

  it('is refused when the context did not install it', () => {
    expect(surfaceWith().parseWithAdapter(WELL_PARSED, 'a1')).toMatchObject({
      status: 'unsupported-capability',
    });
  });

  it('is not invoked for input past its bound', () => {
    let invoked = false;
    const adapter = parser((text) => {
      invoked = true;
      return { status: 'valid', text, value: text };
    });
    expect(
      surfaceWith(adapter).parseWithAdapter(adapter, 'x'.repeat(MAXIMUM + 1)),
    ).toMatchObject({ status: 'out-of-range' });
    expect(invoked).toBe(false);
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('adapter failure');
      },
    ],
    ['answers later', () => Promise.resolve({ status: 'valid', text: 'a1' })],
    // Otherwise well formed, diagnostic included, so the status is the only thing wrong with it.
    [
      'reports a status outside the result model',
      () => ({
        status: 'maybe',
        text: 'a1',
        diagnostic: { message: 'The code is not known.' },
      }),
    ],
    ['reports valid without a value', () => ({ status: 'valid', text: 'a1' })],
  ])('is refused as invalid when it %s', (_label, parse) => {
    const adapter = parser(parse);
    let result: unknown;
    expect(() => {
      result = surfaceWith(adapter).parseWithAdapter(adapter, 'a1');
    }).not.toThrow();
    expect(result).toMatchObject({ status: 'invalid' });
    expect(Object.hasOwn(result as object, 'value')).toBe(false);
  });
});
