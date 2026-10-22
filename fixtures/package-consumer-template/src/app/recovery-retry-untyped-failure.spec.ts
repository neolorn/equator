import { afterEach, describe, expect, it, vi } from 'vitest';

import { Component, ErrorHandler } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  Localization,
  LocalizationRecovery,
  provideLocalizationSetup,
  withFormattingContext,
  withOverlayLocale,
  withRecoveryMessage,
  type LocalizationDiagnostic,
  type LocalizationSnapshot,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { messages } from '#i18n/shell';

import { runtimeExtensions } from './runtime-extensions';

/**
 * A retry stopped by an application's own code, which throws an error of its own.
 *
 * `specs/06-runtime-and-angular.spec.md` section 5 has a failed initialization end with a typed
 * failure, and section 11 lets a coherence-critical effect prevent a commit. An overlay adapter is
 * such an effect and is written by the application, so what it throws carries no diagnostic. The
 * recovery region still has to say why the retry did not work: `retryFailed` is the only place an
 * application that renders the region hears of it.
 */

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

describe('a retry stopped by an overlay adapter that throws its own error', () => {
  let fixture: ComponentFixture<RetryHost> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    TestBed.resetTestingModule();
  });

  it('is reported through retryFailed as the typed internal failure', async () => {
    const thrown = new Error('intentional');
    const overlay = { refuse: true };
    const unhandled: unknown[] = [];
    TestBed.configureTestingModule({
      rethrowApplicationErrors: false,
      providers: [
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders,
            recoveryPayload,
            extensions: runtimeExtensions,
          },
          withRecoveryMessage({ message: messages.recovery.unavailable }),
          withOverlayLocale(() => ({
            apply: () => {
              if (overlay.refuse) throw thrown;
            },
          })),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => unhandled.push(error) },
        },
      ],
    });
    const localization = TestBed.inject(Localization);
    await expect(localization.initialize()).rejects.toBeDefined();
    expect(localization.lifecycle()).toBe('failed');

    fixture = TestBed.createComponent(RetryHost);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const button = (): HTMLButtonElement => {
      const found = host.querySelector('button');
      if (found === null) throw new Error('The recovery offers no retry.');
      return found;
    };
    const reports = fixture.componentInstance;

    button().click();
    await vi.waitFor(() => {
      expect(reports.retryFailed).toHaveLength(1);
    });
    fixture.detectChanges();

    expect(reports.retryFailed[0]).toMatchObject({
      code: 'internal-invariant',
      outcome: 'operational-failure',
    });
    expect(reports.recovered).toEqual([]);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(button().disabled).toBe(false);

    // The adapter accepts the next snapshot, so the same control now recovers.
    overlay.refuse = false;
    button().click();
    await vi.waitFor(() => {
      expect(reports.recovered).toHaveLength(1);
    });
    fixture.detectChanges();

    expect(reports.recovered[0]).toBe(localization.snapshot());
    expect(reports.retryFailed).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(unhandled).toEqual([]);
  });
});
