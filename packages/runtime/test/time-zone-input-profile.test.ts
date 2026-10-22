import { describe, expect, it } from 'vitest';

import { timeZone } from '../src/formatting.js';
import {
  formatLocalizedInput,
  parseLocalizedInput,
} from '../src/localized-input.js';
import {
  type FormattingContext,
  type LocalizedInputProfile,
  type LocalizedInputStatus,
  type LocalizedInputValue,
} from '@neolorn/equator/core';

/**
 * A time-zone field accepts the zones its profile lists, each under the spellings the profile
 * gives it, and nothing else. A spelling is matched whole: a prefix is a field still being typed,
 * a spelling two zones share is reported and never settled, and the zone is written back under
 * the first spelling listed for it.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });

type ZoneProfile = Extract<LocalizedInputProfile, { kind: 'time-zone' }>;

const ZONES: ZoneProfile = Object.freeze({
  kind: 'time-zone',
  options: [
    { timeZone: 'Europe/Paris', labels: ['Paris', 'CET'] },
    { timeZone: 'America/New_York', labels: ['New York', 'ET'] },
  ],
});

function read(
  text: string,
  profile: object = ZONES,
): { readonly status: LocalizedInputStatus; readonly value?: unknown } {
  return parseLocalizedInput(text, profile as LocalizedInputProfile, EN);
}

function write(
  value: unknown,
  profile: object = ZONES,
): ReturnType<typeof formatLocalizedInput> {
  return formatLocalizedInput(
    value as LocalizedInputValue<LocalizedInputProfile>,
    profile as LocalizedInputProfile,
    EN,
  );
}

function listing(...options: readonly unknown[]): object {
  return { kind: 'time-zone', options };
}

const REFUSED_WRITE = {
  ok: false,
  diagnostic: { code: 'invalid-localized-input' },
};

describe('a time zone read from its listed spellings', () => {
  const READ: readonly (readonly [string, string])[] = [
    ['Paris', 'Europe/Paris'],
    ['CET', 'Europe/Paris'],
    ['New York', 'America/New_York'],
    ['ET', 'America/New_York'],
  ];

  for (const [text, id] of READ) {
    it(`reads ${text} as ${id}`, () => {
      expect(read(text)).toMatchObject({
        status: 'valid',
        value: { kind: 'time-zone', id },
      });
    });
  }

  const REFUSED: readonly (readonly [string, LocalizedInputStatus])[] = [
    ['', 'incomplete'],
    ['Par', 'incomplete'],
    ['New ', 'incomplete'],
    ['E', 'incomplete'],
    ['London', 'invalid'],
    ['paris', 'invalid'],
    ['Paris ', 'invalid'],
    ['aris', 'invalid'],
  ];

  for (const [text, status] of REFUSED) {
    it(`reports "${text}" as ${status}`, () => {
      expect(read(text).status).toBe(status);
    });
  }

  it('reads text typed in another normalization form', () => {
    expect(
      read(
        'Zürich',
        listing({ timeZone: 'Europe/Zurich', labels: ['Zürich'] }),
      ),
    ).toMatchObject({ status: 'valid', value: { id: 'Europe/Zurich' } });
  });

  it('reports a spelling two zones share as ambiguous', () => {
    const shared = listing(
      { timeZone: 'Europe/Paris', labels: ['Central', 'Paris'] },
      { timeZone: 'America/Chicago', labels: ['Chicago', 'Central'] },
    );
    expect(read('Central', shared).status).toBe('ambiguous');
    expect(read('Chicago', shared)).toMatchObject({
      status: 'valid',
      value: { id: 'America/Chicago' },
    });
  });

  it('reads a spelling listed under two names of one zone', () => {
    // A former name and its replacement are one zone, so nothing is left to choose between.
    expect(
      read(
        'India',
        listing(
          { timeZone: 'Asia/Calcutta', labels: ['India'] },
          { timeZone: 'Asia/Kolkata', labels: ['India'] },
        ),
      ),
    ).toMatchObject({ status: 'valid', value: { id: 'Asia/Kolkata' } });
  });
});

describe('a time-zone listing that does not hold together', () => {
  const paris = { timeZone: 'Europe/Paris', labels: ['Paris'] };
  const labelled = (labels: unknown): object => ({
    timeZone: 'Europe/Paris',
    labels,
  });
  const numbered = (count: number, prefix: string): string[] =>
    Array.from({ length: count }, (_, index) => `${prefix}${index}`);

  const REFUSED: readonly (readonly [string, object])[] = [
    ['options that are not a list', { kind: 'time-zone', options: 'Paris' }],
    ['options held in a set', { kind: 'time-zone', options: new Set([paris]) }],
    ['no options', listing()],
    ['257 options', listing(...Array.from({ length: 257 }, () => paris))],
    ['an option that is null', listing(null)],
    ['an option that is not an object', listing('Paris')],
    [
      'an option that is a function',
      listing(Object.assign(() => undefined, paris)),
    ],
    ['labels that are not a list', listing(labelled('Paris'))],
    ['an option with no labels', listing(labelled([]))],
    ['an option with 65 labels', listing(labelled(numbered(65, 'Paris ')))],
    ['an empty label', listing(labelled(['Paris', '']))],
    ['a label of 257 characters', listing(labelled(['P'.repeat(257)]))],
    ['a label that is not NFC', listing(labelled(['Zürich']))],
    ['a label that is not text', listing(labelled([5]))],
    [
      'a zone the platform does not know',
      listing({ timeZone: 'Mars/Phobos', labels: ['Paris'] }),
    ],
    [
      'more than 2048 labels in all',
      listing(
        ...Array.from({ length: 33 }, (_, index) =>
          labelled(numbered(64, `Paris ${index} `)),
        ),
      ),
    ],
  ];

  for (const [title, profile] of REFUSED) {
    it(`refuses ${title}`, () => {
      expect(read('Paris', profile).status).toBe('policy-rejected');
    });

    it(`does not write under ${title}`, () => {
      expect(write(timeZone('Europe/Paris'), profile)).toMatchObject(
        REFUSED_WRITE,
      );
    });
  }

  it('accepts 256 options', () => {
    expect(
      read('Paris', listing(...Array.from({ length: 256 }, () => paris)))
        .status,
    ).toBe('valid');
  });

  it('accepts an option with 64 labels', () => {
    expect(
      read('Paris 63', listing(labelled(numbered(64, 'Paris ')))).status,
    ).toBe('valid');
  });

  it('accepts 2048 labels in all', () => {
    expect(
      read(
        'Paris 31 63',
        listing(
          ...Array.from({ length: 32 }, (_, index) =>
            labelled(numbered(64, `Paris ${index} `)),
          ),
        ),
      ).status,
    ).toBe('valid');
  });

  it('accepts a label of 256 characters', () => {
    const label = 'P'.repeat(256);
    expect(read(label, listing(labelled([label]))).status).toBe('valid');
  });
});

describe('the length of time-zone text', () => {
  it('refuses 257 characters when no limit is declared', () => {
    expect(read('P'.repeat(257)).status).toBe('policy-rejected');
  });

  it('reads past 256 characters under a larger declared limit', () => {
    // Nothing that long can be listed, so the text is read and matches no spelling.
    expect(
      read('P'.repeat(257), { ...ZONES, maximumCharacters: 300 }).status,
    ).toBe('invalid');
  });

  it('reads text exactly as long as the declared limit', () => {
    expect(read('Paris', { ...ZONES, maximumCharacters: 5 }).status).toBe(
      'valid',
    );
  });
});

describe('a time zone written under its first listed spelling', () => {
  it('writes the first spelling and describes it', () => {
    const value = timeZone('Europe/Paris');
    expect(write(value)).toStrictEqual({
      ok: true,
      value: {
        kind: 'formatted-value',
        semantic: 'time-zone',
        text: 'Paris',
        parts: [{ kind: 'literal', value: 'Paris' }],
        locale: 'en-US',
        language: 'en-US',
        direction: 'ltr',
        source: value,
      },
    });
  });

  it('writes the spelling of the zone given, not of the first listed', () => {
    expect(write(timeZone('America/New_York'))).toMatchObject({
      ok: true,
      value: { text: 'New York' },
    });
  });

  it('writes a zone listed under its former name', () => {
    expect(
      write(
        timeZone('Asia/Kolkata'),
        listing({ timeZone: 'Asia/Calcutta', labels: ['India'] }),
      ),
    ).toMatchObject({ ok: true, value: { text: 'India' } });
  });

  it('writes a spelling of 200 characters', () => {
    const label = 'P'.repeat(200);
    expect(
      write(
        timeZone('Europe/Paris'),
        listing({ timeZone: 'Europe/Paris', labels: [label] }),
      ),
    ).toMatchObject({ ok: true, value: { text: label } });
  });

  it('does not write a zone the profile does not list', () => {
    expect(write(timeZone('Asia/Tokyo'))).toMatchObject(REFUSED_WRITE);
  });

  it('does not write a zone the platform does not know', () => {
    expect(write({ kind: 'time-zone', id: 'Mars/Phobos' })).toMatchObject(
      REFUSED_WRITE,
    );
  });

  it('does not write a zone held under a former name', () => {
    // The text would read back as the zone's current name, which is not the value given.
    expect(
      write(
        { kind: 'time-zone', id: 'Asia/Calcutta' },
        listing({ timeZone: 'Asia/Kolkata', labels: ['India'] }),
      ),
    ).toMatchObject(REFUSED_WRITE);
  });

  it('does not write a first spelling another zone shares', () => {
    expect(
      write(
        timeZone('Europe/Paris'),
        listing(
          { timeZone: 'Europe/Paris', labels: ['Central', 'Paris'] },
          { timeZone: 'America/Chicago', labels: ['Central'] },
        ),
      ),
    ).toMatchObject(REFUSED_WRITE);
  });

  it('does not write a spelling longer than the declared limit', () => {
    expect(
      write(timeZone('America/New_York'), { ...ZONES, maximumCharacters: 7 }),
    ).toMatchObject(REFUSED_WRITE);
    expect(
      write(timeZone('America/New_York'), { ...ZONES, maximumCharacters: 8 }),
    ).toMatchObject({ ok: true, value: { text: 'New York' } });
  });

  it('does not write a value of another kind as a time zone', () => {
    expect(write({ kind: 'decimal', value: '5' })).toMatchObject(REFUSED_WRITE);
  });
});
