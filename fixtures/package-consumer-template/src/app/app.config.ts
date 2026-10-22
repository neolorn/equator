import {
  type ApplicationConfig,
  inject,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { TitleStrategy, withInMemoryScrolling } from '@angular/router';
import {
  cookieStore,
  fixedClock,
  instant,
  withExtensions,
  withFormattingContext,
  withLocaleAnnouncement,
  withLocalizationClock,
  withObservability,
  withOverlayLocale,
  withPersistence,
  withRecoveryMessage,
  withRelativeTimePolicy,
  withRouting,
  type RelativeTimePolicy,
} from '@neolorn/equator';
import {
  LocalizedTitleStrategy,
  provideLocalizedRouter,
} from '@neolorn/equator/router';
import { provideLocalization } from '#i18n';
import {
  providerId as lazyProviderId,
  scopeId as lazyScopeId,
} from '#i18n/lazy';
import { messages } from '#i18n/shell';

import { routes } from './app.routes';
import { routeTransitions } from './route-transitions';
import { localeCookie } from './locale-cookie';
import { overlayLocale } from './overlay-locale';
import { runtimeExtensions } from './runtime-extensions';
import { DynamicContentStore, provideDynamicContent } from './dynamic-content';
import { eventLog } from './event-log';
import inputs from './exercise-inputs.json';
import {
  routePolicy,
  appRouteProjection,
  SITE_ORIGIN,
} from './localization.routes';

/**
 * The formatting context this application declares.
 *
 * Exported so a test can assert the values the application actually ships rather than a copy of
 * them. `numberingSystem: 'latn'` is the load-bearing one: `ar-EG` resolves to `arab` on its own,
 * so this line is the difference between Latin and Arabic-Indic digits on every localized surface,
 * and `app-formatting-context.spec.ts` asserts that it arrives. Only the browser harness bootstraps
 * through `appConfig`, and every vitest spec in this lab builds its own providers.
 */
export const appFormattingContext = Object.freeze({
  timeZone: 'UTC',
  calendar: 'gregory',
  numberingSystem: 'latn',
  hourCycle: 'h23',
});

/**
 * The one social fact a deployment has to supply, and the reason Equator asks for it.
 *
 * `og:image` is required by ogp.me and is an absolute URL to this application's own artwork, so it
 * can only come from here: an image URL inside Equator would be consumer content in a
 * product-neutral library. Supplying it is also what turns the Open Graph block on: everything else
 * in that block, including the `og:locale` spelling that is the whole point, Equator derives.
 */
const SOCIAL_PREVIEW = {
  image: 'https://site.example/social/preview.png',
  card: 'summary_large_image',
  // A brand name, not a sentence. It is the same string in every language on purpose, which is why
  // it stays here and the alt text does not: alt text describes a picture to someone who cannot
  // see it, and that is reading, so it comes from the catalog below.
  siteName: 'Equator package consumer',
} as const;

/**
 * What each route's document says, declared once per route id.
 *
 * Declared per route id rather than as a conditional chain on `context.resolution.routeId` inside
 * the `document` callback, which would answer with the same two strings for every route it does not
 * name, so `/second` and `/items/42` and `/lazy` would all claim to be the home page, in both
 * languages, and nothing would say so. A chain always has a last branch, so it never stops
 * compiling and never stops answering.
 *
 * They are messages rather than strings for one reason worth stating: `equator check
 * --require-complete` already fails when a target catalog omits a message, so a title with no Arabic
 * translation is a build failure and not a page that quietly serves English. A bespoke metadata
 * format would have needed its own completeness check, and a second completeness mechanism is one
 * that drifts from the first.
 *
 * `article` is deliberately absent. Its title is the fetched article's own, so no catalog can hold
 * it, and it comes from the `document` callback instead, which is what that callback is for.
 */
const ROUTE_DOCUMENTS = {
  'route:_index': {
    title: messages.document.title,
    description: messages.document.description,
  },
  'route:second': {
    title: messages.document.second.title,
    description: messages.document.second.description,
  },
  item: {
    title: messages.document.item.title,
    description: messages.document.item.description,
  },
  'route:lazy': {
    title: messages.document.lazy.title,
    description: messages.document.lazy.description,
  },
  topic: {
    title: messages.document.topic.title,
    description: messages.document.topic.description,
  },
  dossier: {
    title: messages.document.dossier.title,
    description: messages.document.dossier.description,
  },
} as const;

/**
 * What the document says at an address that reached no route.
 *
 * Three answers a visitor can get that have no route id to look a title up by, so `ROUTE_DOCUMENTS`
 * above cannot answer for any of them. Without these the head of a missing page is whatever the
 * previous page left in it: `/en-us/nowhere` reached from the home page claimed to be the home page,
 * in both languages, with a canonical link to prove it.
 *
 * Messages for the same reason the route documents are messages: a missing Arabic translation here
 * is a build failure under `equator check --require-complete` rather than an English title on an
 * Arabic page.
 */
const OUTCOME_DOCUMENTS = {
  'not-found': {
    title: messages.document.notFound.title,
    description: messages.document.notFound.description,
  },
  gone: {
    title: messages.document.gone.title,
    description: messages.document.gone.description,
  },
  'unsupported-locale': {
    title: messages.document.unsupportedLocale.title,
    description: messages.document.unsupportedLocale.description,
  },
} as const;

/**
 * The lazy page's scope, named for routes whose own code never asks for it.
 *
 * The root component shows whether this scope is ready on every page, so on each route below the
 * page itself says whether the option that names it there was honoured. Only the scope's identity
 * is read here. Reading one of its messages would put it in the first render's bundle and make it a
 * startup scope, which no option could then be seen to load.
 */
const LAZY_SCOPE = Object.freeze({
  providerId: lazyProviderId,
  scopeId: lazyScopeId,
});

/**
 * Scopes a route needs ready before it is shown, beyond the ones its own code brings in. The
 * exercise sheet is drawn on request and written by the build, so one route shows both.
 */
const REQUIRED_SCOPES = { exercise: [LAZY_SCOPE] } as const;

/**
 * Scopes a route names as progressive. The dossier is drawn on request and the article is written
 * by the build, and in both the first render has no page before it to keep on screen, so the scope
 * is loaded before either is sent. A later navigation waits for the scope in coordinated mode and
 * lands ahead of it in progressive mode, which `route-transitions.ts` decides.
 */
const PROGRESSIVE_SCOPES = {
  dossier: [LAZY_SCOPE],
  article: [LAZY_SCOPE],
} as const;

/**
 * What a screen reader hears when the language changes: the page's title, in the language just
 * arrived at. Equator's own wording names the language, which a reader who chose it already knows;
 * the title says where they are. Equator asks for the wording once it has written the head, so the
 * title read here is already the new one.
 *
 * A server commits once per render and announces nothing, so there is no document to read there.
 */
const announcedTitle = (): string | undefined =>
  typeof document === 'undefined' ? undefined : document.title;

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // One call, and it is the whole of this application's routing. It wraps `provideRouter`,
    // derives the locale branches from the route projection, installs the localized
    // `LocationStrategy` and the address sync, and carries the route localization that would
    // otherwise be a second provider call. Adding a route, adding a locale or changing one path
    // spelling in one locale touches none of it.
    //
    // No `LocationStrategy` provider line: Equator installs its own from inside, as
    // `withHashLocation()` does, and warns in development if anything else wins the token.
    //
    // No `withRouterConfig` either. Equator needs nothing from `canceledNavigationResolution`: the
    // two modes differ only on a cancelled navigation, and the difference reproduces identically
    // with Equator and without it. Passing one here warns, because Angular provides
    // ROUTER_CONFIGURATION non-multi and a consumer's feature replaces Equator's config entirely.
    provideLocalizedRouter(
      routes,
      {
        origin: SITE_ORIGIN,
        documentMetadata: ROUTE_DOCUMENTS,
        outcomeDocuments: OUTCOME_DOCUMENTS,
        ...routeTransitions,
        requiredScopes: REQUIRED_SCOPES,
        progressiveScopes: PROGRESSIVE_SCOPES,
        // What no catalog can hold: the article's own title, and the preview image URL. Everything
        // static is above, so this is down to the two facts that are genuinely dynamic and the one
        // that is genuinely this deployment's.
        document: (context, localization) => {
          const article = inject(DynamicContentStore).article();
          const social = {
            ...SOCIAL_PREVIEW,
            imageAlt: localization.text(messages.social.imageAlt),
          };
          // A route that resolved and turned out to hold nothing. Equator withdraws the canonical
          // link and the alternates on its own, because those are claims about the address; the
          // wording is this application's, and this is where it says it.
          if (
            context.resolution.routeId === 'topic' &&
            context.pageOutcome?.outcome === 'absent'
          ) {
            return {
              title: localization.text(messages.document.topicAbsent.title),
              description: localization.text(
                messages.document.topicAbsent.description,
              ),
              social,
            };
          }
          return context.resolution.routeId === 'article' &&
            article !== undefined
            ? { title: article.title, description: article.summary, social }
            : { social };
        },
      },
      // An ordinary application setting, and the one that makes interaction preservation provable.
      // A locale switch is a navigation, so with restoration on the Router sends the page to the
      // top and Equator has to put the visitor back. Without it nothing moves, the hook restores
      // what was never lost, and the scroll assertions below pass whether Equator acts or not.
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    // The one line Equator asks an application to write, and the reason it is a line rather than
    // something `provideLocalizedRouter` does. Angular offers no router feature for this token, so
    // claiming it from inside would silently replace a strategy an application had set on purpose,
    // and applications do set it. Omitting the line is not silent: `provideLocalizedRouter`
    // warns in development as soon as any route declares a title, which `app.routes.ts` now does.
    { provide: TitleStrategy, useClass: LocalizedTitleStrategy },
    provideClientHydration(withEventReplay()),
    // One import, one call. The configuration, catalog set, loaders, recovery payload and startup
    // scopes are all things Equator generated, so importing each one here by hand would be passing
    // them straight back. What remains is what this application actually decides.
    provideLocalization(
      withExtensions(runtimeExtensions),
      // The locale URL policy, declared once. The Router integration, the `url` locale source,
      // canonical URLs and reciprocal `hreflang` links all read this one copy; the route table
      // itself is not here because Equator generated it and passes it already.
      withRouting({
        policy: routePolicy,
        projection: appRouteProjection,
        // Read from this file's source text when Equator compiles this owner, like the indexing
        // field, and inert at runtime. `priority` is a number here and a string would not do:
        // route data carries the class, and the class is what carries the numbers.
        sitemap: {
          field: 'section',
          values: {
            landing: { changefreq: 'daily', priority: 1 },
            reference: { changefreq: 'monthly', priority: 0.5 },
          },
          lastmodField: 'updated',
        },
      }),
      // No `withLocaleSources` line. This application wants Equator's order (URL, then what this
      // visitor chose before, then what their client asked for, then the configured default) and
      // that is the default, so writing it out said nothing and made a second place to maintain.
      // `locale-sources.spec.ts` asserts the order this application actually negotiates, so the
      // default changing under it is a test failure rather than a silent behaviour change.
      //
      // `locale-cookie.ts` and not a literal: `server.ts` writes the same cookie, and when the
      // two were declared separately they disagreed about `Secure` and only WebKit said so.
      withPersistence(cookieStore(localeCookie)),
      withRecoveryMessage({
        message: messages.recovery.unavailable,
        retryLabel: messages.control.retry,
      }),
      withFormattingContext(appFormattingContext),
      // One moment for every render, the server's, the build's and the browser's, so a relative
      // time is worded the same in each and the checks can hold the words to the inputs. A
      // deployment wording against the present leaves the line out and gets `systemClock()`.
      withLocalizationClock(
        fixedClock(
          instant(`${BigInt(inputs.clock.epochMilliseconds) * 1_000_000n}`),
        ),
      ),
      // Nothing finer than a minute, and a date rather than words past two days.
      withRelativeTimePolicy(inputs.relativeTimePolicy as RelativeTimePolicy),
      withOverlayLocale(overlayLocale),
      withObservability(eventLog),
      withLocaleAnnouncement(announcedTitle),
    ),
    provideDynamicContent(),
  ],
};
