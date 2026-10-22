/**
 * The refusal a date function raises when nothing gives it a time zone.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4 has a date formatted in the time zone
 * the expression names, and otherwise in the one the formatting context carries. With neither, the
 * function refuses before it asks the platform anything, so the refusal has no platform rejection
 * behind it: no reason that blames the platform, and no error underneath the evaluator's own.
 */
import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import {
  expression,
  patternBody,
  refusalOf,
  renderArtifact,
  variable,
} from './compiled-artifact-harness.js';

const WHEN: readonly CompiledInputContract[] = [
  { name: 'when', type: 'date-time', optional: false, nullable: false },
];

describe('a date function given no time zone', () => {
  it.each(['date', 'time', 'datetime'])(
    'refuses under :%s with nothing from the platform behind it',
    (name) => {
      const failure = refusalOf(() =>
        renderArtifact(
          {
            body: patternBody([
              expression(variable('when'), { name, options: {} }),
            ]),
            inputs: WHEN,
          },
          { when: new Date(Date.UTC(2024, 0, 2, 15, 4)) },
        ),
      );

      expect(failure.diagnostic).toMatchObject({
        code: 'unsupported-formatting-capability',
        outcome: 'operational-failure',
      });
      expect(Object.keys(failure.diagnostic)).not.toContain('reason');
      // The evaluator names the message on the refusal it raised, and that one wraps nothing.
      const raised: unknown = failure.cause;
      expect(raised).toBeInstanceOf(LocalizationError);
      expect(
        Object.keys(Object.getOwnPropertyDescriptors(raised)),
      ).not.toContain('cause');
    },
  );
});
