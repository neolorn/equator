import { describe, expect, it } from 'vitest';

import {
  parseMessageSemanticModel,
  type MessageCustomFunction,
} from '../src/message-format.js';

/**
 * `timeZone=input` written on an extension function.
 *
 * The value `input` names the time zone of the operand, and it is defined for the three built-in
 * date functions. An extension that declares an option spelled `timeZone` receives the text it was
 * written with, so its resolved value carries `input` and not a zone. A date function that then
 * asks its operand for a zone finds none, and the message is refused where it is written.
 */

const zoned: MessageCustomFunction = {
  name: 'demo:zoned',
  selects: false,
  operandType: 'date-time',
  resultType: 'date-time',
  options: ['timeZone'],
};

const message = (annotation: string): string =>
  [
    '.input {$when :datetime timeZone=|Europe/Paris|}',
    `.local $again = {$when ${annotation} timeZone=input}`,
    '{{{$again :time timeZone=input}}}',
  ].join('\n');

describe('a date function asking an operand for its time zone', () => {
  it('is refused when the operand was annotated by an extension that wrote input', () => {
    const result = parseMessageSemanticModel(message(':demo:zoned'), {
      customFunctions: [zoned],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['EQ1204']);
  });

  it('is answered when the operand was annotated by a built-in date function that wrote input', () => {
    // The control: the same message with the built-in in the extension's place, which resolves
    // input against the zone written on the declaration above it.
    const result = parseMessageSemanticModel(message(':datetime'), {
      customFunctions: [zoned],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
