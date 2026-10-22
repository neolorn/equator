/**
 * The value of a declaration in a compiled message, read by its kind.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` treats a compiled catalog as data that is
 * checked where it is read. A declaration binds a name to an expression, and a node that carries
 * an operand the way an expression does and states another kind is not one, so the message is
 * refused and not evaluated as though the kind had not been written.
 */
import { describe, expect, it } from 'vitest';

import {
  expression,
  literal,
  local,
  patternBody,
  refusalOf,
  renderArtifact,
} from './compiled-artifact-harness.js';

const declaring = (value: unknown): string =>
  renderArtifact({ body: patternBody(['printed'], [local('n', value)]) });

describe('a declaration of a compiled message', () => {
  it('is evaluated when its value is an expression', () => {
    expect(declaring(expression(literal('1')))).toBe('printed');
  });

  it.each(['literal', 'markup', 'Expression'])(
    'is refused when its value has the shape of an expression and states the kind %s',
    (kind) => {
      const refused = refusalOf(() =>
        declaring({ ...(expression(literal('1')) as object), kind }),
      );

      expect(refused.diagnostic.code).toBe('invalid-rich-message');
    },
  );
});
