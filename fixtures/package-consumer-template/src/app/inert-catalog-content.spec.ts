import { beforeEach, describe, expect, it } from 'vitest';

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Localization,
  LocalizedMessage,
  provideLocalizationSetup,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { messages } from '#i18n/shell';

import { runtimeExtensions } from './runtime-extensions';

/**
 * Catalog content rendered on the structured path stays data.
 *
 * `specs/09-safe-content-and-ux.spec.md` sections 2 to 5: catalog text is never HTML, a catalog
 * never chooses a URL, a target, a relationship or a handler, and never chooses a class, a style
 * or a token. The one markup-bearing message the shell renders elsewhere is a plain message that
 * Angular interpolates, which escapes it whatever the runtime does, so it cannot show any of this.
 * These messages go through `localized-message`, where the runtime decides what each part becomes.
 */

@Component({
  selector: 'inert-content-host',
  imports: [LocalizedMessage],
  template: `
    <localized-message data-markup [handle]="messages.hostile.markup" />
  `,
})
class InertContentHost {
  protected readonly messages = messages;
}

async function render(): Promise<HTMLElement> {
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
  await TestBed.inject(Localization).initialize();
  const fixture = TestBed.createComponent(InertContentHost);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('catalog text on the structured path', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    host = await render();
  });

  it('renders markup a catalog wrote as the text it is', () => {
    const message = host.querySelector('[data-markup]');
    expect(message?.querySelector('script')).toBeNull();
    expect(message?.querySelector('img')).toBeNull();
    expect(message?.textContent).toContain('<script>alert(1)</script>');
    expect(message?.querySelector('strong')?.textContent?.trim()).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('produces no event attribute anywhere a catalog reached', () => {
    const named = [...host.querySelectorAll('*')].flatMap((element) =>
      element.getAttributeNames().filter((name) => /^on/iu.test(name)),
    );
    expect(named).toEqual([]);
  });
});
