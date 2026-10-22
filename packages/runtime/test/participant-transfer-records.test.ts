/**
 * The participant records a browser takes from a server-rendered document.
 *
 * `specs/06-runtime-and-angular.spec.md` section 10 has the server transfer each region's record,
 * and `specs/05-compiled-artifacts-and-trust.spec.md` section 2 has the browser revalidate what it
 * is handed. The records arrive inside the document, where anything could have rewritten them, so
 * they are admitted as a whole or not at all: one record that names a region badly, shows a report
 * a commit could not have produced, or describes an attempt its own report contradicts refuses the
 * list, and nothing in it is repaired.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeParticipantTransferRecords } from '../src/participant-runtime.js';

const PROFILE = 'equator-participant-state/1';

const READY = {
  status: 'ready',
  representation: { kind: 'language-independent' },
};
const UNAVAILABLE = {
  status: 'unavailable',
  outcome: 'localized-representation-unavailable',
};
const WITHDRAWN = {
  status: 'domain-outcome',
  outcome: 'consumer-domain-outcome',
  code: 'article/withdrawn',
};
const FAILED = {
  status: 'failed',
  outcome: 'operational-failure',
  reason: 'environment-failure',
};

const CURRENT = { targetLocale: 'ar-EG', transitionId: 4, report: READY };

const record = (more: object = {}) => ({
  profile: PROFILE,
  participantId: 'region',
  coordination: 'required',
  ...more,
});

const attempt = (status: string, more: object = {}) => ({
  status,
  targetLocale: 'ar-EG',
  transitionId: 4,
  ...more,
});

const admitted = (more: object) =>
  sanitizeParticipantTransferRecords([record(more)]);

describe('a list of participant records', () => {
  it('is admitted as it was written', () => {
    const records = [
      record({
        current: CURRENT,
        attempt: attempt('ready', { report: READY }),
      }),
      record({ participantId: 'sidebar', coordination: 'progressive' }),
    ];

    expect(sanitizeParticipantTransferRecords(records)).toStrictEqual(records);
    expect(sanitizeParticipantTransferRecords([])).toStrictEqual([]);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['one record outside a list', record()],
    ['text', 'region'],
  ])('is refused when it is %s', (_name, value) => {
    expect(sanitizeParticipantTransferRecords(value)).toBeUndefined();
  });

  it('holds as many records as a registry holds participants, and no more', () => {
    const records = Array.from({ length: 129 }, (_unused, index) =>
      record({ participantId: `region-${index}` }),
    );

    expect(
      sanitizeParticipantTransferRecords(records.slice(0, 128)),
    ).toStrictEqual(records.slice(0, 128));
    expect(sanitizeParticipantTransferRecords(records)).toBeUndefined();
  });

  it('is refused when two records name one region', () => {
    expect(
      sanitizeParticipantTransferRecords([
        record(),
        record({ participantId: 'sidebar' }),
        record({ coordination: 'progressive' }),
      ]),
    ).toBeUndefined();
  });

  it.each([
    ['is null', null],
    ['is text', 'region'],
    ['is a list', [record()]],
    ['holds a field a record does not have', record({ payload: 'a headline' })],
    ['has no profile', record({ profile: undefined })],
    [
      'is of another profile',
      record({ profile: 'equator-participant-state/2' }),
    ],
    ['names no region', record({ participantId: undefined })],
    ['names a region with a number', record({ participantId: 5 })],
    ['names a region outside the set', record({ participantId: 'region one' })],
    [
      'names a region past the bound',
      record({ participantId: 'r'.repeat(129) }),
    ],
    ['has no mode', record({ coordination: undefined })],
    ['has a mode nothing defines', record({ coordination: 'optional' })],
    ['shows something that is null', record({ current: null })],
    ['attempted something that is null', record({ attempt: null })],
  ])('is refused when a record %s', (_name, item) => {
    expect(
      sanitizeParticipantTransferRecords([
        record({ participantId: 'first' }),
        item,
      ]),
    ).toBeUndefined();
  });
});

describe('what a transferred record says the region shows', () => {
  it.each([
    ['a ready report', { report: READY }],
    ['an unavailable report', { report: UNAVAILABLE }],
    ['a domain outcome', { report: WITHDRAWN }],
    ['the first transition of a context', { transitionId: 0 }],
    [
      'the largest transition a context can count',
      { transitionId: Number.MAX_SAFE_INTEGER },
    ],
  ])('is kept for %s', (_name, fields) => {
    const current = { ...CURRENT, ...fields };

    expect(admitted({ current })).toStrictEqual([record({ current })]);
  });

  it.each([
    ['text in its place', 'ar-EG'],
    ['a list in its place', [CURRENT]],
    ['a field it does not have', { ...CURRENT, payload: 'a headline' }],
    ['no locale', { ...CURRENT, targetLocale: undefined }],
    ['a locale in another spelling', { ...CURRENT, targetLocale: 'ar-eg' }],
    ['a locale that is not text', { ...CURRENT, targetLocale: 5 }],
    ['no transition', { ...CURRENT, transitionId: undefined }],
    ['a transition that is text', { ...CURRENT, transitionId: '4' }],
    ['a transition below zero', { ...CURRENT, transitionId: -1 }],
    ['a fractional transition', { ...CURRENT, transitionId: 1.5 }],
    [
      'a transition past what can be counted',
      { ...CURRENT, transitionId: 2 ** 53 },
    ],
    ['no report', { ...CURRENT, report: undefined }],
    ['a report that is refused', { ...CURRENT, report: { status: 'ready' } }],
    ['a failed report, which nothing commits', { ...CURRENT, report: FAILED }],
  ])('refuses the list for %s', (_name, current) => {
    expect(admitted({ current })).toBeUndefined();
  });
});

describe('what a transferred record says the region last attempted', () => {
  it.each([
    ['still preparing', attempt('preparing')],
    ['prepared with a ready report', attempt('prepared', { report: READY })],
    [
      'prepared with an unavailable report',
      attempt('prepared', { report: UNAVAILABLE }),
    ],
    ['ready', attempt('ready', { report: READY })],
    ['unavailable', attempt('unavailable', { report: UNAVAILABLE })],
    ['a domain outcome', attempt('domain-outcome', { report: WITHDRAWN })],
    ['failed with the report it made', attempt('failed', { report: FAILED })],
    ['failed before it reported', attempt('failed')],
    ['made in the first transition', attempt('preparing', { transitionId: 0 })],
  ])('is kept for an attempt %s', (_name, value) => {
    expect(admitted({ attempt: value })).toStrictEqual([
      record({ attempt: value }),
    ]);
  });

  it.each([
    ['text in its place', 'ready'],
    ['a list in its place', [attempt('preparing')]],
    [
      'a field it does not have',
      attempt('preparing', { diagnostic: { code: 'x' } }),
    ],
    ['no status', attempt('preparing', { status: undefined })],
    ['a status nothing defines', attempt('retrying')],
    ['an idle status', attempt('idle')],
    ['a cancelled status', attempt('cancelled', { report: READY })],
    ['a superseded status', attempt('superseded')],
    ['no locale', attempt('preparing', { targetLocale: undefined })],
    [
      'a locale in another spelling',
      attempt('preparing', { targetLocale: 'AR-EG' }),
    ],
    ['no transition', attempt('preparing', { transitionId: undefined })],
    ['a transition below zero', attempt('preparing', { transitionId: -1 })],
    ['a fractional transition', attempt('preparing', { transitionId: 0.5 })],
    ['a transition that is text', attempt('preparing', { transitionId: '4' })],
    [
      'a refused report while preparing',
      attempt('preparing', { report: { status: 'ready' } }),
    ],
    [
      'a refused report after failing',
      attempt('failed', { report: { status: 'failed' } }),
    ],
    ['a report while still preparing', attempt('preparing', { report: READY })],
    ['a prepared status and no report', attempt('prepared')],
    ['a ready status and no report', attempt('ready')],
    ['an unavailable status and no report', attempt('unavailable')],
    ['a domain outcome and no report', attempt('domain-outcome')],
    [
      'a ready status over an unavailable report',
      attempt('ready', { report: UNAVAILABLE }),
    ],
    [
      'an unavailable status over a ready report',
      attempt('unavailable', { report: READY }),
    ],
    [
      'a failed status over a ready report',
      attempt('failed', { report: READY }),
    ],
    [
      'a ready status over a failed report',
      attempt('ready', { report: FAILED }),
    ],
  ])('refuses the list for %s', (_name, value) => {
    expect(admitted({ attempt: value })).toBeUndefined();
  });
});
