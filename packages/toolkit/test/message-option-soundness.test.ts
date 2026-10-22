import { describe, expect, it } from 'vitest';

import { parseMessageSemanticModel } from '../src/message-format.js';

/**
 * When the whole option set of an expression is judged as a set, and when it is not.
 *
 * Some option sets are refused only together: `roundingIncrement` beside the wrong fraction digits
 * is the case used here. That question is put to the pinned ECMA-402 rules with every option
 * present, so it is asked only when every option is known and each one is sound on its own. An
 * option already refused is reported once, for its own reason, and an option whose value arrives at
 * render time leaves the set unknown rather than wrong.
 */

function summaries(source: string): readonly string[] {
  const result = parseMessageSemanticModel(source);
  for (const { code } of result.diagnostics) expect(code).toBe('EQ1204');
  return result.diagnostics.map(({ summary }) => summary);
}

// Refused as a set: the increment needs equal fraction digits beside it.
const TOGETHER = /cannot be used together/u;

describe('the whole option set of a number expression', () => {
  it('is refused as a set when every option is a literal', () => {
    const reported = summaries('{$n :number roundingIncrement=5}');

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatch(TOGETHER);
  });

  it('is not judged when an option takes its value from a variable', () => {
    // What `$digits` holds decides whether the set is sound, and it is not known here.
    expect(
      summaries(
        '{$n :number roundingIncrement=5 minimumFractionDigits=$digits}',
      ),
    ).toEqual([]);
  });

  it('is still judged when the only variable is on an option the formatter never receives', () => {
    // `u:id` is not a formatting option. Writing it as a variable is refused for its own reason,
    // and it takes nothing away from what is known about the options the formatter does receive.
    const reported = summaries('{$n :number roundingIncrement=5 u:id=$id}');

    expect(reported).toHaveLength(2);
    expect(reported[0]).toContain('u:id');
    expect(reported[1]).toMatch(TOGETHER);
  });

  it('is not judged when one of its options was already refused alone', () => {
    // Both values would also be refused by the formatter. Each is reported once, by the rule that
    // names what is wrong with it.
    for (const source of [
      '{$n :number roundingIncrement=7}',
      '{$n :number minimumIntegerDigits=99}',
    ]) {
      const reported = summaries(source);
      expect(reported).toHaveLength(1);
      expect(reported[0]).not.toMatch(TOGETHER);
    }
  });

  it('is not judged when select would be inherited rather than written', () => {
    const reported = summaries(
      '.local $a = {$n :number select=exact} {{{$a :number roundingIncrement=5}}}',
    );

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('select');
    expect(reported[0]).not.toMatch(TOGETHER);
  });
});
