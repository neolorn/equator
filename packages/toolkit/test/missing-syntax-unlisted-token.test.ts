import { describe, expect, it } from 'vitest';

import { parseMessageSemanticModel } from '../src/message-format.js';

/**
 * A message that stops where the syntax wanted a token Equator has no sentence of its own for.
 *
 * The parser says which token it wanted, and for most of them Equator says what the token is for.
 * Two it can want have no such sentence: the brace that closes an expression after a trailing
 * space, and the `$` that starts the name a `.local` declares. The refusal then names the token
 * itself, at the place it was wanted, so the author is still told what to type.
 */

function refusal(source: string) {
  const parsed = parseMessageSemanticModel(source);
  expect(parsed.ok).toBe(false);
  expect(parsed.diagnostics).toHaveLength(1);
  return parsed.diagnostics[0];
}

describe('a message missing a token with no sentence of its own', () => {
  it('names the closing brace an expression stops short of', () => {
    const source = '{$count :number ';
    const diagnostic = refusal(source);

    expect(diagnostic?.code).toBe('EQ1201');
    expect(diagnostic?.summary).toContain('}');
    expect(diagnostic?.summary).not.toContain('$');
  });

  it('names the $ a .local declaration writes its name without', () => {
    const diagnostic = refusal('.local count = {1} {{One}}');

    expect(diagnostic?.code).toBe('EQ1201');
    expect(diagnostic?.summary).toContain('$');
    expect(diagnostic?.summary).not.toContain('}');
  });
});
