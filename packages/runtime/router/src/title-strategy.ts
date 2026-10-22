import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';

import { DocumentLocalization } from '@neolorn/equator';

/**
 * The one writer of `document.title` once a navigation has ended.
 *
 * Angular emits `NavigationEnd` and then calls `titleStrategy.updateTitle(...)`, one statement
 * after the other in the same `tap` (`@angular/router` 22.2.1,
 * `NavigationTransitions.setupNavigations`). The event passes through two plain subjects, the
 * transitions' and the Router's, so every subscriber has returned before that second statement
 * runs. `RouteLocalization` is one of them: it calls `applyDocument`, which projects the incoming
 * page and hands it to `DocumentLocalization.apply` before its first `await`. So when Angular asks
 * for the title, Equator has written the incoming page's and `current()` answers with that page's
 * projection, and the last write of every navigation belongs to whatever holds this token.
 * `DefaultTitleStrategy` writes whenever the route tree declares a `title` (`updateTitle`), which
 * means a consumer following Angular's own documented route-title API silently replaces every
 * localized title with an English one. Nothing throws, nothing warns, and the page looks like
 * Equator simply failed to translate.
 *
 * **This is installed by the consumer, not by `provideLocalizedRouter`.** `TitleStrategy` is
 * provided in root with `factory: () => inject(DefaultTitleStrategy)` (its `ɵprov`), and a raw
 * provider entry is the documented way to replace it. Angular ships no `withTitleStrategy()` router
 * feature to claim it through, so taking the token from inside `provideLocalizedRouter` would
 * silently replace a provider an application had set on purpose. `provideLocalizedRouter` warns in
 * development when the line is missing and the routes declare a title: the configuration where
 * omitting it changes what the page says.
 *
 * The fallback is Angular's behaviour exactly, not a narrowed version of it. For a route Equator
 * has no title for, this writes what `DefaultTitleStrategy` would have written, an empty title
 * included: `Title.setTitle` assigns `newTitle || ''` (`@angular/platform-browser` 22.2.1), which
 * for the text `buildTitle` answers is the text itself. `Title` is not injected to do it: that
 * service lives in `@angular/platform-browser`, which is not a peer of this package, and all it
 * does is assign `document.title`, which is also how `DocumentLocalization` writes.
 */
@Injectable()
export class LocalizedTitleStrategy extends TitleStrategy {
  private readonly documentRef = inject(DOCUMENT);

  /**
   * Optional for the same reason `RouteLocalization` takes it that way: an application can install
   * the router integration without the document effect. Without it Equator has no title to defend
   * and this strategy is `DefaultTitleStrategy` with an extra frame.
   */
  private readonly localized = inject(DocumentLocalization, { optional: true });

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const projected = this.localized?.current()?.title;
    // Re-asserted rather than skipped. Equator wrote this value while `NavigationEnd` was being
    // delivered, and a subscriber called after Equator's can have moved the title since, so writing
    // it again is what makes "the localized title survives the navigation" true rather than likely.
    // Assigning the value the document already holds is not a mutation the browser acts on.
    //
    // Where the incoming page's document could not be written, the projection is still the one of
    // the page the navigation left, which is the page being put back.
    if (projected !== undefined) {
      this.documentRef.title = projected;
      return;
    }
    const declared = this.buildTitle(snapshot);
    if (declared !== undefined) this.documentRef.title = declared;
  }
}
