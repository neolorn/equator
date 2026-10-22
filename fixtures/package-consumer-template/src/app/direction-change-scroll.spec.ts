import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestBed } from '@angular/core/testing';
import { Localization, withFormattingContext } from '@neolorn/equator';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { configuration } from '#i18n';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { runtimeExtensions } from './runtime-extensions';

/**
 * The six bounds on the window that holds a restored scroll position.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 8. After a switch that turns the document
 * around, the restored position is re-applied against movement nobody asked for, and the window
 * doing it has to close before the application does any scrolling of its own, because from inside
 * the window the two are indistinguishable. The browser gate reads the position after the window
 * has closed, so it cannot tell a window that closed on time from one that was still open.
 *
 * Frames, the clock and the viewport are this file's to drive. The engine's reveal is stood in for
 * by a viewport that stays where it was put, or that ignores every write, which is the one case
 * the window exists for: a position that does not stay where the restore put it.
 */

const bundle = {
  configuration,
  catalogSet,
  catalogLoaders,
  recoveryPayload,
  extensions: runtimeExtensions,
  routeProjection,
};

/** Frames run when this file says so, one at a time. */
const pending: FrameRequestCallback[] = [];
function frame(): void {
  for (const callback of pending.splice(0)) callback(performance.now());
}

/** The viewport, as the runtime reads and writes it. */
const viewport = { x: 0, y: 0, obeys: true };
const writes: [number, number][] = [];
const originals = new Map<string, PropertyDescriptor | undefined>();

function takeOverTheViewport(): void {
  for (const [name, read] of [
    ['scrollX', () => viewport.x],
    ['scrollY', () => viewport.y],
  ] as const) {
    originals.set(name, Object.getOwnPropertyDescriptor(window, name));
    Object.defineProperty(window, name, { configurable: true, get: read });
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(((x: number, y: number) => {
    writes.push([x, y]);
    if (viewport.obeys) {
      viewport.x = x;
      viewport.y = y;
    }
  }) as unknown as typeof window.scrollTo);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    pending.push(callback);
    return pending.length;
  });
}

/** Everything the commit before this one scheduled, run on real frames before the fakes go in. */
const realFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function switchedToArabic(options: {
  readonly focused: boolean;
  readonly beforeTheSwitch?: () => void;
}): Promise<Localization> {
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
  await localization.changeLocale('en-US', { remember: false });
  await realFrame();
  await realFrame();

  const control = document.createElement('button');
  control.type = 'button';
  document.body.append(control);
  if (options.focused) control.focus();
  else (document.activeElement as HTMLElement | null)?.blur();

  viewport.x = 0;
  viewport.y = 400;
  viewport.obeys = true;
  takeOverTheViewport();
  options.beforeTheSwitch?.();
  await localization.changeLocale('ar-EG', { remember: false });
  // The restore is queued behind a microtask and then a frame.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  frame();
  expect(writes.at(-1)?.[1]).toBe(400);
  return localization;
}

/**
 * The block positions the window wrote after the restore itself, which is the first write. The
 * block axis alone, because the inline one is re-signed for the new direction and zero either way.
 */
const held = () => writes.slice(1).map(([, block]) => block);

describe('the window that holds a restored scroll position', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const [name, descriptor] of originals) {
      if (descriptor === undefined) Reflect.deleteProperty(window, name);
      else Object.defineProperty(window, name, descriptor);
    }
    originals.clear();
    pending.length = 0;
    writes.length = 0;
    document.body
      .querySelectorAll('button')
      .forEach((element) => element.remove());
  });

  it('closes after two frames with nothing to correct', async () => {
    await switchedToArabic({ focused: true });

    frame();
    frame();

    expect(held()).toEqual([]);
    expect(pending).toHaveLength(0);
  });

  it('re-applies for six frames at most on a page that never settles', async () => {
    await switchedToArabic({ focused: true });
    viewport.obeys = false;
    viewport.y = 0;

    for (let count = 0; count < 12; count += 1) frame();

    expect(held()).toHaveLength(6);
    expect(pending).toHaveLength(0);
  });

  it('closes after 150 milliseconds whatever the frames are doing', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await switchedToArabic({ focused: true });
    viewport.obeys = false;
    viewport.y = 0;

    frame();
    expect(held()).toHaveLength(1);
    now += 151;
    for (let count = 0; count < 12; count += 1) frame();

    expect(held()).toHaveLength(1);
  });

  it('closes on the first sign of the visitor scrolling', async () => {
    await switchedToArabic({ focused: true });
    viewport.obeys = false;
    viewport.y = 0;

    frame();
    expect(held()).toHaveLength(1);
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 }));
    for (let count = 0; count < 12; count += 1) frame();

    expect(held()).toHaveLength(1);
  });

  it('closes when a later commit supersedes the one it restored', async () => {
    const localization = await switchedToArabic({ focused: true });
    viewport.obeys = false;
    viewport.y = 0;

    frame();
    expect(held()).toEqual([400]);
    await localization.changeLocale('en-US', { remember: false });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let count = 0; count < 12; count += 1) frame();

    // The later commit restores its own position, captured where the viewport now is. Nothing
    // after it writes the position the superseded commit captured.
    expect(held().slice(1)).not.toContain(400);
  });

  it('has closed before the application scrolls, so its position stands', async () => {
    await switchedToArabic({ focused: true });

    frame();
    frame();
    // What an application does once the page has settled: moves the reader somewhere of its own.
    window.scrollTo(0, 50);
    for (let count = 0; count < 12; count += 1) frame();

    expect(held()).toEqual([50]);
    expect(viewport.y).toBe(50);
  });

  it('is not opened when nothing had focus', async () => {
    await switchedToArabic({ focused: false });
    viewport.obeys = false;
    viewport.y = 0;

    for (let count = 0; count < 12; count += 1) frame();

    expect(held()).toEqual([]);
  });
});

/**
 * Section 8 again: the distance from the inline start is captured and restored without asking the
 * document how far it can scroll. A direction change is relaying the document out when both happen,
 * and a document that has not finished growing reports a range that is still too small, so a
 * restore clamped to it lands short where `scrollTo` would have clamped correctly on its own.
 */
describe('the restore across a direction change', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const [name, descriptor] of originals) {
      if (descriptor === undefined) Reflect.deleteProperty(window, name);
      else Object.defineProperty(window, name, descriptor);
    }
    originals.clear();
    pending.length = 0;
    writes.length = 0;
    document.body
      .querySelectorAll('button')
      .forEach((element) => element.remove());
  });

  it('reads no scroll range at capture or at restore', async () => {
    const reads: string[] = [];
    const watched: [Element, string][] = [];
    const watch = () => {
      for (const element of new Set(
        [
          document.documentElement,
          document.body,
          document.scrollingElement,
        ].filter((each): each is Element => each instanceof Element),
      )) {
        for (const name of ['scrollWidth', 'scrollHeight']) {
          const inherited = Object.getOwnPropertyDescriptor(
            Element.prototype,
            name,
          );
          Object.defineProperty(element, name, {
            configurable: true,
            get() {
              reads.push(`${element.nodeName}.${name}`);
              return inherited?.get?.call(element) as number;
            },
          });
          watched.push([element, name]);
        }
      }
    };
    try {
      await switchedToArabic({ focused: true, beforeTheSwitch: watch });
      for (let count = 0; count < 12; count += 1) frame();
    } finally {
      for (const [element, name] of watched) {
        Reflect.deleteProperty(element, name);
      }
    }

    expect(reads).toEqual([]);
  });
});
