/**
 * The small guarantees the rest of the runtime leans on without restating them.
 *
 * `specs/11-diagnostics-and-observability.spec.md` section 3 gives a diagnostic bounded identities
 * that are safe to print; `specs/05-compiled-artifacts-and-trust.spec.md` section 3 fixes SHA-256
 * and the URL-safe base64 alphabet without padding for every digest the runtime recomputes; and an
 * operation handed a signal that has already aborted answers with that signal's own reason. Each
 * of them is stated once in `runtime-safety.ts` and assumed everywhere else.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import {
  areTransferredAddresses,
  asDiagnostic,
  hasExactKeys,
  isRecord,
  operationalDiagnostic,
  sha256Base64Url,
  snapshotInertJson,
  waitForSignal,
} from '../src/runtime-safety.js';

// Built from a code point so that no control character sits in this file.
const CONTROL = String.fromCodePoint(0x1b);
const REPLACED = String.fromCodePoint(0xfffd);

describe('an operational diagnostic', () => {
  it('carries its code, its outcome class and its message, and nothing it was not given', () => {
    const diagnostic = operationalDiagnostic('catalog-load-failed', 'Failed.');

    expect(diagnostic).toStrictEqual({
      code: 'catalog-load-failed',
      outcome: 'operational-failure',
      message: 'Failed.',
    });
    expect(Object.isFrozen(diagnostic)).toBe(true);
  });

  it('makes every identity it was given safe to print', () => {
    const unsafe = `shell${CONTROL}[31m`;
    const safe = `shell${REPLACED}[31m`;

    expect(
      operationalDiagnostic('catalog-load-failed', 'Failed.', {
        targetLocale: unsafe,
        providerId: unsafe,
        scopeId: unsafe,
        participantId: unsafe,
      }),
    ).toStrictEqual({
      code: 'catalog-load-failed',
      outcome: 'operational-failure',
      message: 'Failed.',
      targetLocale: safe,
      providerId: safe,
      scopeId: safe,
      participantId: safe,
    });
  });

  it.each(['targetLocale', 'providerId', 'scopeId', 'participantId'] as const)(
    'carries %s alone when that is the one identity given',
    (identity) => {
      expect(
        operationalDiagnostic('catalog-load-failed', 'Failed.', {
          [identity]: 'given',
        }),
      ).toStrictEqual({
        code: 'catalog-load-failed',
        outcome: 'operational-failure',
        message: 'Failed.',
        [identity]: 'given',
      });
    },
  );

  it('stands in for an error that carries no diagnostic of its own', () => {
    expect(asDiagnostic(new Error('a stack trace nobody should log'))).toEqual({
      code: 'internal-invariant',
      outcome: 'operational-failure',
      message: expect.any(String) as string,
    });
    const carried = operationalDiagnostic('disposed', 'Disposed.');
    expect(asDiagnostic(new LocalizationError(carried))).toBe(carried);
  });
});

describe('the SHA-256 digest in URL-safe base64', () => {
  const reference = (value: string): string =>
    createHash('sha256').update(value, 'utf8').digest('base64url');

  it.each([
    ['the empty string', ''],
    ['three bytes', 'abc'],
    ['one byte short of a second block', 'a'.repeat(55)],
    ['the first length that needs a second block', 'a'.repeat(56)],
    ['exactly one block of input', 'a'.repeat(64)],
    ['several blocks', 'equator '.repeat(40)],
    ['text outside ASCII', 'مخزن الفهارس'],
  ])('agrees with the platform for %s', (_name, value) => {
    const digest = sha256Base64Url(value);

    expect(digest).toBe(reference(value));
    // 32 bytes without padding.
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });
});

describe('waiting on work under a signal', () => {
  it('answers a signal that had already aborted with that signal’s reason', async () => {
    const controller = new AbortController();
    const reason = new Error('the navigation was replaced');
    controller.abort(reason);

    await expect(
      waitForSignal(Promise.resolve('finished'), controller.signal),
    ).rejects.toBe(reason);
  });

  it('leaves the abandoned work’s own failure handled', async () => {
    const controller = new AbortController();
    const reason = new Error('the navigation was replaced');
    controller.abort(reason);
    const unhandled: unknown[] = [];
    const record = (error: unknown) => unhandled.push(error);
    process.on('unhandledRejection', record);

    try {
      await expect(
        waitForSignal(
          Promise.reject(new Error('the load failed')),
          controller.signal,
        ),
      ).rejects.toBe(reason);
      // An unhandled rejection is reported after the microtasks drain, so a timer is past it.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', record);
    }

    expect(unhandled).toStrictEqual([]);
  });

  it('answers an abort that arrives during the wait with its reason', async () => {
    const controller = new AbortController();
    const reason = new Error('the navigation was replaced');
    const waiting = waitForSignal(
      new Promise(() => undefined),
      controller.signal,
    );

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
  });

  // A caller may abort with `null`, and the platform then keeps `null` as the signal's reason.
  it('answers a signal that had already aborted with no reason with an abort error', async () => {
    const controller = new AbortController();
    controller.abort(null);

    const failure: unknown = await waitForSignal(
      Promise.resolve('finished'),
      controller.signal,
    ).catch((error: unknown) => error);

    expect(controller.signal.reason).toBeNull();
    expect(failure).toBeInstanceOf(DOMException);
    expect((failure as DOMException).name).toBe('AbortError');
    expect((failure as DOMException).message).toBe('Aborted');
  });

  it('answers an abort with no reason that arrives during the wait with an abort error', async () => {
    const controller = new AbortController();
    const waiting = waitForSignal(
      new Promise(() => undefined),
      controller.signal,
    );

    controller.abort(null);
    const failure: unknown = await waiting.catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DOMException);
    expect((failure as DOMException).name).toBe('AbortError');
    expect((failure as DOMException).message).toBe('Aborted');
  });

  /** A live signal that records every listener put on it and taken off it. */
  function watchedSignal() {
    const { signal } = new AbortController();
    const listening: unknown[][] = [];
    const stopped: unknown[][] = [];
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (
      ...listener: Parameters<AbortSignal['addEventListener']>
    ) => {
      listening.push(listener.slice(0, 2));
      add(...listener);
    };
    signal.removeEventListener = (
      ...listener: Parameters<AbortSignal['removeEventListener']>
    ) => {
      stopped.push(listener.slice(0, 2));
      remove(...listener);
    };
    return { signal, listening, stopped };
  }

  // A signal outlives most of what waits on it: a request's signal is waited on once per catalog.
  it('stops listening to the signal once the work has finished', async () => {
    const { signal, listening, stopped } = watchedSignal();

    await expect(
      waitForSignal(Promise.resolve('finished'), signal),
    ).resolves.toBe('finished');

    expect(listening).toHaveLength(1);
    expect(listening[0]?.[0]).toBe('abort');
    expect(stopped).toStrictEqual(listening);
  });

  it('stops listening to the signal once the work has failed', async () => {
    const { signal, listening, stopped } = watchedSignal();
    const failure = new Error('the load failed');

    await expect(waitForSignal(Promise.reject(failure), signal)).rejects.toBe(
      failure,
    );

    expect(listening).toHaveLength(1);
    expect(stopped).toStrictEqual(listening);
  });
});

describe('a transferred address table', () => {
  const ORIGINS = { 'en-US': 'https://en.example' };

  it('admits a locale key at the length bound and refuses one past it', () => {
    expect(areTransferredAddresses({ ['a'.repeat(128)]: '/second' })).toBe(
      true,
    );
    expect(areTransferredAddresses({ ['a'.repeat(129)]: '/second' })).toBe(
      false,
    );
  });

  it('refuses an address for a locale the policy gives no origin, whatever it begins with', () => {
    expect(
      areTransferredAddresses(
        { 'ar-EG': 'https://ar.example/second' },
        ORIGINS,
      ),
    ).toBe(false);
    // The text an absent origin reads as when it is joined into a string.
    expect(
      areTransferredAddresses({ 'ar-EG': 'undefined/second' }, ORIGINS),
    ).toBe(false);
  });
});

describe('an object that is not an array', () => {
  it('is recognized whatever it was constructed from', () => {
    class Preferences {
      readonly locale = 'ar-EG';
    }

    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord(new Preferences())).toBe(true);
  });

  it('is not an array, null or a primitive', () => {
    for (const value of [[], null, undefined, 'text', 42, true]) {
      expect(isRecord(value)).toBe(false);
    }
  });
});

describe('a record with an exact set of fields', () => {
  it('has every required field, and may have the optional ones', () => {
    expect(hasExactKeys({ id: 1, name: 'a' }, ['id', 'name'])).toBe(true);
    expect(hasExactKeys({ id: 1 }, ['id'], ['name'])).toBe(true);
    expect(hasExactKeys({ id: 1, name: 'a' }, ['id'], ['name'])).toBe(true);
  });

  it('is not one that lacks a required field while having another', () => {
    expect(hasExactKeys({ id: 1 }, ['id', 'name'])).toBe(false);
  });

  it('is not one with a field nobody named', () => {
    expect(hasExactKeys({ id: 1, note: 'x' }, ['id'])).toBe(false);
    expect(hasExactKeys({ id: 1, note: 'x' }, ['id'], ['name'])).toBe(false);
  });
});

describe('the aggregate string bound on inert data', () => {
  const limits = (maximumCodeUnits: number) => ({
    maximumDepth: 4,
    maximumNodes: 16,
    maximumCodeUnits,
  });

  it('admits strings up to the bound and refuses one code unit past it', () => {
    expect(snapshotInertJson(['ab', 'cd'], limits(4)).value).toStrictEqual([
      'ab',
      'cd',
    ]);
    expect(() => snapshotInertJson(['ab', 'cde'], limits(4))).toThrow(
      TypeError,
    );
  });
});
