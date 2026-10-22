/**
 * What a participant's report may carry, and what is refused whole.
 *
 * `specs/06-runtime-and-angular.spec.md` section 8 has a participant report readiness, the
 * representation it actually supplies, and bounded safe identity. A report is written by
 * application code and is the only thing that crosses into the transaction, so it is read as
 * untrusted: one that states a language tag in a spelling other than the canonical one, a
 * direction its language is not written in, or an identity outside the bound is refused, and is
 * never repaired into something the region did not say.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeParticipantReport } from '../src/participant-runtime.js';

const LANGUAGE_INDEPENDENT = Object.freeze({ kind: 'language-independent' });

const ready = (representation: unknown, more: object = {}) =>
  sanitizeParticipantReport({ status: 'ready', representation, ...more });

const identified = (identity: unknown) =>
  ready(LANGUAGE_INDEPENDENT, { identity });

const localeBound = (fields: object) =>
  ready({ kind: 'locale-bound', ...fields });

/** A private-use tag of exactly `length` characters, already in its canonical spelling. */
function tagOfLength(length: number): string {
  const stem = 'en-x';
  const full = Math.floor((length - stem.length) / 9);
  const rest = length - stem.length - full * 9;
  return `${stem}${'-aaaaaaaa'.repeat(full)}${rest === 0 ? '' : `-${'a'.repeat(rest - 1)}`}`;
}

describe('a report that is not a report', () => {
  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a status on its own', 'ready'],
    ['a list', [{ status: 'ready' }]],
    ['a record with no status', { representation: LANGUAGE_INDEPENDENT }],
    ['a status that is not text', { status: 1 }],
  ])('is refused: %s', (_name, value) => {
    expect(sanitizeParticipantReport(value)).toBeUndefined();
  });
});

describe('a ready report', () => {
  it.each([
    ['an outcome, which only the other kinds have', { outcome: 'ready' }],
    ['a code, which only a domain outcome has', { code: 'article/42' }],
    ['a payload', { body: 'the text of the article' }],
  ])('is refused whole with %s', (_name, fields) => {
    expect(ready(LANGUAGE_INDEPENDENT, fields)).toBeUndefined();
  });
});

describe('the identity a report carries', () => {
  it('is kept with every field the participant named', () => {
    const identity = {
      resourceId: 'article/42',
      representationId: 'body@en-US',
      revision: 'r:7',
      correlationId: 'trace.9_a-b',
    };

    expect(identified(identity)).toStrictEqual({
      status: 'ready',
      representation: LANGUAGE_INDEPENDENT,
      identity,
    });
  });

  it('is kept on its own when only the resource is named', () => {
    expect(identified({ resourceId: 'a' })).toStrictEqual({
      status: 'ready',
      representation: LANGUAGE_INDEPENDENT,
      identity: { resourceId: 'a' },
    });
  });

  it('is left out of a report that named none', () => {
    expect(ready(LANGUAGE_INDEPENDENT)).toStrictEqual({
      status: 'ready',
      representation: LANGUAGE_INDEPENDENT,
    });
  });

  it('may be as long as the bound and no longer', () => {
    const longest = `a${'b'.repeat(127)}`;

    expect(identified({ resourceId: longest })?.identity).toStrictEqual({
      resourceId: longest,
    });
    expect(identified({ resourceId: `${longest}b` })).toBeUndefined();
  });

  it.each([
    ['text in place of the record', 'article-42'],
    ['null', null],
    ['a resource that is not text', { resourceId: 42 }],
    ['no resource', { revision: 'r7' }],
    ['an empty resource', { resourceId: '' }],
    ['a resource opening with punctuation', { resourceId: '-article' }],
    ['a resource opening outside the set', { resourceId: '!article' }],
    ['a resource ending outside the set', { resourceId: 'article!' }],
    ['a resource holding a space', { resourceId: 'article 42' }],
    ['a revision ending outside the set', { resourceId: 'a', revision: 'r7?' }],
    ['a revision that is a number', { resourceId: 'a', revision: 7 }],
    ['a correlation that is a number', { resourceId: 'a', correlationId: 7 }],
    [
      'a representation that is null',
      { resourceId: 'a', representationId: null },
    ],
    ['a field the identity does not have', { resourceId: 'a', title: 'b' }],
  ])('refuses the whole report for %s', (_name, identity) => {
    expect(identified(identity)).toBeUndefined();
  });
});

describe('the representation of a ready report', () => {
  it.each([
    ['none', undefined],
    ['null', null],
    ['text', 'locale-bound'],
    ['a kind that is not text', { kind: 1 }],
    ['a kind nothing defines', { kind: 'translated' }],
  ])('is required, and %s is refused', (_name, representation) => {
    expect(ready(representation)).toBeUndefined();
  });

  it('is refused with a direction that is neither of the two', () => {
    expect(
      ready({ kind: 'language-independent', direction: 'sideways' }),
    ).toBeUndefined();
    expect(
      ready({ kind: 'language-independent', direction: 'rtl' }),
    ).toStrictEqual({
      status: 'ready',
      representation: { kind: 'language-independent', direction: 'rtl' },
    });
  });
});

describe('a locale-bound representation', () => {
  it.each([
    ['en-US', 'ltr'],
    ['ar-EG', 'rtl'],
  ])('is kept for %s written %s', (supplyingLocale, direction) => {
    expect(localeBound({ supplyingLocale, direction })).toStrictEqual({
      status: 'ready',
      representation: { kind: 'locale-bound', supplyingLocale, direction },
    });
  });

  it.each([
    ['no supplying locale', { supplyingLocale: undefined }],
    ['a supplying locale that is not text', { supplyingLocale: 5 }],
    ['an empty supplying locale', { supplyingLocale: '' }],
    ['a tag in another spelling', { supplyingLocale: 'en-us' }],
    ['a tag that is not one', { supplyingLocale: 'not a tag' }],
    ['a direction the language is not written in', { direction: 'rtl' }],
    ['a direction that is neither of the two', { direction: 'up' }],
    ['no direction', { direction: undefined }],
    ['a field the kind does not have', { language: 'en-US' }],
  ])('is refused with %s', (_name, fields) => {
    expect(
      localeBound({ supplyingLocale: 'en-US', direction: 'ltr', ...fields }),
    ).toBeUndefined();
  });

  it('is refused for a right-to-left language reported left-to-right', () => {
    expect(
      localeBound({ supplyingLocale: 'ar-EG', direction: 'ltr' }),
    ).toBeUndefined();
  });

  it('takes a language tag as long as the bound and no longer', () => {
    const longest = tagOfLength(128);
    const tooLong = tagOfLength(129);

    expect([longest.length, tooLong.length]).toStrictEqual([128, 129]);
    expect(
      localeBound({ supplyingLocale: longest, direction: 'ltr' }),
    ).toStrictEqual({
      status: 'ready',
      representation: {
        kind: 'locale-bound',
        supplyingLocale: longest,
        direction: 'ltr',
      },
    });
    expect(
      localeBound({ supplyingLocale: tooLong, direction: 'ltr' }),
    ).toBeUndefined();
  });
});

describe.each(['language-independent', 'unknown-language'])(
  'a %s representation',
  (kind) => {
    it('is kept with no direction, which leaves the direction to the renderer', () => {
      expect(ready({ kind })).toStrictEqual({
        status: 'ready',
        representation: { kind },
      });
    });

    it.each(['ltr', 'rtl'])('is kept with the direction %s', (direction) => {
      expect(ready({ kind, direction })).toStrictEqual({
        status: 'ready',
        representation: { kind, direction },
      });
    });

    it.each([
      ['a direction that is neither of the two', { direction: 'auto' }],
      ['a language, which the kind does not have', { language: 'en-US' }],
    ])('is refused with %s', (_name, fields) => {
      expect(ready({ kind, ...fields })).toBeUndefined();
    });
  },
);

describe('a user-authored representation', () => {
  it.each([
    ['nothing more', {}],
    ['a language', { language: 'ar-EG' }],
    ['a direction', { direction: 'rtl' }],
    ['a language and its direction', { language: 'ar-EG', direction: 'rtl' }],
    [
      'another language and its direction',
      { language: 'en-US', direction: 'ltr' },
    ],
  ])('is kept with %s', (_name, fields) => {
    expect(ready({ kind: 'user-authored', ...fields })).toStrictEqual({
      status: 'ready',
      representation: { kind: 'user-authored', ...fields },
    });
  });

  it.each([
    ['a tag in another spelling', { language: 'ar-eg' }],
    ['a language that is not text', { language: 5 }],
    ['a language that is null', { language: null }],
    ['a direction that is neither of the two', { direction: 'auto' }],
    [
      'a direction its language is not written in',
      { language: 'ar-EG', direction: 'ltr' },
    ],
    [
      'a bad direction beside a good language',
      { language: 'en-US', direction: 'auto' },
    ],
    ['a field the kind does not have', { supplyingLocale: 'ar-EG' }],
  ])('is refused with %s', (_name, fields) => {
    expect(ready({ kind: 'user-authored', ...fields })).toBeUndefined();
  });
});

describe('a fixed-language representation', () => {
  it.each([
    ['en-US', 'ltr'],
    ['ar-EG', 'rtl'],
  ])('is kept for %s written %s', (language, direction) => {
    expect(
      ready({ kind: 'fixed-language', language, direction }),
    ).toStrictEqual({
      status: 'ready',
      representation: { kind: 'fixed-language', language, direction },
    });
  });

  it.each([
    ['no language', { language: undefined }],
    [
      'no language, written left to right',
      { language: undefined, direction: 'ltr' },
    ],
    ['a language that is not text', { language: 5 }],
    ['a tag in another spelling', { language: 'AR-EG' }],
    ['no direction', { direction: undefined }],
    ['a direction that is neither of the two', { direction: 'auto' }],
    ['a direction the language is not written in', { direction: 'ltr' }],
    ['a field the kind does not have', { supplyingLocale: 'ar-EG' }],
  ])('is refused with %s', (_name, fields) => {
    expect(
      ready({
        kind: 'fixed-language',
        language: 'ar-EG',
        direction: 'rtl',
        ...fields,
      }),
    ).toBeUndefined();
  });
});

describe('a multilingual representation', () => {
  const LEFT_TO_RIGHT = [
    'en-US',
    'fr-FR',
    'de-DE',
    'es-ES',
    'it-IT',
    'pt-BR',
    'nl-NL',
    'sv-SE',
    'da-DK',
    'fi-FI',
    'pl-PL',
    'cs-CZ',
    'tr-TR',
    'el-GR',
    'ru-RU',
    'ja-JP',
    'ko-KR',
  ].map((language) => ({ language, direction: 'ltr' }));
  const ARABIC = { language: 'ar-EG', direction: 'rtl' };
  const ENGLISH = { language: 'en-US', direction: 'ltr' };

  const multilingual = (languages: unknown, more: object = {}) =>
    ready({ kind: 'multilingual', languages, ...more });

  it('is kept with each language beside the direction it is written in', () => {
    expect(multilingual([ARABIC, ENGLISH])).toStrictEqual({
      status: 'ready',
      representation: { kind: 'multilingual', languages: [ARABIC, ENGLISH] },
    });
  });

  it.each(['ltr', 'rtl'])(
    'is kept with the direction %s of its own',
    (direction) => {
      expect(multilingual([ENGLISH, ARABIC], { direction })).toStrictEqual({
        status: 'ready',
        representation: {
          kind: 'multilingual',
          languages: [ENGLISH, ARABIC],
          direction,
        },
      });
    },
  );

  it('holds sixteen languages and no more', () => {
    const sixteen = LEFT_TO_RIGHT.slice(0, 16);

    expect(multilingual(sixteen)).toStrictEqual({
      status: 'ready',
      representation: { kind: 'multilingual', languages: sixteen },
    });
    expect(LEFT_TO_RIGHT).toHaveLength(17);
    expect(multilingual(LEFT_TO_RIGHT)).toBeUndefined();
  });

  it.each([
    ['no list', undefined, {}],
    ['a record in place of the list', { 0: ARABIC, 1: ENGLISH, length: 2 }, {}],
    ['an empty list', [], {}],
    ['one language', [ARABIC], {}],
    ['a language named twice', [ARABIC, ENGLISH, ARABIC], {}],
    ['an entry that is text', [ARABIC, 'en-US'], {}],
    ['an entry that is null', [ARABIC, null], {}],
    ['an entry with no language', [ARABIC, { direction: 'ltr' }], {}],
    [
      'an entry in another spelling',
      [ARABIC, { ...ENGLISH, language: 'en-us' }],
      {},
    ],
    ['an entry with no direction', [ARABIC, { language: 'en-US' }], {}],
    [
      'an entry with a direction that is neither',
      [ARABIC, { ...ENGLISH, direction: 'auto' }],
      {},
    ],
    [
      'an entry written the other way',
      [ARABIC, { ...ENGLISH, direction: 'rtl' }],
      {},
    ],
    [
      'an entry holding another field',
      [ARABIC, { ...ENGLISH, script: 'Latn' }],
      {},
    ],
    [
      'a direction that is neither of the two',
      [ARABIC, ENGLISH],
      { direction: 'auto' },
    ],
    [
      'a field the kind does not have',
      [ARABIC, ENGLISH],
      { language: 'ar-EG' },
    ],
  ])('is refused with %s', (_name, languages, more) => {
    expect(multilingual(languages, more)).toBeUndefined();
  });
});

describe('an unavailable report', () => {
  const UNAVAILABLE = {
    status: 'unavailable',
    outcome: 'localized-representation-unavailable',
  };

  it('is kept, with the identity it named', () => {
    expect(sanitizeParticipantReport(UNAVAILABLE)).toStrictEqual(UNAVAILABLE);
    expect(
      sanitizeParticipantReport({
        ...UNAVAILABLE,
        identity: { resourceId: 'article/42' },
      }),
    ).toStrictEqual({ ...UNAVAILABLE, identity: { resourceId: 'article/42' } });
  });

  it.each([
    ['no outcome', { outcome: undefined }],
    ['the outcome of another kind', { outcome: 'operational-failure' }],
    [
      'a representation, which it cannot have',
      { representation: LANGUAGE_INDEPENDENT },
    ],
    ['an identity outside the bound', { identity: { resourceId: '' } }],
  ])('is refused with %s', (_name, fields) => {
    expect(
      sanitizeParticipantReport({ ...UNAVAILABLE, ...fields }),
    ).toBeUndefined();
  });
});

describe('a domain outcome', () => {
  const OUTCOME = {
    status: 'domain-outcome',
    outcome: 'consumer-domain-outcome',
    code: 'article/withdrawn',
  };

  it('is kept under the code the application gave it', () => {
    expect(sanitizeParticipantReport(OUTCOME)).toStrictEqual(OUTCOME);
  });

  it('is kept with the representation and the identity it named', () => {
    const full = {
      ...OUTCOME,
      representation: {
        kind: 'fixed-language',
        language: 'ar-EG',
        direction: 'rtl',
      },
      identity: { resourceId: 'article/42', revision: 'r7' },
    };

    expect(sanitizeParticipantReport(full)).toStrictEqual(full);
  });

  it('takes a code as long as the bound and no longer', () => {
    const longest = `a${'b'.repeat(127)}`;

    expect(
      sanitizeParticipantReport({ ...OUTCOME, code: longest }),
    ).toStrictEqual({ ...OUTCOME, code: longest });
    expect(
      sanitizeParticipantReport({ ...OUTCOME, code: `${longest}b` }),
    ).toBeUndefined();
  });

  it.each([
    ['no outcome', { outcome: undefined }],
    ['the outcome of another kind', { outcome: 'operational-failure' }],
    ['no code', { code: undefined }],
    ['a code that is a number', { code: 5 }],
    ['a code holding a space', { code: 'article withdrawn' }],
    [
      'a representation that is refused',
      { representation: { kind: 'translated' } },
    ],
    ['a representation that is null', { representation: null }],
    ['an identity outside the bound', { identity: { resourceId: '' } }],
    ['a field the kind does not have', { reason: 'internal-failure' }],
  ])('is refused with %s', (_name, fields) => {
    expect(
      sanitizeParticipantReport({ ...OUTCOME, ...fields }),
    ).toBeUndefined();
  });
});

describe('a failed report', () => {
  const FAILED = {
    status: 'failed',
    outcome: 'operational-failure',
    reason: 'environment-failure',
  };

  it.each([
    'invalid-configuration',
    'unsupported-capability',
    'compatibility-rejection',
    'security-rejection',
    'environment-failure',
    'internal-failure',
  ])('is kept for the reason %s', (reason) => {
    expect(sanitizeParticipantReport({ ...FAILED, reason })).toStrictEqual({
      ...FAILED,
      reason,
    });
  });

  it('is kept with the identity it named', () => {
    const identity = { resourceId: 'article/42' };

    expect(sanitizeParticipantReport({ ...FAILED, identity })).toStrictEqual({
      ...FAILED,
      identity,
    });
  });

  it.each([
    ['no outcome', { outcome: undefined }],
    ['the outcome of another kind', { outcome: 'consumer-domain-outcome' }],
    ['no reason', { reason: undefined }],
    ['a reason outside the set', { reason: 'out-of-memory' }],
    ['an empty reason', { reason: '' }],
    ['a reason that is not text', { reason: 5 }],
    ['an identity outside the bound', { identity: { resourceId: '' } }],
    ['a message, which a report does not carry', { message: 'ENOENT /srv/a' }],
  ])('is refused with %s', (_name, fields) => {
    expect(sanitizeParticipantReport({ ...FAILED, ...fields })).toBeUndefined();
  });
});

describe('a report of a status nothing defines', () => {
  it.each(['', 'idle', 'prepared', 'Ready'])('is refused: "%s"', (status) => {
    expect(
      sanitizeParticipantReport({
        status,
        representation: LANGUAGE_INDEPENDENT,
      }),
    ).toBeUndefined();
  });
});
