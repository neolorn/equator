import { describe, expect, it } from 'vitest';

import { parseMessageSemanticModel } from '../src/message-format.js';

function summaries(source: string): readonly string[] {
  const parsed = parseMessageSemanticModel(source);
  expect(parsed.ok).toBe(false);
  return parsed.diagnostics
    .filter(({ code }) => code === 'EQ1204')
    .map(({ summary }) => summary);
}

// An expression takes the options its operand was declared with, so the formatter can refuse a
// value this expression never wrote. One option cannot fail "together" with nothing.
describe('a malformed calendar an expression takes from its operand', () => {
  it('is named on its own', () => {
    const reported = summaries(
      '.local $d = {$x :datetime calendar=|!!|}\n{{{$d :date}}}',
    );
    expect(reported.some((summary) => summary.includes('calendar'))).toBe(true);
    expect(
      reported.filter((summary) => summary.includes('cannot be used together')),
    ).toEqual([]);
  });

  it('is named when a good time zone is written beside it', () => {
    const reported = summaries(
      '.local $d = {$x :datetime calendar=|!!|}\n{{{$d :date timeZone=UTC}}}',
    );
    expect(
      reported.filter((summary) => summary.includes('cannot be used together')),
    ).toEqual([]);
  });
});
