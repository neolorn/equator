import { describe, expect, it } from 'vitest';

import { TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Localization,
  provideLocalizationSetup,
  withFormattingContext,
  withObservability,
  type LocalizationObservabilityEvent,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';

import { runtimeExtensions } from './runtime-extensions';

/**
 * A transfer that cannot be read as bounded data at all.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 2 has a transfer bounded and revalidated
 * field by field, and anything unrecognized cost the whole transfer. `runtime-admission-and-limits
 * .spec.ts` delivers transfers that are well-formed data with one wrong field. These are refused
 * one step earlier, by the structural admission itself, and the application must start from its
 * own generated defaults all the same rather than fail to start.
 */

const TRANSFER_KEY = makeStateKey<unknown>(
  '@neolorn/equator:localization-state/1',
);

const valid = (): Record<string, unknown> => ({
  profile: 'equator-transfer-state/1',
  primaryLocale: 'ar-EG',
  formatting: { locale: 'ar-EG' },
  catalogs: [],
  participants: [],
});

/** Arrays inside arrays, `depth` deep, which JSON text can carry and a transfer never does. */
function nested(depth: number): unknown {
  let value: unknown = [];
  for (let level = 0; level < depth; level += 1) value = [value];
  return value;
}

async function adopt(payload: unknown): Promise<{
  readonly locale: string | undefined;
  readonly reported: readonly LocalizationObservabilityEvent[];
}> {
  TestBed.resetTestingModule();
  const events: LocalizationObservabilityEvent[] = [];
  const transferState = new TransferState();
  transferState.set(TRANSFER_KEY, payload);
  TestBed.configureTestingModule({
    providers: [
      { provide: TransferState, useValue: transferState },
      provideLocalizationSetup(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
        },
        withObservability({
          emit: (event) => {
            events.push(event);
          },
        }),
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  const localization = TestBed.inject(Localization);
  const snapshot = await localization.initialize();
  TestBed.resetTestingModule();
  return {
    locale: snapshot.primaryLocale,
    reported: events.filter(({ phase }) => phase === 'ssr-hydration'),
  };
}

describe('a transfer outside the structural bounds', () => {
  it('is the control: a transfer inside them is adopted', async () => {
    const adopted = await adopt(valid());

    expect(adopted.locale).toBe('ar-EG');
    expect(adopted.reported.map(({ status }) => status)).toEqual([
      'started',
      'succeeded',
    ]);
  });

  it('is dropped whole when it nests deeper than any transfer does', async () => {
    const adopted = await adopt({ ...valid(), catalogs: nested(400) });

    expect(adopted.locale).toBe('en-US');
    expect(
      adopted.reported.map(({ status, reason }) => [status, reason]),
    ).toEqual([
      ['started', undefined],
      ['failed', 'invalid-configuration'],
    ]);
  });

  it('is dropped whole when it holds something that is not data', async () => {
    const adopted = await adopt({ ...valid(), catalogs: [() => 'code'] });

    expect(adopted.locale).toBe('en-US');
    expect(adopted.reported.map(({ status }) => status)).toEqual([
      'started',
      'failed',
    ]);
  });
});
