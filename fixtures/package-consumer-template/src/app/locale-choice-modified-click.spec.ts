import { afterEach, describe, expect, it, vi } from 'vitest';

import { Component, computed, inject } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, type Routes } from '@angular/router';
import {
  LocaleChoice,
  Localization,
  createPathPrefixLocalePolicy,
  withFormattingContext,
  withRouting,
  type LocaleUrlPolicy,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { appRouteProjection } from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

/**
 * A click with a modifier held, on a switcher option.
 *
 * On a link, a modified click asks the browser for that address somewhere else: a new tab, a new
 * window, a download. The directive leaves such a click to the browser where the option is an
 * anchor carrying an address, and only there. An option with no address has nowhere else to open,
 * and a `button` is not a link, so on both a modified click is still the switch.
 */

@Component({
  standalone: true,
  template: `route`,
})
class RouteProbe {}

@Component({
  standalone: true,
  imports: [LocaleChoice],
  template: `<a data-role="anchor" [localeChoice]="other()">other</a>
    <button type="button" data-role="button" [localeChoice]="other()">
      other
    </button>`,
})
class Switcher {
  private readonly choices = inject(Localization).localeChoices;
  readonly other = computed(() => {
    const found = this.choices().find(({ locale }) => locale === 'ar-EG');
    if (found === undefined)
      throw new Error('This fixture offers no choice the switcher needs.');
    return found;
  });
}

const routes: Routes = [
  { path: '', component: RouteProbe },
  { path: 'second', component: RouteProbe },
  { path: '**', component: RouteProbe },
];

const PATH_PREFIX: LocaleUrlPolicy = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'en-Arab-XB': 'en-arab-xb' },
  xDefaultPath: '/',
});

const bundle = {
  configuration,
  catalogSet,
  catalogLoaders,
  recoveryPayload,
  extensions: runtimeExtensions,
  routeProjection,
};

function rendered(): ComponentFixture<Switcher> {
  const fixture = TestBed.createComponent(Switcher);
  fixture.detectChanges();
  return fixture;
}

/** Unrouted, so the anchor has no address. */
async function unrouted(): Promise<ComponentFixture<Switcher>> {
  await TestBed.configureTestingModule({
    providers: [
      provideLocalizationTesting(
        bundle,
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  }).compileComponents();
  await TestBed.inject(Localization).initialize();
  return rendered();
}

/** Routed under a policy that gives every locale an address, so the anchor is a link. */
async function routed(): Promise<ComponentFixture<Switcher>> {
  await TestBed.configureTestingModule({
    providers: [
      provideLocalizedRouter(routes, { origin: 'https://site.example' }),
      provideLocalizationTesting(
        bundle,
        withRouting({ policy: PATH_PREFIX, projection: appRouteProjection }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  }).compileComponents();
  await TestBed.inject(Router).navigateByUrl('/second');
  return rendered();
}

/** Held pending, because what is under test is whether the option asked. */
function switches() {
  return vi
    .spyOn(TestBed.inject(Localization), 'changeLocale')
    .mockReturnValue(new Promise(() => {}));
}

const option = (fixture: ComponentFixture<Switcher>, role: string) => {
  const found = (fixture.nativeElement as HTMLElement).querySelector(
    `[data-role="${role}"]`,
  );
  if (!(found instanceof HTMLElement))
    throw new Error(`The switcher renders no option marked ${role}.`);
  return found;
};

type Modifier = 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey';

/**
 * A click as a browser dispatches one, answered with whether the directive held the default.
 *
 * The listener on the document runs after the directive's and holds the default itself, so a link
 * the directive left alone is not followed by the test document.
 */
function click(element: HTMLElement, init: MouseEventInit): boolean {
  let held: boolean | undefined;
  const after = (event: Event): void => {
    held = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener('click', after);
  try {
    element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
    );
  } finally {
    document.removeEventListener('click', after);
  }
  if (held === undefined) throw new Error('The click reached no listener.');
  return held;
}

describe('a modified click on a switcher option', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const modifier of [
    'ctrlKey',
    'metaKey',
    'shiftKey',
    'altKey',
  ] as readonly Modifier[]) {
    it(`is left to the browser on a link, with ${modifier} held`, async () => {
      const fixture = await routed();
      const changeLocale = switches();
      const anchor = option(fixture, 'anchor');

      expect(anchor.getAttribute('href')).toBe('/ar-eg/second');
      expect(click(anchor, { [modifier]: true })).toBe(false);
      expect(changeLocale).not.toHaveBeenCalled();
    });
  }

  it('is the switch on a link when no modifier is held', async () => {
    const fixture = await routed();
    const changeLocale = switches();

    expect(click(option(fixture, 'anchor'), {})).toBe(true);
    expect(changeLocale.mock.calls).toEqual([['ar-EG']]);
  });

  it('is still the switch on an anchor that carries no address', async () => {
    const fixture = await unrouted();
    const changeLocale = switches();
    const anchor = option(fixture, 'anchor');

    expect(anchor.hasAttribute('href')).toBe(false);
    expect(click(anchor, { ctrlKey: true })).toBe(true);
    expect(changeLocale.mock.calls).toEqual([['ar-EG']]);
  });

  it('is still the switch on a button, routed or not', async () => {
    const fixture = await routed();
    const changeLocale = switches();
    const button = option(fixture, 'button');

    expect(button.hasAttribute('href')).toBe(false);
    expect(click(button, { ctrlKey: true })).toBe(true);
    expect(changeLocale.mock.calls).toEqual([['ar-EG']]);
  });

  it('is nothing from a button other than the main one', async () => {
    const fixture = await routed();
    const changeLocale = switches();

    expect(click(option(fixture, 'anchor'), { button: 1 })).toBe(false);
    expect(click(option(fixture, 'button'), { button: 2 })).toBe(false);
    expect(changeLocale).not.toHaveBeenCalled();
  });
});
