import { describe, expect, it } from 'vitest';

import {
  parseMessageSemanticModel,
  type MessageCustomFunction,
} from '../src/message-format.js';

/**
 * A refusal that lists things says the same sentence whatever order it met them in.
 *
 * The list in a refusal comes from something with an order of its own: the options as an author
 * typed them, the extensions as a registry happened to hold them. A sentence that followed that
 * order would change when a translator reordered two options or an application registered an
 * extension earlier, and a build log that changes for no reason reads as a new finding.
 */

function refusal(
  source: string,
  code: string,
  customFunctions: readonly MessageCustomFunction[] = [],
): string {
  const result = parseMessageSemanticModel(source, { customFunctions });
  const summaries = result.diagnostics
    .filter((diagnostic) => diagnostic.code === code)
    .map(({ summary }) => summary);
  expect(summaries).toHaveLength(1);
  return summaries[0] as string;
}

const selector = (name: string): MessageCustomFunction => ({
  name,
  selects: true,
  operandType: 'string',
  resultType: 'string',
  options: [],
});

describe('a refusal that lists what it found', () => {
  it('names the options of a set that cannot be used together in one order', () => {
    const written = refusal(
      '{$n :number minimumFractionDigits=5 maximumFractionDigits=2}',
      'EQ1204',
    );
    const reordered = refusal(
      '{$n :number maximumFractionDigits=2 minimumFractionDigits=5}',
      'EQ1204',
    );

    expect(written).toContain('minimumFractionDigits=5');
    expect(written).toContain('maximumFractionDigits=2');
    expect(reordered).toBe(written);
  });

  it('names the functions that select in one order, whatever order extensions were registered in', () => {
    const source = '.input {$when :datetime} .match $when * {{Later}}';
    const registered = refusal(source, 'EQ1206', [
      selector('demo:zone'),
      selector('demo:area'),
    ]);
    const reordered = refusal(source, 'EQ1206', [
      selector('demo:area'),
      selector('demo:zone'),
    ]);

    expect(registered).toContain(':demo:area');
    expect(registered).toContain(':demo:zone');
    expect(reordered).toBe(registered);
  });
});
