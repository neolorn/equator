import { RenderMode } from '@angular/ssr';

/**
 * The routes this deployment publishes, and the values that make them into pages.
 *
 * One entry per route, not one per route per locale. A prerendered route has no request, so
 * nothing negotiates a locale for it: every locale's copy is a separate address that has to exist
 * in the build. Spelling all of them out here (`en-us/second`, `ar-eg/second`, `en-us/items/:id`,
 * `ar-eg/items/:id`) is a line to re-edit on every route added and, worse, on every locale added.
 * Missing one is not an error anywhere. It is a page that is simply absent in Arabic.
 *
 * The `article` route shows the part that is genuinely hard by hand: its slug is spelled
 * differently per locale, so its prerendered addresses are `/en-us/articles/handbook` and
 * `/ar-eg/articles/دليل`, from one declaration and the codecs the projection already carries.
 *
 * `routeId` is checked against the projection where the table is built, so a misspelling here is a
 * compile error rather than a throw when the server first evaluates it, and `RenderMode` is the
 * only thing imported from `@angular/ssr`.
 *
 * Exported on its own because `server.ts` builds the sitemap from it. A sitemap needs the same two
 * facts a render table needs, which routes and which parameter values, and nothing else can supply
 * the second: a parameterised route is a pattern, and a pattern is not a page. So the list is
 * written once and read twice, rather than a second list that has to be remembered when an article
 * is added. It is a module of its own because which pages can be prerendered depends on the URL
 * policy, so a consumer row that runs this application under another policy replaces it together
 * with `route-policy.ts`.
 *
 * What a page claims in a sitemap is not here. That is on the route, through `withRouting`, so a
 * route's own data says what kind of page it is and this stays a table about rendering.
 */
export const publishedRoutes = [
  { routeId: 'route:second', renderMode: RenderMode.Prerender },
  {
    routeId: 'article',
    renderMode: RenderMode.Prerender,
    prerender: [{ slug: 'handbook' }],
  },
  { routeId: 'item', renderMode: RenderMode.Client },
  // One sheet written by the build; the other is rendered on request.
  {
    routeId: 'exercise',
    renderMode: RenderMode.Prerender,
    prerender: [{ sheet: 'values' }],
  },
  { routeId: 'route:drawn-sheet', renderMode: RenderMode.Client },
  // The one page the build writes whose messages are in a scope its own route brings in.
  { routeId: 'route:deferred', renderMode: RenderMode.Prerender },
] as const;
