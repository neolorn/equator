import { describe, expect, it } from 'vitest';

import {
  localizedAsset,
  neutralAsset,
  resolveLocalizedAsset,
} from '../src/assets.js';

/**
 * An asset the application declared neutral takes no part in a locale change.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 14: images, media, files and documents are
 * locale-neutral by default, and a release MUST NOT enroll one in a locale transition unless the
 * application declared a localized variant for it. Resolution is where an asset would be enrolled:
 * a neutral asset resolved for one locale and for another is the same answer, carries no locale,
 * language or direction a transition could move, and is never reported as a fallback, because
 * there was nothing to fall back from.
 */

const source = Object.freeze({ url: '/assets/logo.svg' });

describe('a neutral asset resolved across a locale change', () => {
  it('is the same language-independent representation in every locale', () => {
    const logo = neutralAsset('asset.logo', source);
    const english = resolveLocalizedAsset(logo, { targetLocale: 'en-US' });
    const arabic = resolveLocalizedAsset(logo, {
      targetLocale: 'ar-EG',
      fallbackLocales: ['en-US'],
    });

    for (const resolved of [english, arabic]) {
      expect(resolved).toMatchObject({ status: 'ready', fallback: false });
      expect(
        resolved.status === 'ready' ? resolved.representation : undefined,
      ).toEqual({ kind: 'language-independent', source });
    }
  });

  it('differs from an asset the application declared variants for', () => {
    const cover = localizedAsset('asset.cover', [
      { locale: 'en-US', source: { url: '/assets/cover-en.webp' } },
      { locale: 'ar-EG', source: { url: '/assets/cover-ar.webp' } },
    ]);
    expect(
      resolveLocalizedAsset(cover, { targetLocale: 'ar-EG' }),
    ).toMatchObject({
      status: 'ready',
      representation: { kind: 'locale-bound', supplyingLocale: 'ar-EG' },
    });
  });
});
