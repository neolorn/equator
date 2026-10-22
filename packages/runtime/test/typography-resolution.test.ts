import { describe, expect, it } from 'vitest';

import { resolveTypography } from '../src/locale-presentation.js';
import {
  type LocaleTypographyRegistry,
  type TypographyProfile,
} from '@neolorn/equator/core';

/**
 * Which typography profile a registry gives a locale.
 *
 * The script is looked for first, then the language, then the registry's default, because line
 * height and font stack follow the writing system and not the tongue. A locale's script is the
 * one its tag writes or the one its language is likely written in, so `ar-EG` is found under
 * `Arab` with no script in the tag. Every part of a registry is optional, and a registry with none
 * of the three that applies answers with nothing.
 */

const profile = (id: string): TypographyProfile => Object.freeze({ id });

const ARABIC_SCRIPT = profile('arabic-script');
const ARABIC = profile('arabic');
const URDU = profile('urdu');
const FALLBACK = profile('fallback');

describe('the typography of a locale', () => {
  it('is the profile of its script, ahead of its language and the default', () => {
    const registry: LocaleTypographyRegistry = {
      scripts: { Arab: ARABIC_SCRIPT },
      languages: { ar: ARABIC },
      default: FALLBACK,
    };

    expect(resolveTypography('ar-EG', registry)).toBe(ARABIC_SCRIPT);
  });

  it('is the profile of its language where its script is not listed', () => {
    const registry: LocaleTypographyRegistry = {
      scripts: { Latn: profile('latin-script') },
      languages: { ar: ARABIC, ur: URDU },
      default: FALLBACK,
    };

    expect(resolveTypography('ar-EG', registry)).toBe(ARABIC);
    expect(resolveTypography('ur-PK', registry)).toBe(URDU);
  });

  it('is the profile of its language where the registry lists no scripts', () => {
    expect(
      resolveTypography('ar-EG', {
        languages: { ar: ARABIC },
        default: FALLBACK,
      }),
    ).toBe(ARABIC);
  });

  it('is the default where neither its script nor its language is listed', () => {
    const registry: LocaleTypographyRegistry = {
      scripts: { Latn: profile('latin-script') },
      languages: { en: profile('english') },
      default: FALLBACK,
    };

    expect(resolveTypography('ar-EG', registry)).toBe(FALLBACK);
  });

  it('is the default of a registry that lists no scripts and no languages', () => {
    expect(resolveTypography('ar-EG', { default: FALLBACK })).toBe(FALLBACK);
  });

  it('is the profile of its script in a registry with nothing else', () => {
    expect(
      resolveTypography('ar-EG', { scripts: { Arab: ARABIC_SCRIPT } }),
    ).toBe(ARABIC_SCRIPT);
  });

  it('is nothing where the registry has none of the three', () => {
    expect(resolveTypography('ar-EG', {})).toBeUndefined();
    expect(
      resolveTypography('ar-EG', {
        scripts: { Latn: profile('latin-script') },
        languages: { en: profile('english') },
      }),
    ).toBeUndefined();
  });
});
