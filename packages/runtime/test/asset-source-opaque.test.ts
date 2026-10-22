import { describe, expect, it } from 'vitest';

import {
  fixedLanguageAsset,
  localizedAsset,
  neutralAsset,
  resolveLocalizedAsset,
} from '../src/assets.js';

/**
 * An asset's source is the application's value, handed back as it was handed in.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 14: a declared descriptor's source value is
 * opaque trusted consumer data, and a release MUST NOT construct, parse, or fetch it. A source is
 * whatever the application reaches the asset with (a URL, an import, a record its CDN client
 * understands), so a runtime that copied it, normalized it or read into it would be deciding what
 * the application's own value means.
 *
 * The representation is compared by identity, so a copy that happens to look the same fails, and a
 * source that throws on every read is resolved too, so looking inside it fails.
 */

function untouchable(): object {
  const refuse = (): never => {
    throw new Error('the asset source was read');
  };
  return new Proxy(
    {},
    { get: refuse, ownKeys: refuse, getOwnPropertyDescriptor: refuse },
  );
}

function sourceOf(resolved: ReturnType<typeof resolveLocalizedAsset>): unknown {
  return resolved.status === 'ready'
    ? resolved.representation.source
    : undefined;
}

const descriptors = [
  ['neutral', (source: object) => neutralAsset('asset.logo', source)],
  [
    'fixed-language',
    (source: object) =>
      fixedLanguageAsset('asset.charter', source, 'en-US', 'ltr'),
  ],
  [
    'variant-bearing',
    (source: object) =>
      localizedAsset('asset.cover', [
        { locale: 'en-US', source: { url: '/cover-en.webp' } },
        { locale: 'ar-EG', source },
      ]),
  ],
] as const;

describe('the source a resolved asset carries', () => {
  for (const [kind, declare] of descriptors) {
    it(`is the very value a ${kind} descriptor was given`, () => {
      const source = Object.freeze({ url: '/asset.webp' });
      const resolved = resolveLocalizedAsset(declare(source), {
        targetLocale: 'ar-EG',
      });
      expect(resolved.status).toBe('ready');
      expect(sourceOf(resolved)).toBe(source);
    });

    it(`is never read when a ${kind} descriptor is resolved`, () => {
      const source = untouchable();
      expect(() =>
        resolveLocalizedAsset(declare(source), { targetLocale: 'ar-EG' }),
      ).not.toThrow();
    });
  }

  it('is not required to look like an address', () => {
    // A string no URL parser accepts is still a source, because the application decides.
    const source = 'bucket::covers/2024 #main';
    const resolved = resolveLocalizedAsset(neutralAsset('asset.logo', source), {
      targetLocale: 'en-US',
    });
    expect(sourceOf(resolved)).toBe(source);
  });
});
