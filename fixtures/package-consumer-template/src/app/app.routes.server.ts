import { RenderMode } from '@angular/ssr';
import { provideLocalizedServerRendering } from '@neolorn/equator/ssr';
import { configuration } from '#i18n';

import {
  routePolicy,
  appRouteProjection,
  SITE_ORIGIN,
} from './localization.routes';
import { publishedRoutes } from './published-routes';

/**
 * The render table, derived from the published routes.
 *
 * The generated `configuration` is the third argument and it is what decides which locales get
 * addresses. The policy names three; a production build generates two, so two are emitted. The
 * same table under `equator generate --pseudo` emits six. Nothing here changes between the two
 * builds, which is the point: a development locale must not cost a source edit in either
 * direction.
 */
export const serverRendering = provideLocalizedServerRendering(
  routePolicy,
  appRouteProjection,
  configuration,
  publishedRoutes,
  {
    // The addresses the two-layer table produces and nobody visits: `/second`, `/articles/:slug`,
    // `/items/:id`. Rendered on demand, so the build writes a file only where a visitor can
    // actually arrive. Equator refuses to emit the table without this under a prefixing policy:
    // leaving it to the `**` fallback worked, and worked equally well if someone answered the
    // build error by declaring them `Prerender` instead.
    canonicalRenderMode: RenderMode.Server,
    fallback: RenderMode.Server,
    // The origin the router is given too. Under a policy that puts each locale on an origin of its
    // own it decides which locale this build renders.
    origin: SITE_ORIGIN,
  },
);
