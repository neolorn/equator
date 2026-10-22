import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createLocalizationRuntime,
  initializedForBootstrap,
} from '../src/localization.js';
import {
  LocalizationError,
  type LocalizationSetup,
} from '@neolorn/equator/core';

import {
  catalogKey,
  compileSet,
  loadersFor,
  scope,
} from './catalog-store-harness.js';
import {
  TITLE,
  runtime as transactionRuntime,
} from './transaction-runtime-harness.js';

/**
 * What the application initializer waits on, where the injector is destroyed before the context
 * has started.
 *
 * Section 11 of `specs/06-runtime-and-angular.spec.md`. The initializer's promise is held by the
 * framework and by no code of the application's, so a rejection of it reaches nobody. A context
 * disposed with its injector has not failed to start: there is no bootstrap left to stop, and the
 * promise settles without a failure. Every other failure still rejects where there is no recovery
 * to show, and on a server.
 */

/** A context whose catalogs load, or whose every loader fails. */
function runtime(loading = true) {
  const set = compileSet();
  const loaders = loadersFor(set);
  return createLocalizationRuntime({
    setup: {
      configuration: set.configuration,
      catalogSet: set.descriptor,
      catalogLoaders: loading
        ? loaders
        : Object.fromEntries(
            Object.keys(loaders).map((key) => [
              key,
              () => {
                throw new Error('unavailable');
              },
            ]),
          ),
    } as unknown as LocalizationSetup,
    bootstrapScopes: [scope('shell')],
  });
}

/** A context whose startup catalog fails to load, with a recovery message it can show. */
function recovering() {
  return transactionRuntime({
    fail: { [catalogKey('shell', 'en-US')]: 1 },
    setup: {
      recoveryPayload: [
        {
          identity: TITLE.identity,
          locale: 'en-US',
          sourceFingerprint: 'recovery-fixture',
          body: { kind: 'pattern', declarations: [], pattern: ['Try again'] },
        },
      ],
    },
    options: { recoveryMessageIdentity: TITLE.identity },
  }).localization;
}

/** Rejections nothing handled, as the process reports them. */
const unhandled: unknown[] = [];
const record = (reason: unknown): void => {
  unhandled.push(reason);
};
/** Long enough for the process to report a rejection nothing handled. */
const reported = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', record);
});

afterEach(() => {
  process.off('unhandledRejection', record);
});

describe('the initialization an application bootstrap waits on', () => {
  it('settles without a failure where the context is disposed with its injector', async () => {
    for (const server of [false, true]) {
      const localization = runtime();
      let abandoned = false;
      const waited = initializedForBootstrap(localization, {
        server,
        abandoned: () => abandoned,
        initialized: () => undefined,
      });
      // What an injector destroyed during bootstrap does, in the order it does it.
      abandoned = true;
      localization.dispose();

      await expect(waited).resolves.toBeUndefined();
    }
  });

  it('leaves no rejection unhandled where nothing holds what it returned', async () => {
    const localization = runtime();
    let abandoned = false;
    void initializedForBootstrap(localization, {
      server: false,
      abandoned: () => abandoned,
      initialized: () => undefined,
    });
    abandoned = true;
    localization.dispose();
    await reported();

    expect(unhandled).toStrictEqual([]);
  });

  it('rejects with the disposal where the context is disposed and its injector stands', async () => {
    const localization = runtime();
    const waited = initializedForBootstrap(localization, {
      server: false,
      abandoned: () => false,
      initialized: () => undefined,
    });
    localization.dispose();

    await expect(waited).rejects.toBeInstanceOf(LocalizationError);
    await expect(waited).rejects.toMatchObject({
      diagnostic: { code: 'disposed' },
    });
  });

  it('rejects with a failed start where there is no recovery to show', async () => {
    const localization = runtime(false);
    const waited = initializedForBootstrap(localization, {
      server: false,
      abandoned: () => false,
      initialized: () => undefined,
    });

    await expect(waited).rejects.toBeInstanceOf(LocalizationError);
    localization.dispose();
  });

  it('settles in a browser where the failed start has a recovery to show', async () => {
    const localization = recovering();

    await expect(
      initializedForBootstrap(localization, {
        server: false,
        abandoned: () => false,
        initialized: () => undefined,
      }),
    ).resolves.toBeUndefined();
    expect(localization.recovery()).toBeDefined();
    localization.dispose();
  });

  it('rejects on a server though the failed start has a recovery to show', async () => {
    const localization = recovering();
    let ran = 0;
    const waited = initializedForBootstrap(localization, {
      server: true,
      abandoned: () => false,
      initialized: () => {
        ran += 1;
      },
    });

    await expect(waited).rejects.toMatchObject({
      diagnostic: { code: 'catalog-load-failed' },
    });
    // The recovery is there to show, and a server render does not answer with it.
    expect(localization.recovery()).toBeDefined();
    expect(ran).toBe(0);
    localization.dispose();
  });

  it('runs the server step once the context has started, and only on a server', async () => {
    for (const server of [false, true]) {
      const localization = runtime();
      let ran = 0;
      await initializedForBootstrap(localization, {
        server,
        abandoned: () => false,
        initialized: () => {
          ran += 1;
        },
      });

      expect(ran).toBe(server ? 1 : 0);
      expect(localization.snapshot()?.primaryLocale).toBe('en-US');
      localization.dispose();
    }
  });
});
