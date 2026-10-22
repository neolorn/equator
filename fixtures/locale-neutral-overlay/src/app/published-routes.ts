import { RenderMode } from '@angular/ssr';

/**
 * The routes this deployment publishes, and the values that make them into pages.
 *
 * `/second` is spelled alike in every locale, so which language it is in is decided per visitor,
 * and a prerendered file would give every visitor the one language it was written in. It is
 * rendered on request. The article's slug is spelled per locale, so `/articles/handbook` and
 * `/articles/دليل` each belong to one locale and are prerendered in it.
 *
 * `server.ts` builds the sitemap from the same list, so the pages there are the pages this build
 * renders.
 */
export const publishedRoutes = [
  { routeId: 'route:second', renderMode: RenderMode.Server },
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
  // Spelled alike in every locale, so it is rendered on request, as `/second` is.
  { routeId: 'route:deferred', renderMode: RenderMode.Server },
] as const;
