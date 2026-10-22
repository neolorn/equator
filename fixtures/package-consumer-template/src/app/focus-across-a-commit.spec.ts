/**
 * Focus and selection across a locale commit, when the visitor or the application acts before the
 * restore lands.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 12. The restore is captured during the commit and
 * applied a frame or more later, so three things can be true by then that were not at capture: the
 * visitor has moved focus somewhere, the application has rewritten a field's value and placed the
 * caret in it itself, or nothing was focused at all and the only change was the reading direction.
 * A browser run meets the first of these only by a race; here the window is held open deliberately,
 * by claiming the coordinator the way the Router integration does and releasing it by hand, so each
 * case is decided by the restore and not by the scheduler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestBed } from '@angular/core/testing';
import {
  Localization,
  LocalizationInteractionRestore,
  provideLocalizationSetup,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';

import { runtimeExtensions } from './runtime-extensions';

const nextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function setup(): Promise<{
  readonly localization: Localization;
  readonly restore: LocalizationInteractionRestore;
}> {
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
  return {
    localization,
    restore: TestBed.inject(LocalizationInteractionRestore),
  };
}

/** Commits with the restore parked, runs `meanwhile`, then lets the restore land. */
async function commitThenRestore(meanwhile: () => void): Promise<void> {
  const { localization, restore } = await setup();
  restore.ɵclaim();
  const result = await localization.changeLocale('ar-EG');
  expect(result.status).toBe('committed');
  meanwhile();
  restore.ɵflush(window);
  await nextFrame();
  await nextFrame();
}

describe('the focus and selection restore after a locale commit', () => {
  let added: HTMLElement[] = [];

  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const element of added) element.remove();
    added = [];
    vi.restoreAllMocks();
  });

  function place<Placed extends HTMLElement>(element: Placed): Placed {
    document.body.append(element);
    added.push(element);
    return element;
  }

  it('puts focus back on the control that started the switch when the commit dropped it', async () => {
    const switcher = place(document.createElement('button'));
    switcher.focus();

    await commitThenRestore(() => switcher.blur());

    expect(document.activeElement).toBe(switcher);
  });

  it('leaves focus where the visitor moved it before the restore landed', async () => {
    const switcher = place(document.createElement('button'));
    const field = place(document.createElement('input'));
    switcher.focus();

    await commitThenRestore(() => field.focus());

    expect(document.activeElement).toBe(field);
  });

  it('leaves the offsets an application placed in a value it rewrote', async () => {
    const field = place(document.createElement('input'));
    field.value = 'abcdef';
    field.focus();
    field.setSelectionRange(1, 3);

    await commitThenRestore(() => {
      // The application's own component, rewriting its value for the new locale and mapping the
      // caret into the new string itself.
      field.value = 'XYZabcdef';
      field.setSelectionRange(4, 6);
    });

    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([4, 6]);
  });

  it('moves no focus for a change of reading direction alone', async () => {
    place(document.createElement('button'));
    place(document.createElement('input'));
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    await commitThenRestore(() => undefined);

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.activeElement).toBe(document.body);
  });
});
