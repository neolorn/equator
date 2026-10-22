import { afterEach, describe, expect, it } from 'vitest';

import { parseMessageSemanticModel } from '../src/message-format.js';

/**
 * A message's number options get one answer on every machine that compiles it.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 6: the pinned ECMA-402 edition's rules
 * decide, not the build host's `Intl.NumberFormat`. So the host is replaced here by one that refuses
 * every option set and then by one that accepts every option set, and each message must be judged
 * exactly as it is on the real host.
 */

const realNumberFormat = Intl.NumberFormat;

function useHost(numberFormat: unknown): void {
  Object.defineProperty(Intl, 'NumberFormat', {
    value: numberFormat,
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  useHost(realNumberFormat);
});

const REFUSES_EVERYTHING = function NumberFormat(): never {
  throw new RangeError('this host refuses every option set');
};
const ACCEPTS_EVERYTHING = function NumberFormat(): object {
  return {};
};

const TOGETHER = 'cannot be used together';

/** Messages each option set accepts, and messages it refuses only as a set. */
const ACCEPTED = [
  '{1 :number}',
  '{1 :integer}',
  '{1 :percent}',
  '{1 :number roundingIncrement=5 minimumFractionDigits=2 maximumFractionDigits=2}',
  '{1 :number minimumFractionDigits=3 maximumFractionDigits=1 minimumSignificantDigits=2}',
  '{1 :unit unit=meter}',
  '{1 :unit unit=mile-scandinavian}',
  '{1 :unit unit=kilometer-per-hour}',
  '{1 :unit unit=percent-per-percent}',
  '{1 :currency currency=EUR}',
  '{1 :currency currency=JPY roundingIncrement=5}',
  '.local $n = {1 :number maximumFractionDigits=0}\n{{{$n :currency currency=JPY roundingIncrement=5}}}',
  // The yen is written with no fraction digits, so a minimum of one fixes the maximum at one.
  '.local $n = {1 :number minimumFractionDigits=1}\n{{{$n :currency currency=JPY roundingIncrement=5}}}',
];
const REFUSED = [
  '{1 :number roundingIncrement=5}',
  '{1 :number minimumFractionDigits=3 maximumFractionDigits=1}',
  '{1 :number minimumSignificantDigits=5 maximumSignificantDigits=2}',
  '{1 :number roundingIncrement=5 minimumFractionDigits=2 maximumFractionDigits=2 maximumSignificantDigits=3}',
  '{1 :number roundingIncrement=5 roundingPriority=morePrecision minimumFractionDigits=2 maximumFractionDigits=2}',
  '{1 :unit unit=furlong}',
  '{1 :unit unit=square-meter}',
  '{1 :unit unit=meter-per-second-per-second}',
  '{1 :unit unit=meter-per-furlong}',
  '{1 :unit}',
  // The euro is written with two, so the same minimum leaves the maximum at two.
  '.local $n = {1 :number minimumFractionDigits=1}\n{{{$n :currency currency=EUR roundingIncrement=5}}}',
];

function summaries(source: string): readonly string[] {
  return parseMessageSemanticModel(source).diagnostics.map(
    ({ code, summary }) => `${code} ${summary}`,
  );
}

describe('the number options of a message', () => {
  const onTheRealHost = new Map(
    [...ACCEPTED, ...REFUSED].map((source) => [source, summaries(source)]),
  );

  it('are judged by the pinned rules on the real host', () => {
    for (const source of ACCEPTED) {
      expect(onTheRealHost.get(source), source).toEqual([]);
    }
    for (const source of REFUSED) {
      const reported = onTheRealHost.get(source) ?? [];
      expect(reported, source).toHaveLength(1);
      expect(reported[0], source).toMatch(/^EQ1204 /u);
      expect(reported[0], source).toContain(TOGETHER);
    }
  });

  it('get the same answer from a host that refuses every option set', () => {
    useHost(REFUSES_EVERYTHING);
    for (const [source, expected] of onTheRealHost) {
      expect(summaries(source), source).toEqual(expected);
    }
  });

  it('get the same answer from a host that accepts every option set', () => {
    useHost(ACCEPTS_EVERYTHING);
    for (const [source, expected] of onTheRealHost) {
      expect(summaries(source), source).toEqual(expected);
    }
  });
});
