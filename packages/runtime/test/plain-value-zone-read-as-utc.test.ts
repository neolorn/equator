import { describe, expect, it } from 'vitest';

import { type FormattingContext } from '@neolorn/equator/core';

import {
  formatPlainDateTime,
  formatPlainTime,
  plainDate,
  plainDateTime,
  plainTime,
} from '../src/formatting.js';

/**
 * A zone an operation names for a plain time or a plain date-time.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` sections 2 and 4. A plain value has no zone and
 * is written at its own fields, which is what writing it in UTC does, and the host judges a zone an
 * operation names. Each name below is asked of the host first, so a case states what the host
 * reads it as rather than what the pinned table does.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const OPTIONS = { hour: 'numeric', minute: 'numeric' } as const;
const TIME = plainTime(13, 5);
const DATE_TIME = plainDateTime(plainDate(2024, 3, 14), plainTime(13, 5));

const hostReads = (timeZone: string): string | undefined => {
  try {
    return new Intl.DateTimeFormat('und', { timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    return undefined;
  }
};

const FORMATTERS = [
  [
    'formatPlainTime',
    (timeZone?: string) =>
      formatPlainTime(TIME, EN, {
        ...OPTIONS,
        ...(timeZone === undefined ? {} : { timeZone }),
      }),
  ],
  [
    'formatPlainDateTime',
    (timeZone?: string) =>
      formatPlainDateTime(DATE_TIME, EN, {
        ...OPTIONS,
        ...(timeZone === undefined ? {} : { timeZone }),
      }),
  ],
] as const;

describe.each(FORMATTERS)(
  '%s under a zone the operation names',
  (_, format) => {
    it.each(['Etc/UTC', 'GMT', 'Etc/GMT', 'etc/utc', 'Zulu'])(
      'writes the fields as they are under %s, which the host reads as UTC',
      (timeZone) => {
        expect(hostReads(timeZone)).toBe('UTC');
        const written = format(timeZone);
        expect(written).toMatchObject({ ok: true });
        expect(written.ok && written.value.text).toBe(
          format().ok && (format() as { value: { text: string } }).value.text,
        );
      },
    );

    it('refuses a zone the host reads as another zone', () => {
      expect(hostReads('Europe/London')).toBe('Europe/London');
      const refused = format('Europe/London');
      expect(refused.ok ? 'written' : refused.diagnostic).toMatchObject({
        code: 'unsupported-formatting-capability',
      });
      expect(!refused.ok && refused.diagnostic.reason).toBeFalsy();
    });

    it('refuses a name the host does not read, as what the host lacks', () => {
      expect(hostReads('Mars/Olympus_Mons')).toBeUndefined();
      const refused = format('Mars/Olympus_Mons');
      expect(refused.ok ? 'written' : refused.diagnostic).toMatchObject({
        code: 'unsupported-formatting-capability',
        reason: 'native-capability-rejected',
      });
    });
  },
);
