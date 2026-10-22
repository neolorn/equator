import { afterEach, describe, expect, it, vi } from 'vitest';

import { Component, ErrorHandler } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  Localization,
  LocalizationRecovery,
  createLocalizationContext,
  type LocalizationDiagnostic,
  type LocalizationSnapshot,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { messages, providerId, scopeId } from '#i18n/shell';

import { runtimeExtensions } from './runtime-extensions';

/**
 * The retry control of `<localization-recovery>`, pressed.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 11 requires the recovery presentation
 * to offer a retry. The other spec files call `Localization.retry()` themselves; a reader presses
 * the button, and what the application learns of the attempt arrives through the component's two
 * outputs. The source catalog's load is held by this file, so each case decides how the attempt
 * it started ends and reads the control while the attempt is still open.
 */

const sourceIdentity = `${providerId}:${scopeId}:en-US` as const;

@Component({
  selector: 'retry-host',
  imports: [LocalizationRecovery],
  template: `<localization-recovery
    retryLabel="Try again"
    (recovered)="recovered.push($event)"
    (retryFailed)="retryFailed.push($event)"
  />`,
})
class RetryHost {
  readonly recovered: LocalizationSnapshot[] = [];
  readonly retryFailed: LocalizationDiagnostic[] = [];
}

interface HeldLoad {
  deliver(): void;
  lose(): void;
}

interface Failed {
  readonly localization: Localization;
  readonly fixture: ComponentFixture<RetryHost>;
  /** Every load of the source catalog that was asked for, oldest first. */
  readonly loads: HeldLoad[];
  /** What reached the application's error handler, which a press must never do. */
  readonly unhandled: unknown[];
  readonly button: () => HTMLButtonElement;
}

/** An application whose first load of the source catalog was lost, showing its recovery. */
async function failed(): Promise<Failed> {
  const sourceLoader = catalogLoaders[sourceIdentity];
  const loads: HeldLoad[] = [];
  const localization = createLocalizationContext({
    setup: {
      configuration,
      catalogSet,
      catalogLoaders: {
        ...catalogLoaders,
        [sourceIdentity]: () =>
          new Promise<Awaited<ReturnType<typeof sourceLoader>>>(
            (resolve, reject) => {
              loads.push({
                deliver: () => resolve(sourceLoader()),
                lose: () => reject(new Error('intentional')),
              });
            },
          ),
      },
      recoveryPayload,
      extensions: runtimeExtensions,
    },
    bootstrapScopes: [Object.freeze({ providerId, scopeId })],
    recoveryMessage: messages.recovery.unavailable,
    formattingContext: { timeZone: 'UTC' },
  });
  const first = localization.initialize();
  await vi.waitFor(() => {
    expect(loads).toHaveLength(1);
  });
  loads[0]?.lose();
  await expect(first).rejects.toBeDefined();

  const unhandled: unknown[] = [];
  await TestBed.configureTestingModule({
    rethrowApplicationErrors: false,
    providers: [
      { provide: Localization, useValue: localization },
      {
        provide: ErrorHandler,
        useValue: { handleError: (error: unknown) => unhandled.push(error) },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(RetryHost);
  fixture.detectChanges();
  return {
    localization,
    fixture,
    loads,
    unhandled,
    button: () => {
      const found = (fixture.nativeElement as HTMLElement).querySelector(
        'button',
      );
      if (found === null) throw new Error('The recovery offers no retry.');
      return found;
    },
  };
}

const region = (fixture: ComponentFixture<RetryHost>): Element | null =>
  (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');

describe('the retry control of the recovery region', () => {
  let open: Failed | undefined;

  afterEach(() => {
    open?.fixture.destroy();
    open?.localization.dispose();
    open = undefined;
    TestBed.resetTestingModule();
  });

  it('starts one attempt, and is unusable while that attempt is open', async () => {
    open = await failed();
    const { fixture, loads, unhandled, button } = open;
    expect(button().disabled).toBe(false);

    button().click();
    // Pressed again before the page has redrawn, which is before the control can show that it is
    // busy.
    button().click();
    fixture.detectChanges();

    await vi.waitFor(() => {
      expect(loads).toHaveLength(2);
    });
    expect(button().disabled).toBe(true);
    expect(region(fixture)).not.toBeNull();

    loads[1]?.lose();
    await vi.waitFor(() => {
      expect(fixture.componentInstance.retryFailed).toHaveLength(1);
    });
    // One attempt, so one load and one report of how it ended, and the second press was not an
    // error for the application to hear about.
    expect(loads).toHaveLength(2);
    expect(unhandled).toEqual([]);
  });

  it('reports why a retry did not work, and can be pressed again', async () => {
    open = await failed();
    const { localization, fixture, loads, button } = open;

    button().click();
    await vi.waitFor(() => {
      expect(loads).toHaveLength(2);
    });
    loads[1]?.lose();
    await vi.waitFor(() => {
      expect(fixture.componentInstance.retryFailed).toHaveLength(1);
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.retryFailed[0]).toMatchObject({
      code: 'catalog-load-failed',
      outcome: 'operational-failure',
    });
    expect(fixture.componentInstance.recovered).toEqual([]);
    expect(localization.lifecycle()).toBe('failed');
    expect(region(fixture)).not.toBeNull();
    expect(button().disabled).toBe(false);

    // Usable in fact, not only in appearance: a second press starts a second attempt.
    button().click();
    await vi.waitFor(() => {
      expect(loads).toHaveLength(3);
    });
    loads[2]?.lose();
    await vi.waitFor(() => {
      expect(fixture.componentInstance.retryFailed).toHaveLength(2);
    });
  });

  it('hands over the committed snapshot when a retry works, and withdraws', async () => {
    open = await failed();
    const { localization, fixture, loads, button } = open;

    button().click();
    await vi.waitFor(() => {
      expect(loads).toHaveLength(2);
    });
    loads[1]?.deliver();
    await vi.waitFor(() => {
      expect(fixture.componentInstance.recovered).toHaveLength(1);
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.recovered[0]).toBe(
      localization.snapshot(),
    );
    expect(fixture.componentInstance.recovered[0]?.primaryLocale).toBe('en-US');
    expect(fixture.componentInstance.retryFailed).toEqual([]);
    expect(localization.lifecycle()).toBe('ready');
    expect(region(fixture)).toBeNull();
  });

  it('shares its attempt with a retry the application asks for beside it', async () => {
    open = await failed();
    const { localization, fixture, loads, unhandled, button } = open;

    button().click();
    await vi.waitFor(() => {
      expect(loads).toHaveLength(2);
    });
    // What a second recovery region on the page, or the application's own code, does while the
    // first attempt is still open.
    const beside = localization.retry();
    loads[1]?.deliver();
    const snapshot = await beside;
    await vi.waitFor(() => {
      expect(fixture.componentInstance.recovered).toHaveLength(1);
    });

    expect(snapshot).toBe(localization.snapshot());
    expect(fixture.componentInstance.recovered[0]).toBe(snapshot);
    expect(loads).toHaveLength(2);
    expect(unhandled).toEqual([]);
  });
});
