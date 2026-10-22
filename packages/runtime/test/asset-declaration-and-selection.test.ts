import { describe, expect, it } from 'vitest';

import { canonicalizeLanguageTag } from '@neolorn/equator/core';
import {
  dynamicAssetParticipantReport,
  fixedLanguageAsset,
  localizedAsset,
  neutralAsset,
  resolveLocalizedAsset,
  type LocalizedAssetDescriptor,
  type LocalizedAssetFallback,
  type LocalizedAssetMetadata,
} from '../src/assets.js';
import { refusalOf } from './compiled-artifact-harness.js';

/**
 * What an application may declare about an asset, and what selection answers for it.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 14: a declared descriptor is neutral,
 * variant-bearing, or fixed-language; selection takes one canonical target locale and an explicit
 * ordered fallback list of at most thirty-two locales beside it, guesses nothing, and answers
 * either a ready result naming the representation and whether it fell back, or an unavailable
 * one. A report about a dynamic asset is rebuilt from bounded status, outcome, identity and
 * representation metadata alone.
 *
 * A descriptor can be written by hand as well as through the three declaring functions, so every
 * bound is held again where a descriptor is resolved.
 */

const SOURCE: object = Object.freeze({ url: '/assets/a.webp' });
const OTHER: object = Object.freeze({ url: '/assets/b.webp' });
const REFUSED = 'invalid-configuration';

function refusalCode(run: () => unknown): string {
  return refusalOf(run).diagnostic.code;
}

/** A private-use tag is canonical at any length the grammar allows, so only the bound refuses it. */
function tagOfLength(length: number): string {
  let tag = 'en-x';
  while (tag.length + 9 <= length) tag += '-aaaaaaaa';
  const rest = length - tag.length;
  return rest === 0 ? tag : `${tag}-${'a'.repeat(rest - 1)}`;
}

function distinctLocales(count: number): readonly string[] {
  return Array.from(
    { length: count },
    (_, index) => `en-x-v${String(index).padStart(3, '0')}`,
  );
}

const variantsOf = (locales: readonly string[]) =>
  locales.map((locale) => ({ locale, source: { url: `/assets/${locale}` } }));

const ACCEPTED_IDENTITIES = [
  ['one character', 'a'],
  ['a leading digit', '7up'],
  ['every punctuation mark the grammar allows', 'A0._:-z'],
  ['128 characters', 'a'.repeat(128)],
] as const;

const REFUSED_IDENTITIES = [
  ['empty', ''],
  ['129 characters', 'a'.repeat(129)],
  ['led by punctuation', '.logo'],
  ['led by a character outside the grammar', '!logo'],
  ['ended by a character outside the grammar', 'logo!'],
  ['broken by a space', 'lo go'],
  ['a path', 'assets/logo'],
] as const;

describe('an asset identity', () => {
  it.each(ACCEPTED_IDENTITIES)('is accepted with %s', (_label, id) => {
    expect(neutralAsset(id, SOURCE).id).toBe(id);
    expect(
      dynamicAssetParticipantReport({ assetId: id, status: 'unavailable' }),
    ).toMatchObject({ identity: { resourceId: id } });
  });

  it.each(REFUSED_IDENTITIES)(
    'is refused by every declaration when %s',
    (_label, id) => {
      expect(refusalCode(() => neutralAsset(id, SOURCE))).toBe(REFUSED);
      expect(
        refusalCode(() =>
          localizedAsset(id, [{ locale: 'en-US', source: SOURCE }]),
        ),
      ).toBe(REFUSED);
      expect(
        refusalCode(() => fixedLanguageAsset(id, SOURCE, 'en-US', 'ltr')),
      ).toBe(REFUSED);
    },
  );

  it.each(REFUSED_IDENTITIES)(
    'is refused on a hand-written descriptor when %s',
    (_label, id) => {
      const written: LocalizedAssetDescriptor<object> = {
        kind: 'neutral',
        id,
        source: SOURCE,
      };
      expect(
        refusalCode(() =>
          resolveLocalizedAsset(written, { targetLocale: 'en-US' }),
        ),
      ).toBe(REFUSED);
    },
  );

  it.each(REFUSED_IDENTITIES)(
    'is refused in a participant report when %s',
    (_label, id) => {
      expect(
        refusalCode(() =>
          dynamicAssetParticipantReport({ assetId: id, status: 'unavailable' }),
        ),
      ).toBe(REFUSED);
    },
  );
});

describe('the language of a fixed-language asset', () => {
  it('is accepted in its canonical spelling, with either direction', () => {
    expect(
      fixedLanguageAsset('doc.deed', SOURCE, 'en-US', 'ltr'),
    ).toStrictEqual({
      kind: 'fixed-language',
      id: 'doc.deed',
      source: SOURCE,
      language: 'en-US',
      direction: 'ltr',
    });
    expect(
      fixedLanguageAsset('doc.deed', SOURCE, 'ar-EG', 'rtl').direction,
    ).toBe('rtl');
  });

  it('is frozen and carries the source it was given', () => {
    const deed = fixedLanguageAsset('doc.deed', SOURCE, 'en-US', 'ltr');
    expect(Object.isFrozen(deed)).toBe(true);
    expect(deed.source).toBe(SOURCE);
  });

  it.each([
    ['in another casing', 'en-us'],
    ['in upper case', 'EN'],
    ['under a deprecated code', 'iw-IL'],
    ['empty', ''],
    ['not a language tag', 'not a tag'],
  ])('is refused %s', (_label, language) => {
    expect(
      refusalCode(() =>
        fixedLanguageAsset('doc.deed', SOURCE, language, 'ltr'),
      ),
    ).toBe(REFUSED);
  });

  it('is accepted at 64 characters and refused at 65', () => {
    const atBound = tagOfLength(64);
    const pastBound = tagOfLength(65);
    // Both are canonical, so the length is the only thing that separates them.
    expect([atBound.length, canonicalizeLanguageTag(atBound)]).toStrictEqual([
      64,
      atBound,
    ]);
    expect([
      pastBound.length,
      canonicalizeLanguageTag(pastBound),
    ]).toStrictEqual([65, pastBound]);
    expect(
      fixedLanguageAsset('doc.deed', SOURCE, atBound, 'ltr').language,
    ).toBe(atBound);
    expect(
      refusalCode(() =>
        fixedLanguageAsset('doc.deed', SOURCE, pastBound, 'ltr'),
      ),
    ).toBe(REFUSED);
  });

  it.each([['auto'], ['LTR'], [''], [undefined]])(
    'is refused with the direction %j',
    (direction) => {
      expect(
        refusalCode(() =>
          fixedLanguageAsset('doc.deed', SOURCE, 'en-US', direction as never),
        ),
      ).toBe(REFUSED);
    },
  );

  it('is refused when only the language is wrong, and when only the direction is', () => {
    expect(
      refusalCode(() => fixedLanguageAsset('doc.deed', SOURCE, 'en-us', 'rtl')),
    ).toBe(REFUSED);
    expect(
      refusalCode(() =>
        fixedLanguageAsset('doc.deed', SOURCE, 'ar-EG', 'sideways' as never),
      ),
    ).toBe(REFUSED);
  });
});

describe('a neutral asset declaration', () => {
  it('is a frozen descriptor of its kind, identity and source', () => {
    const logo = neutralAsset('asset.logo', SOURCE);
    expect(logo).toStrictEqual({
      kind: 'neutral',
      id: 'asset.logo',
      source: SOURCE,
    });
    expect(Object.isFrozen(logo)).toBe(true);
  });
});

describe('the variants of a localized asset', () => {
  it('are refused when there are none', () => {
    expect(refusalCode(() => localizedAsset('asset.cover', []))).toBe(REFUSED);
  });

  it('are accepted at 256 and refused at 257', () => {
    expect(
      localizedAsset('asset.cover', variantsOf(distinctLocales(256))).variants,
    ).toHaveLength(256);
    expect(
      refusalCode(() =>
        localizedAsset('asset.cover', variantsOf(distinctLocales(257))),
      ),
    ).toBe(REFUSED);
  });

  it('are refused when one names a locale that is not canonical', () => {
    expect(
      refusalCode(() =>
        localizedAsset('asset.cover', [
          { locale: 'en-US', source: SOURCE },
          { locale: 'ar-eg', source: OTHER },
        ]),
      ),
    ).toBe(REFUSED);
  });

  it('are refused when two name the same locale', () => {
    expect(
      refusalCode(() =>
        localizedAsset('asset.cover', [
          { locale: 'en-US', source: SOURCE },
          { locale: 'ar-EG', source: OTHER },
          { locale: 'en-US', source: OTHER },
        ]),
      ),
    ).toBe(REFUSED);
  });

  it.each([
    ['two written in reverse', ['fr-FR', 'ar-EG']],
    ['two written in order', ['ar-EG', 'fr-FR']],
    ['five interleaved', ['ar-EG', 'es-ES', 'de-DE', 'fr-FR', 'en-US']],
    ['five rotated', ['en-US', 'es-ES', 'fr-FR', 'ar-EG', 'de-DE']],
    ['nine in reverse', [...distinctLocales(9)].reverse()],
    [
      'sixty-four in strides',
      distinctLocales(64).map(
        (_, index, all) => all[(index * 7) % all.length] as string,
      ),
    ],
  ])('are sorted by locale from %s', (_label, written) => {
    const descriptor = localizedAsset('asset.cover', variantsOf(written));
    expect(descriptor.variants.map(({ locale }) => locale)).toStrictEqual(
      [...written].sort(),
    );
  });

  it('keep each source beside its own locale and are frozen', () => {
    const descriptor = localizedAsset('asset.cover', [
      { locale: 'fr-FR', source: OTHER },
      { locale: 'ar-EG', source: SOURCE },
    ]);
    expect(descriptor).toStrictEqual({
      kind: 'localized-variants',
      id: 'asset.cover',
      variants: [
        { locale: 'ar-EG', source: SOURCE },
        { locale: 'fr-FR', source: OTHER },
      ],
    });
    expect(descriptor.variants[0]?.source).toBe(SOURCE);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.variants)).toBe(true);
    expect(descriptor.variants.every((each) => Object.isFrozen(each))).toBe(
      true,
    );
  });

  it('carry nothing a variant held beyond its locale and source', () => {
    const written = { locale: 'en-US', source: SOURCE, weight: 3 };
    expect(localizedAsset('asset.cover', [written]).variants).toStrictEqual([
      { locale: 'en-US', source: SOURCE },
    ]);
  });
});

describe('the declared fallback of a localized asset', () => {
  const variants = [{ locale: 'en-US', source: SOURCE }];

  it('is absent from a descriptor declared without one', () => {
    expect(
      Object.hasOwn(localizedAsset('asset.cover', variants), 'fallback'),
    ).toBe(false);
  });

  it('is kept as a frozen language-independent source', () => {
    const { fallback } = localizedAsset('asset.cover', variants, {
      kind: 'language-independent',
      source: OTHER,
      note: 'dropped',
    } as LocalizedAssetFallback<object>);
    expect(fallback).toStrictEqual({
      kind: 'language-independent',
      source: OTHER,
    });
    expect(fallback?.source).toBe(OTHER);
    expect(Object.isFrozen(fallback)).toBe(true);
  });

  it('is kept as a frozen source in one named language', () => {
    const { fallback } = localizedAsset('asset.cover', variants, {
      kind: 'fixed-language',
      source: OTHER,
      language: 'ar-EG',
      direction: 'rtl',
      note: 'dropped',
    } as LocalizedAssetFallback<object>);
    expect(fallback).toStrictEqual({
      kind: 'fixed-language',
      source: OTHER,
      language: 'ar-EG',
      direction: 'rtl',
    });
    expect(fallback?.source).toBe(OTHER);
    expect(Object.isFrozen(fallback)).toBe(true);
  });

  it.each([
    [
      'names a kind outside the two',
      { kind: 'other', source: OTHER, language: 'ar-EG', direction: 'rtl' },
    ],
    [
      'names a language that is not canonical',
      {
        kind: 'fixed-language',
        source: OTHER,
        language: 'ar-eg',
        direction: 'rtl',
      },
    ],
    [
      'names no language',
      { kind: 'fixed-language', source: OTHER, language: '', direction: 'rtl' },
    ],
    [
      'names a direction outside the two',
      {
        kind: 'fixed-language',
        source: OTHER,
        language: 'ar-EG',
        direction: 'auto',
      },
    ],
  ])('is refused when it %s', (_label, fallback) => {
    expect(
      refusalCode(() =>
        localizedAsset('asset.cover', variants, fallback as never),
      ),
    ).toBe(REFUSED);
  });
});

describe('the locales an asset is selected over', () => {
  const logo = neutralAsset('asset.logo', SOURCE);

  it('are the target alone when the request names no fallback', () => {
    const resolved = resolveLocalizedAsset(logo, { targetLocale: 'ar-EG' });
    expect(resolved.attemptedLocales).toStrictEqual(['ar-EG']);
    expect(resolved.targetLocale).toBe('ar-EG');
  });

  it('are the target and then the fallbacks in the order given, each once', () => {
    const resolved = resolveLocalizedAsset(logo, {
      targetLocale: 'ar-EG',
      fallbackLocales: ['fr-FR', 'ar-EG', 'en-US', 'fr-FR', 'en-US'],
    });
    expect(resolved.attemptedLocales).toStrictEqual([
      'ar-EG',
      'fr-FR',
      'en-US',
    ]);
    expect(Object.isFrozen(resolved.attemptedLocales)).toBe(true);
  });

  it.each([['ar-eg'], [''], ['not a tag'], [tagOfLength(65)]])(
    'are refused for the target %j',
    (targetLocale) => {
      expect(
        refusalCode(() => resolveLocalizedAsset(logo, { targetLocale })),
      ).toBe(REFUSED);
    },
  );

  it.each([['en-us'], [''], [tagOfLength(65)]])(
    'are refused for the fallback %j',
    (fallback) => {
      expect(
        refusalCode(() =>
          resolveLocalizedAsset(logo, {
            targetLocale: 'ar-EG',
            fallbackLocales: ['fr-FR', fallback],
          }),
        ),
      ).toBe(REFUSED);
    },
  );

  it('take thirty-two fallbacks beside the target and refuse a thirty-third', () => {
    const fallbacks = distinctLocales(33);
    expect(
      resolveLocalizedAsset(logo, {
        targetLocale: 'ar-EG',
        fallbackLocales: fallbacks.slice(0, 32),
      }).attemptedLocales,
    ).toHaveLength(33);
    expect(
      refusalCode(() =>
        resolveLocalizedAsset(logo, {
          targetLocale: 'ar-EG',
          fallbackLocales: fallbacks,
        }),
      ),
    ).toBe(REFUSED);
  });
});

describe('the descriptive copy a selection carries', () => {
  const logo = neutralAsset('asset.logo', SOURCE);
  const text = (value: string) => ({ text: value }) as never;
  const FIELDS = ['alt', 'caption', 'transcript', 'label', 'description'];

  it('is an empty frozen record when the request brings none', () => {
    const { metadata } = resolveLocalizedAsset(logo, { targetLocale: 'en-US' });
    expect(metadata).toStrictEqual({});
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  it.each(FIELDS.map((field) => [field]))(
    'is the %s alone when that is all the request brings',
    (field) => {
      const value = text(field);
      const { metadata } = resolveLocalizedAsset(logo, {
        targetLocale: 'en-US',
        metadata: { [field]: value } as LocalizedAssetMetadata,
      });
      expect(metadata).toStrictEqual({ [field]: value });
      expect((metadata as Record<string, unknown>)[field]).toBe(value);
    },
  );

  it('is every field the request brings and nothing else it held', () => {
    const brought = Object.fromEntries(
      FIELDS.map((field) => [field, text(field)]),
    );
    const { metadata } = resolveLocalizedAsset(logo, {
      targetLocale: 'en-US',
      metadata: { ...brought, payload: 'dropped' } as LocalizedAssetMetadata,
    });
    expect(metadata).toStrictEqual(brought);
    expect(Object.isFrozen(metadata)).toBe(true);
  });
});

describe('selection for a neutral or fixed-language asset', () => {
  it('answers the one neutral source, ready and not a fallback', () => {
    const resolved = resolveLocalizedAsset(neutralAsset('asset.logo', SOURCE), {
      targetLocale: 'ar-EG',
      fallbackLocales: ['en-US'],
    });
    expect(resolved).toStrictEqual({
      assetId: 'asset.logo',
      targetLocale: 'ar-EG',
      attemptedLocales: ['ar-EG', 'en-US'],
      metadata: {},
      status: 'ready',
      fallback: false,
      representation: { kind: 'language-independent', source: SOURCE },
    });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('answers a fixed-language source with its own language and direction', () => {
    const resolved = resolveLocalizedAsset(
      fixedLanguageAsset('doc.deed', SOURCE, 'ar-EG', 'rtl'),
      { targetLocale: 'en-US' },
    );
    expect(resolved).toStrictEqual({
      assetId: 'doc.deed',
      targetLocale: 'en-US',
      attemptedLocales: ['en-US'],
      metadata: {},
      status: 'ready',
      fallback: false,
      representation: {
        kind: 'fixed-language',
        source: SOURCE,
        language: 'ar-EG',
        direction: 'rtl',
      },
    });
  });

  it.each([
    ['a language that is not canonical', { language: 'ar-eg' }],
    ['a direction outside the two', { direction: 'auto' }],
  ])(
    'refuses a hand-written fixed-language descriptor with %s',
    (_l, wrong) => {
      const written = {
        kind: 'fixed-language',
        id: 'doc.deed',
        source: SOURCE,
        language: 'ar-EG',
        direction: 'rtl',
        ...wrong,
      } as LocalizedAssetDescriptor<object>;
      expect(
        refusalCode(() =>
          resolveLocalizedAsset(written, { targetLocale: 'en-US' }),
        ),
      ).toBe(REFUSED);
    },
  );

  it('refuses a hand-written descriptor of a kind outside the three', () => {
    const written = {
      kind: 'gallery',
      id: 'asset.cover',
      variants: [{ locale: 'en-US', source: SOURCE }],
    } as unknown as LocalizedAssetDescriptor<object>;
    expect(
      refusalCode(() =>
        resolveLocalizedAsset(written, { targetLocale: 'en-US' }),
      ),
    ).toBe(REFUSED);
  });
});

describe('selection among declared variants', () => {
  const english: object = Object.freeze({ url: '/cover-en.webp' });
  const arabic: object = Object.freeze({ url: '/cover-ar.webp' });
  const declared = [
    { locale: 'en-US', source: english },
    { locale: 'ar-EG', source: arabic },
  ];

  it('answers the target locale itself and reports no fallback', () => {
    expect(
      resolveLocalizedAsset(localizedAsset('asset.cover', declared), {
        targetLocale: 'ar-EG',
        fallbackLocales: ['en-US'],
      }),
    ).toStrictEqual({
      assetId: 'asset.cover',
      targetLocale: 'ar-EG',
      attemptedLocales: ['ar-EG', 'en-US'],
      metadata: {},
      status: 'ready',
      fallback: false,
      representation: {
        kind: 'locale-bound',
        source: arabic,
        supplyingLocale: 'ar-EG',
        language: 'ar',
        direction: 'rtl',
      },
    });
  });

  it('answers the first fallback that has a variant and reports the fallback', () => {
    const resolved = resolveLocalizedAsset(
      localizedAsset('asset.cover', declared),
      {
        targetLocale: 'fr-FR',
        fallbackLocales: ['de-DE', 'en-US', 'ar-EG'],
      },
    );
    expect(resolved).toMatchObject({
      status: 'ready',
      fallback: true,
      representation: {
        kind: 'locale-bound',
        source: english,
        supplyingLocale: 'en-US',
        language: 'en',
        direction: 'ltr',
      },
    });
  });

  it('does not widen a regional target to its language', () => {
    const resolved = resolveLocalizedAsset(
      localizedAsset('asset.cover', [{ locale: 'fr', source: english }]),
      { targetLocale: 'fr-CA' },
    );
    expect(resolved.status).toBe('unavailable');
  });

  it('answers the language-independent fallback when no locale has a variant', () => {
    const resolved = resolveLocalizedAsset(
      localizedAsset('asset.cover', declared, {
        kind: 'language-independent',
        source: OTHER,
      }),
      { targetLocale: 'fr-FR', fallbackLocales: ['de-DE'] },
    );
    expect(resolved).toStrictEqual({
      assetId: 'asset.cover',
      targetLocale: 'fr-FR',
      attemptedLocales: ['fr-FR', 'de-DE'],
      metadata: {},
      status: 'ready',
      fallback: true,
      representation: { kind: 'language-independent', source: OTHER },
    });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('answers the fixed-language fallback when no locale has a variant', () => {
    const resolved = resolveLocalizedAsset(
      localizedAsset('asset.cover', declared, {
        kind: 'fixed-language',
        source: OTHER,
        language: 'he-IL',
        direction: 'rtl',
      }),
      { targetLocale: 'fr-FR' },
    );
    expect(resolved).toStrictEqual({
      assetId: 'asset.cover',
      targetLocale: 'fr-FR',
      attemptedLocales: ['fr-FR'],
      metadata: {},
      status: 'ready',
      fallback: true,
      representation: {
        kind: 'fixed-language',
        source: OTHER,
        language: 'he-IL',
        direction: 'rtl',
      },
    });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('prefers a variant on a fallback locale to the declared fallback', () => {
    const resolved = resolveLocalizedAsset(
      localizedAsset('asset.cover', declared, {
        kind: 'language-independent',
        source: OTHER,
      }),
      { targetLocale: 'fr-FR', fallbackLocales: ['ar-EG'] },
    );
    expect(resolved).toMatchObject({
      fallback: true,
      representation: { kind: 'locale-bound', supplyingLocale: 'ar-EG' },
    });
  });

  it('answers unavailable, naming what it tried, when nothing is declared for the miss', () => {
    const resolved = resolveLocalizedAsset(
      localizedAsset('asset.cover', declared),
      { targetLocale: 'fr-FR', fallbackLocales: ['de-DE'] },
    );
    expect(resolved).toStrictEqual({
      assetId: 'asset.cover',
      targetLocale: 'fr-FR',
      attemptedLocales: ['fr-FR', 'de-DE'],
      metadata: {},
      status: 'unavailable',
      outcome: 'localized-representation-unavailable',
    });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('holds a hand-written descriptor to the bounds of a declared one', () => {
    const written = (
      variants: readonly { locale: string; source: object }[],
      fallback?: unknown,
    ) =>
      ({
        kind: 'localized-variants',
        id: 'asset.cover',
        variants,
        ...(fallback === undefined ? {} : { fallback }),
      }) as LocalizedAssetDescriptor<object>;
    const request = { targetLocale: 'en-US' };
    expect(
      resolveLocalizedAsset(written([...declared].reverse()), request).status,
    ).toBe('ready');
    for (const descriptor of [
      written([]),
      written([...declared, { locale: 'en-US', source: OTHER }]),
      written([{ locale: 'EN-us', source: english }]),
      written(declared, {
        kind: 'fixed-language',
        source: OTHER,
        language: 'AR',
        direction: 'rtl',
      }),
    ]) {
      expect(
        refusalCode(() => resolveLocalizedAsset(descriptor, request)),
      ).toBe(REFUSED);
    }
  });
});

describe('a report about a dynamic asset', () => {
  const control = (code: number) => `r${String.fromCharCode(code)}1`;

  it('names a locale-bound representation with the direction of its locale', () => {
    const report = dynamicAssetParticipantReport({
      assetId: 'asset.cover',
      status: 'ready',
      representation: { kind: 'locale-bound', supplyingLocale: 'ar-EG' },
    });
    expect(report).toStrictEqual({
      status: 'ready',
      identity: { resourceId: 'asset.cover' },
      representation: {
        kind: 'locale-bound',
        supplyingLocale: 'ar-EG',
        direction: 'rtl',
      },
    });
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('refuses a locale-bound representation whose locale is not canonical', () => {
    expect(
      refusalCode(() =>
        dynamicAssetParticipantReport({
          assetId: 'asset.cover',
          status: 'ready',
          representation: { kind: 'locale-bound', supplyingLocale: 'ar-eg' },
        }),
      ),
    ).toBe(REFUSED);
  });

  it('names a language-independent representation, with a direction only when one was stated', () => {
    const report = (direction?: unknown) =>
      dynamicAssetParticipantReport({
        assetId: 'asset.cover',
        status: 'ready',
        representation: {
          kind: 'language-independent',
          ...(direction === undefined ? {} : { direction }),
        } as never,
      });
    expect(report()).toMatchObject({ status: 'ready' });
    expect(
      (report() as { representation: unknown }).representation,
    ).toStrictEqual({ kind: 'language-independent' });
    expect(
      (report('rtl') as { representation: unknown }).representation,
    ).toStrictEqual({ kind: 'language-independent', direction: 'rtl' });
    expect(refusalCode(() => report('auto'))).toBe(REFUSED);
  });

  it('names a fixed-language representation by its language and direction', () => {
    const report = (language: string, direction: string) =>
      dynamicAssetParticipantReport({
        assetId: 'doc.deed',
        status: 'ready',
        representation: {
          kind: 'fixed-language',
          language,
          direction,
        } as never,
      });
    expect(
      (report('ar-EG', 'rtl') as { representation: unknown }).representation,
    ).toStrictEqual({
      kind: 'fixed-language',
      language: 'ar-EG',
      direction: 'rtl',
    });
    expect(refusalCode(() => report('ar-eg', 'rtl'))).toBe(REFUSED);
    expect(refusalCode(() => report('ar-EG', 'auto'))).toBe(REFUSED);
  });

  it('carries the representation and revision identities only when they were stated', () => {
    expect(
      dynamicAssetParticipantReport({
        assetId: 'asset.cover',
        status: 'unavailable',
      }),
    ).toStrictEqual({
      status: 'unavailable',
      outcome: 'localized-representation-unavailable',
      identity: { resourceId: 'asset.cover' },
    });
    expect(
      dynamicAssetParticipantReport({
        assetId: 'asset.cover',
        representationId: 'cover 2x',
        status: 'unavailable',
      }),
    ).toMatchObject({
      identity: { resourceId: 'asset.cover', representationId: 'cover 2x' },
    });
    const both = dynamicAssetParticipantReport({
      assetId: 'asset.cover',
      representationId: 'cover 2x',
      revision: 'W/"7~"',
      status: 'unavailable',
    }) as { identity: object };
    expect(both.identity).toStrictEqual({
      resourceId: 'asset.cover',
      representationId: 'cover 2x',
      revision: 'W/"7~"',
    });
    expect(Object.isFrozen(both.identity)).toBe(true);
    const revisionOnly = dynamicAssetParticipantReport({
      assetId: 'asset.cover',
      revision: 'r1',
      status: 'unavailable',
    }) as { identity: object };
    expect(revisionOnly.identity).toStrictEqual({
      resourceId: 'asset.cover',
      revision: 'r1',
    });
  });

  it.each([['representationId'], ['revision']])(
    'holds the %s to 256 characters without a control character',
    (field) => {
      const report = (value: string) =>
        dynamicAssetParticipantReport({
          assetId: 'asset.cover',
          status: 'unavailable',
          [field]: value,
        });
      for (const accepted of ['r', 'r'.repeat(256), 'r 1~']) {
        expect(
          (report(accepted) as unknown as { identity: Record<string, unknown> })
            .identity[field],
        ).toBe(accepted);
      }
      for (const refused of [
        '',
        'r'.repeat(257),
        control(0x00),
        control(0x1f),
        control(0x7f),
      ]) {
        expect(refusalCode(() => report(refused))).toBe(REFUSED);
      }
    },
  );

  it.each([
    ['invalid-configuration'],
    ['unsupported-capability'],
    ['compatibility-rejection'],
    ['security-rejection'],
    ['environment-failure'],
    ['internal-failure'],
  ] as const)('carries the failure reason %s', (reason) => {
    expect(
      dynamicAssetParticipantReport({
        assetId: 'asset.cover',
        status: 'failed',
        reason,
      }),
    ).toStrictEqual({
      status: 'failed',
      outcome: 'operational-failure',
      reason,
      identity: { resourceId: 'asset.cover' },
    });
  });

  it.each([[''], ['timeout'], ['Internal-Failure']])(
    'refuses the failure reason %j',
    (reason) => {
      expect(
        refusalCode(() =>
          dynamicAssetParticipantReport({
            assetId: 'asset.cover',
            status: 'failed',
            reason: reason as never,
          }),
        ),
      ).toBe(REFUSED);
    },
  );
});

/**
 * Values of another type, where a declaration, a request or a report expected one of its own.
 *
 * A typed caller cannot write these. A descriptor read from a file, a request built from a query,
 * or a report assembled by untyped code can, and each is refused with the one typed failure this
 * module raises, so a caller that handles a refusal handles all of them.
 */
const NOT_TEXT: readonly (readonly [string, unknown])[] = [
  ['absent', undefined],
  ['null', null],
  ['a number', 42],
  ['a list of one tag', ['en-US']],
  ['a record', { locale: 'en-US' }],
];

const NOT_A_RECORD: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['text', 'en-US'],
  ['a number', 42],
  ['a list', []],
];

describe('a value of another type', () => {
  const logo = neutralAsset('asset.logo', SOURCE);
  const cover = localizedAsset('asset.cover', [
    { locale: 'en-US', source: SOURCE },
  ]);
  const written = (fields: object) =>
    ({ id: 'asset.cover', ...fields }) as never;
  const reported = (fields: object) =>
    ({ assetId: 'asset.cover', ...fields }) as never;

  it.each(NOT_TEXT)('is refused as an asset identity when %s', (_label, id) => {
    expect(refusalCode(() => neutralAsset(id as never, SOURCE))).toBe(REFUSED);
    expect(
      refusalCode(() =>
        resolveLocalizedAsset(
          { kind: 'neutral', id, source: SOURCE } as never,
          { targetLocale: 'en-US' },
        ),
      ),
    ).toBe(REFUSED);
    expect(
      refusalCode(() =>
        dynamicAssetParticipantReport({
          assetId: id,
          status: 'unavailable',
        } as never),
      ),
    ).toBe(REFUSED);
  });

  it.each(NOT_TEXT)(
    'is refused as the language of a fixed-language asset when %s',
    (_label, language) => {
      expect(
        refusalCode(() =>
          fixedLanguageAsset('doc.deed', SOURCE, language as never, 'ltr'),
        ),
      ).toBe(REFUSED);
      expect(
        refusalCode(() =>
          resolveLocalizedAsset(
            written({
              kind: 'fixed-language',
              source: SOURCE,
              language,
              direction: 'ltr',
            }),
            { targetLocale: 'en-US' },
          ),
        ),
      ).toBe(REFUSED);
    },
  );

  it.each(NOT_TEXT)(
    'is refused as the locale of a variant when %s',
    (_label, locale) => {
      expect(
        refusalCode(() =>
          localizedAsset('asset.cover', [{ locale, source: SOURCE }] as never),
        ),
      ).toBe(REFUSED);
    },
  );

  it.each(NOT_TEXT)(
    'is refused as the language of a declared fallback when %s',
    (_label, language) => {
      const fallback = {
        kind: 'fixed-language',
        source: OTHER,
        language,
        direction: 'rtl',
      };
      expect(
        refusalCode(() =>
          localizedAsset(
            'asset.cover',
            [{ locale: 'en-US', source: SOURCE }],
            fallback as never,
          ),
        ),
      ).toBe(REFUSED);
      expect(
        refusalCode(() =>
          resolveLocalizedAsset(
            written({
              kind: 'localized-variants',
              variants: [{ locale: 'en-US', source: SOURCE }],
              fallback,
            }),
            { targetLocale: 'ar-EG' },
          ),
        ),
      ).toBe(REFUSED);
    },
  );

  it.each(NOT_TEXT)(
    'is refused as the target locale of a selection when %s',
    (_label, targetLocale) => {
      expect(
        refusalCode(() =>
          resolveLocalizedAsset(logo, { targetLocale } as never),
        ),
      ).toBe(REFUSED);
    },
  );

  it.each(NOT_TEXT.filter(([, value]) => value !== undefined))(
    'is refused as a fallback locale of a selection when %s',
    (_label, fallback) => {
      expect(
        refusalCode(() =>
          resolveLocalizedAsset(logo, {
            targetLocale: 'ar-EG',
            fallbackLocales: ['fr-FR', fallback],
          } as never),
        ),
      ).toBe(REFUSED);
    },
  );

  it.each(NOT_TEXT)(
    'is refused as the supplying locale or the language of a report when %s',
    (_label, locale) => {
      expect(
        refusalCode(() =>
          dynamicAssetParticipantReport(
            reported({
              status: 'ready',
              representation: { kind: 'locale-bound', supplyingLocale: locale },
            }),
          ),
        ),
      ).toBe(REFUSED);
      expect(
        refusalCode(() =>
          dynamicAssetParticipantReport(
            reported({
              status: 'ready',
              representation: {
                kind: 'fixed-language',
                language: locale,
                direction: 'ltr',
              },
            }),
          ),
        ),
      ).toBe(REFUSED);
    },
  );

  it.each(NOT_TEXT.filter(([, value]) => value !== undefined))(
    'is refused as a representation or revision identity when %s',
    (_label, identity) => {
      for (const field of ['representationId', 'revision']) {
        expect(
          refusalCode(() =>
            dynamicAssetParticipantReport(
              reported({ status: 'unavailable', [field]: identity }),
            ),
          ),
        ).toBe(REFUSED);
      }
    },
  );

  it.each(NOT_TEXT)(
    'is refused as the code of a domain outcome when %s',
    (_label, code) => {
      expect(
        refusalCode(() =>
          dynamicAssetParticipantReport(
            reported({ status: 'domain-outcome', code }),
          ),
        ),
      ).toBe(REFUSED);
    },
  );

  it.each([...NOT_A_RECORD, ['absent', undefined] as const])(
    'is refused as a descriptor, a request or a report when %s',
    (_label, value) => {
      expect(
        refusalCode(() =>
          resolveLocalizedAsset(value as never, { targetLocale: 'en-US' }),
        ),
      ).toBe(REFUSED);
      expect(
        refusalCode(() => resolveLocalizedAsset(logo, value as never)),
      ).toBe(REFUSED);
      expect(
        refusalCode(() => dynamicAssetParticipantReport(value as never)),
      ).toBe(REFUSED);
    },
  );

  it.each([
    ['absent', undefined],
    ['null', null],
    ['text', 'en-US'],
    ['a record shaped like a list', { length: 1, 0: { locale: 'en-US' } }],
  ])('is refused as the variants of a localized asset when %s', (_l, value) => {
    expect(
      refusalCode(() => localizedAsset('asset.cover', value as never)),
    ).toBe(REFUSED);
    expect(
      refusalCode(() =>
        resolveLocalizedAsset(
          written({ kind: 'localized-variants', variants: value }),
          { targetLocale: 'en-US' },
        ),
      ),
    ).toBe(REFUSED);
  });

  it.each(NOT_A_RECORD)(
    'is refused as one variant when %s',
    (_label, value) => {
      expect(
        refusalCode(() => localizedAsset('asset.cover', [value] as never)),
      ).toBe(REFUSED);
    },
  );

  it.each(NOT_A_RECORD)(
    'is refused as a declared fallback when %s',
    (_label, fallback) => {
      expect(
        refusalCode(() =>
          localizedAsset(
            'asset.cover',
            [{ locale: 'en-US', source: SOURCE }],
            fallback as never,
          ),
        ),
      ).toBe(REFUSED);
    },
  );

  it.each([
    ['text', 'fr-FR'],
    ['a number', 42],
    ['a record', { 0: 'fr-FR' }],
    ['null', null],
  ])('is refused as the fallback list of a selection when %s', (_l, value) => {
    expect(
      refusalCode(() =>
        resolveLocalizedAsset(cover, {
          targetLocale: 'ar-EG',
          fallbackLocales: value,
        } as never),
      ),
    ).toBe(REFUSED);
  });

  it.each(NOT_A_RECORD)(
    'is refused as the descriptive copy of a selection when %s',
    (_label, metadata) => {
      expect(
        refusalCode(() =>
          resolveLocalizedAsset(logo, {
            targetLocale: 'en-US',
            metadata,
          } as never),
        ),
      ).toBe(REFUSED);
    },
  );

  it.each([...NOT_A_RECORD, ['absent', undefined] as const])(
    'is refused as the representation of a ready report when %s',
    (_label, representation) => {
      expect(
        refusalCode(() =>
          dynamicAssetParticipantReport(
            reported({ status: 'ready', representation }),
          ),
        ),
      ).toBe(REFUSED);
    },
  );

  it('is refused as a representation kind or a report status outside the declared ones', () => {
    expect(
      refusalCode(() =>
        dynamicAssetParticipantReport(
          reported({ status: 'ready', representation: { kind: 'other' } }),
        ),
      ),
    ).toBe(REFUSED);
    expect(
      refusalCode(() =>
        dynamicAssetParticipantReport(reported({ status: 'pending' })),
      ),
    ).toBe(REFUSED);
    expect(refusalCode(() => dynamicAssetParticipantReport(reported({})))).toBe(
      REFUSED,
    );
  });
});
