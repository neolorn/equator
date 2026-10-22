import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TestBed } from '@angular/core/testing';
import {
  DocumentLocalization,
  Localization,
  provideLocalizationSetup,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';

import { runtimeExtensions } from './runtime-extensions';

/**
 * What is left in the head when the application that wrote it goes away.
 *
 * Everything `DocumentLocalization` writes is marked as its own, and disposing of it removes every
 * marked element and puts the title back, so a document that outlives the application, as a test
 * host's does and as a page embedding more than one application does, carries nothing of it. An
 * element the application did not write is not touched.
 */

const OWNED = '[data-equator-document]';

const projection = {
  title: 'Second page',
  description: 'What the second page is about.',
  locale: 'en-US',
  seo: {
    indexing: 'indexable',
    canonical: 'https://site.example/en-us/second',
    alternates: [
      {
        locale: 'en-US',
        hreflang: 'en-US',
        url: 'https://site.example/en-us/second',
      },
      {
        locale: 'ar-EG',
        hreflang: 'ar-EG',
        url: 'https://site.example/ar-eg/second',
      },
    ],
    xDefault: 'https://site.example/second',
  },
  social: { image: 'https://site.example/preview.png' },
} as const;

/** The head of an application that has started, which is what ties it to the injector's life. */
async function configured(): Promise<DocumentLocalization> {
  TestBed.resetTestingModule();
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
  return TestBed.inject(DocumentLocalization);
}

describe('the head after its application is gone', () => {
  let foreign: HTMLMetaElement | undefined;
  let title = '';

  beforeEach(() => {
    title = document.title;
  });

  afterEach(() => {
    foreign?.remove();
    foreign = undefined;
    TestBed.resetTestingModule();
    for (const node of document.head.querySelectorAll(OWNED)) node.remove();
    document.title = title;
  });

  function authored(): HTMLMetaElement {
    foreign = document.createElement('meta');
    foreign.setAttribute('name', 'author');
    foreign.setAttribute('content', 'the application');
    document.head.append(foreign);
    return foreign;
  }

  it('carries nothing Equator wrote once the head is disposed of', async () => {
    document.title = 'As the document loaded';
    const kept = authored();
    const head = await configured();

    head.apply(projection);
    expect(document.title).toBe('Second page');
    expect(document.head.querySelectorAll(OWNED).length).toBeGreaterThan(5);
    expect(head.current()).toMatchObject({ title: 'Second page' });

    head.dispose();

    expect(document.head.querySelectorAll(OWNED)).toHaveLength(0);
    expect(document.title).toBe('As the document loaded');
    expect(head.current()).toBeUndefined();
    expect(kept.isConnected).toBe(true);
  });

  it('is disposed of with the injector that provided it', async () => {
    const kept = authored();
    const head = await configured();
    head.apply(projection);
    expect(document.head.querySelectorAll(OWNED).length).toBeGreaterThan(5);

    TestBed.resetTestingModule();

    expect(document.head.querySelectorAll(OWNED)).toHaveLength(0);
    expect(document.title).toBe(title);
    expect(kept.isConnected).toBe(true);
  });
});
