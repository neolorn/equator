import { afterEach, describe, expect, it } from 'vitest';

import { TestBed } from '@angular/core/testing';
import {
  Localization,
  LocalizationError,
  createLocalizationContext,
  withFormattingContext,
} from '@neolorn/equator';
import {
  ControllableLocalizationParticipant,
  LocalizationTestingController,
  provideLocalizationTesting,
  resetLocalizationTestEnvironment,
} from '@neolorn/equator/testing';
import { localizationSetup } from '#i18n';
import { messages, providerId, scopeId } from '#i18n/shell';

import { runtimeExtensions } from './runtime-extensions';

/**
 * The holds of `@neolorn/equator/testing`, ended the ways a test ends them.
 *
 * `specs/06-runtime-and-angular.spec.md` section 12 gives a consumer's suite a controller over
 * deferred catalog loads and participant attempts. A hold that is released is what the other spec
 * files use; this file is about the other endings: a load that is failed, a preparation that
 * throws, a hold asked for on a catalog that does not exist, and a participant nobody has asked
 * anything of yet.
 */

const shellScope = { providerId, scopeId } as const;

function refusal(evaluate: () => unknown): unknown {
  try {
    evaluate();
  } catch (error) {
    return error instanceof LocalizationError ? error.diagnostic : error;
  }
  return undefined;
}

function configured(): Localization {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalizationTesting(
        { ...localizationSetup, extensions: runtimeExtensions },
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  return TestBed.inject(Localization);
}

describe('a held catalog load', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('fails the change it belongs to when the test fails it', async () => {
    const localization = configured();
    await localization.initialize();
    const held = TestBed.inject(LocalizationTestingController).deferNext(
      shellScope,
      'ar-EG',
    );

    const change = localization.changeLocale('ar-EG');
    await held.started;
    held.fail();

    // A lost network, as the application sees one: the change is refused as an operational
    // failure and the page stays in the locale it was in.
    await expect(change).resolves.toMatchObject({
      status: 'failed',
      diagnostic: {
        code: 'catalog-load-failed',
        outcome: 'operational-failure',
      },
    });
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(localization.text(messages.appTitle)).toBe('Equator feature lab');
  });

  it('rejects the wrapped loader itself with a catalog load failure', async () => {
    // What a caller assembling the providers by hand holds: the loaders, not a runtime over them.
    const controller = new LocalizationTestingController(
      localizationSetup.catalogLoaders,
    );
    const identity = `${providerId}:${scopeId}:ar-EG` as const;
    const held = controller.deferNext(shellScope, 'ar-EG');

    const load = controller.catalogLoaders[identity]?.();
    await held.started;
    held.fail();

    await expect(load).rejects.toBeInstanceOf(LocalizationError);
    await expect(load).rejects.toMatchObject({
      diagnostic: {
        code: 'catalog-load-failed',
        outcome: 'operational-failure',
      },
    });
    expect(controller.loadCount(shellScope, 'ar-EG')).toBe(1);
  });

  it('is refused for a catalog the setup declares no loader for', async () => {
    await configured().initialize();
    const controller = TestBed.inject(LocalizationTestingController);

    expect(
      refusal(() => controller.deferNext(shellScope, 'en-x-undeclared')),
    ).toMatchObject({
      code: 'scope-unavailable',
      outcome: 'localized-representation-unavailable',
    });
    expect(
      refusal(() =>
        controller.deferNext({ providerId, scopeId: 'undeclared' }, 'en-US'),
      ),
    ).toMatchObject({ code: 'scope-unavailable' });
    // The control: the same call for a declared catalog returns a hold.
    expect(
      refusal(() => controller.deferNext(shellScope, 'ar-EG')),
    ).toBeUndefined();
  });
});

describe('a controllable participant', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('starts with nothing recorded and answers ready when nothing is held', () => {
    const participant = new ControllableLocalizationParticipant('untouched');

    const { contexts, committed, rolledBack, discarded, disposeCount } =
      participant;
    expect({
      contexts,
      committed,
      rolledBack,
      discarded,
      disposeCount,
    }).toEqual({
      contexts: [],
      committed: [],
      rolledBack: [],
      discarded: [],
      disposeCount: 0,
    });

    const context = Object.freeze({
      targetLocale: 'ar-EG',
    }) as unknown as Parameters<
      ControllableLocalizationParticipant['prepare']
    >[0];
    // No hold was queued, so the first preparation is answered at once.
    expect(participant.prepare(context)).toEqual({
      status: 'ready',
      representation: { kind: 'language-independent' },
    });
    expect(participant.contexts).toEqual([context]);
  });

  it('fails the change when its held preparation throws', async () => {
    // Built without an injector, so the participant is registered before anything initializes.
    const localization = createLocalizationContext({
      setup: { ...localizationSetup, extensions: runtimeExtensions },
      bootstrapScopes: [shellScope],
      initialLocale: 'en-US',
      formattingContext: { timeZone: 'UTC' },
    });
    const participant = new ControllableLocalizationParticipant('thrower');
    localization.registerParticipant(participant, { coordination: 'required' });
    await localization.initialize();

    const held = participant.deferNext();
    const change = localization.changeLocale('ar-EG', { mode: 'coordinated' });
    expect((await held.started).targetLocale).toBe('ar-EG');
    held.reject();

    await expect(change).resolves.toMatchObject({
      status: 'failed',
      diagnostic: {
        code: 'participant-failed',
        outcome: 'operational-failure',
      },
    });
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(
      participant.contexts.map(({ targetLocale }) => targetLocale),
    ).toEqual(['en-US', 'ar-EG']);
    expect(participant.committed).toHaveLength(1);
    localization.dispose();
  });
});

describe('resetLocalizationTestEnvironment', () => {
  it('expires a cookie a store wrote at the root path', () => {
    document.cookie = 'equator-locale=ar-EG; Path=/';
    document.cookie = 'another=1; Path=/';
    // The cookie has to be there first, or its absence afterwards says nothing about the reset.
    expect(document.cookie).toContain('equator-locale=ar-EG');
    expect(document.cookie).toContain('another=1');

    resetLocalizationTestEnvironment();

    expect(document.cookie).toBe('');
  });
});
