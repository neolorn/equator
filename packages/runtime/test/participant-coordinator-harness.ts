import type { ParticipantCoordinator } from '../src/participant-runtime.js';
import type {
  FormattingContext,
  LocalizationParticipant,
  LocalizationParticipantContext,
  LocalizationParticipantOptions,
  LocalizationParticipantReport,
} from '@neolorn/equator/core';

/**
 * Regions registered with a coordinator that write down what they are told.
 *
 * The cases that use this are about the order callbacks arrive in and about what a region still
 * holds afterwards, so every region shares one log with its neighbours and keeps the context of
 * each preparation, whose signal is the only thing a region can watch a change through.
 */

export const FORMATTING: FormattingContext = Object.freeze({
  locale: 'ar-EG',
  timeZone: 'UTC',
  calendar: 'gregory',
  numberingSystem: 'arab',
  hourCycle: 'h23',
});

export const READY: LocalizationParticipantReport = Object.freeze({
  status: 'ready',
  representation: Object.freeze({ kind: 'language-independent' }),
});

export const UNAVAILABLE: LocalizationParticipantReport = Object.freeze({
  status: 'unavailable',
  outcome: 'localized-representation-unavailable',
});

export const FAILED: LocalizationParticipantReport = Object.freeze({
  status: 'failed',
  outcome: 'operational-failure',
  reason: 'environment-failure',
});

export const noRetry = () => Promise.reject(new Error('not retried here'));

export const live = () => new AbortController().signal;

/** A preparation that never answers, so the attempt ends only by being abandoned. */
export const unanswered = () =>
  new Promise<LocalizationParticipantReport>(() => undefined);

/** A promise a case settles by hand. */
export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/**
 * Resolves on a timer, by which time every promise reaction already queued has run.
 *
 * A case that waits for a state to settle waits this way, so it does not depend on how many turns
 * the settling takes.
 */
export const pause = (milliseconds = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export const STILL_WAITING = 'still waiting';

/** What a promise resolved to, or `STILL_WAITING` for one that outlasts a timer. */
export const settled = <Value>(
  promise: Promise<Value>,
): Promise<Value | typeof STILL_WAITING> =>
  new Promise((resolve, reject) => {
    promise.then(resolve, reject);
    void pause(100).then(() => resolve(STILL_WAITING));
  });

type Answer = (
  context: LocalizationParticipantContext,
) => LocalizationParticipantReport | PromiseLike<LocalizationParticipantReport>;

/**
 * Registers a region that logs each callback as `callback id transition`, and a discard with the
 * status of the report it was handed or `unanswered` for none. A case replaces a callback through
 * `hooks` when the region is to misbehave in it.
 */
export function recorded(
  coordinator: ParticipantCoordinator,
  log: string[],
  id: string,
  answer: Answer = () => READY,
  options: LocalizationParticipantOptions = {},
  hooks: Partial<LocalizationParticipant> = {},
) {
  const contexts: LocalizationParticipantContext[] = [];
  const participant: LocalizationParticipant = {
    id,
    prepare: (context) => {
      contexts.push(context);
      return answer(context);
    },
    commit: (context) => void log.push(`commit ${id} ${context.transitionId}`),
    rollback: (context) =>
      void log.push(`rollback ${id} ${context.transitionId}`),
    discard: (context, report) =>
      void log.push(
        `discard ${id} ${context.transitionId} ${report?.status ?? 'unanswered'}`,
      ),
    dispose: () => void log.push(`dispose ${id}`),
    ...hooks,
  };
  return {
    registration: coordinator.register(participant, options, noRetry),
    /** The context of each preparation, in the order they began. */
    contexts,
  };
}
