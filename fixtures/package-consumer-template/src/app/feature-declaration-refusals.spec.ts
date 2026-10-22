import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  provideLocalizationSetup,
  withFormattingContext,
  withLocaleSources,
  withPersistence,
  withRecoveryMessage,
  withRouting,
  type RecoveryMessageOptions,
  type RoutingOptions,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';
import { messages } from '#i18n/shell';

import { appRouteProjection, routePolicy } from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

/**
 * A feature declared in a way that cannot mean anything, refused where it is declared.
 *
 * Each of these is a mistake in an application's own `provideLocalization()` call. It is refused
 * when the feature is built or the providers are composed, as an `invalid-configuration`
 * diagnostic, rather than at the first request that would have needed the feature. Every case
 * carries its control, the same call written correctly, so a function that refused everything
 * would fail here too.
 */

const unrouted = {
  configuration,
  catalogSet,
  catalogLoaders,
  recoveryPayload,
  extensions: runtimeExtensions,
};

const refused = {
  code: 'invalid-configuration',
  outcome: 'operational-failure',
};

function refusal(evaluate: () => unknown): unknown {
  try {
    evaluate();
  } catch (error) {
    return error instanceof LocalizationError ? error.diagnostic : error;
  }
  return undefined;
}

const remembering = () =>
  Object.freeze({
    id: 'remembered',
    read: () => undefined,
    write: () => undefined,
  });

describe('withRecoveryMessage', () => {
  it('refuses a message that takes inputs, and a retry label that does', () => {
    // A recovery message is rendered when nothing can supply an input.
    const withInputs = messages.fmt
      .number as unknown as RecoveryMessageOptions['message'];

    expect(
      refusal(() => withRecoveryMessage({ message: withInputs })),
    ).toMatchObject(refused);
    expect(
      refusal(() =>
        withRecoveryMessage({
          message: messages.recovery.unavailable,
          retryLabel: withInputs,
        }),
      ),
    ).toMatchObject(refused);
    expect(
      refusal(() =>
        withRecoveryMessage({
          message: messages.recovery.unavailable,
          retryLabel: messages.control.retry,
        }),
      ),
    ).toBeUndefined();
  });
});

describe('withPersistence', () => {
  it('refuses an empty list of stores', () => {
    expect(refusal(() => withPersistence())).toMatchObject(refused);
    expect(refusal(() => withPersistence(remembering))).toBeUndefined();
  });
});

describe('withLocaleSources', () => {
  it('refuses an empty list of sources', () => {
    expect(refusal(() => withLocaleSources())).toMatchObject(refused);
  });

  it('refuses a source declared twice', () => {
    expect(
      refusal(() => withLocaleSources('url', 'stored', 'url')),
    ).toMatchObject(refused);
    expect(
      refusal(() => withLocaleSources('url', 'stored', 'default')),
    ).toBeUndefined();
  });
});

describe('withRouting', () => {
  it('refuses options that carry no policy', () => {
    // What a caller who is not type-checked can write.
    const withoutPolicy = {
      projection: appRouteProjection,
    } as unknown as RoutingOptions;

    expect(refusal(() => withRouting(withoutPolicy))).toMatchObject(refused);
  });

  it('is refused by a setup that carries no generated route projection', () => {
    const routing = withRouting({
      policy: routePolicy,
      projection: appRouteProjection,
    });

    expect(
      refusal(() => provideLocalizationSetup(unrouted, routing)),
    ).toMatchObject(refused);
    expect(
      refusal(() =>
        provideLocalizationSetup({ ...unrouted, routeProjection }, routing),
      ),
    ).toBeUndefined();
  });

  it('is refused when its projection was generated for something else', () => {
    // A projection from a stale generated file, or from another owner in the same workspace,
    // carries route ids that resolve against nothing. This one is the application's own in every
    // respect but the identity, so the identity is the only thing there is to refuse it on.
    const foreign = withRouting({
      policy: routePolicy,
      projection: {
        ...appRouteProjection,
        generated: Object.freeze({
          ...routeProjection,
          identity: `sha256-${'B'.repeat(43)}`,
        }),
      },
    });

    expect(
      refusal(() =>
        provideLocalizationSetup({ ...unrouted, routeProjection }, foreign),
      ),
    ).toMatchObject(refused);
  });
});

describe('provideLocalizationSetup', () => {
  it('refuses a feature installed twice', () => {
    expect(
      refusal(() =>
        provideLocalizationSetup(
          unrouted,
          withFormattingContext({ timeZone: 'UTC' }),
          withFormattingContext({ timeZone: 'Africa/Cairo' }),
        ),
      ),
    ).toMatchObject(refused);
    expect(
      refusal(() =>
        provideLocalizationSetup(
          unrouted,
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ),
    ).toBeUndefined();
  });
});
