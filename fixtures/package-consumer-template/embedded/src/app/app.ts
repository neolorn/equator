import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { LocalizationRecovery, injectLocalization } from '@neolorn/equator';
import { messages } from '#i18n/shell';

/**
 * The panel's frame. The page around it owns the document's language and direction, so the panel
 * states its own on the element it renders into, and each message states the language that
 * supplied it, which is not always the committed one.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, LocalizationRecovery],
  template: `
    <localization-recovery />
    @if (snapshot(); as current) {
      <section
        data-panel
        [attr.lang]="current.primaryLocale"
        [attr.dir]="current.direction"
      >
        <h1
          data-heading
          [attr.lang]="heading().language"
          [attr.data-supplying]="heading().supplyingLocale"
        >
          {{ heading().value }}
        </h1>
        <p
          data-greeting
          [attr.lang]="greeting().language"
          [attr.data-supplying]="greeting().supplyingLocale"
        >
          {{ greeting().value }}
        </p>
        <nav>
          <a data-link="panel" routerLink="/">{{ home() }}</a>
          <a data-link="about" routerLink="/about">{{ about() }}</a>
        </nav>
        <button type="button" data-forget (click)="forget()">
          {{ forgetLabel() }}
        </button>
        @for (locale of locales; track locale) {
          <button
            type="button"
            [attr.data-choose]="locale"
            [attr.aria-pressed]="current.primaryLocale === locale"
            (click)="choose(locale)"
          >
            {{ locale }}
          </button>
        }
        <router-outlet />
      </section>
    }
  `,
})
export class App {
  private readonly localization = injectLocalization();
  protected readonly locales = ['en-US', 'ar', 'ar-EG'] as const;
  protected readonly snapshot = this.localization.snapshot;
  protected readonly heading = computed(() => {
    this.snapshot();
    return this.localization.evaluateText(messages.heading);
  });
  protected readonly greeting = computed(() => {
    this.snapshot();
    return this.localization.evaluateText(messages.greeting);
  });
  protected readonly home = this.localization.textSignal(messages.home);
  protected readonly about = this.localization.textSignal(messages.about);
  protected readonly forgetLabel = this.localization.textSignal(
    messages.forget,
  );

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    // What the browser rows read back: router navigations completed without a document request,
    // and when the client has booted. The document's language is the host page's, so these are
    // the only attributes the panel writes above its own element.
    const root = document.documentElement;
    const router = inject(Router);
    let documentNavigationPending = !router.navigated;
    let clientNavigations = 0;
    root.dataset['clientNavigations'] = '0';
    router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      if (documentNavigationPending) {
        documentNavigationPending = false;
        return;
      }
      clientNavigations += 1;
      root.dataset['clientNavigations'] = String(clientNavigations);
    });
    afterNextRender(() => {
      root.dataset['clientReady'] = 'true';
    });
  }

  protected choose(locale: string): void {
    void this.localization.changeLocale(locale);
  }

  protected forget(): void {
    void this.localization.forgetRememberedLocale();
  }
}
