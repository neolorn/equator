import { afterEach, describe, expect, it } from 'vitest';

import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  Localization,
  LocalizedMessage,
  internalDestination,
  withRouting,
  withFormattingContext,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';
import { messages } from '#i18n/shell';

import {
  addressedLocales,
  localeOrigin,
  pagePath,
  switchInDocument,
} from './addresses';
import { routes } from './app.routes';
import { runtimeExtensions } from './runtime-extensions';
import { appRouteProjection, routePolicy } from './localization.routes';

/**
 * A link a catalog places is an address Equator writes, so it is the canonical one.
 *
 * The application names the page as it names a route, origin-relative and in no locale. Written as
 * given, `/second` on an Arabic page is an address that names no locale: a visitor who follows it
 * is sent back through locale entry, and under a policy that prefixes every locale is answered with
 * a redirect rather than the page.
 */

@Component({
  imports: [LocalizedMessage],
  template: `
    <localized-message
      data-link
      [handle]="messages.helpLink"
      [slots]="bindings"
    />
  `,
})
class LinkHost {
  protected readonly messages = messages;
  protected readonly bindings = Object.freeze({
    link: Object.freeze({
      kind: 'link' as const,
      destination: internalDestination('/second'),
    }),
  });
}

afterEach(() => {
  history.replaceState(null, '', '/');
});

async function rendered(): Promise<ComponentFixture<LinkHost>> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [LinkHost],
    providers: [
      provideLocalizedRouter(routes, { origin: localeOrigin('en-US') }),
      provideLocalizationTesting(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        withRouting({ policy: routePolicy, projection: appRouteProjection }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  await TestBed.inject(Localization).initialize();
  const fixture = TestBed.createComponent(LinkHost);
  await fixture.whenStable();
  return fixture;
}

const href = (fixture: ComponentFixture<LinkHost>) =>
  (fixture.nativeElement as HTMLElement)
    .querySelector('[data-link] a')
    ?.getAttribute('href');

describe('a link a catalog places', () => {
  it('is written as the page it names, in the committed locale', async () => {
    const fixture = await rendered();

    expect(href(fixture)).toBe(pagePath('second', 'en-US'));
  });

  // Under a host policy another locale is another origin, and the page is not in this document.
  // Under locale-neutral the page has one address for every locale, so there is no Arabic one for
  // the link to move to.
  it.runIf(switchInDocument && addressedLocales('second').includes('ar-EG'))(
    'follows a locale change',
    async () => {
      const fixture = await rendered();

      await TestBed.inject(Localization).changeLocale('ar-EG');
      await fixture.whenStable();

      expect(href(fixture)).toBe(pagePath('second', 'ar-EG'));
    },
  );
});
