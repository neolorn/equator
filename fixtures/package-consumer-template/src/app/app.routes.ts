import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Routes } from '@angular/router';
import {
  injectLocalization,
  pageAbsent,
  pageGone,
  pageOperationalFailure,
} from '@neolorn/equator';
import {
  LocalizedPageOutcome,
  LocalizedRouteParameters,
} from '@neolorn/equator/router';
import { messages } from '#i18n/shell';

import { DossierStore } from './dossier-store';
import { DynamicContentStore } from './dynamic-content';

@Component({
  selector: 'feature-home-route',
  standalone: true,
  imports: [RouterLink],
  template: `
    <p data-route-view="home">{{ label() }}</p>
    <a data-route-link="second" routerLink="second">{{ secondLink() }}</a>
    <a data-route-link="item" routerLink="items/42">{{ itemLink() }}</a>
    <a data-route-link="article" [routerLink]="articlePath()">Article</a>
    <a data-route-link="exercise" [routerLink]="exercisePath()">{{
      exerciseLink()
    }}</a>
  `,
})
class FeatureLabHomeRoute {
  private readonly localization = injectLocalization();
  protected readonly label = this.localization.textSignal(messages.route.home);
  protected readonly secondLink = this.localization.textSignal(
    messages.route.openSecond,
  );
  protected readonly itemLink = this.localization.textSignal(
    messages.route.openItem,
  );
  protected readonly articlePath = computed(() =>
    this.localization.snapshot()?.primaryLocale === 'ar-EG'
      ? 'articles/دليل'
      : 'articles/handbook',
  );
  protected readonly exerciseLink = this.localization.textSignal(
    messages.route.openExercise,
  );
  protected readonly exercisePath = computed(() =>
    this.localization.snapshot()?.primaryLocale === 'ar-EG'
      ? 'exercise/مباشر'
      : 'exercise/live',
  );
}

@Component({
  selector: 'feature-second-route',
  standalone: true,
  imports: [RouterLink],
  template: `
    <p data-route-view="second">{{ label() }}</p>
    <a data-route-link="home" routerLink="../">{{ homeLink() }}</a>
  `,
})
class FeatureLabSecondRoute {
  private readonly localization = injectLocalization();
  protected readonly label = this.localization.textSignal(
    messages.route.second,
  );
  protected readonly homeLink = this.localization.textSignal(
    messages.route.returnHome,
  );
}

@Component({
  selector: 'feature-item-route',
  standalone: true,
  imports: [RouterLink],
  template: `
    <p data-route-view="item">{{ label() }}</p>
    <a data-route-link="home" routerLink="../../">{{ homeLink() }}</a>
  `,
})
class FeatureLabItemRoute {
  private readonly localization = injectLocalization();
  protected readonly label = this.localization.textSignal(messages.route.item);
  protected readonly homeLink = this.localization.textSignal(
    messages.route.returnHome,
  );
}

@Component({
  selector: 'feature-article-route',
  standalone: true,
  imports: [RouterLink],
  template: `
    <article
      data-route-view="article"
      [attr.data-entity-id]="article()?.entityId"
    >
      <h2>{{ article()?.title }}</h2>
      <p>{{ article()?.summary }}</p>
    </article>
    <a data-route-link="home" routerLink="../../">Return home</a>
  `,
})
class FeatureLabArticleRoute {
  private readonly store = inject(DynamicContentStore);
  protected readonly article = this.store.article;
}

/**
 * A route whose parameter is an opaque identifier rather than a word in a language.
 *
 * The counterpart to the article route above, and declared as its counterpart: `articles/:slug`
 * carries a slug that is translated per locale, and this carries one that must be byte-identical
 * in every locale because it names a thing rather than describing it. The distinction is the whole
 * reason two parameter codecs exist, and this route is the one that exercises the second.
 */
@Component({
  selector: 'feature-topic-route',
  standalone: true,
  imports: [RouterLink],
  template: `
    <p data-route-view="topic" [attr.data-topic-id]="topicId()">
      {{ label() }}
    </p>
    <a data-route-link="home" routerLink="../../">{{ homeLink() }}</a>
  `,
})
class FeatureLabTopicRoute {
  private readonly localization = injectLocalization();
  private readonly route = inject(ActivatedRoute);
  private readonly outcome = inject(LocalizedPageOutcome);
  protected readonly label = this.localization.textSignal(messages.route.item);
  protected readonly homeLink = this.localization.textSignal(
    messages.route.returnHome,
  );
  protected readonly topicId = computed(
    () => this.route.snapshot.paramMap.get('topic') ?? '',
  );

  /**
   * What the address could not say, said by the page that looked it up.
   *
   * `topics/:topic` accepts any identifier, so every spelling of it resolves to this route and the
   * status Equator can derive from the address alone is 200. Whether a topic is filed under the
   * identifier, whether it was retired, and whether the lookup itself failed are three answers only
   * this component has. The declaration lands after a microtask, which is where a real lookup lands
   * it, so the head Equator built for this navigation is corrected rather than built twice.
   */
  constructor() {
    const topic = this.route.snapshot.paramMap.get('topic') ?? '';
    void Promise.resolve().then(() => {
      if (topic === 'retired-topic') this.outcome.declare(pageGone());
      else if (topic === 'unavailable-topic') {
        this.outcome.declare(pageOperationalFailure(503));
      } else if (!FILED_TOPICS.includes(topic)) {
        this.outcome.declare(pageAbsent());
      }
    });
  }
}

/** The topics this application has, which is the fact the address cannot carry. */
const FILED_TOPICS: readonly string[] = ['handbook', 'a.b_c~d-e'];

/**
 * A route that tells Equator how its address is spelled elsewhere.
 *
 * Three lines of application code, and they are the three that matter: load the record, read the
 * per-locale slugs it carries, declare them. From there Equator writes the canonical URL, the
 * `hreflang` alternates, the Open Graph alternates and the address a locale switch moves to:
 * none of which this component mentions.
 *
 * The declaration lands after `NavigationEnd`, because the load is a promise. That is the ordinary
 * position rather than a late one, and it is why Equator re-projects the head when a declaration
 * arrives instead of only building it once.
 */
@Component({
  selector: 'feature-dossier-route',
  standalone: true,
  imports: [RouterLink],
  template: `
    <p data-route-view="dossier" [attr.data-entity-id]="entityId()">
      {{ slug() }}
    </p>
    <a data-route-link="home" routerLink="../../">{{ homeLink() }}</a>
  `,
})
class FeatureLabDossierRoute {
  private readonly localization = injectLocalization();
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(DossierStore);
  private readonly parameters = inject(LocalizedRouteParameters);
  protected readonly homeLink = this.localization.textSignal(
    messages.route.returnHome,
  );
  protected readonly slug = signal('');
  protected readonly entityId = signal('');

  constructor() {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.slug.set(slug);
    void this.store.load(slug).then((dossier) => {
      if (dossier === undefined) return;
      this.entityId.set(dossier.entityId);
      this.parameters.declare({ slug: dossier.slugs });
    });
  }
}

@Component({
  selector: 'feature-not-found-route',
  standalone: true,
  template: `<p data-route-view="not-found">{{ label() }}</p>`,
})
class FeatureLabNotFoundRoute {
  private readonly localization = injectLocalization();
  protected readonly label = this.localization.textSignal(
    messages.route.returnHome,
  );
}

/**
 * Routes as an application writes them.
 *
 * Most declare no identity: Equator derives one from the address, so adding, renaming or removing a
 * route needs no localization change. The four parameterised routes declare one, which is the case
 * decision section 5 keeps pinning available for: a derived `route:items._` is stable and unique
 * but is not a name anyone would want to write in a cross-application link.
 */
export const routes = [
  {
    path: '',
    pathMatch: 'full',
    component: FeatureLabHomeRoute,
    // `section` is this application's own word for its own reasons, and `withRouting` is where it
    // is mapped to what a sitemap says. Equator reads the field it was pointed at rather than one
    // of its own, so a project that already groups its routes does not annotate them twice.
    data: { equatorIndexing: 'indexable', section: 'landing' },
  },
  {
    path: 'second',
    component: FeatureLabSecondRoute,
    // `updated` is a date this page changed on, which nothing but the application knows. Equator
    // never invents one: a build time is a date the page did not change on, and the one element a
    // crawler actually reads is worth less than nothing when it is wrong.
    data: {
      equatorIndexing: 'indexable',
      section: 'reference',
      updated: '2026-09-01',
    },
    // Declared in English on purpose, and it is the only route here that declares one.
    //
    // This is what a consumer following Angular's documented route-title API writes, and it is the
    // trap it walks into: Angular calls `TitleStrategy.updateTitle` after `NavigationEnd`,
    // which is after Equator has already written the localized title, so without Equator's strategy
    // installed this string replaces the Arabic title on the Arabic page. Nothing throws and
    // nothing warns: the page just reads as if Equator failed to translate.
    title: 'Second route, declared in English',
  },
  {
    path: 'items/:id',
    component: FeatureLabItemRoute,
    data: { equatorRouteId: 'item', equatorIndexing: 'non-indexable' },
  },
  {
    // A lazy boundary with a scope of its own, which is the reason a scope of this application is
    // not a startup scope.
    path: 'lazy',
    loadComponent: () =>
      import('./lazy-route').then((module) => module.FeatureLabLazyRoute),
    // Declared per visitor so the served application answers one page from a route declaration
    // that the toolkit read out of this file.
    data: { equatorIndexing: 'non-indexable', equatorCaching: 'per-visitor' },
  },
  {
    // The same page at a route every visitor may be given, so a build can write it. A per-visitor
    // route is refused by a build, and this is where the scope a route brings in is shown reaching
    // a page written ahead of any request.
    path: 'deferred',
    loadComponent: () =>
      import('./lazy-route').then((module) => module.FeatureLabLazyRoute),
    data: { equatorIndexing: 'non-indexable' },
  },
  {
    path: 'articles/:slug',
    component: FeatureLabArticleRoute,
    // No `section`. A route whose class the table does not list claims nothing, and an entry with
    // its address and its alternates and nothing else is a complete entry.
    data: { equatorRouteId: 'article', equatorIndexing: 'indexable' },
  },
  {
    // The counterpart to `articles/:slug`: the same parameter name, and a slug no codec can
    // translate. One of the two is answered by a pure function and the other by the record itself,
    // which is the distinction `LocalizedRouteParameters` exists for, and having both means a
    // check cannot pass by reading the wrong one.
    path: 'dossiers/:slug',
    component: FeatureLabDossierRoute,
    data: { equatorRouteId: 'dossier', equatorIndexing: 'indexable' },
  },
  {
    path: 'topics/:topic',
    component: FeatureLabTopicRoute,
    data: { equatorRouteId: 'topic', equatorIndexing: 'indexable' },
  },
  {
    // Every pipe and formatting function on one page, which the gate reads in every way a page
    // reaches a reader. Lazy, so none of it is in the first render's bundle, and not indexable,
    // because it is a sheet of values rather than a page anyone searches for.
    path: 'exercise/:sheet',
    loadComponent: () =>
      import('./exercise-route').then(
        (module) => module.FeatureLabExerciseRoute,
      ),
    data: { equatorRouteId: 'exercise', equatorIndexing: 'non-indexable' },
  },
  {
    // The same sheet at a route the render table leaves to the browser, so the gate reads every
    // line as a client render wrote it. Per visitor, because the shell the server answers for a
    // route it does not render still carries the class the route declares.
    path: 'drawn-sheet',
    loadComponent: () =>
      import('./exercise-route').then(
        (module) => module.FeatureLabExerciseRoute,
      ),
    data: { equatorIndexing: 'non-indexable', equatorCaching: 'per-visitor' },
  },
  {
    // The address this application does not serve. No fixture had one, which is why an
    // application's own not-found page never rendering under a locale prefix went unnoticed: the
    // projection excludes a wildcard by design, and the adapter treated "not in the projection" as
    // a failure rather than as an answer.
    path: '**',
    component: FeatureLabNotFoundRoute,
    data: { equatorIndexing: 'non-indexable' },
  },
] satisfies Routes;
