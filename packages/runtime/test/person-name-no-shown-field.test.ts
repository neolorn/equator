/**
 * A person name none of whose supplied fields the selected pattern writes.
 *
 * The pattern's trimming leaves no token for it, so it is written as empty text with no parts, and
 * that is an answer, not a failure.
 */
import { expect, it } from 'vitest';

import { formatPersonName, personName } from '../src/formatting.js';

it('writes a name none of whose fields the pattern shows as empty text', () => {
  const name = personName('en', { credentials: 'PhD' });
  const empties: string[] = [];
  for (const length of ['long', 'medium', 'short'] as const) {
    for (const usage of ['referring', 'addressing', 'monogram'] as const) {
      for (const formality of ['formal', 'informal'] as const) {
        const result = formatPersonName(
          name,
          { locale: 'en' },
          { length, usage, formality },
        );
        expect(result.ok).toBe(true);
        if (result.ok && result.value.text === '') {
          empties.push(`${length}/${usage}/${formality}`);
          expect(result.value.parts).toStrictEqual([]);
        }
      }
    }
  }
  expect(empties.length).toBeGreaterThan(0);
});
