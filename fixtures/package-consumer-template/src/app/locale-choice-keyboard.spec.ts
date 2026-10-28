import { afterEach, describe, expect, it, vi } from 'vitest';

import { Component, computed, inject, type DebugElement } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, type Routes } from '@angular/router';
import {
  LocaleChoice,
  Localization,
  createPathPrefixLocalePolicy,
  withRouting,
  type LocaleUrlPolicy,
  withFormattingContext,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { configuration } from '#i18n';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { appRouteProjection } from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

/**
 * A switcher option a keyboard can reach whether or not it has somewhere to go.
 *
 * An anchor is focusable and activated by Enter only while it carries an `href`, and an option has
 * no address when the application is not routed, when a slug has no declared spelling in that
 * locale, or when the address cannot distinguish the locale. An anchor without one is something a
 * mouse can click and a keyboard cannot reach, so a reader without a pointer would have no way into
 * that language. The directive gives such an anchor the button pattern: a role that says what it
 * is, a place in the tab order, Enter as it is pressed and Space as it is released.
 *
 * The last three cases are the controls. A `button`, an anchor with an address, and the locale
 * already in use each take less or none of it, so a directive that put the whole pattern on every
 * option would fail here rather than pass.
 */

@Component({
  standalone: true,
  template: `route`,
})
class RouteProbe {}

@Component({
  standalone: true,
  imports: [LocaleChoice],
  template: `<a data-role="plain" [localeChoice]="other()">other</a>
    <a
      data-role="authored"
      role="menuitemradio"
      tabindex="-1"
      [localeChoice]="other()"
      >other</a
    >
    <button type="button" data-role="button" [localeChoice]="other()">
      other
    </button>
    <a data-role="current" [localeChoice]="current()">current</a>`,
})
class Switcher {
  private readonly choices = inject(Localization).localeChoices;
  readonly other = computed(() =>
    this.pick((choice) => choice.locale === 'ar-EG'),
  );
  readonly current = computed(() => this.pick((choice) => choice.current));

  private pick(
    matches: (
      choice: ReturnType<Localization['localeChoices']>[number],
    ) => boolean,
  ) {
    const found = this.choices().find(matches);
    if (found === undefined)
      throw new Error('This fixture offers no choice the switcher needs.');
    return found;
  }
}

const routes: Routes = [
  { path: '', component: RouteProbe },
  { path: 'second', component: RouteProbe },
  { path: '**', component: RouteProbe },
];

/** A policy under which every locale has an address on every page, for the control. */
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

/** Unrouted, so no option has an address: the case every application without routing is in. */
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

async function routed(
  policy: LocaleUrlPolicy,
): Promise<ComponentFixture<Switcher>> {
  await TestBed.configureTestingModule({
    providers: [
      provideLocalizedRouter(routes, { origin: 'https://site.example' }),
      provideLocalizationTesting(
        bundle,
        withRouting({ policy, projection: appRouteProjection }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  }).compileComponents();
  await TestBed.inject(Router).navigateByUrl('/second');
  return rendered();
}

function rendered(): ComponentFixture<Switcher> {
  const fixture = TestBed.createComponent(Switcher);
  fixture.detectChanges();
  return fixture;
}

/** Held pending, because what is under test is that the option asked, not what the switch did. */
function switches() {
  return vi
    .spyOn(TestBed.inject(Localization), 'changeLocale')
    .mockReturnValue(new Promise(() => {}));
}

/** One of the elements the directive was found on, by the role this fixture gave it. */
const option = (found: readonly DebugElement[], role: string): HTMLElement => {
  const match = found.find(
    ({ nativeElement }) =>
      (nativeElement as HTMLElement).getAttribute('data-role') === role,
  );
  if (match === undefined)
    throw new Error(`The directive is on no element marked ${role}.`);
  return match.nativeElement as HTMLElement;
};

/** Dispatched the way a browser does, so the return value says whether the default was held. */
const key = (
  element: HTMLElement,
  type: 'keydown' | 'keyup',
  name: string,
): boolean =>
  element.dispatchEvent(
    new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true }),
  );

describe('a locale switcher option with no address', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is in the tab order and says it is a button', async () => {
    const fixture = await unrouted();
    const options = fixture.debugElement.queryAll(By.directive(LocaleChoice));
    const plain = option(options, 'plain');

    expect(options).toHaveLength(4);
    expect(plain.hasAttribute('href')).toBe(false);
    expect(plain.getAttribute('role')).toBe('button');
    expect(plain.getAttribute('tabindex')).toBe('0');
    claimCapability('directive:LocaleChoice');
  });

  it('switches on Enter as it is pressed and on Space as it is released', async () => {
    const fixture = await unrouted();
    const changeLocale = switches();
    const plain = option(
      fixture.debugElement.queryAll(By.directive(LocaleChoice)),
      'plain',
    );

    expect(key(plain, 'keydown', 'Enter')).toBe(false);
    expect(changeLocale.mock.calls).toEqual([['ar-EG']]);

    // Held as it is pressed, because its default scrolls the page, and acted on as it is released,
    // which is when a native button acts on it.
    expect(key(plain, 'keydown', ' ')).toBe(false);
    expect(changeLocale).toHaveBeenCalledTimes(1);
    expect(key(plain, 'keyup', ' ')).toBe(false);
    expect(changeLocale.mock.calls).toEqual([['ar-EG'], ['ar-EG']]);
    claimCapability('directive:LocaleChoice');
  });

  it('keeps a role and a tab order the application wrote', async () => {
    const fixture = await unrouted();
    const changeLocale = switches();
    const authored = option(
      fixture.debugElement.queryAll(By.directive(LocaleChoice)),
      'authored',
    );

    // An option inside a menu, whose roving focus the application manages.
    expect(authored.getAttribute('role')).toBe('menuitemradio');
    expect(authored.getAttribute('tabindex')).toBe('-1');
    key(authored, 'keydown', 'Enter');
    expect(changeLocale.mock.calls).toEqual([['ar-EG']]);
    claimCapability('directive:LocaleChoice');
  });

  it('leaves a button to the element it already is', async () => {
    const fixture = await unrouted();
    const changeLocale = switches();
    const button = option(
      fixture.debugElement.queryAll(By.directive(LocaleChoice)),
      'button',
    );

    // A browser turns Enter and Space on a button into a click, so handling the key as well would
    // switch twice.
    expect(button.hasAttribute('role')).toBe(false);
    expect(button.hasAttribute('tabindex')).toBe(false);
    expect(key(button, 'keydown', 'Enter')).toBe(true);
    expect(changeLocale).not.toHaveBeenCalled();
    claimCapability('directive:LocaleChoice');
  });

  it('does not switch into the locale already in use', async () => {
    const fixture = await unrouted();
    const changeLocale = switches();
    const current = option(
      fixture.debugElement.queryAll(By.directive(LocaleChoice)),
      'current',
    );

    expect(current.getAttribute('aria-current')).toBe('true');
    expect(key(current, 'keydown', 'Enter')).toBe(false);
    expect(changeLocale).not.toHaveBeenCalled();
    claimCapability('directive:LocaleChoice');
  });

  it('leaves an anchor with an address to be a link', async () => {
    const fixture = await routed(PATH_PREFIX);
    const changeLocale = switches();
    const plain = option(
      fixture.debugElement.queryAll(By.directive(LocaleChoice)),
      'plain',
    );

    expect(plain.getAttribute('href')).toBe('/ar-eg/second');
    expect(plain.hasAttribute('role')).toBe(false);
    expect(plain.hasAttribute('tabindex')).toBe(false);
    // Enter on a link is the browser's click, which the directive already answers.
    expect(key(plain, 'keydown', 'Enter')).toBe(true);
    expect(changeLocale).not.toHaveBeenCalled();
    claimCapability('directive:LocaleChoice', { policy: PATH_PREFIX });
  });
});
