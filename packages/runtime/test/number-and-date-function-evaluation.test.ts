import { describe, expect, it } from 'vitest';

import type { CompiledInputContract } from '../src/catalog-runtime.js';
import {
  expression,
  literal,
  patternBody,
  refusalOf,
  renderArtifact,
  variable,
} from './compiled-artifact-harness.js';
import { render } from './message-harness.js';

/**
 * What the number and date functions refuse before they format, and what a number selects on.
 *
 * LDML 48 Part 9 gives `:offset`, `:currency` and `:unit` each an option they cannot work
 * without, and gives the date functions an operand that has to be a date. The toolkit refuses a
 * message that leaves one out where it is written. The cases here hand the evaluator the compiled
 * form directly, because a compiled artifact is its input whatever produced it, and each asserts
 * the refusal is the evaluator's own: a refusal with no platform rejection behind it, raised
 * before anything was handed to `Intl`.
 */

const NUMBER: readonly CompiledInputContract[] = [
  { name: 'count', type: 'number', optional: false, nullable: false },
];
const WHEN: readonly CompiledInputContract[] = [
  { name: 'when', type: 'date-time', optional: false, nullable: false },
];

const annotated = (
  operand: unknown,
  name: string,
  options: Readonly<Record<string, unknown>> = {},
): unknown => expression(operand, { name, options });

describe('an option a number function cannot format without', () => {
  it.each([
    ['neither add nor subtract', {}],
    ['both add and subtract', { add: literal('1'), subtract: literal('1') }],
  ])('refuses :offset written with %s', (_label, options) => {
    const failure = refusalOf(() =>
      renderArtifact({
        body: patternBody([annotated(literal('41'), 'offset', options)]),
      }),
    );
    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
    expect(Object.keys(failure.diagnostic)).not.toContain('reason');
  });

  it.each(['currency', 'unit'])(
    'refuses :%s written without the identifier it formats in',
    (name) => {
      const failure = refusalOf(() =>
        renderArtifact({
          body: patternBody([annotated(literal('41'), name)]),
        }),
      );
      expect(failure.diagnostic.code).toBe('invalid-message-input');
      expect(failure.diagnostic.outcome).toBe('operational-failure');
      // The platform would reject the same call; the refusal is raised before it is asked.
      expect(Object.keys(failure.diagnostic)).not.toContain('reason');
    },
  );
});

describe('a numbering system the runtime has no data for', () => {
  const when = new Date(Date.UTC(2024, 0, 2, 15, 4));

  it.each([
    ['number', variable('count'), {}],
    ['datetime', variable('when'), { timeZone: literal('UTC') }],
  ])(
    'is refused by :%s as a capability the platform lacks',
    (name, operand, options) => {
      const failure = refusalOf(() =>
        renderArtifact(
          {
            body: patternBody([annotated(operand, name, options)]),
            inputs: [...NUMBER, ...WHEN],
          },
          { count: 3, when },
          undefined,
          { locale: 'en-US', numberingSystem: 'none-such' },
        ),
      );
      expect(failure.diagnostic.code).toBe('unsupported-formatting-capability');
      expect(failure.diagnostic.outcome).toBe('operational-failure');
      expect(failure.diagnostic.reason).toBe('native-capability-rejected');
    },
  );
});

/**
 * LDML 48 Part 9, "Number Selection": a numeric key is compared with the value and a keyword with
 * the plural category the `select` option names. `:percent` selects on the percentage it prints.
 */
describe('what a numeric selector matches', () => {
  const selecting = (annotation: string, keys: readonly string[]): string =>
    [
      `.input {$count ${annotation}}`,
      '.match $count',
      ...keys.map((key) => `${key} {{${key}}}`),
      '* {{none}}',
    ].join('\n');

  it('matches :percent against the percentage, by number and by category', () => {
    expect(render(selecting(':percent', ['50']), NUMBER, { count: 0.5 })).toBe(
      '50',
    );
    expect(render(selecting(':percent', ['0.5']), NUMBER, { count: 0.5 })).toBe(
      'none',
    );
    expect(
      render(selecting(':percent', ['one']), NUMBER, { count: 0.01 }),
    ).toBe('one');
  });

  it('matches no category under select=exact and still matches the number', () => {
    expect(
      render(selecting(':number select=exact', ['one']), NUMBER, { count: 1 }),
    ).toBe('none');
    expect(
      render(selecting(':number select=exact', ['1']), NUMBER, { count: 1 }),
    ).toBe('1');
  });

  it('matches the ordinal category under select=ordinal', () => {
    const source = selecting(':number select=ordinal', ['two', 'other']);
    expect(render(source, NUMBER, { count: 2 })).toBe('two');
    expect(render(source, NUMBER, { count: 4 })).toBe('other');
  });

  it('matches the cardinal category when select is not written', () => {
    const source = selecting(':number', ['two', 'other']);
    expect(render(source, NUMBER, { count: 2 })).toBe('other');
  });
});

describe('what a date function is given', () => {
  const when = new Date(Date.UTC(2024, 0, 2, 15, 4));

  it.each(['date', 'time', 'datetime'])(
    'refuses a literal that is not a date under :%s',
    (name) => {
      const failure = refusalOf(() =>
        renderArtifact({
          body: patternBody([
            annotated(literal('not a date'), name, {
              timeZone: literal('UTC'),
            }),
          ]),
        }),
      );
      expect(failure.diagnostic.code).toBe('invalid-message-input');
      expect(failure.diagnostic.outcome).toBe('operational-failure');
    },
  );

  it.each(['date', 'time', 'datetime'])(
    'refuses :%s when neither the message nor the context names a time zone',
    (name) => {
      const failure = refusalOf(() =>
        renderArtifact(
          {
            body: patternBody([annotated(variable('when'), name)]),
            inputs: WHEN,
          },
          { when },
        ),
      );
      expect(failure.diagnostic.code).toBe('unsupported-formatting-capability');
      expect(failure.diagnostic.outcome).toBe('operational-failure');
    },
  );

  it('takes the time zone from the context when the message names none', () => {
    expect(
      renderArtifact(
        {
          body: patternBody([annotated(variable('when'), 'time')]),
          inputs: WHEN,
        },
        { when },
        undefined,
        { locale: 'en-US', timeZone: 'Asia/Tokyo', hourCycle: 'h23' },
      ),
    ).toBe('00:04');
  });

  // The context's cycle is sent to the formatter beside the message's `hour12`, and ECMA-402's
  // CreateDateTimeFormat sets the cycle aside whenever `hour12` is given.
  it.each([
    ['a 24-hour context', 'h23', 'true', /^3:04\sPM$/u],
    ['a 12-hour context', 'h12', 'false', /^15:04$/u],
  ] as const)(
    'formats by the hour12 the message writes in %s',
    (_label, hourCycle, hour12, expected) => {
      expect(
        renderArtifact(
          {
            body: patternBody([
              annotated(variable('when'), 'time', { hour12: literal(hour12) }),
            ]),
            inputs: WHEN,
          },
          { when },
          undefined,
          { locale: 'en-US', timeZone: 'UTC', hourCycle },
        ),
      ).toMatch(expected);
    },
  );

  it.each([
    ['h23', '15:04'],
    ['h12', /^3:04\sPM$/u],
  ] as const)(
    'formats by the context cycle %s where the message writes no hour12',
    (hourCycle, expected) => {
      expect(
        renderArtifact(
          {
            body: patternBody([annotated(variable('when'), 'time')]),
            inputs: WHEN,
          },
          { when },
          undefined,
          { locale: 'en-US', timeZone: 'UTC', hourCycle },
        ),
      ).toMatch(expected);
    },
  );

  it('prints a date in a left-to-right message with nothing around it', () => {
    expect(
      renderArtifact(
        {
          body: patternBody([
            annotated(variable('when'), 'date', { timeZone: literal('UTC') }),
          ]),
          inputs: WHEN,
        },
        { when },
      ),
    ).toBe('Jan 2, 2024');
  });
});
