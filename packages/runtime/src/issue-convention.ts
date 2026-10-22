import { GENERATED_ABI, type PlainMessageHandle } from '@neolorn/equator/core';

/**
 * How a backend failure code names its message.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 9 requires the pairing to work with
 * nothing written per code, because a mapping line per code is a line every new code needs and
 * eventually does not get, and what the reader sees then is a generic apology instead of what
 * went wrong.
 *
 * The transformation is Equator's and is product-neutral: it knows nothing about any particular
 * error taxonomy, and encodes no consumer's vocabulary. It reads a code as a sequence of words
 * and writes them back as one lower-kebab identifier.
 *
 *   INSUFFICIENT_STOCK   -> insufficient-stock
 *   insufficientStock    -> insufficient-stock
 *   Payment.Declined     -> payment-declined
 *   step2Failed          -> step2-failed
 *
 * Word boundaries are every run of characters that is neither an ASCII letter nor an ASCII digit,
 * plus the position where a lowercase ASCII letter or a digit is followed by an uppercase ASCII
 * letter. That second rule is what makes `insufficientStock` and `INSUFFICIENT_STOCK` the same
 * message: a service that changes how it spells its codes should not orphan an application's
 * translations.
 *
 * Only ASCII letters and digits are read, because those are the characters a message identifier is
 * written in. Every other character separates words, a letter outside ASCII included, and a code
 * is read as it is given, with no Unicode normalization: an accented letter sent as one character
 * is a separator, and sent as a letter and a combining mark it is that letter and a separator.
 *
 * A code with nothing usable in it yields the empty string, and a code with a word that begins
 * with a digit, `ORDER_2_EXPIRED` as `order-2-expired`, yields an identifier no catalog can hold.
 * The caller treats both the way it treats any code no message answers.
 */
export function issueMessageId(code: string): string {
  const words: string[] = [];
  let current = '';
  let afterLowerOrDigit = false;
  for (const character of code) {
    const upper = character >= 'A' && character <= 'Z';
    const lower = character >= 'a' && character <= 'z';
    const digit = character >= '0' && character <= '9';
    if (!upper && !lower && !digit) {
      if (current.length > 0) words.push(current);
      current = '';
      afterLowerOrDigit = false;
      continue;
    }
    const boundary = upper && afterLowerOrDigit;
    if (boundary) {
      words.push(current);
      current = '';
    }
    current += upper ? character.toLowerCase() : character;
    afterLowerOrDigit = !upper;
  }
  if (current.length > 0) words.push(current);
  return words.join('-');
}

/**
 * The generated member name for a message id.
 *
 * Generation turns `insufficient-stock` into the property `insufficientStock`, so the convention
 * has to make the same turn to find it. Kept beside the id derivation rather than inferred at the
 * call site, because the two only work if they agree.
 */
function memberName(messageId: string): string {
  return messageId
    .split('-')
    .map((word, index) =>
      index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join('');
}

function isPlainHandle(value: unknown): value is PlainMessageHandle {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['generatedAbi'] === GENERATED_ABI &&
    candidate['resultKind'] === 'plain' &&
    typeof candidate['identity'] === 'string'
  );
}

/**
 * The message a code names, if the group holds one.
 *
 * The handle found by name is accepted only if its own identity ends in the derived id. A group
 * is an ordinary object and an application can pass the wrong one; without that check a code
 * could quietly render a message about something else, which is worse than rendering the generic
 * one, because nothing about it looks wrong.
 */
export function issueMessage(
  messages: Readonly<Record<string, unknown>>,
  code: string,
): PlainMessageHandle | undefined {
  const messageId = issueMessageId(code);
  if (messageId.length === 0) return undefined;
  const candidate = Object.prototype.hasOwnProperty.call(
    messages,
    memberName(messageId),
  )
    ? messages[memberName(messageId)]
    : undefined;
  if (!isPlainHandle(candidate)) return undefined;
  const identity = candidate.identity;
  return identity === messageId || identity.endsWith(`.${messageId}`)
    ? candidate
    : undefined;
}
