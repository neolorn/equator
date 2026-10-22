import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestBed } from '@angular/core/testing';
import { Router, TitleStrategy } from '@angular/router';
import {
  Localization,
  withRouting,
  withFormattingContext,
} from '@neolorn/equator';
import {
  LocalizedTitleStrategy,
  documentMessage,
  provideLocalizedRouter,
  type LocalizedRouterOptions,
} from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';
import { messages } from '#i18n/shell';

import { routes } from './app.routes';
import { runtimeExtensions } from './runtime-extensions';
import { routePolicy, appRouteProjection } from './localization.routes';
import { localeOrigin, switchInDocument } from './addresses';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * Does a route's document metadata come from the catalog for the locale that is active?
 *
 * The failure this guards against is not a missing lookup. It is a conditional chain on
 * `context.resolution.routeId` inside the `document` callback, whose last branch answers for every
 * route the chain does not name, so most of the application's pages claim to be the home page, in
 * whichever language is active, and nothing reports it: the chain compiles, runs, and returns a
 * real localized string every time.
 *
 * **Two routes, not one.** With a single route under test, "each route's own metadata" and "one
 * title for the whole application" produce identical output, and the assertion is green for the
 * defect it was written against. Every case below reads at least two routes.
 */

const ARABIC = 'ar-EG';

/**
 * `origin` is the one this build answers at. Under a locale-host policy it decides which locale a
 * change stays in the document for, so a case that switches to Arabic answers at Arabic's.
 */
async function configure(
  documentMetadata: Record<string, unknown> | undefined,
  document?: LocalizedRouterOptions['document'],
  origin: string = localeOrigin('en-US'),
): Promise<Router> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [
      provideLocalizedRouter(routes, {
        origin,
        ...(documentMetadata === undefined
          ? {}
          : { documentMetadata: documentMetadata as never }),
        ...(document === undefined ? {} : { document }),
      }),
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
      // The application's own configuration. Without it Angular's `DefaultTitleStrategy` writes the
      // English `title` that `app.routes.ts` declares on `second` over everything asserted here,
      // which is 8.2's defect, and is not what this file is measuring.
      { provide: TitleStrategy, useClass: LocalizedTitleStrategy },
    ],
  }).compileComponents();
  await TestBed.inject(Localization).initialize();
  return TestBed.inject(Router);
}

/** The declaration this application ships, restated here only so a case can vary one entry of it. */
const DECLARED = {
  'route:_index': {
    title: messages.document.title,
    description: messages.document.description,
  },
  'route:second': {
    title: messages.document.second.title,
    description: messages.document.second.description,
  },
} as const;

const description = (): string | null =>
  document.querySelector('meta[name="description"]')?.getAttribute('content') ??
  null;

describe('a route document declared by route id', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders each route’s own title and description, in the active locale', async () => {
    const router = await configure(DECLARED, undefined, localeOrigin(ARABIC));
    const localization = TestBed.inject(Localization);
    await localization.changeLocale(ARABIC);

    await router.navigateByUrl('/');
    expect(document.title).toBe('مختبر ميزات Equator');
    expect(description()).toBe('مختبر وقت تشغيل الترجمة في Equator.');

    await router.navigateByUrl('/second');
    // Distinct from the home title, and distinct from `route.second`: the label this route
    // renders inside the page. Both distinctions are deliberate: sharing either string would let a
    // wrong lookup pass.
    expect(document.title).toBe('العنوان الثاني');
    expect(description()).toBe(
      'عنوان ثانٍ، لإثبات أن بيانات كل صفحة خاصة بها.',
    );
  });

  // Where a switch stays in this document. Under locale-host it loads the other origin instead.
  it.runIf(switchInDocument)(
    'follows the locale rather than the navigation',
    async () => {
      // The catalog is chosen when the document is projected, not when the map is written. Asserted
      // in both directions on one route, because a lookup hardcoded to the source locale answers
      // English correctly and is the whole defect.
      const router = await configure(DECLARED);
      await router.navigateByUrl('/second');
      expect(document.title).toBe('Second address');

      await TestBed.inject(Localization).changeLocale(ARABIC);
      // The re-projection runs in an effect, so it lands on the next change detection rather than
      // inside `changeLocale`. A zoneless application schedules that itself; a zoneless TestBed has
      // to be told, and without this the assertion reads the title from before the switch.
      TestBed.tick();
      expect(document.title).toBe('العنوان الثاني');
      claimCapability('entry:@neolorn/equator', { policy: routePolicy });
    },
  );

  it('lets the dynamic callback override one field and keep the rest', async () => {
    // The two halves compose rather than replace. A route whose title is fetched keeps the
    // description its catalog declares, and a callback that returned a whole projection would
    // silently drop it.
    const router = await configure(DECLARED, () => ({
      title: 'From the store',
    }));
    await router.navigateByUrl('/second');
    expect(document.title).toBe('From the store');
    expect(description()).toBe(
      "A second address, to prove one route's metadata is its own.",
    );
  });

  it('reports a route that reached a visitor with no title', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `/second` declared, `/items/42` not, and no callback to cover it.
    const router = await configure({
      'route:second': DECLARED['route:second'],
    });
    await router.navigateByUrl('/second');
    await router.navigateByUrl('/items/42');

    const untitled = warn.mock.calls
      .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
      .filter((message) => message.includes('no document title'));
    expect(untitled).toHaveLength(1);
    expect(untitled[0]).toContain('"item"');
    // And the declared one is not reported, which is what makes the case above a finding rather
    // than a warning that fires for everything.
    expect(untitled[0]).not.toContain('route:second');
  });

  it('refuses a message that takes a value with none bound to it', () => {
    // Refused where the declaration is built, which is this call. `PlainMessageHandle` is
    // assignable from a handle that declares inputs, so nothing about the type stops this being
    // written, and resolved as it stands the title reads with its placeholder unfilled.
    expect(() =>
      provideLocalizedRouter(routes, {
        documentMetadata: {
          'route:second': { title: messages.welcome as never },
        },
      }),
    ).toThrow(/takes "name"/u);
    claimCapability('feature:provideLocalizedRouter');
    claimCapability('entry:@neolorn/equator/router');
  });

  it('accepts the same message with its value bound', async () => {
    const router = await configure({
      'route:second': {
        title: documentMessage(messages.welcome, { name: 'Equator' }),
      },
    });
    await router.navigateByUrl('/second');

    expect(document.title).toBe('Welcome, Equator!');
    claimCapability('declaration:document-metadata', { policy: routePolicy });
    claimCapability('entry:@neolorn/equator/router', { policy: routePolicy });
  });

  it('refuses an unbound message in an outcome document too', () => {
    expect(() =>
      provideLocalizedRouter(routes, {
        outcomeDocuments: { 'not-found': { title: messages.welcome as never } },
      }),
    ).toThrow(/takes "name"/u);
    claimCapability('feature:provideLocalizedRouter');
    claimCapability('declaration:outcome-documents');
    claimCapability('entry:@neolorn/equator/router');
  });

  it('reports a declaration naming a route that does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await configure({
      ...DECLARED,
      'route:renamed-away': DECLARED['route:second'],
    });
    const named = warn.mock.calls
      .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
      .filter((message) => message.includes('documentMetadata'));
    expect(named).toHaveLength(1);
    expect(named[0]).toContain('"route:renamed-away"');
    // The keys that do name routes are not reported, so this cannot pass by reporting everything.
    expect(named[0]).not.toContain('names "route:second"');
    expect(named[0]).toContain('so that entry describes nothing.');
  });

  it('reports every declaration naming a route that does not exist, in one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await configure({
      ...DECLARED,
      'route:renamed-away': DECLARED['route:second'],
      'route:removed': DECLARED['route:second'],
    });
    const named = warn.mock.calls
      .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
      .filter((message) => message.includes('documentMetadata'));
    expect(named).toHaveLength(1);
    expect(named[0]).toContain(
      'names "route:renamed-away", "route:removed", which no route in the projection declares, so those entries describe nothing.',
    );
  });
});

describe('the Open Graph block and the image that decides it', () => {
  const openGraph = (): readonly string[] =>
    [...document.querySelectorAll('meta[property^="og:"]')].map(
      (node) => node.getAttribute('property') ?? '',
    );

  it('writes no block for a declaration that carries no image', async () => {
    // The half a catalog holds. `siteName` and `imageAlt` are sentences and belong in a catalog;
    // the image URL is the deployment's and arrives through `document`. A route that declares the
    // first and supplies no second has started nothing, and `DocumentSocialProjection` says the
    // image is what decides whether there is a block at all.
    const router = await configure({
      'route:second': {
        title: messages.document.second.title,
        description: messages.document.second.description,
        siteName: messages.document.title,
      },
    });
    await router.navigateByUrl('/second');

    expect(openGraph()).toEqual([]);
    expect(document.querySelector('meta[name="twitter:card"]')).toBeNull();
    // The rest of the head is unaffected: withholding the block is not withholding the page.
    expect(description()).not.toBeNull();
  });

  it('writes the block once the deployment supplies one', async () => {
    const router = await configure(
      {
        'route:second': {
          title: messages.document.second.title,
          description: messages.document.second.description,
          siteName: messages.document.title,
        },
      },
      () => ({ social: { image: 'https://site.example/social/preview.png' } }),
    );
    await router.navigateByUrl('/second');

    expect(openGraph()).toContain('og:image');
    expect(openGraph()).toContain('og:site_name');
    // Section 13: a card processor falls back to Open Graph, so the only card tag is the one Open
    // Graph has no equivalent for.
    expect(
      [...document.querySelectorAll('meta[name^="twitter:"]')].map((node) =>
        node.getAttribute('name'),
      ),
    ).toEqual(['twitter:card']);
  });
});
