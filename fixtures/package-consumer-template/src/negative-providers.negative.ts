import { provideRouter } from '@angular/router';
import { provideLocalizationSetup } from '@neolorn/equator';
import { configuration, provideLocalization } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';

import { runtimeExtensions } from './app/runtime-extensions';

/**
 * Composition calls that must not compile.
 *
 * `specs/06-runtime-and-angular.spec.md` section 1: the setup is the one argument, and feature
 * providers are the only other arguments either composition function accepts. The rule is the
 * signature and nothing else enforces it, so a rest parameter widened to take Angular providers
 * would pass every positive case in the suite; these are the calls that tell the two apart.
 *
 * Separate from the other negatives because the verifier compiles one negative file at a time.
 */

// An Angular provider where a feature belongs.
// EXPECT: Argument of type 'EnvironmentProviders' is not assignable to parameter of type 'LocalizationFeature
provideLocalizationSetup(
  {
    configuration,
    catalogSet,
    catalogLoaders,
    recoveryPayload,
    extensions: runtimeExtensions,
  },
  provideRouter([]),
);

// A plain provider array, handed to the generated composition function.
// EXPECT: Argument of type '{ provide: string; useValue: number; }[]' is not assignable to parameter of type 'LocalizationFeature
provideLocalization([{ provide: 'token', useValue: 1 }]);
