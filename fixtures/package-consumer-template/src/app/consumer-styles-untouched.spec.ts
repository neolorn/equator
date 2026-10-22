/**
 * A change of reading direction leaves the application's styling where the application put it.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 10: a release exposes direction signals and MUST
 * NOT rewrite a consumer application's CSS. The direction reaches the page as `dir` on the document
 * element, and what the page does with it is the stylesheet's business; a runtime that also wrote
 * a style, a class or a rule would be deciding the layout of an application it knows nothing about.
 *
 * The announcer region is the one element Equator creates and styles, and it is excluded.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TestBed } from '@angular/core/testing';
import {
  Localization,
  provideLocalizationSetup,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';

import { runtimeExtensions } from './runtime-extensions';

const ANNOUNCER = '[data-equator-announcer]';

/** Every rule in every stylesheet, and every element's style and class, outside the announcer. */
function styleCensus(): readonly string[] {
  const rules = [...document.styleSheets].flatMap((sheet) =>
    [...sheet.cssRules].map((rule) => `rule ${rule.cssText}`),
  );
  const elements = [...document.querySelectorAll('*')]
    .filter((element) => element.closest(ANNOUNCER) === null)
    .flatMap((element) => [
      `${element.tagName} style=${element.getAttribute('style') ?? ''}`,
      `${element.tagName} class=${element.getAttribute('class') ?? ''}`,
    ]);
  return [...rules, ...elements];
}

describe('a locale commit and the application stylesheet', () => {
  let added: Element[] = [];

  beforeEach(() => {
    const sheet = document.createElement('style');
    sheet.textContent =
      '.card { margin-inline-start: 1rem; } .icon { transform: scaleX(1); }';
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('style', 'padding-left: 2px');
    document.head.append(sheet);
    document.body.append(card);
    added = [sheet, card];
  });

  afterEach(() => {
    for (const element of added) element.remove();
    added = [];
  });

  it('is the same after a commit into a right-to-left locale', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders,
            recoveryPayload,
            extensions: runtimeExtensions,
          },
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });
    const localization = TestBed.inject(Localization);
    await localization.initialize();
    const before = styleCensus();
    expect(before).toContain('DIV class=card');

    await localization.changeLocale('ar-EG');

    // The direction did change, so the census below is taken after a commit that had something
    // to say about layout.
    expect(document.documentElement.dir).toBe('rtl');
    expect(styleCensus()).toEqual(before);
  });
});
