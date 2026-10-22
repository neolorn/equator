import { describe, expect, it } from 'vitest';

import { inject, provideEnvironmentInitializer } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Localization,
  languagePresentation,
  provideLocalizationSetup,
  type LocalizationParticipant,
  type LocalizationParticipantContext,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';

import { runtimeExtensions } from './runtime-extensions';

/**
 * The localization snapshot carries what Equator derived and nothing a consumer handed it.
 *
 * Section 15 of `specs/07-routing-rendering-and-seo.spec.md`: a human-language field uses its
 * message or participant result, and no consumer payload is admitted into the snapshot. A required
 * participant is the consumer code closest to the snapshot, because its report is read in the same
 * transaction that builds it. A report carrying a payload is refused before it gets that far, which
 * `packages/runtime/test/participant-own-language.test.ts` holds; this holds the snapshot itself.
 */

/** Every field `LocalizationSnapshot` names. The snapshot here has no route, because none is installed. */
const SNAPSHOT_FIELDS = [
  'catalogSetIds',
  'degraded',
  'direction',
  'formatting',
  'generatedAbi',
  'id',
  'loadedScopes',
  'primaryLocale',
  'requiredScopes',
  'standardsProfile',
];

function setup(participant: LocalizationParticipant): Localization {
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
      provideEnvironmentInitializer(() => {
        inject(Localization).registerParticipant(participant);
      }),
    ],
  });
  return TestBed.inject(Localization);
}

const ready = (context: LocalizationParticipantContext) =>
  Object.freeze({
    status: 'ready' as const,
    representation: Object.freeze({
      kind: 'locale-bound' as const,
      supplyingLocale: context.targetLocale,
      direction: languagePresentation(context.targetLocale).direction,
    }),
  });

describe('a localization snapshot', () => {
  it('names only its own fields after a required participant has answered', async () => {
    const localization = setup(
      Object.freeze({ id: 'required-region', prepare: ready }),
    );
    await localization.initialize();
    const result = await localization.changeLocale('ar-EG', {
      remember: false,
    });

    expect(result.status).toBe('committed');
    expect(Object.keys(localization.snapshot() ?? {}).sort()).toEqual(
      SNAPSHOT_FIELDS,
    );
  });
});
