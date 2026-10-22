import { describe, expect, it } from 'vitest';

import { instant } from '../src/formatting.js';
import { resolveRelativeTime } from '../src/relative-time-policy.js';

/**
 * What resolving a relative timestamp comes to, for a span the policy phrases and for one it does
 * not.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 5 leaves the thresholds to the
 * application. A span inside them is selected and formatted in one step; a span past them is
 * handed back as elapsed milliseconds, which is the policy working and not a failure. The expected
 * phrase is asked of the platform with the same arguments.
 */

const REFERENCE = 1_700_000_000_000;

const at = (milliseconds: number) =>
  instant(`${String(REFERENCE + milliseconds)}000000`);

const EN = Object.freeze({ locale: 'en-US' });

describe('resolving a relative timestamp', () => {
  it('phrases a span the policy names a unit for', () => {
    // Ninety minutes ago.
    const outcome = resolveRelativeTime(at(-5_400_000), at(0), {}, EN);

    expect(outcome).toMatchObject({
      kind: 'relative',
      unit: 'hour',
      value: -1,
      formatted: {
        kind: 'formatted-value',
        text: new Intl.RelativeTimeFormat('en-US').format(-1, 'hour'),
      },
    });
  });

  it('hands back the elapsed span where it is past the ceiling the policy sets', () => {
    expect(
      resolveRelativeTime(
        at(-5_400_000),
        at(0),
        { absoluteAfterMilliseconds: 3_600_000 },
        EN,
      ),
    ).toStrictEqual({ kind: 'absolute', elapsedMilliseconds: -5_400_000 });
  });

  it('hands back the elapsed span where it is past the largest unit the policy names', () => {
    expect(
      resolveRelativeTime(
        at(3 * 86_400_000),
        at(0),
        { largestUnit: 'day' },
        EN,
      ),
    ).toStrictEqual({ kind: 'absolute', elapsedMilliseconds: 3 * 86_400_000 });
  });
});
