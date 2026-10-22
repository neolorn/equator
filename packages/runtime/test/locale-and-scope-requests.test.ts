/**
 * What a locale change is asked for: a locale, and the scopes to have ready in it.
 *
 * Both arrive from application code. `specs/03-locale-identity-and-resolution.spec.md` section 3
 * gives a locale one canonical identity and section 5 lets a consumer name it by an alias, so a
 * request is read as an alias first and as a language tag second, and anything that is neither a
 * locale the consumer supports ends the change as a failure rather than as a thrown error.
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 10 keeps consumer values out of a
 * diagnostic except as bounded identifiers, which is why a value too long to be a locale is
 * refused without being repeated. A scope list is read on the same terms as one scope: it holds
 * generated scopes, each of them once.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationDiagnostic } from '@neolorn/equator/core';

import { PROVIDER, diagnosticOf, scope } from './catalog-store-harness.js';
import {
  LAZY,
  SHELL,
  configured,
  runtime,
} from './transaction-runtime-harness.js';

/** The diagnostic a change to `locale` fails with, without its wording. */
async function refusal(
  locale: unknown,
  fixture: Parameters<typeof runtime>[0] = {},
): Promise<Omit<LocalizationDiagnostic, 'message'> | undefined> {
  const { localization } = runtime(fixture);
  await localization.initialize();
  const result = await localization.changeLocale(locale as string);
  localization.dispose();
  if (result.status !== 'failed') return undefined;
  const { message: _message, ...rest } = result.diagnostic;
  return rest;
}

const UNSUPPORTED = {
  code: 'unsupported-locale',
  outcome: 'operational-failure',
};

describe('the locale a change asks for', () => {
  it('is refused as unsupported, and not read as a tag, when it is not a string', async () => {
    await expect(refusal(5)).resolves.toStrictEqual(UNSUPPORTED);
    await expect(refusal(undefined)).resolves.toStrictEqual(UNSUPPORTED);
    await expect(refusal(['ar-EG'])).resolves.toStrictEqual(UNSUPPORTED);
  });

  it('is refused as unsupported, and not as a malformed tag, when it is empty', async () => {
    await expect(refusal('')).resolves.toStrictEqual(UNSUPPORTED);
  });

  it('is refused without being named when it is longer than 128 code units', async () => {
    // Well formed as a tag, so only its length stands between it and the diagnostic.
    const long = `ar-x-${Array.from({ length: 14 }, () => 'abcdefgh').join('-')}`;

    expect(long).toHaveLength(130);
    await expect(refusal(long)).resolves.toStrictEqual(UNSUPPORTED);
  });

  it('is refused as malformed when it is not a language tag', async () => {
    await expect(refusal('not a locale')).resolves.toStrictEqual({
      ...UNSUPPORTED,
      reason: 'malformed-input',
    });
  });

  it('is refused by name when it is a locale the consumer does not support', async () => {
    await expect(refusal('fr-FR')).resolves.toStrictEqual({
      ...UNSUPPORTED,
      targetLocale: 'fr-FR',
    });
  });

  it('is found under a spelling that canonicalizes to a supported locale', async () => {
    const { localization } = runtime();
    await localization.initialize();

    await expect(localization.changeLocale('AR-eg')).resolves.toMatchObject({
      status: 'committed',
      targetLocale: 'ar-EG',
    });
    localization.dispose();
  });

  it('is found under an alias that is not itself a language tag', async () => {
    const { localization } = runtime({
      set: configured('aliases', { 'arabic (egypt)': 'ar-EG' }),
    });
    await localization.initialize();

    await expect(
      localization.changeLocale('arabic (egypt)'),
    ).resolves.toMatchObject({ status: 'committed', targetLocale: 'ar-EG' });
    localization.dispose();
  });

  it('is found under an alias of exactly 128 code units', async () => {
    const alias = 'a'.repeat(128);
    const { localization } = runtime({
      set: configured('aliases', { [alias]: 'ar-EG' }),
    });
    await localization.initialize();

    await expect(localization.changeLocale(alias)).resolves.toMatchObject({
      status: 'committed',
      targetLocale: 'ar-EG',
    });
    localization.dispose();
  });
});

describe('the scopes a change asks for', () => {
  const UNKNOWN = scope('nowhere');

  async function asked(requiredScopes: unknown) {
    const { localization } = runtime();
    await localization.initialize();
    try {
      return diagnosticOf(() =>
        localization.changeLocale('ar-EG', {
          requiredScopes: requiredScopes as never,
        }),
      );
    } finally {
      localization.dispose();
    }
  }

  it('are admitted as every generated scope, each named once', async () => {
    await expect(asked([SHELL, LAZY])).resolves.toBeUndefined();
  });

  it('are refused as malformed when they are not a list', async () => {
    await expect(asked({ length: 1, 0: SHELL })).resolves.toMatchObject({
      code: 'invalid-configuration',
    });
  });

  it('are refused as malformed, before any is looked up, when there are more than were generated', async () => {
    // Three names against two generated scopes. Looked up one by one, the third would be reported
    // as a scope nobody generated.
    await expect(asked([SHELL, LAZY, UNKNOWN])).resolves.toMatchObject({
      code: 'invalid-configuration',
    });
  });

  it('are refused as malformed when one scope is named twice', async () => {
    await expect(asked([SHELL, SHELL])).resolves.toMatchObject({
      code: 'invalid-configuration',
    });
  });

  it('are refused by name when one of them was never generated', async () => {
    const diagnostic = await asked([SHELL, UNKNOWN]);

    expect(diagnostic).toMatchObject({
      code: 'scope-unavailable',
      providerId: PROVIDER,
      scopeId: 'nowhere',
    });
  });
});
