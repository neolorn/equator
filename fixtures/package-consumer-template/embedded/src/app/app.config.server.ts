import { type ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { RenderMode, provideServerRendering, withRoutes } from '@angular/ssr';

import { appConfig } from './app.config';

/**
 * The panel answers on request. The about page is written by the build, where there is no reader
 * to ask, so it is written in the locale the panel falls back to when nobody states one. The
 * settings page is drawn in the browser, which loads its own catalogs.
 */
const serverOnlyConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(
      withRoutes([
        { path: 'about', renderMode: RenderMode.Prerender },
        { path: 'settings', renderMode: RenderMode.Client },
        { path: '**', renderMode: RenderMode.Server },
      ]),
    ),
  ],
};

export const serverConfig = mergeApplicationConfig(appConfig, serverOnlyConfig);
