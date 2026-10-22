import { describe, expect, it } from 'vitest';

import { parseMessageSemanticModel } from '../src/message-format.js';

/**
 * The order in which a message's unsupported functions are reported.
 *
 * Each function outside the profile gets a refusal of its own, and the refusals are told apart only
 * by the function each one names. Reported in the order the message calls them, the list would
 * change when a translator moved a placeholder, so they are reported by code point.
 */

function refusedFunctions(source: string): readonly string[] {
  const path = ['messages', 'greeting'];
  const result = parseMessageSemanticModel(source, { path });
  expect(result.ok).toBe(false);
  expect(
    result.diagnostics.map(({ code, path: at }) => ({ code, path: at })),
  ).toEqual([
    { code: 'EQ1203', path },
    { code: 'EQ1203', path },
  ]);
  return result.diagnostics.map(({ summary }) =>
    summary.includes(':demo:apple')
      ? 'demo:apple'
      : summary.includes(':demo:zebra')
        ? 'demo:zebra'
        : 'neither',
  );
}

describe('two functions outside the profile in one message', () => {
  it('are reported by code point when the later one is called first', () => {
    expect(refusedFunctions('{$a :demo:zebra} {$b :demo:apple}')).toEqual([
      'demo:apple',
      'demo:zebra',
    ]);
  });

  it('are reported in the same order when the message calls them the other way round', () => {
    expect(refusedFunctions('{$a :demo:apple} {$b :demo:zebra}')).toEqual([
      'demo:apple',
      'demo:zebra',
    ]);
  });
});
