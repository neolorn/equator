/**
 * What crosses into the runtime as data, and what it is turned into on the way.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 2 admits a configuration, a catalog set
 * and a catalog only as inert JSON: null, booleans, canonical numbers, well-formed strings, dense
 * arrays and plain records of the same, with no accessor, no symbol, no hidden property and no
 * cycle, inside fixed bounds on depth, node count and aggregate text. What is admitted is a copy
 * the runtime owns and nothing can change. `snapshotInertJson` is that boundary, and every refusal
 * here is a `TypeError`, which its callers turn into the diagnostic for whatever they were reading.
 */
import { describe, expect, it } from 'vitest';

import {
  codePointLengthAtMost,
  compareCodeUnit,
  safeDiagnosticIdentifier,
  snapshotInertJson,
} from '../src/runtime-safety.js';

const ROOMY = { maximumDepth: 16, maximumNodes: 256, maximumCodeUnits: 1_024 };

const snapshot = (value: unknown, limits: Partial<typeof ROOMY> = {}) =>
  snapshotInertJson(value, { ...ROOMY, ...limits });

const refused = (
  value: unknown,
  limits: Partial<typeof ROOMY> = {},
): boolean => {
  try {
    snapshot(value, limits);
  } catch (error) {
    // Anything other than the documented refusal is a crash, and fails the case as itself.
    if (error instanceof TypeError) return true;
    throw error;
  }
  return false;
};

// Built from code units so that no lone surrogate or control character sits in this file.
const unit = (...codeUnits: number[]): string =>
  String.fromCharCode(...codeUnits);
const NUL = unit(0);

describe('a snapshot of inert data', () => {
  it('is a deep copy with every array and record in it frozen', () => {
    const input = {
      list: [1, { inner: ['x'] }, [{ deep: true }]],
      record: { nested: { leaf: null } },
    };

    const { value } = snapshot(input) as unknown as { value: typeof input };

    expect(value).toEqual(input);
    expect(value).not.toBe(input);
    expect(Object.getPrototypeOf(value)).toBeNull();
    for (const part of [
      value,
      value.list,
      value.list[1],
      (value.list[1] as { inner: string[] }).inner,
      value.list[2],
      (value.list[2] as { deep: boolean }[])[0],
      value.record,
      value.record.nested,
    ]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
    // The caller's own object is left as it was.
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.list)).toBe(false);
  });

  it('says how many nodes it holds, how deep it goes and how long it is encoded', () => {
    const taken = snapshot({ b: [1, { c: 'x' }], a: null, t: true });

    expect(taken.canonical).toBe('{"a":null,"b":[1,{"c":"x"}],"t":true}');
    expect(taken.nodes).toBe(7);
    expect(taken.depth).toBe(4);
    expect(taken.utf8Bytes).toBe(taken.canonical.length);
    expect(Object.isFrozen(taken)).toBe(true);
  });

  it('counts depth through arrays and through records alike', () => {
    expect(snapshot([[['x']]]).depth).toBe(4);
    expect(snapshot({ a: { b: { c: 'x' } } }).depth).toBe(4);
    expect(snapshot('x').depth).toBe(1);
  });

  it('writes its canonical form with keys in code-unit order, whatever order they arrived in', () => {
    const keys = ['b', 'a', 'Z', 'aa', '10', '9', ''];
    const expected = '{"":0,"10":0,"9":0,"Z":0,"a":0,"aa":0,"b":0}';

    // Every rotation and its reverse, so each key arrives before and after each other key.
    for (let turn = 0; turn < keys.length; turn += 1) {
      const rotated = [...keys.slice(turn), ...keys.slice(0, turn)];
      for (const order of [rotated, [...rotated].reverse()]) {
        expect(
          snapshot(Object.fromEntries(order.map((key) => [key, 0]))).canonical,
        ).toBe(expected);
      }
    }
  });

  // Long enough that the engine merges runs instead of inserting one key at a time.
  it('orders a record of two hundred keys that arrived scattered', () => {
    const name = (index: number) => `k${String(index).padStart(3, '0')}`;
    const ascending = Array.from({ length: 200 }, (_, index) => name(index));
    // 77 shares no factor with 200, so stepping by it visits every key once and never in order.
    const scattered = ascending.map((_, index) => name((index * 77) % 200));

    for (const order of [scattered, [...ascending].reverse()]) {
      expect(
        snapshot(Object.fromEntries(order.map((key) => [key, 0]))).canonical,
      ).toBe(`{${ascending.map((key) => `"${key}":0`).join(',')}}`);
    }
  });

  it('admits a value that appears twice without being a cycle', () => {
    const shared = { leaf: 1 };

    expect(
      snapshot({ first: shared, second: shared, list: [shared] }).value,
    ).toEqual({ first: { leaf: 1 }, second: { leaf: 1 }, list: [{ leaf: 1 }] });
  });
});

describe('what is not inert data', () => {
  it.each<[string, unknown]>([
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['negatively infinite', Number.NEGATIVE_INFINITY],
    ['negative zero', -0],
    ['an integer past the safe range', 2 ** 53],
    ['a negative integer past the safe range', -(2 ** 53)],
  ])('refuses a number that is %s', (_name, value) => {
    expect(refused(value)).toBe(true);
    expect(refused([value])).toBe(true);
  });

  it.each<[string, number]>([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['the largest safe integer', Number.MAX_SAFE_INTEGER],
    ['the smallest safe integer', Number.MIN_SAFE_INTEGER],
    ['a very small fraction', 1e-300],
  ])('admits a number that is %s', (_name, value) => {
    expect(snapshot(value).value).toBe(value);
  });

  it.each<[string, string]>([
    ['a high surrogate at the end', unit(0x61, 0xd800)],
    ['the last high surrogate at the end', unit(0xdbff)],
    ['a high surrogate before a letter', unit(0xd83d, 0x61)],
    ['a high surrogate before another high surrogate', unit(0xd83d, 0xd83d)],
    [
      'a high surrogate before the unit past the low range',
      unit(0xd83d, 0xe000),
    ],
    [
      'a high surrogate before the unit below the low range',
      unit(0xd83d, 0xdbff),
    ],
    ['the first low surrogate alone', unit(0xdc00)],
    ['the last low surrogate alone', unit(0xdfff)],
    ['a low surrogate after a complete pair', unit(0xd83d, 0xde00, 0xde00)],
    ['a low surrogate before a high one', unit(0xde00, 0xd83d)],
  ])('refuses text with %s', (_name, text) => {
    expect(refused(text)).toBe(true);
    expect(refused({ [text]: 1 })).toBe(true);
  });

  it.each<[string, string]>([
    ['the first pair', unit(0xd800, 0xdc00)],
    ['the last pair', unit(0xdbff, 0xdfff)],
    ['a pair between letters', unit(0x61, 0xd83d, 0xde00, 0x62)],
    ['two pairs in a row', unit(0xd83d, 0xde00, 0xd83d, 0xde00)],
    ['the units either side of the surrogate range', unit(0xd7ff, 0xe000)],
  ])('admits text with %s', (_name, text) => {
    expect(snapshot(text).value).toBe(text);
    expect(Object.keys(snapshot({ [text]: 1 }).value as object)).toStrictEqual([
      text,
    ]);
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['a function', () => undefined],
    ['a symbol', Symbol('s')],
    ['a big integer', 10n],
  ])('refuses %s, alone and inside a record', (_name, value) => {
    expect(refused(value)).toBe(true);
    expect(refused({ held: value })).toBe(true);
    expect(refused([value])).toBe(true);
  });

  it('refuses a value that contains itself', () => {
    const record: Record<string, unknown> = {};
    record['self'] = record;
    const list: unknown[] = [];
    list.push([list]);

    expect(refused(record)).toBe(true);
    expect(refused(list)).toBe(true);
  });

  it.each<[string, () => unknown]>([
    ['an instance of a class', () => new (class Message {})()],
    ['a date', () => new Date(0)],
    ['a map', () => new Map([['a', 1]])],
    ['a record inheriting from another', () => Object.create({ inherited: 1 })],
    ['a record with a symbol key', () => ({ [Symbol('s')]: 1 })],
    [
      'a record with a getter',
      () =>
        Object.defineProperty({}, 'computed', {
          enumerable: true,
          get: () => 1,
        }),
    ],
    [
      'a record with a setter',
      () =>
        Object.defineProperty({}, 'computed', {
          enumerable: true,
          set: () => undefined,
        }),
    ],
    [
      'a record with an accessor that has neither',
      () =>
        Object.defineProperty({}, 'computed', {
          enumerable: true,
          get: undefined,
        } as unknown as PropertyDescriptor),
    ],
    [
      'a record with a hidden property',
      () =>
        Object.defineProperty({}, 'hidden', { value: 1, enumerable: false }),
    ],
  ])('refuses %s', (_name, build) => {
    expect(refused(build())).toBe(true);
    expect(refused([build()])).toBe(true);
  });

  it.each<[string, () => unknown[]]>([
    ['a hole', () => Object.assign(new Array<unknown>(3), { 0: 1, 2: 3 })],
    ['only holes', () => new Array<unknown>(2)],
    ['a property beside its items', () => Object.assign([1], { extra: 1 })],
    ['a symbol key', () => Object.assign([1], { [Symbol('s')]: 1 })],
    [
      'an item behind a getter',
      () => Object.defineProperty([1], 0, { enumerable: true, get: () => 1 }),
    ],
    [
      'an item behind a setter',
      () =>
        Object.defineProperty([1], 0, {
          enumerable: true,
          set: () => undefined,
        }),
    ],
    [
      'an item behind an accessor that has neither',
      () =>
        Object.defineProperty([1], 0, {
          enumerable: true,
          get: undefined,
        } as unknown as PropertyDescriptor),
    ],
    [
      'a hidden item',
      () => Object.defineProperty([1], 0, { value: 1, enumerable: false }),
    ],
  ])('refuses an array with %s', (_name, build) => {
    expect(refused(build())).toBe(true);
    expect(refused({ held: build() })).toBe(true);
  });

  it('admits a record with no prototype', () => {
    const record = Object.assign(Object.create(null) as object, { a: 1 });

    expect(snapshot(record).value).toEqual({ a: 1 });
  });
});

describe('the bounds on inert data', () => {
  it.each(['maximumDepth', 'maximumNodes', 'maximumCodeUnits'] as const)(
    'refuses a %s that is not a positive safe integer',
    (limit) => {
      for (const value of [
        0,
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        2 ** 53,
      ]) {
        // A lone number has depth one, is one node and holds no text, so no bound but the check
        // on the limits themselves stands in its way.
        expect(refused(7, { [limit]: value })).toBe(true);
      }
    },
  );

  it('admits a value with every bound at one', () => {
    const limits = { maximumDepth: 1, maximumNodes: 1, maximumCodeUnits: 1 };

    expect(snapshotInertJson('a', limits).value).toBe('a');
  });

  it('admits a value exactly at its node bound and refuses one node more', () => {
    expect(snapshot([1, 2], { maximumNodes: 3 }).nodes).toBe(3);
    expect(refused([1, 2, 3], { maximumNodes: 3 })).toBe(true);
    expect(snapshot({ a: 1, b: 2 }, { maximumNodes: 3 }).nodes).toBe(3);
    expect(refused({ a: 1, b: 2, c: 3 }, { maximumNodes: 3 })).toBe(true);
  });

  it('admits a value exactly at its depth bound and refuses one level more', () => {
    expect(snapshot([[1]], { maximumDepth: 3 }).depth).toBe(3);
    expect(refused([[[1]]], { maximumDepth: 3 })).toBe(true);
    expect(snapshot({ a: { b: 1 } }, { maximumDepth: 3 }).depth).toBe(3);
    expect(refused({ a: { b: { c: 1 } } }, { maximumDepth: 3 })).toBe(true);
    // Wide is not deep: many siblings at the bound are still at the bound.
    expect(refused([[1], [2], [3]], { maximumDepth: 3 })).toBe(false);
  });

  it('counts the text of values and of keys against one aggregate bound', () => {
    expect(refused(['ab', 'cd'], { maximumCodeUnits: 4 })).toBe(false);
    expect(refused(['ab', 'cde'], { maximumCodeUnits: 4 })).toBe(true);
    expect(refused({ ab: 'cd' }, { maximumCodeUnits: 4 })).toBe(false);
    expect(refused({ abc: 'cd' }, { maximumCodeUnits: 4 })).toBe(true);
    expect(refused({ abcd: 1 }, { maximumCodeUnits: 4 })).toBe(false);
    expect(refused({ abcde: 1 }, { maximumCodeUnits: 4 })).toBe(true);
    expect(refused({ ab: { cd: 1 } }, { maximumCodeUnits: 4 })).toBe(false);
    expect(refused({ ab: { cd: 1, e: 1 } }, { maximumCodeUnits: 4 })).toBe(
      true,
    );
  });

  it('bounds the encoded size by four bytes a code unit and sixteen a node', () => {
    // A control character is one code unit and six bytes encoded, which is the only way text
    // inside its own bound can be past this one.
    const controls = (count: number): string => NUL.repeat(count);

    // Seven of them in quotes are 44 bytes, and the bound for seven code units and one node is 44.
    expect(snapshot(controls(7), { maximumCodeUnits: 7 }).utf8Bytes).toBe(44);
    // 92 bytes against a bound of 96.
    expect(refused(controls(15), { maximumCodeUnits: 20 })).toBe(false);
    // 122 bytes against the same 96.
    expect(refused(controls(20), { maximumCodeUnits: 20 })).toBe(true);
  });
});

describe('counting code points up to a maximum', () => {
  it('answers the count when it is within the maximum', () => {
    expect(codePointLengthAtMost('', 0)).toBe(0);
    expect(codePointLengthAtMost('abc', 3)).toBe(3);
    expect(codePointLengthAtMost('ab', 3)).toBe(2);
    // One code point in two code units.
    expect(codePointLengthAtMost(unit(0xd83d, 0xde00), 1)).toBe(1);
  });

  it('answers nothing when the text is longer', () => {
    expect(codePointLengthAtMost('abcd', 3)).toBeUndefined();
    expect(codePointLengthAtMost('a', 0)).toBeUndefined();
    expect(codePointLengthAtMost('abcdefgh', 3)).toBeUndefined();
  });

  it.each([-1, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'answers nothing for a maximum of %d',
    (maximum) => {
      expect(codePointLengthAtMost('', maximum)).toBeUndefined();
      expect(codePointLengthAtMost('a', maximum)).toBeUndefined();
    },
  );
});

describe('an identifier made safe to print', () => {
  it('is a fixed marker when the value was not text', () => {
    for (const value of [undefined, null, 7, {}, ['shell']]) {
      expect(safeDiagnosticIdentifier(value)).toBe('<invalid>');
    }
  });
});

describe('ordering keys by code unit', () => {
  it('puts the lower key first, the higher last, and ties nowhere', () => {
    expect(compareCodeUnit('a', 'b')).toBe(-1);
    expect(compareCodeUnit('b', 'a')).toBe(1);
    expect(compareCodeUnit('a', 'a')).toBe(0);
    expect(compareCodeUnit('Z', 'a')).toBe(-1);
    expect(compareCodeUnit('a', 'aa')).toBe(-1);
    expect(['b', 'a', 'Z', 'aa'].sort(compareCodeUnit)).toStrictEqual([
      'Z',
      'a',
      'aa',
      'b',
    ]);
  });
});
