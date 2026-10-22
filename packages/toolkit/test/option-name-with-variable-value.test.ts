import { describe, expect, it } from 'vitest';

import { parseMessageSemanticModel } from '../src/message-format.js';

/**
 * An option name is judged whatever its value is.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` refuses an option name a function's
 * definition does not give it rather than dropping it. Whether the name belongs to the function
 * is known where it is written; only the value of an option can wait for render time.
 */

function refusals(source: string): readonly string[] {
  const result = parseMessageSemanticModel(source);
  for (const { code } of result.diagnostics) expect(code).toBe('EQ1204');
  return result.diagnostics.map(({ summary }) => summary);
}

describe('an option name the function does not define, with a variable as its value', () => {
  it('is refused on a string function, which takes no option', () => {
    const reported = refusals('{$s :string nosuch=$x}');

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('nosuch');
    expect(reported[0]).toContain(':string');
  });

  it('is refused on a number function', () => {
    const reported = refusals('{$n :number nosuch=$x}');

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('nosuch');
  });

  it('is refused once, as the same option with a literal value is', () => {
    expect(refusals('{$n :number nosuch=$x}')).toHaveLength(
      refusals('{$n :number nosuch=1}').length,
    );
  });

  it('leaves an option the function defines to its value at render time', () => {
    expect(refusals('{$n :number minimumFractionDigits=$digits}')).toEqual([]);
  });

  it('leaves a namespaced option to the rule for its namespace', () => {
    expect(refusals('{$n :number u:locale=$x}')).toEqual(
      refusals('{$n :number u:locale=en}'),
    );
  });
});
