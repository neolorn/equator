import { describe, expect, it } from 'vitest';

import { parseMessageSemanticModel } from '../src/message-format.js';

/**
 * Where a refused message says it was refused.
 *
 * A message is one value inside a catalog, so a refusal carries two locations: the path of the
 * entry that holds the message, and the characters inside the message the refusal is about. A
 * syntax refusal points at the characters the parser stopped on. A refusal of the message as a
 * whole, an unknown function or an option that cannot be honoured, covers all of it.
 */

const OPTIONS = {
  sourcePath: 'i18n/shell/en-US.yaml',
  path: ['messages', 'greeting'],
} as const;

interface Located {
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly span: readonly [number, number] | undefined;
  readonly sourcePath: string | undefined;
}

function refusals(source: string): readonly Located[] {
  const result = parseMessageSemanticModel(source, OPTIONS);
  expect(result.ok).toBe(false);
  return result.diagnostics.map(({ code, path, span }) => ({
    code,
    path,
    span: span === undefined ? undefined : [span.start.offset, span.end.offset],
    sourcePath: span?.sourcePath,
  }));
}

describe('a syntax refusal', () => {
  it('covers the characters the parser stopped on, inside a longer message', () => {
    // One character, with text on both sides of it.
    const source = 'Hello {$a b} tail';

    expect(refusals(source)).toEqual([
      {
        code: 'EQ1201',
        path: ['messages', 'greeting'],
        span: [10, 11],
        sourcePath: 'i18n/shell/en-US.yaml',
      },
    ]);
  });

  it('covers every character of a refusal that is wider than one', () => {
    // Everything after the quoted pattern is the mistake, not only its first character.
    const source = '{{a}} trailing';

    expect(refusals(source)).toEqual([
      {
        code: 'EQ1201',
        path: ['messages', 'greeting'],
        span: [6, source.length],
        sourcePath: 'i18n/shell/en-US.yaml',
      },
    ]);
  });

  it('stays inside the message when the parser stopped at its end', () => {
    const source = 'Hello {';

    expect(refusals(source)[0]?.span).toEqual([source.length, source.length]);
  });
});

describe('a refusal of the message as a whole', () => {
  it('places a function outside the profile at the entry, over the whole message', () => {
    const source = '{$n :nope}';

    expect(refusals(source)).toEqual([
      {
        code: 'EQ1203',
        path: ['messages', 'greeting'],
        span: [0, source.length],
        sourcePath: 'i18n/shell/en-US.yaml',
      },
    ]);
  });

  it('places an option that cannot be honoured at the entry, over the whole message', () => {
    const source = '{$n :number roundingIncrement=7}';

    expect(refusals(source)).toEqual([
      {
        code: 'EQ1204',
        path: ['messages', 'greeting'],
        span: [0, source.length],
        sourcePath: 'i18n/shell/en-US.yaml',
      },
    ]);
  });

  it('carries no path when the caller named no entry', () => {
    for (const source of ['{$n :nope}', '{$n :number roundingIncrement=7}']) {
      const result = parseMessageSemanticModel(source);
      expect(result.diagnostics.map(({ path }) => path)).toEqual([[]]);
    }
  });
});
