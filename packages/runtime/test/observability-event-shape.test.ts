/**
 * What reaches a sink: the members of an event, the bounds on them, and how often a failure repeats.
 *
 * `specs/11-diagnostics-and-observability.spec.md` section 7 lists what an event carries and
 * forbids anything else in one. Section 8 bounds every field before it is emitted, so an identity
 * beyond its length or holding a control character is dropped and a count or a duration outside its
 * range is dropped, and it collapses equivalent repeated failures inside a window while capping the
 * failure identities remembered, oldest given up first.
 *
 * The emitter is built by the function a context and `withObservability()` both hand their sink to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RUNTIME_EVENT_CODES,
  RUNTIME_OBSERVABILITY_PROFILE,
  createLocalizationEventEmitter,
  type LocalizationEventInput,
  type LocalizationEventStatus,
  type LocalizationObservabilityEvent,
} from '../src/observability.js';

const BARE: LocalizationEventInput = Object.freeze({
  code: RUNTIME_EVENT_CODES.catalog,
  phase: 'catalog',
  status: 'succeeded',
});

/** What the sink receives for `BARE`: the profile and the three members every input has. */
const BARE_EVENT: LocalizationObservabilityEvent = Object.freeze({
  profile: RUNTIME_OBSERVABILITY_PROFILE,
  ...BARE,
});

const IDENTITIES = [
  'targetLocale',
  'supplyingLocale',
  'providerId',
  'scopeId',
  'participantId',
  'correlationId',
] as const;

const INTEGERS = ['transitionId', 'snapshotId', 'count'] as const;

/** The same value under every member of one kind, so a bound is read on each of them. */
function under<Value>(
  names: readonly string[],
  value: Value,
): Partial<LocalizationEventInput> {
  return Object.fromEntries(names.map((name) => [name, value]));
}

function reporting() {
  const events: LocalizationObservabilityEvent[] = [];
  const emitter = createLocalizationEventEmitter({
    emit: (event) => void events.push(event),
  });
  return {
    events,
    emit: (input: Partial<LocalizationEventInput> = {}): void => {
      emitter.emit({ ...BARE, ...input });
    },
  };
}

describe('an event handed to a sink', () => {
  it('carries the profile, the code, the phase and the status, and no member it was not given', () => {
    const { events, emit } = reporting();

    emit();

    expect(events).toStrictEqual([BARE_EVENT]);
    expect(Object.keys(events[0] ?? {})).toStrictEqual([
      'profile',
      'code',
      'phase',
      'status',
    ]);
  });

  it('carries every member it was given', () => {
    const { events, emit } = reporting();
    const given = {
      reason: 'catalog-load-failed',
      targetLocale: 'ar-EG',
      supplyingLocale: 'en-US',
      providerId: 'provider',
      scopeId: 'shell',
      participantId: 'region',
      correlationId: 'request 7',
      transitionId: 3,
      snapshotId: 2,
      count: 5,
      durationMilliseconds: 12.5,
    } as const;

    emit(given);

    expect(events).toStrictEqual([{ ...BARE_EVENT, ...given }]);
  });
});

describe('an identity on an event', () => {
  it('is kept at 128 characters', () => {
    const { events, emit } = reporting();
    const longest = under(IDENTITIES, 'a'.repeat(128));

    emit(longest);

    expect(events).toStrictEqual([{ ...BARE_EVENT, ...longest }]);
  });

  it('is left out at 129 characters', () => {
    const { events, emit } = reporting();

    emit(under(IDENTITIES, 'a'.repeat(129)));

    expect(events).toStrictEqual([BARE_EVENT]);
  });

  it('is left out when it is empty', () => {
    const { events, emit } = reporting();

    emit(under(IDENTITIES, ''));

    expect(events).toStrictEqual([BARE_EVENT]);
  });

  it.each([
    ['a null', '\u0000'],
    ['a unit separator', '\u001f'],
    ['a delete', '\u007f'],
    ['an application program command', '\u009f'],
    ['a left-to-right embedding', '‪'],
    ['a right-to-left override', '‮'],
    ['a left-to-right isolate', '⁦'],
    ['a pop directional isolate', '⁩'],
  ])('is left out when it holds %s', (_name, character) => {
    const { events, emit } = reporting();

    emit(under(IDENTITIES, `shell${character}lazy`));

    expect(events).toStrictEqual([BARE_EVENT]);
  });
});

describe('a transition, a snapshot or a count on an event', () => {
  it.each([0, 1_000_000_000])('is kept at %d', (value) => {
    const { events, emit } = reporting();
    const numbers = under(INTEGERS, value);

    emit(numbers);

    expect(events).toStrictEqual([{ ...BARE_EVENT, ...numbers }]);
  });

  it.each([-1, 1.5, 1_000_000_001, Number.NaN, Number.POSITIVE_INFINITY])(
    'is left out at %d',
    (value) => {
      const { events, emit } = reporting();

      emit(under(INTEGERS, value));

      expect(events).toStrictEqual([BARE_EVENT]);
    },
  );
});

describe('a duration on an event', () => {
  it.each([
    [0, 0],
    [86_400_000, 86_400_000],
    [1.2344, 1.234],
    [1.2346, 1.235],
  ])('of %d milliseconds is reported as %d', (given, reported) => {
    const { events, emit } = reporting();

    emit({ durationMilliseconds: given });

    expect(events).toStrictEqual([
      { ...BARE_EVENT, durationMilliseconds: reported },
    ]);
  });

  it.each([
    -0.001,
    86_400_000.001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('is left out at %d milliseconds', (given) => {
    const { events, emit } = reporting();

    emit({ durationMilliseconds: given });

    expect(events).toStrictEqual([BARE_EVENT]);
  });
});

describe('an event repeated inside one second', () => {
  const FAILURE = Object.freeze({
    status: 'failed',
    reason: 'catalog-load-failed',
    providerId: 'provider',
    scopeId: 'shell',
    targetLocale: 'ar-EG',
  } as const);

  beforeEach(() => {
    // The window is read from the clock, so the clock stands still unless a case moves it.
    vi.useFakeTimers({ toFake: ['Date'], now: 1_700_000_000_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each<LocalizationEventStatus>([
    'failed',
    'unavailable',
    'cancelled',
    'superseded',
  ])(
    'is reported once when its status is %s, and again once the second is over',
    (status) => {
      const { events, emit } = reporting();

      emit({ status });
      vi.advanceTimersByTime(999);
      emit({ status });
      const inside = events.length;
      vi.advanceTimersByTime(1);
      emit({ status });

      expect(inside).toBe(1);
      expect(events).toStrictEqual([
        { ...BARE_EVENT, status },
        { ...BARE_EVENT, status },
      ]);
    },
  );

  it.each<LocalizationEventStatus>([
    'started',
    'succeeded',
    'recovered',
    'redirected',
  ])('is reported every time when its status is %s', (status) => {
    const { events, emit } = reporting();

    emit({ status });
    emit({ status });

    expect(events).toStrictEqual([
      { ...BARE_EVENT, status },
      { ...BARE_EVENT, status },
    ]);
  });

  it('is a repeat only where the code, phase, status, reason, provider, scope and target locale all agree', () => {
    const { events, emit } = reporting();
    const distinct: readonly Partial<LocalizationEventInput>[] = [
      FAILURE,
      { ...FAILURE, code: RUNTIME_EVENT_CODES.cache },
      { ...FAILURE, phase: 'cache' },
      { ...FAILURE, status: 'unavailable' },
      { ...FAILURE, reason: 'catalog-admission-failed' },
      { ...FAILURE, providerId: 'another' },
      { ...FAILURE, scopeId: 'lazy' },
      { ...FAILURE, targetLocale: 'en-US' },
    ];

    for (const input of distinct) emit(input);
    const told = events.length;
    emit({ ...FAILURE, supplyingLocale: 'en-US' });
    emit({ ...FAILURE, participantId: 'region' });
    emit({ ...FAILURE, correlationId: 'request 7' });
    emit({ ...FAILURE, transitionId: 3, snapshotId: 2, count: 5 });
    emit({ ...FAILURE, durationMilliseconds: 12.5 });

    expect(told).toBe(distinct.length);
    expect(events).toStrictEqual(
      distinct.map((input) => ({ ...BARE_EVENT, ...input })),
    );
  });

  it('is not a repeat where a provider and a scope only read alike once joined', () => {
    const { events, emit } = reporting();

    emit({ ...FAILURE, providerId: 'ab', scopeId: 'c' });
    emit({ ...FAILURE, providerId: 'a', scopeId: 'bc' });

    expect(events).toStrictEqual([
      { ...BARE_EVENT, ...FAILURE, providerId: 'ab', scopeId: 'c' },
      { ...BARE_EVENT, ...FAILURE, providerId: 'a', scopeId: 'bc' },
    ]);
  });

  it('is not a repeat where one event carries a member as empty text and the other does not carry it', () => {
    const { events, emit } = reporting();
    // A reason is not bounded as an identity is, so an untyped caller can hand an empty one.
    const empty = '' as unknown as NonNullable<
      LocalizationEventInput['reason']
    >;

    emit({ status: 'failed', reason: empty });
    emit({ status: 'failed' });

    expect(events).toStrictEqual([
      { ...BARE_EVENT, status: 'failed', reason: empty },
      { ...BARE_EVENT, status: 'failed' },
    ]);
  });

  it('remembers 128 failures and gives up the oldest first', () => {
    const { events, emit } = reporting();
    const scopes = Array.from({ length: 129 }, (_, index) => `scope-${index}`);

    for (const scopeId of scopes) emit({ ...FAILURE, scopeId });
    const told = events.length;
    emit({ ...FAILURE, scopeId: 'scope-128' });
    emit({ ...FAILURE, scopeId: 'scope-1' });
    emit({ ...FAILURE, scopeId: 'scope-0' });

    expect(told).toBe(129);
    expect(events.slice(told)).toStrictEqual([
      { ...BARE_EVENT, ...FAILURE, scopeId: 'scope-0' },
    ]);
  });
});
