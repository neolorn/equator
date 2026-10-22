/**
 * Bringing a runtime from configured to ready, and what it leaves behind when it cannot.
 *
 * `specs/06-runtime-and-angular.spec.md` section 5: initialization resolves the locale, loads every
 * startup scope, builds one complete snapshot and publishes it once; equivalent concurrent requests
 * are one attempt; and when no snapshot can be built the failure is typed, the generated recovery
 * payload is exposed, and an explicit retry starts a new attempt. Section 4 lists what the snapshot
 * holds, and section 11 has a destroyed context cancel its pending work.
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4 layers the formatting context a
 * snapshot carries.
 */
import { describe, expect, it } from 'vitest';

import { GENERATED_ABI } from '@neolorn/equator/core';

import {
  PROVIDER,
  catalogKey,
  diagnosticOf,
  rejectionOf,
} from './catalog-store-harness.js';
import {
  HEADING,
  LAZY,
  SHELL,
  TITLE,
  compiled,
  configured,
  participant,
  route,
  runtime,
  until,
} from './transaction-runtime-harness.js';

describe('the first snapshot', () => {
  it('holds what the context was built from, and nothing it was not given', async () => {
    const { localization } = runtime();

    const snapshot = await localization.initialize();

    expect(snapshot).toStrictEqual({
      id: 1,
      primaryLocale: 'en-US',
      direction: 'ltr',
      requiredScopes: [SHELL],
      loadedScopes: [SHELL],
      degraded: false,
      generatedAbi: GENERATED_ABI,
      standardsProfile: 'equator-1',
      catalogSetIds: {
        [PROVIDER]: compiled().descriptor.providers[0]?.catalogSetId,
      },
      formatting: { locale: 'en-US' },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    localization.dispose();
  });

  it('carries the route the context started on', async () => {
    const { localization } = runtime({
      options: { initialRoute: route('/en-us') },
    });

    const snapshot = await localization.initialize();

    expect(snapshot.route).toStrictEqual(route('/en-us'));
    expect(Object.isFrozen(snapshot.route)).toBe(true);
    localization.dispose();
  });

  it('is followed by snapshots with later identities', async () => {
    const { localization } = runtime();
    const first = await localization.initialize();

    const second = await localization.changeLocale('ar-EG');
    const third = await localization.changeLocale('en-US');

    expect(
      [second, third].map(
        (result) => result.status === 'committed' && result.snapshot.id,
      ),
    ).toStrictEqual([first.id + 1, first.id + 2]);
    localization.dispose();
  });
});

describe('an initialization', () => {
  it('is one attempt for two requests that arrive together', async () => {
    const { localization, loads } = runtime();

    const first = localization.initialize();
    const second = localization.initialize();

    expect(second).toBe(first);
    await first;
    expect(loads[catalogKey('shell', 'en-US')]).toBe(1);
    localization.dispose();
  });

  it('answers a later request with the snapshot it committed', async () => {
    const { localization, loads } = runtime();
    const committed = await localization.initialize();

    await expect(localization.initialize()).resolves.toBe(committed);

    expect(localization.snapshot()).toBe(committed);
    expect(loads[catalogKey('shell', 'en-US')]).toBe(1);
    localization.dispose();
  });

  it('is initializing towards the resolved locale until its catalogs arrive', async () => {
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
      options: { initialLocale: 'ar-EG' },
    });

    const initializing = localization.initialize();

    expect(localization.lifecycle()).toBe('initializing');
    await expect.poll(() => localization.targetLocale()).toBe('ar-EG');
    expect(localization.lifecycle()).toBe('initializing');
    expect(localization.snapshot()).toBeUndefined();

    release(catalogKey('shell', 'ar-EG'));
    await expect(initializing).resolves.toMatchObject({
      primaryLocale: 'ar-EG',
    });
    expect(localization.lifecycle()).toBe('ready');
    expect(localization.targetLocale()).toBeUndefined();
    localization.dispose();
  });
});

describe('the formatting context of a snapshot', () => {
  it('is the application-wide context under the locale', async () => {
    const { localization } = runtime({
      options: {
        formattingContext: { timeZone: 'UTC', numberingSystem: 'latn' },
      },
    });

    const snapshot = await localization.initialize();

    expect(snapshot.formatting).toStrictEqual({
      locale: 'en-US',
      timeZone: 'UTC',
      numberingSystem: 'latn',
    });
    localization.dispose();
  });

  it('carries the context the server rendered the initial locale with, for that locale only', async () => {
    const { localization } = runtime({
      options: {
        initialLocale: 'ar-EG',
        formattingContext: { timeZone: 'UTC' },
        initialFormattingContext: { numberingSystem: 'latn' },
      },
    });

    const rendered = await localization.initialize();
    const moved = await localization.changeLocale('en-US');
    const back = await localization.changeLocale('ar-EG');

    expect(rendered.formatting).toStrictEqual({
      locale: 'ar-EG',
      timeZone: 'UTC',
      numberingSystem: 'latn',
    });
    expect(moved).toMatchObject({ status: 'committed' });
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    expect(
      moved.status === 'committed' && moved.snapshot.formatting,
    ).toStrictEqual({ locale: 'en-US', timeZone: 'UTC' });
    expect(
      back.status === 'committed' && back.snapshot.formatting,
    ).toStrictEqual(rendered.formatting);
    localization.dispose();
  });

  it('puts what the server rendered with over the generated entry for the locale', async () => {
    const { localization } = runtime({
      set: configured('formatting', {
        'ar-EG': { numberingSystem: 'arab', calendar: 'gregory' },
      }),
      options: {
        initialLocale: 'ar-EG',
        initialFormattingContext: { numberingSystem: 'latn' },
      },
    });

    const snapshot = await localization.initialize();

    expect(snapshot.formatting).toStrictEqual({
      locale: 'ar-EG',
      numberingSystem: 'latn',
      calendar: 'gregory',
    });
    localization.dispose();
  });
});

/**
 * The recovery payload is the compiled body of messages the consumer already wrote, by locale:
 * `specs/03-locale-identity-and-resolution.spec.md` section 11.
 */
describe('an initialization that cannot build a snapshot', () => {
  const representation = (
    handle: typeof TITLE,
    locale: string,
  ): Readonly<Record<string, unknown>> => {
    const catalog = compiled().catalogs.find(
      ({ key }) =>
        key.scopeId === handle.scopeId && key.catalogLocale === locale,
    );
    const message = (
      catalog?.messages as
        | readonly {
            messageId: string;
            sourceFingerprint: string;
            body: unknown;
          }[]
        | undefined
    )?.find(({ messageId }) => messageId === handle.messageId);
    if (message === undefined)
      throw new Error('the fixture has no such message');
    return {
      identity: handle.identity,
      locale,
      sourceFingerprint: message.sourceFingerprint,
      body: structuredClone(message.body),
    };
  };

  const PAYLOAD = () =>
    ['en-US', 'ar-EG'].flatMap((locale) => [
      representation(TITLE, locale),
      representation(HEADING, locale),
    ]);

  interface Recovery {
    /** The generated payload, or `null` for a setup that selected no recovery messages. */
    readonly payload?: readonly unknown[] | null;
    /** The identity of the recovery message, or `null` for a context that names none. */
    readonly message?: string | null;
    readonly hold?: readonly string[];
  }

  /** A runtime whose startup catalog fails to load once, with recovery messages to show. */
  const failing = (
    initialLocale: string,
    { payload = PAYLOAD(), message = TITLE.identity, hold = [] }: Recovery = {},
  ) =>
    runtime({
      fail: { [catalogKey('shell', initialLocale)]: 1 },
      hold,
      setup: payload === null ? {} : { recoveryPayload: payload },
      options: {
        initialLocale,
        ...(message === null ? {} : { recoveryMessageIdentity: message }),
        recoveryRetryLabelIdentity: HEADING.identity,
      },
    });

  it('fails with the reason, and holds no snapshot', async () => {
    const { localization } = failing('en-US');

    await expect(
      rejectionOf(() => localization.initialize()),
    ).resolves.toMatchObject({ code: 'catalog-load-failed' });

    expect(localization.lifecycle()).toBe('failed');
    expect(localization.ready()).toBe(false);
    expect(localization.snapshot()).toBeUndefined();
    expect(localization.targetLocale()).toBeUndefined();
    localization.dispose();
  });

  it('exposes the recovery message and its retry label', async () => {
    const { localization } = failing('en-US');

    await rejectionOf(() => localization.initialize());

    expect(localization.recovery()).toMatchObject({
      kind: 'text',
      value: 'Catalog store',
      supplyingLocale: 'en-US',
      direction: 'ltr',
    });
    expect(localization.recoveryRetryLabel()).toMatchObject({
      kind: 'text',
      value: 'Lazy heading',
      supplyingLocale: 'en-US',
    });
    localization.dispose();
  });

  it('exposes them in the locale it was initializing towards', async () => {
    const { localization } = failing('ar-EG');

    await rejectionOf(() => localization.initialize());

    expect(localization.recovery()).toMatchObject({
      value: 'مخزن الفهارس',
      supplyingLocale: 'ar-EG',
      direction: 'rtl',
    });
    expect(localization.recoveryRetryLabel()).toMatchObject({
      value: 'عنوان مؤجل',
      supplyingLocale: 'ar-EG',
    });
    localization.dispose();
  });

  it('exposes them in the source locale when the payload has none for the target', async () => {
    // The source representation of the message sits behind another message in the source locale
    // and behind the same message in a third locale, so only the one that matches on both is it.
    const { localization } = failing('ar-EG', {
      payload: [
        representation(HEADING, 'en-US'),
        { ...representation(TITLE, 'ar-EG'), locale: 'fr-FR' },
        representation(TITLE, 'en-US'),
      ],
    });

    await rejectionOf(() => localization.initialize());

    expect(localization.recovery()).toMatchObject({
      value: 'Catalog store',
      supplyingLocale: 'en-US',
      direction: 'ltr',
    });
    localization.dispose();
  });

  it.each<readonly [string, Recovery]>([
    ['the setup selected no recovery messages', { payload: null }],
    ['the context names no recovery message', { message: null }],
    [
      'the payload does not carry the message the context names',
      { payload: [representation(HEADING, 'en-US')] },
    ],
    [
      'the context names something that is not a message identity',
      {
        message: 'title',
        payload: [{ ...representation(TITLE, 'en-US'), identity: 'title' }],
      },
    ],
  ])(
    'fails with the reason and no recovery message when %s',
    async (_label, recovery) => {
      const { localization } = failing('en-US', recovery);

      await expect(
        rejectionOf(() => localization.initialize()),
      ).resolves.toMatchObject({ code: 'catalog-load-failed' });

      expect(localization.recovery()).toBeUndefined();
      expect(localization.lifecycle()).toBe('failed');
      expect(localization.targetLocale()).toBeUndefined();
      localization.dispose();
    },
  );

  it('exposes no recovery message when the context was disposed while it was initializing', async () => {
    const { localization } = failing('en-US', {
      hold: [catalogKey('shell', 'en-US')],
    });

    const initializing = localization.initialize();
    await expect.poll(() => localization.targetLocale()).toBe('en-US');
    localization.dispose();

    await expect(rejectionOf(() => initializing)).resolves.toMatchObject({
      code: 'disposed',
    });
    expect(localization.recovery()).toBeUndefined();
    expect(localization.recoveryRetryLabel()).toBeUndefined();
  });

  it('exposes no recovery message when the context names none', async () => {
    const { localization } = runtime({
      fail: { [catalogKey('shell', 'en-US')]: 1 },
    });

    await rejectionOf(() => localization.initialize());

    expect(localization.lifecycle()).toBe('failed');
    expect(localization.recovery()).toBeUndefined();
    expect(localization.recoveryRetryLabel()).toBeUndefined();
    localization.dispose();
  });

  it('starts a new attempt on retry, and withdraws the recovery once that commits', async () => {
    const { localization, loads } = failing('en-US');
    await rejectionOf(() => localization.initialize());

    const snapshot = await localization.retry();

    expect(snapshot).toMatchObject({ primaryLocale: 'en-US' });
    expect(loads[catalogKey('shell', 'en-US')]).toBe(2);
    expect(localization.lifecycle()).toBe('ready');
    expect(localization.snapshot()).toBe(snapshot);
    expect(localization.recovery()).toBeUndefined();
    expect(localization.recoveryRetryLabel()).toBeUndefined();
    expect(localization.text(TITLE)).toBe('Catalog store');
    // A retry is a transition of its own, numbered after the attempt that failed.
    expect(localization.scopeReadiness(SHELL)()).toMatchObject({
      status: 'ready',
      transitionId: 1,
    });
    await expect(localization.changeLocale('ar-EG')).resolves.toMatchObject({
      status: 'committed',
      transitionId: 2,
    });
    localization.dispose();
  });
});

describe('a retry', () => {
  it('is refused before any attempt has failed', () => {
    const { localization } = runtime();

    expect(diagnosticOf(() => localization.retry())).toMatchObject({
      code: 'invalid-configuration',
    });
    localization.dispose();
  });

  it('is refused once the context is ready', async () => {
    const { localization } = runtime();
    await localization.initialize();

    expect(diagnosticOf(() => localization.retry())).toMatchObject({
      code: 'invalid-configuration',
    });
    localization.dispose();
  });
});

describe('the participants of an initialization', () => {
  it('commits without waiting for a progressive one, and starts it once it has', async () => {
    const region = participant('region', { hold: ['en-US'] });
    const { localization } = runtime();
    const registration = localization.registerParticipant(region.value, {
      coordination: 'progressive',
    });

    await localization.initialize();

    expect(localization.lifecycle()).toBe('ready');
    expect(registration.state().current).toBeUndefined();
    await expect
      .poll(() => registration.state().attempt.status)
      .toBe('preparing');
    expect(region.contexts[0]).toMatchObject({
      targetLocale: 'en-US',
      formatting: { locale: 'en-US' },
      transitionId: 0,
    });

    region.release('en-US');
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');
    expect(region.calls).toStrictEqual(['prepare en-US', 'commit en-US']);
    localization.dispose();
  });

  it('has a required one discard what it prepared when the context is disposed before the commit', async () => {
    const region = participant('region', { hold: ['en-US'] });
    const { localization } = runtime();
    const registration = localization.registerParticipant(region.value);

    const initializing = localization.initialize();
    // Held until the catalogs are in, so that nothing but the commit is left once it answers.
    await expect.poll(() => region.calls).toStrictEqual(['prepare en-US']);
    region.release('en-US');
    await until(() => registration.state().attempt.status === 'prepared');
    localization.dispose();

    await expect(rejectionOf(() => initializing)).resolves.toMatchObject({
      code: 'disposed',
    });
    expect(region.calls).toStrictEqual(['prepare en-US', 'discard en-US']);
    expect(localization.snapshot()).toBeUndefined();
  });
});

describe('a disposed context', () => {
  const disposed = () => {
    const { localization } = runtime();
    localization.dispose();
    return localization;
  };
  const DISPOSED = { code: 'disposed' };

  it('refuses to initialize', () => {
    expect(diagnosticOf(() => disposed().initialize())).toMatchObject(DISPOSED);
  });

  it('refuses a locale change', () => {
    expect(diagnosticOf(() => disposed().changeLocale('ar-EG'))).toMatchObject(
      DISPOSED,
    );
  });

  it('refuses a participant', () => {
    expect(
      diagnosticOf(() =>
        disposed().registerParticipant(participant('region').value),
      ),
    ).toMatchObject(DISPOSED);
  });

  it('refuses a scope preload and a scope request', async () => {
    await expect(
      rejectionOf(() => disposed().preloadScope(LAZY)),
    ).resolves.toMatchObject(DISPOSED);
    await expect(
      rejectionOf(() => disposed().ensureScope(LAZY)),
    ).resolves.toMatchObject(DISPOSED);
  });

  it('ends a preload that was waiting for its catalog, without waiting for it', async () => {
    const { localization } = runtime({ hold: [catalogKey('lazy', 'en-US')] });
    await localization.initialize();

    const preloading = localization.preloadScope(LAZY);
    localization.dispose();

    await expect(rejectionOf(() => preloading)).resolves.toMatchObject(
      DISPOSED,
    );
  });

  it('ends a scope request that was waiting for its catalog, without waiting for it', async () => {
    const { localization } = runtime({ hold: [catalogKey('lazy', 'en-US')] });
    await localization.initialize();

    const ensuring = localization.ensureScope(LAZY);
    localization.dispose();

    await expect(rejectionOf(() => ensuring)).resolves.toMatchObject(DISPOSED);
  });
});
