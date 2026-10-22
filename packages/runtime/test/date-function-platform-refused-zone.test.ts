/**
 * The refusal a date function raises when the platform refuses the zone it was given.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4 has a date formatted in the time zone
 * the formatting context carries when the expression names none. A context can carry a zone the
 * platform has no rules for, and the platform then throws on the formatter itself. The refusal
 * that reaches the caller is the typed unsupported result section 4 gives a zone the host does not
 * read, it says the platform refused, and the platform's error is its cause.
 */
import { describe, expect, it } from 'vitest';

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

const NO_SUCH_ZONE = 'Not/A_Zone';

const rendered = (name: string, timeZone: string): string =>
  renderArtifact(
    {
      body: patternBody([expression(variable('when'), { name, options: {} })]),
      inputs: WHEN,
    },
    { when: new Date(Date.UTC(2024, 0, 2, 15, 4)) },
    undefined,
    { locale: 'en-US', timeZone },
  );

describe('a date function under a zone the platform refuses', () => {
  it('is under a zone the platform throws on', () => {
    expect(
      () => new Intl.DateTimeFormat('en-US', { timeZone: NO_SUCH_ZONE }),
    ).toThrow(RangeError);
  });

  it.each(['date', 'time', 'datetime'])(
    'formats under :%s in a zone the platform knows',
    (name) => {
      expect(rendered(name, 'UTC')).not.toBe('');
    },
  );

  it.each(['date', 'time', 'datetime'])(
    'refuses under :%s with the platform’s error behind it',
    (name) => {
      const failure = refusalOf(() => rendered(name, NO_SUCH_ZONE));

      expect(failure.diagnostic).toMatchObject({
        code: 'unsupported-formatting-capability',
        outcome: 'operational-failure',
        reason: 'native-capability-rejected',
      });
      expect(failure.cause).toBeInstanceOf(RangeError);
    },
  );

  it.each(['date', 'time', 'datetime'])(
    'refuses an hour cycle of the context the platform refuses under :%s as it refuses a zone',
    (name) => {
      const failure = refusalOf(() =>
        renderArtifact(
          {
            body: patternBody([
              expression(variable('when'), {
                name,
                options: {},
              }),
            ]),
            inputs: WHEN,
          },
          { when: new Date(Date.UTC(2024, 0, 2, 15, 4)) },
          undefined,
          { locale: 'en-US', timeZone: 'UTC', hourCycle: 'h99' as 'h23' },
        ),
      );

      expect(failure.diagnostic).toMatchObject({
        code: 'unsupported-formatting-capability',
        outcome: 'operational-failure',
        reason: 'native-capability-rejected',
      });
      expect(failure.cause).toBeInstanceOf(RangeError);
    },
  );
});
