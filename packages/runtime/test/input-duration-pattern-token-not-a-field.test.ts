import { describe, expect, it } from 'vitest';

import { decimal, duration } from '../src/formatting.js';
import {
  formatLocalizedInput,
  parseLocalizedInput,
} from '../src/localized-input.js';
import { type FormattingContext } from '@neolorn/equator/core';

/**
 * A duration pattern is authored, in a project file or in a call, and a place in it can hold
 * anything that was written there. A place that holds neither a literal nor a unit makes the
 * profile invalid, and the field says so as a result: it does not throw on a pattern, because the
 * pattern is read on every keystroke of a form.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

const NOT_A_TOKEN: readonly (readonly [string, unknown])[] = [
  ['nothing', undefined],
  ['null', null],
  ['a number', 5],
  ['true', true],
];

const FIVE_MINUTES = duration(
  {
    years: 0,
    months: 0,
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 5,
    seconds: decimal('0'),
  },
  1,
);

describe('a duration pattern with a place that is neither a literal nor a unit', () => {
  it.each(NOT_A_TOKEN)('is refused when the place holds %s', (_name, token) => {
    const profile = { kind: 'duration', pattern: [token] };
    expect(parseLocalizedInput('5', profile as never, EN)).toMatchObject({
      status: 'policy-rejected',
      text: '5',
      diagnostic: { code: 'invalid-localized-input' },
    });
  });

  it.each(NOT_A_TOKEN)(
    'is refused when %s follows a literal',
    (_name, token) => {
      const profile = { kind: 'duration', pattern: ['PT', token] };
      expect(parseLocalizedInput('PT5', profile as never, EN)).toMatchObject({
        status: 'policy-rejected',
        diagnostic: { code: 'invalid-localized-input' },
      });
    },
  );

  it.each(NOT_A_TOKEN)(
    'writes nothing when the place holds %s',
    (_name, token) => {
      const profile = { kind: 'duration', pattern: [token] };
      expect(
        formatLocalizedInput(FIVE_MINUTES as never, profile as never, EN),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: 'invalid-localized-input' },
      });
    },
  );

  it('reads the same text under a pattern whose place holds a unit', () => {
    expect(
      parseLocalizedInput(
        '5',
        { kind: 'duration', pattern: [{ field: 'minutes' }] },
        EN,
      ),
    ).toMatchObject({ status: 'valid', value: { minutes: 5 } });
  });
});
