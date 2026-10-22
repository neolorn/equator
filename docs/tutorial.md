# Your first localized route

This tutorial builds an Angular application in two locales, English and Arabic. It ends with a page
whose text changes with the locale, a second route that keeps its address in both languages, a
switcher that moves between them, and a test suite that asserts all of it.

Follow the steps in order. Each one produces something you can run.

## Before you begin

You need:

- Node.js on one of the [supported lines](reference/compatibility.md), which `node --version`
  reports;
- the Angular CLI, run through `npx`;
- an empty directory to work in.

## Create the application

```text
npx @angular/cli@22 new my-app --routing --style css
cd my-app
```

The CLI asks whether to enable server-side rendering. Answer no, which is the default, so the
application this tutorial builds runs in the browser alone and every file below is the file the CLI
wrote. Equator localizes a server-rendered application too, and [How to render on the
server](how-to/render-on-the-server.md) starts from one.

Run `npm start` and open the address the CLI prints. The Angular welcome page appears. Stop the
server before continuing.

## Install Equator

```sh install
npm install @neolorn/equator
npm install --save-dev @neolorn/equator-toolkit
```

`@neolorn/equator` ships with the application. `@neolorn/equator-toolkit` compiles the catalogs at
build time and is a development dependency.

## Set up the project

Declare the locales the application serves:

```sh run
npx equator init --source-locale en-US --default-locale en-US --locale en-US --locale ar-EG
```

`init` writes `equator.config.json`, maps `#i18n` in `package.json`, creates the `i18n/` directory,
and adds the `equator:generate`, `equator:check`, `equator:format`, `equator:clean`, and
`equator:watch` scripts. `equator.config.json` holds the locale set and nothing else.

`init` writes no catalog and no recovery message. Both are content, and content belongs to the
project.

## Write the messages

A catalog is one YAML file per locale per scope, at `i18n/<scope>/<locale>.yaml`. A scope is a
directory whose name you choose; `shell` holds the messages that surround every page.

Create `i18n/shell/en-US.yaml`:

```yaml i18n/shell/en-US.yaml
messages:
  app-title: Hello, world
  recovery-message: The page could not be shown. Please reload.
  recovery-retry: Try again
  home-heading: Home
  second-heading: Second page
  open-second: Open the second page
  return-home: Back to the start
  hero-tagline: Localized end to end.
  asset.alt: The Equator handbook cover
  learn-more:
    message: 'Read the {#strong}guide{/strong}.'
    description: Shown under the hero. The guide is a separate page.
  help-link:
    message: 'Open {#link}support{/link}.'
```

Create `i18n/shell/ar-EG.yaml` with the same keys:

```yaml i18n/shell/ar-EG.yaml
messages:
  app-title: مرحبا بالعالم
  recovery-message: تعذر عرض الصفحة. الرجاء إعادة التحميل.
  recovery-retry: إعادة المحاولة
  home-heading: الرئيسية
  second-heading: الصفحة الثانية
  open-second: افتح الصفحة الثانية
  return-home: العودة إلى البداية
  hero-tagline: مترجم من أوله إلى آخره.
  asset.alt: غلاف دليل Equator
  learn-more:
    message: 'اقرأ {#strong}الدليل{/strong}.'
  help-link:
    message: 'افتح {#link}الدعم{/link}.'
```

`recovery-message` is the sentence a visitor reads when no catalog can be loaded, and
`recovery-retry` names the button beside it. Equator has no default for either, so every application
writes them, and both travel in the recovery payload so they arrive in the reader's language even
though no catalog could be loaded.

`learn-more` and `help-link` carry [MessageFormat 2](https://www.unicode.org/reports/tr35/tr35-78/tr35-messageFormat.html)
slots: `{#strong}...{/strong}` marks a span that the application renders. A `description` travels
with the message to whoever translates it.

## Compile the catalogs

```sh run
npx equator generate
```

`generate` compiles both catalogs and writes the modules the application imports:

- `#i18n` exports `provideLocalization`, bound to this project's locale set.
- `#i18n/shell` exports `messages`, one typed handle for each key in the `shell` scope.

Keys are kebab-case in the file and camelCase in code, so `app-title` is `messages.appTitle`.

`generate` also reports that every message in the scope is unreached. Nothing has used one yet, so
that is what it should say here, and it goes away at the second compile further down, once the
components below read them.

## Declare the locale policy

Create `src/app/localization.routes.ts`:

```ts src/app/localization.routes.ts
import {
  createPathPrefixLocalePolicy,
  defineRouteProjection,
} from '@neolorn/equator';
import { routeProjection } from '#i18n/routes';

export const routePolicy = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

export const appRouteProjection = defineRouteProjection({
  generated: routeProjection,
});
```

The policy states where the locale appears in a URL. This one puts it in the first path segment, so
the home page is at `/en-us` and `/ar-eg`. [How to localize your routes](how-to/localize-routes.md)
covers the other three.

The projection states which routes have localized addresses. It starts from `routeProjection`, a
third generated module written from the application's route table. That table does not exist yet, so
the first `generate` wrote this module with no routes in it, and the second compile fills it in.

## Render a message with structure

Create `src/app/hero.ts`:

```ts src/app/hero.ts
import { Component } from '@angular/core';
import {
  internalDestination,
  LocalizedLabel,
  LocalizedMessage,
  LocalizePipe,
} from '@neolorn/equator';
import { messages } from '#i18n/shell';

@Component({
  selector: 'app-hero',
  imports: [LocalizePipe, LocalizedLabel, LocalizedMessage],
  templateUrl: './hero.html',
})
export class Hero {
  protected readonly messages = messages;
  protected readonly helpBindings = {
    link: {
      kind: 'link' as const,
      destination: internalDestination('/second'),
    },
  };
}
```

Create `src/app/hero.html`:

```html src/app/hero.html
<p>{{ messages.heroTagline | localize }}</p>

<div role="img" [localizedLabel]="messages.asset.alt"></div>

<localized-message [handle]="messages.learnMore" />

<localized-message [handle]="messages.helpLink" [slots]="helpBindings" />
```

`LocalizePipe` renders a message that is text. `LocalizedLabel` puts one in an attribute that cannot
hold markup, here the `aria-label` that names the image. `LocalizedMessage` renders a message that has a slot in it, and `helpBindings` states
what the `link` slot becomes. [How to render a message](how-to/render-messages.md) covers all four.

## Write the routes

Replace `src/app/app.routes.ts`:

```ts src/app/app.routes.ts
import { Component } from '@angular/core';
import { RouterLink, type Routes } from '@angular/router';
import { LocalizePipe } from '@neolorn/equator';
import { messages } from '#i18n/shell';

import { Hero } from './hero';

@Component({
  selector: 'app-home',
  imports: [Hero, RouterLink, LocalizePipe],
  template: `
    <h2>{{ messages.homeHeading | localize }}</h2>
    <app-hero />
    <a routerLink="second">{{ messages.openSecond | localize }}</a>
  `,
})
export class Home {
  protected readonly messages = messages;
}

@Component({
  selector: 'app-second',
  imports: [RouterLink, LocalizePipe],
  template: `
    <h2>{{ messages.secondHeading | localize }}</h2>
    <a routerLink="../">{{ messages.returnHome | localize }}</a>
  `,
})
export class Second {
  protected readonly messages = messages;
}

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: Home },
  { path: 'second', component: Second },
];
```

Nothing in this file names a locale. `routerLink="second"` is written once and resolves under
whichever locale is committed.

## Compose the providers

Replace `src/app/app.config.ts`:

```ts src/app/app.config.ts
import {
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
} from '@angular/core';
import { provideLocalization } from '#i18n';
import { messages } from '#i18n/shell';
import {
  cookieStore,
  withPersistence,
  withRecoveryMessage,
  withRouting,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { routes } from './app.routes';
import { appRouteProjection, routePolicy } from './localization.routes';

export const localizationFeatures = [
  withRouting({ policy: routePolicy, projection: appRouteProjection }),
  withRecoveryMessage({
    message: messages.recoveryMessage,
    retryLabel: messages.recoveryRetry,
  }),
] as const;

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideLocalizedRouter(routes),
    provideLocalization(
      ...localizationFeatures,
      withPersistence(cookieStore()),
    ),
  ],
};
```

`provideLocalizedRouter` replaces `provideRouter`, and the CLI's
`provideBrowserGlobalErrorListeners()` stays. Each `with*` selects a feature, and leaving one out
selects its default; [Features](reference/features.md) lists them. `localizationFeatures` is
exported so the test below composes the same features rather than a copy of them.
`withPersistence(cookieStore())` stores the visitor's choice, so the next visit opens in the
language the last one ended in. It stays out of the shared list, because a test that stores a
choice decides the locale the next test starts in.

## Render the title and the switcher

Replace `src/app/app.ts`:

```ts src/app/app.ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  injectLocalization,
  LocaleChoice,
  LocalizePipe,
} from '@neolorn/equator';
import { messages } from '#i18n/shell';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LocaleChoice, LocalizePipe],
  template: `
    <h1>{{ messages.appTitle | localize }}</h1>
    <nav>
      @for (choice of localization.localeChoices(); track choice.locale) {
        <a [localeChoice]="choice">{{ choice.selfName }}</a>
      }
    </nav>
    <router-outlet />
  `,
})
export class App {
  protected readonly messages = messages;
  protected readonly localization = injectLocalization();
}
```

`localeChoices()` returns one choice for each configured locale. `localeChoice` writes `lang`,
`dir`, `aria-current`, `aria-busy`, and, on an anchor, an `href` holding the current page's address
in that locale.

The template is inline now, so delete `src/app/app.html` and `src/app/app.css`, which the CLI wrote
for the old one.

## Compile the routes

The route table exists now, so compile again:

```sh run
npx equator generate
```

`generate` writes `#i18n/routes` from what this pass found, and checks the composed providers
against it. `equator watch` runs both steps while you work.

## Run the application

Start the server and open `/en-us`. The English title, the English heading, and two switcher options
appear. Select the Arabic option: the text changes to Arabic, the direction flips to right to left,
and the address becomes `/ar-eg`. Open the second page and the address becomes `/ar-eg/second`.

## Write the test

Replace `src/app/app.spec.ts`:

```ts src/app/app.spec.ts
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformLocation } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Localization } from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import {
  LocalizationTestingController,
  provideLocalizationTesting,
  resetLocalizationTestEnvironment,
} from '@neolorn/equator/testing';
import { localizationSetup } from '#i18n';
import { providerId, scopeId } from '#i18n/shell';

import { App } from './app';
import { localizationFeatures } from './app.config';
import { routes } from './app.routes';

const shell = { providerId, scopeId } as const;

// The DOM outlives this file. Equator reads the address bar for the locale, so a file that
// navigates and does not put it back decides what the next file is testing.
afterEach(resetLocalizationTestEnvironment);

async function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      // TestBed writes no browser URL of its own. This is the address the test can read.
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: 'http://localhost:4200/' },
      },
      provideZonelessChangeDetection(),
      provideLocalizedRouter(routes),
      // The same setup and the same features the application composes.
      provideLocalizationTesting(localizationSetup, ...localizationFeatures),
    ],
  });

  const localization = TestBed.inject(Localization);
  await localization.initialize();

  const fixture = TestBed.createComponent(App);
  // A component created by hand is not a component the Router reached. Nothing has an address
  // until a route is activated, so the test navigates to the one it means to be on.
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/');
  await fixture.whenStable();
  fixture.detectChanges();

  return {
    fixture,
    localization,
    router,
    address: TestBed.inject(PlatformLocation),
    catalogs: TestBed.inject(LocalizationTestingController),
  };
}

function heading(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.querySelector('h1')?.textContent?.trim() ?? '';
}

function switcher(fixture: {
  nativeElement: HTMLElement;
}): HTMLAnchorElement[] {
  return [
    ...fixture.nativeElement.querySelectorAll<HTMLAnchorElement>('nav a'),
  ];
}

describe('the application', () => {
  it('renders in the default locale', async () => {
    const { fixture, localization } = await setup();

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(heading(fixture)).not.toBe('');
  });

  it('offers one switcher option per locale, each a link', async () => {
    const { fixture } = await setup();
    const options = switcher(fixture);

    expect(options.map((each) => each.getAttribute('lang'))).toEqual([
      'en',
      'ar',
    ]);
    expect(options.map((each) => each.getAttribute('dir'))).toEqual([
      'ltr',
      'rtl',
    ]);
    expect(options.map((each) => each.getAttribute('aria-current'))).toEqual([
      'true',
      null,
    ]);
    expect(options.map((each) => each.getAttribute('href'))).toEqual([
      '/en-us',
      '/ar-eg',
    ]);
  });

  it('changes the whole page at once, and nothing before it commits', async () => {
    const { fixture, localization, address, catalogs } = await setup();
    const before = heading(fixture);

    // Hold the arriving catalog open, so the half of a switch that is otherwise too fast to see
    // can be asserted.
    const arriving = catalogs.deferNext(shell, 'ar-EG');
    const switching = localization.changeLocale('ar-EG');
    await arriving.started;

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(heading(fixture)).toBe(before);

    arriving.release();
    await switching;
    await fixture.whenStable();
    fixture.detectChanges();

    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    expect(document.documentElement.lang).toBe('ar-EG');
    expect(document.documentElement.dir).toBe('rtl');
    expect(address.pathname).toBe('/ar-eg');
    expect(heading(fixture)).not.toBe(before);
  });

  it('keeps the locale across a navigation, and spells the address for it', async () => {
    const { fixture, localization, router, address } = await setup();

    await localization.changeLocale('ar-EG');
    await fixture.whenStable();

    await router.navigateByUrl('/second');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    // The Router's own URL is the route; the address is the route in the committed locale.
    expect(router.url).toBe('/second');
    expect(address.pathname).toBe('/ar-eg/second');
  });
});
```

Run the suite once:

```text
npm test -- --no-watch
```

On a terminal `ng test` keeps watching for changes unless told not to. Four cases pass. The run
also prints `Not implemented: Window's scrollTo()` a few times, which is the test environment saying
it has no scrolling to do rather than anything about the application.

## What to read next

- [How to write a message](how-to/write-messages.md): scopes, placeholders, and what happens when a
  locale omits a message.
- [How to localize your routes](how-to/localize-routes.md): the other locale policies, and what a
  visitor's address decides.
- [About how a locale is resolved](explanation/about-locale-resolution.md): the order Equator asks
  in, and how to choose the sources it asks.
