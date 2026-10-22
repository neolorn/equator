/**
 * A value that is not a generated handle, handed to the runtime as if it were one.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 7. The compiler refuses a qualified
 * string in a handle's place (`negative-message-handle.negative.ts`); this is the other half, for a
 * value that reached the runtime past the compiler, through a cast or from untyped code. Each is
 * refused on the generated ABI stamp it lacks, before the runtime reads anything the value claims
 * about itself. The generated handle is the control.
 */
import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  createLocalizationContext,
  type PlainMessageHandle,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { messages, providerId, scopeId } from '#i18n/shell';

import { runtimeExtensions } from './runtime-extensions';

function refusal(evaluate: () => unknown): unknown {
  try {
    evaluate();
  } catch (error) {
    return error instanceof LocalizationError ? error.diagnostic : error;
  }
  return undefined;
}

describe('a stand-in for a generated handle', () => {
  it('is refused on the generated ABI it does not carry', async () => {
    const localization = createLocalizationContext({
      setup: {
        configuration,
        catalogSet,
        catalogLoaders,
        extensions: runtimeExtensions,
      },
      bootstrapScopes: [Object.freeze({ providerId, scopeId })],
      formattingContext: { timeZone: 'UTC' },
    });
    await localization.initialize();

    expect(localization.text(messages.appTitle)).toBe('Equator feature lab');

    expect(
      refusal(() =>
        localization.text(
          `${providerId}:${scopeId}:app-title` as unknown as PlainMessageHandle,
        ),
      ),
    ).toMatchObject({ outcome: 'operational-failure' });
    // Every field the handle has, and the right scope, so only the stamp is missing.
    const unstamped = { ...messages.appTitle, generatedAbi: undefined };
    expect(
      refusal(() =>
        localization.text(unstamped as unknown as PlainMessageHandle),
      ),
    ).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
    });
    localization.dispose();
  });
});
