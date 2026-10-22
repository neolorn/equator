import { describe, expect, it } from 'vitest';

import { remapCaret } from '../forms/src/caret.js';

/**
 * A caret inside the text a reformat left alone keeps its distance from the start.
 *
 * `caret.test.ts` asks about reformats that change the text ahead of the caret. These are the ones
 * that change it behind: text appended or removed past the caret, where holding the distance from
 * the end would move a caret nothing near it had touched.
 */

describe('a caret in text the reformat did not touch', () => {
  it('stays where it was when text is appended after it', () => {
    expect(remapCaret('1234', 2, '1234.50')).toBe(2);
    expect('1234.50'.slice(0, 2)).toBe('12');
  });

  it('stays at the end of the old value when text is appended there', () => {
    // The last position the two values still agree on belongs to the start anchor: a suffix that
    // appears after the caret is ahead of it, not behind it.
    expect(remapCaret('1234', 4, '1234.50')).toBe(4);
  });

  it('stays where it was when text after it is removed', () => {
    expect(remapCaret('1234.50', 2, '1234')).toBe(2);
    expect(remapCaret('1234.50', 4, '1234')).toBe(4);
  });

  it('stays where it was when the value did not change', () => {
    for (const offset of [0, 1, 2, 3, 4]) {
      expect(remapCaret('1234', offset, '1234')).toBe(offset);
    }
  });

  it('starts at the front of a value that replaces an empty one', () => {
    expect(remapCaret('', 0, '1234')).toBe(0);
  });
});
