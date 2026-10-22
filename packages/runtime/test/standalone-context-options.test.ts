import { describe, expect, it } from 'vitest';

import { instant } from '../src/formatting.js';
import { createLocalizationContext } from '../src/localization.js';
import {
  type LocalizationObservabilityEvent,
  type LocalizationObservabilityOptions,
} from '../src/observability.js';
import {
  type LocalizationContextOptions,
  type LocalizationSetup,
  type MessageHandle,
} from '@neolorn/equator/core';

import {
  catalogKey,
  loadersFor,
  rejectionOf,
} from './catalog-store-harness.js';
import {
  HEADING,
  SHELL,
  TITLE,
  compiled,
  route,
} from './transaction-runtime-harness.js';

/**
 * What a context built outside an injector does with the options it is handed.
 *
 * `createLocalizationContext` takes the generated setup and little else. With no scopes named it
 * loads every scope the configuration declares, and with scopes named it loads those and no
 * others. The route it is told the reader is on is the route of the snapshot it commits, and the
 * retry label it is handed is what it offers beside the recovery message when it cannot start.
 */

interface Fixture {
  readonly options?: Partial<LocalizationContextOptions> &
    LocalizationObservabilityOptions;
  /** A catalog key whose loader fails every time it is asked. */
  readonly failing?: string;
  readonly recoveryPayload?: readonly unknown[];
}

function context({ options = {}, failing, recoveryPayload }: Fixture = {}) {
  const loads: string[] = [];
  const loaders = Object.fromEntries(
    Object.entries(loadersFor(compiled())).map(([key, load]) => [
      key,
      () => {
        loads.push(key);
        if (key === failing) throw new Error('the loader under test failed');
        return load();
      },
    ]),
  );
  const localization = createLocalizationContext({
    setup: {
      configuration: compiled().configuration,
      catalogSet: compiled().descriptor,
      catalogLoaders: loaders,
      ...(recoveryPayload === undefined ? {} : { recoveryPayload }),
    } as unknown as LocalizationSetup,
    ...options,
  });
  return { localization, loads };
}

/** What the generated recovery payload carries for one message in one locale. */
function representation(handle: MessageHandle, locale: string) {
  const message = compiled()
    .catalogs.find(
      ({ key }) =>
        key.scopeId === handle.scopeId && key.catalogLocale === locale,
    )
    ?.messages.find(({ messageId }) => messageId === handle.messageId);
  if (message === undefined) throw new Error('the fixture has no such message');
  return {
    identity: handle.identity,
    locale,
    sourceFingerprint: message.sourceFingerprint,
    body: structuredClone(message.body),
  };
}

describe('a context built outside an injector', () => {
  it('loads every scope the configuration declares when it is handed none', async () => {
    const { localization, loads } = context();

    await localization.initialize();

    expect([...loads].sort()).toStrictEqual(
      [catalogKey('lazy', 'en-US'), catalogKey('shell', 'en-US')].sort(),
    );
    expect(localization.text(TITLE)).toBe('Catalog store');
    expect(localization.text(HEADING)).toBe('Lazy heading');
    localization.dispose();
  });

  it('loads the scopes it is handed and no others', async () => {
    const { localization, loads } = context({
      options: { bootstrapScopes: [SHELL] },
    });

    await localization.initialize();

    expect(loads).toStrictEqual([catalogKey('shell', 'en-US')]);
    expect(localization.text(TITLE)).toBe('Catalog store');
    localization.dispose();
  });

  it('starts in the locale it is handed', async () => {
    const { localization } = context({ options: { initialLocale: 'ar-EG' } });

    const snapshot = await localization.initialize();

    expect(snapshot.primaryLocale).toBe('ar-EG');
    localization.dispose();
  });

  it('starts in the default locale when it is handed none', async () => {
    const { localization } = context();

    const snapshot = await localization.initialize();

    expect(snapshot.primaryLocale).toBe('en-US');
    localization.dispose();
  });

  it('formats under the defaults it is handed', async () => {
    const { localization } = context({
      options: { formattingContext: { timeZone: 'UTC' } },
    });
    const { localization: bare } = context();
    const range = [instant('0'), instant('90000000000000')] as const;
    const fields = { dateStyle: 'medium', timeStyle: 'short' } as const;

    const snapshot = await localization.initialize();
    await bare.initialize();

    expect(snapshot.formatting).toMatchObject({ timeZone: 'UTC' });
    expect(localization.formatInstantRange(...range, fields).ok).toBe(true);
    // With no zone there is no wall clock to read an instant against, and the call is refused.
    expect(bare.formatInstantRange(...range, fields).ok).toBe(false);
    localization.dispose();
    bare.dispose();
  });

  it('reports to the sink it is handed', async () => {
    const events: LocalizationObservabilityEvent[] = [];
    const { localization } = context({
      options: { observability: { emit: (event) => void events.push(event) } },
    });

    const snapshot = await localization.initialize();

    expect(
      events
        .filter(({ phase }) => phase === 'initialization')
        .map(({ status, snapshotId }) => ({ status, snapshotId })),
    ).toStrictEqual([
      { status: 'started', snapshotId: undefined },
      { status: 'succeeded', snapshotId: snapshot.id },
    ]);
    localization.dispose();
  });

  it('commits the route it was told the reader is on', async () => {
    const { localization } = context({
      options: { initialRoute: route('/en-us') },
    });

    const snapshot = await localization.initialize();

    expect(snapshot.route).toStrictEqual(route('/en-us'));
    localization.dispose();
  });

  it('commits no route when it was told of none', async () => {
    const { localization } = context();

    const snapshot = await localization.initialize();

    expect(Object.keys(snapshot)).not.toContain('route');
    localization.dispose();
  });

  it('offers the retry label it was handed beside the recovery message', async () => {
    const { localization } = context({
      failing: catalogKey('shell', 'en-US'),
      recoveryPayload: [
        representation(TITLE, 'en-US'),
        representation(HEADING, 'en-US'),
      ],
      options: {
        bootstrapScopes: [SHELL],
        recoveryMessage: TITLE,
        recoveryRetryLabel: HEADING,
      },
    });

    await expect(
      rejectionOf(() => localization.initialize()),
    ).resolves.toMatchObject({ code: 'catalog-load-failed' });

    expect(localization.recovery()).toMatchObject({ value: 'Catalog store' });
    expect(localization.recoveryRetryLabel()).toMatchObject({
      kind: 'text',
      value: 'Lazy heading',
      supplyingLocale: 'en-US',
    });
    localization.dispose();
  });

  it('offers no retry label when it was handed none', async () => {
    const { localization } = context({
      failing: catalogKey('shell', 'en-US'),
      recoveryPayload: [
        representation(TITLE, 'en-US'),
        representation(HEADING, 'en-US'),
      ],
      options: { bootstrapScopes: [SHELL], recoveryMessage: TITLE },
    });

    await rejectionOf(() => localization.initialize());

    expect(localization.recovery()).toMatchObject({ value: 'Catalog store' });
    expect(localization.recoveryRetryLabel()).toBeUndefined();
    localization.dispose();
  });
});
