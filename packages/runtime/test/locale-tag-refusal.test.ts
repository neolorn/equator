import { describe, expect, it } from 'vitest';

import {
  contentPresentation,
  languagePresentation,
  resolveTypography,
} from '../src/locale-presentation.js';
import { LocalizationError, localeProfile } from '@neolorn/equator/core';

/**
 * A tag handed to a function that describes it, and that it cannot describe.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 3 refuses three kinds of tag the same
 * way, with the typed failure a malformed locale argument ends as everywhere else: a value that is
 * not text, a tag the platform does not parse, and a tag that names no script and has none in the
 * likely subtags data. Only the second has an error of the platform's to carry, so only the second
 * carries a cause. One handler then reads every refusal these four functions make.
 */

const DESCRIBERS: readonly (readonly [string, (tag: string) => unknown])[] = [
  ['localeProfile', (tag) => localeProfile(tag)],
  ['contentPresentation', (tag) => contentPresentation(tag)],
  ['languagePresentation', (tag) => languagePresentation(tag)],
  ['resolveTypography', (tag) => resolveTypography(tag, {})],
];

function refusal(call: () => unknown): LocalizationError {
  try {
    call();
  } catch (failure) {
    expect(failure).toBeInstanceOf(LocalizationError);
    return failure as LocalizationError;
  }
  throw new Error('The tag was described.');
}

describe.each(DESCRIBERS)('%s', (_name, describeTag) => {
  it('refuses a tag the platform does not parse, with the platform error as the cause', () => {
    for (const tag of ['not a tag', 'en_US', '']) {
      const failure = refusal(() => describeTag(tag));
      expect(failure.diagnostic).toStrictEqual({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: 'A locale tag the platform does not parse has no profile.',
        reason: 'malformed-input',
      });
      expect(failure.cause).toBeInstanceOf(RangeError);
    }
  });

  it('refuses a tag with no script and none likely, with no cause', () => {
    for (const tag of ['tlh', 'tlh-AQ', 'xx']) {
      const failure = refusal(() => describeTag(tag));
      expect(failure.diagnostic).toStrictEqual({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message:
          'A locale tag that names no script and has no likely script has no profile.',
        reason: 'malformed-input',
      });
      expect(failure.cause).toBeUndefined();
    }
  });

  it('refuses a value that is not text, with no cause', () => {
    for (const value of [42, null, new Intl.Locale('en')]) {
      const failure = refusal(() => describeTag(value as unknown as string));
      expect(failure.diagnostic).toStrictEqual({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: 'A locale tag that is not text has no profile.',
        reason: 'malformed-input',
      });
      expect(failure.cause).toBeUndefined();
    }
  });

  it('does not name the tag in the message', () => {
    // A tag handed to these functions can be text a visitor wrote, which section 3 keeps out of a
    // diagnostic's payload.
    const failure = refusal(() => describeTag('<script>'));
    expect(failure.message).not.toContain('<script>');
  });
});
