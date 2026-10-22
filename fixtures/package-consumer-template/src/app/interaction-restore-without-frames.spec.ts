import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestBed } from '@angular/core/testing';
import { Localization, withFormattingContext } from '@neolorn/equator';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { runtimeExtensions } from './runtime-extensions';

/**
 * The restore after a commit, in a document view that schedules no animation frames.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 8 holds a restored scroll position for a
 * bounded number of frames after a switch that turns the document around.
 * `direction-change-scroll.spec.ts` drives that window frame by frame. A nonvisual DOM has no
 * frames to count, and nothing in it moves on its own, so there the position is put back
 * once and no window is opened: nothing listens for the visitor scrolling, and nothing is
 * written a second time.
 */

const bundle = {
  configuration,
  catalogSet,
  catalogLoaders,
  recoveryPayload,
  extensions: runtimeExtensions,
  routeProjection,
};

const scrollIntents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

const realFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

describe('the restore after a commit where the view has no frames', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();

  function replace(name: string, descriptor: PropertyDescriptor): void {
    originals.set(name, Object.getOwnPropertyDescriptor(window, name));
    Object.defineProperty(window, name, { configurable: true, ...descriptor });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [name, descriptor] of originals) {
      if (descriptor === undefined) Reflect.deleteProperty(window, name);
      else Object.defineProperty(window, name, descriptor);
    }
    originals.clear();
    document.body
      .querySelectorAll('button')
      .forEach((element) => element.remove());
    TestBed.resetTestingModule();
  });

  it('puts the position back once, and holds nothing open', async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideLocalizationTesting(
          bundle,
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    }).compileComponents();
    const localization = TestBed.inject(Localization);
    await localization.initialize();
    // Whatever the first commit scheduled runs on real frames, before they are taken away.
    await realFrame();
    await realFrame();

    const control = document.createElement('button');
    control.type = 'button';
    document.body.append(control);
    control.focus();

    const writes: [number, number][] = [];
    replace('scrollX', { get: () => 0 });
    replace('scrollY', { get: () => 400 });
    vi.spyOn(window, 'scrollTo').mockImplementation(((x: number, y: number) => {
      writes.push([x, y]);
    }) as unknown as typeof window.scrollTo);
    replace('requestAnimationFrame', { writable: true, value: undefined });
    const listening = vi.spyOn(window, 'addEventListener');

    const result = await localization.changeLocale('ar-EG', {
      remember: false,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(result.status).toBe('committed');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.activeElement).toBe(control);
    expect(writes.map(([, block]) => block)).toEqual([400]);
    expect(
      listening.mock.calls
        .map(([type]) => type)
        .filter((type) => scrollIntents.includes(type)),
    ).toEqual([]);
  });
});
