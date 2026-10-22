import { describe, expect, it } from 'vitest';

import {
  compareLocalized,
  decimal,
  localeMetadata,
  segmentText,
  selectPlural,
} from '../src/formatting.js';
import { RUNTIME_LIMITS } from '../src/runtime-safety.js';
import { type FormattingContext } from '@neolorn/equator/core';

/**
 * What a plural selection, a comparison, a segmentation and a locale's metadata hand back when
 * they have no answer.
 *
 * Each answers with a result and never with a throw. A refusal names the locale that was asked
 * for, and carries a reason only where the platform was asked and refused: an input Equator
 * turned away itself, for its length or its precision, never reached the platform, so it names
 * none.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

const refusal = (targetLocale: string, reason?: string) => ({
  ok: false,
  diagnostic: {
    code: 'unsupported-formatting-capability',
    outcome: 'operational-failure',
    message: expect.stringMatching(/\S/u) as unknown as string,
    targetLocale,
    ...(reason === undefined ? {} : { reason }),
  },
});

const PLATFORM_REFUSED = refusal('en-US', 'native-capability-rejected');
const TURNED_AWAY = refusal('en-US');

const PAST_THE_CEILING = 'a'.repeat(
  RUNTIME_LIMITS.localizedInputCodePoints + 1,
);
const AT_THE_CEILING = 'a'.repeat(RUNTIME_LIMITS.localizedInputCodePoints);

describe('a plural selection', () => {
  it('is refused, as the platform’s refusal, under options the platform throws on', () => {
    const options = {
      type: 'no-such-type',
    } as unknown as Intl.PluralRulesOptions;

    expect(() => new Intl.PluralRules('en-US', options)).toThrow(RangeError);
    expect(selectPlural(decimal('1'), EN, options)).toStrictEqual(
      PLATFORM_REFUSED,
    );
  });

  it('is refused, with no reason given, for a number finer than a native number holds', () => {
    const result = selectPlural(decimal('1.00000000000000000001'), EN);

    expect(result).toStrictEqual(TURNED_AWAY);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('a comparison', () => {
  it('is refused, as the platform’s refusal, under options the platform throws on', () => {
    const options = {
      sensitivity: 'no-such-sensitivity',
    } as unknown as Intl.CollatorOptions;

    expect(() => new Intl.Collator('en-US', options)).toThrow(RangeError);
    expect(compareLocalized('a', 'b', EN, options)).toStrictEqual(
      PLATFORM_REFUSED,
    );
  });

  it('is made at the length ceiling, and refused with no reason past it on either side', () => {
    expect(compareLocalized(AT_THE_CEILING, AT_THE_CEILING, EN)).toStrictEqual({
      ok: true,
      value: 0,
    });
    expect(compareLocalized(PAST_THE_CEILING, 'b', EN)).toStrictEqual(
      TURNED_AWAY,
    );
    expect(compareLocalized('a', PAST_THE_CEILING, EN)).toStrictEqual(
      TURNED_AWAY,
    );
  });

  it('is refused with no reason for a side that is not text', () => {
    expect(compareLocalized(1 as unknown as string, 'b', EN)).toStrictEqual(
      TURNED_AWAY,
    );
    expect(compareLocalized('a', 2 as unknown as string, EN)).toStrictEqual(
      TURNED_AWAY,
    );
  });
});

describe('a segmentation', () => {
  it('is refused, as the platform’s refusal, under options the platform throws on', () => {
    const options = {
      granularity: 'no-such-granularity',
    } as unknown as Intl.SegmenterOptions;

    expect(() => new Intl.Segmenter('en-US', options)).toThrow(RangeError);
    expect(segmentText('a b', EN, options)).toStrictEqual(PLATFORM_REFUSED);
  });

  it('is refused with no reason past the length ceiling, and for an input that is not text', () => {
    expect(segmentText(PAST_THE_CEILING, EN)).toStrictEqual(TURNED_AWAY);
    expect(segmentText(1 as unknown as string, EN)).toStrictEqual(TURNED_AWAY);
  });
});

describe('the metadata of a locale', () => {
  it('is refused, naming the tag as it was written, for a tag that is not well formed', () => {
    expect(localeMetadata('not a tag')).toStrictEqual(
      refusal('not a tag', 'native-capability-rejected'),
    );
  });
});
