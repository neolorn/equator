import { MessageSyntaxError } from 'messageformat';
import { describe, expect, it } from 'vitest';

import { syntaxErrorSentence } from '../src/message-format.js';

/**
 * The shape a parser message must have before its token is quoted.
 *
 * The sentence for a missing token is built from the parser's own message, which is the word
 * Missing, the token and the offset, and nothing else. A message that carries anything before
 * that or after it is not that shape, and it gets the general sentence, the one a message that
 * does not mention a token gets.
 */

function missingSyntax(message: string): MessageSyntaxError {
  // The span is one character wide, which is the width of the token the messages below name.
  const error = new MessageSyntaxError('missing-syntax', 3, 4);
  error.message = message;
  return error;
}

const general = syntaxErrorSentence(missingSyntax('something else'));

describe('the sentence for a missing token', () => {
  it('quotes the token when the message is exactly Missing, the token and the offset', () => {
    // The control: the shape the two cases below depart from is one that is read.
    expect(syntaxErrorSentence(missingSyntax('Missing { at 3'))).not.toBe(
      general,
    );
  });

  it('is the general sentence when text comes before Missing', () => {
    expect(syntaxErrorSentence(missingSyntax('Still Missing { at 3'))).toBe(
      general,
    );
  });

  it('is the general sentence when text comes after the offset', () => {
    expect(syntaxErrorSentence(missingSyntax('Missing { at 3, or later'))).toBe(
      general,
    );
  });
});
