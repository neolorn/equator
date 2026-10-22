import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  localeProfile,
  openGraphAlternates,
  openGraphLocale,
} from '../core/src/locale-profile.js';

/**
 * A locale with no territory, and the alternates a page lists beside its own locale.
 *
 * Open Graph's `language_TERRITORY` has two parts, so a tag that maximizes to no territory has no
 * spelling there. Which tags those are is the platform's likely-subtags data, and it differs from
 * one release of that data to the next, so these cases do not ask the platform: maximizing the one
 * tag below answers the tag as it was written, and every other tag is maximized as usual.
 */

const NO_TERRITORY = 'tlh-Latn';

beforeEach(() => {
  const maximize = Intl.Locale.prototype.maximize;
  vi.spyOn(Intl.Locale.prototype, 'maximize').mockImplementation(function (
    this: Intl.Locale,
  ) {
    return this.baseName === NO_TERRITORY ? this : maximize.call(this);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a locale that maximizes to no territory', () => {
  it('has a profile with no region member', () => {
    expect(localeProfile(NO_TERRITORY)).toStrictEqual({
      locale: 'tlh-Latn',
      language: 'tlh',
      script: 'Latn',
      direction: 'ltr',
    });
  });

  it('has no Open Graph spelling', () => {
    expect(openGraphLocale(NO_TERRITORY)).toBeUndefined();
  });
});

describe('the social alternates of a page', () => {
  const CLUSTER = [
    { hreflang: 'en-US' },
    { hreflang: 'ar-EG' },
    { hreflang: 'x-default' },
  ];

  it('lists every other locale and never the routing default', () => {
    expect(openGraphAlternates('en-US', CLUSTER)).toEqual(['ar_EG']);
    expect(openGraphAlternates('ar-EG', CLUSTER)).toEqual(['en_US']);
  });

  it('lists every locale when the page states none of its own', () => {
    expect(openGraphAlternates(undefined, CLUSTER)).toEqual(['en_US', 'ar_EG']);
  });

  it('drops an alternate with no Open Graph spelling', () => {
    expect(
      openGraphAlternates('en-US', [
        { hreflang: NO_TERRITORY },
        { hreflang: 'not a tag' },
        { hreflang: 'ar-EG' },
      ]),
    ).toEqual(['ar_EG']);
    expect(
      openGraphAlternates(undefined, [{ hreflang: NO_TERRITORY }]),
    ).toEqual([]);
  });

  it('lists a territory once when two alternates spell the same one', () => {
    expect(
      openGraphAlternates('en-US', [{ hreflang: 'ar' }, { hreflang: 'ar-EG' }]),
    ).toEqual(['ar_EG']);
  });
});
