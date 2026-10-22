import { describe, expect, it } from 'vitest';

import { parseMessageSemanticModel } from '../src/message-format.js';
import { RESOURCE_LIMITS } from '../src/resource-limits.js';

/**
 * The size at which a message is refused before it is parsed.
 *
 * The ceiling is a number of bytes in UTF-8, which is how a catalog stores the message. A message
 * of exactly that many bytes is the largest one accepted, and a message with fewer characters than
 * the ceiling is still refused when its characters take more bytes than it.
 */

const path = ['messages', 'long'];

describe('the byte ceiling of a message', () => {
  it('admits a message of exactly the ceiling', () => {
    const result = parseMessageSemanticModel(
      'x'.repeat(RESOURCE_LIMITS.messageBytes),
      { path },
    );

    expect(result.ok).toBe(true);
  });

  it('refuses a message one byte over the ceiling', () => {
    const result = parseMessageSemanticModel(
      'x'.repeat(RESOURCE_LIMITS.messageBytes + 1),
      { path },
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['EQ1201']);
  });

  it('refuses a message under the ceiling in characters and over it in bytes', () => {
    // Two bytes to a character, so three quarters of the ceiling in characters is one and a half
    // times the ceiling in bytes.
    const source = 'é'.repeat((RESOURCE_LIMITS.messageBytes / 4) * 3);
    const result = parseMessageSemanticModel(source, { path });

    expect(source.length).toBeLessThan(RESOURCE_LIMITS.messageBytes);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.map(({ code, path: at }) => ({ code, path: at })),
    ).toEqual([{ code: 'EQ1201', path }]);
  });

  it('refuses a source that is not text', () => {
    const result = parseMessageSemanticModel(42, { path });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['EQ1201']);
  });
});
