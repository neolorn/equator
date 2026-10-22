/**
 * A participant that registers after the transaction it would have joined has already started.
 *
 * `specs/06-runtime-and-angular.spec.md` section 8 has a region take part in a locale transaction
 * by registering a participant. A component registers when it is created, which is usually after
 * the first snapshot and sometimes while a transaction is in flight, so a registration made then
 * is brought to the committed locale on its own rather than left idle until the next change.
 * Section 7 has each region expose its own readiness, and a retry is how one failed region is
 * asked again without a locale change.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationParticipantReport } from '@neolorn/equator/core';

import { catalogKey, rejectionOf } from './catalog-store-harness.js';
import { participant, runtime } from './transaction-runtime-harness.js';

const FAILED: LocalizationParticipantReport = Object.freeze({
  status: 'failed',
  outcome: 'operational-failure',
  reason: 'environment-failure',
});

describe('a participant registered late', () => {
  it('is prepared for the committed locale when it registers on a ready context', async () => {
    const region = participant('region');
    const { localization } = runtime();
    await localization.initialize();
    await localization.changeLocale('ar-EG');

    const registration = localization.registerParticipant(region.value);

    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('ar-EG');
    expect(region.calls).toStrictEqual(['prepare ar-EG', 'commit ar-EG']);
    expect(region.contexts[0]).toMatchObject({
      targetLocale: 'ar-EG',
      formatting: { locale: 'ar-EG' },
    });
    localization.dispose();
  });

  it('is prepared once the initialization it missed has committed', async () => {
    const region = participant('region');
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'en-US')],
    });

    const initializing = localization.initialize();
    const registration = localization.registerParticipant(region.value);
    release(catalogKey('shell', 'en-US'));
    await initializing;

    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');
    expect(region.calls).toStrictEqual(['prepare en-US', 'commit en-US']);
    localization.dispose();
  });

  it('is prepared for the locale a change in flight commits, and not for the one it replaces', async () => {
    const region = participant('region');
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    await localization.initialize();

    const change = localization.changeLocale('ar-EG');
    const registration = localization.registerParticipant(region.value);
    release(catalogKey('shell', 'ar-EG'));
    await change;

    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('ar-EG');
    expect(region.calls).toStrictEqual(['prepare ar-EG', 'commit ar-EG']);
    localization.dispose();
  });

  it('is left idle on a context that has no snapshot and is not building one', async () => {
    const region = participant('region');
    const { localization } = runtime();

    const registration = localization.registerParticipant(region.value);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(registration.state().attempt.status).toBe('idle');
    expect(region.calls).toStrictEqual([]);
    localization.dispose();
  });
});

describe('a participant asked to retry', () => {
  it('prepares again for the committed locale and answers with the state it reached', async () => {
    const reports: LocalizationParticipantReport[] = [FAILED];
    const region = participant('region');
    const { localization } = runtime();
    await localization.initialize();
    const registration = localization.registerParticipant({
      ...region.value,
      prepare: async (context) =>
        reports.shift() ?? (await region.value.prepare(context)),
    });
    await expect.poll(() => registration.state().attempt.status).toBe('failed');
    expect(registration.state().current).toBeUndefined();

    const state = await registration.retry();

    expect(state).toBe(registration.state());
    expect(state).toMatchObject({
      participantId: 'region',
      current: { targetLocale: 'en-US' },
      attempt: { status: 'ready', targetLocale: 'en-US' },
    });
    localization.dispose();
  });

  it('refuses once it has been unregistered', async () => {
    const region = participant('region');
    const { localization } = runtime();
    await localization.initialize();
    const registration = localization.registerParticipant(region.value);

    registration.unregister();

    await expect(
      rejectionOf(() => registration.retry()),
    ).resolves.toMatchObject({ code: 'disposed', participantId: 'region' });
    localization.dispose();
  });
});

describe('a participant registered after another', () => {
  it('is the one prepared, and under a transition of its own', async () => {
    const first = participant('first');
    const second = participant('second');
    const { localization } = runtime();
    await localization.initialize();

    const firstRegistration = localization.registerParticipant(first.value);
    await expect
      .poll(() => firstRegistration.state().current?.targetLocale)
      .toBe('en-US');
    const secondRegistration = localization.registerParticipant(second.value);
    await expect
      .poll(() => secondRegistration.state().current?.targetLocale)
      .toBe('en-US');

    expect(first.calls).toStrictEqual(['prepare en-US', 'commit en-US']);
    expect(second.calls).toStrictEqual(['prepare en-US', 'commit en-US']);
    expect(first.contexts[0]?.transitionId).toBe(1);
    expect(second.contexts[0]?.transitionId).toBe(2);
    await expect(localization.changeLocale('ar-EG')).resolves.toMatchObject({
      status: 'committed',
      transitionId: 3,
    });
    localization.dispose();
  });

  it('is the one a retry prepares again', async () => {
    const first = participant('first');
    const second = participant('second');
    const { localization } = runtime();
    localization.registerParticipant(first.value);
    const registration = localization.registerParticipant(second.value);
    await localization.initialize();

    const state = await registration.retry();

    expect(state.participantId).toBe('second');
    expect(first.calls).toStrictEqual(['prepare en-US', 'commit en-US']);
    expect(second.calls).toStrictEqual([
      'prepare en-US',
      'commit en-US',
      'prepare en-US',
      'commit en-US',
    ]);
    localization.dispose();
  });
});

describe('a participant registered and withdrawn while a transaction is in flight', () => {
  it('is never prepared', async () => {
    const region = participant('region');
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'en-US')],
    });

    const initializing = localization.initialize();
    const registration = localization.registerParticipant(region.value);
    registration.unregister();
    release(catalogKey('shell', 'en-US'));
    await initializing;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(region.calls).toStrictEqual([]);
    expect(localization.participants()).toStrictEqual([]);
    localization.dispose();
  });
});

describe('a participant a later change has already brought to the committed locale', () => {
  it('is not prepared a second time by the change it registered during', async () => {
    const region = participant('region');
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    await localization.initialize();

    // Registered while a change to Arabic is in flight, then that change is overtaken by one
    // back to English, which was asked for after the registration and so prepares the participant.
    const overtaken = localization.changeLocale('ar-EG');
    const registration = localization.registerParticipant(region.value);
    const later = localization.changeLocale('en-US');
    release(catalogKey('shell', 'ar-EG'));
    await expect(overtaken).resolves.toMatchObject({ status: 'superseded' });
    await expect(later).resolves.toMatchObject({ status: 'committed' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(registration.state().current?.targetLocale).toBe('en-US');
    expect(region.calls).toStrictEqual(['prepare en-US', 'commit en-US']);
    localization.dispose();
  });
});

describe('a retry asked for at an awkward moment', () => {
  it('initializes the context first when it has no snapshot yet', async () => {
    const region = participant('region');
    const { localization } = runtime();
    const registration = localization.registerParticipant(region.value);

    const state = await registration.retry();

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(state).toMatchObject({
      current: { targetLocale: 'en-US' },
      attempt: { status: 'ready' },
    });
    localization.dispose();
  });

  it('waits for a locale change in flight, and prepares for the locale it commits', async () => {
    const region = participant('region');
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    await localization.initialize();
    const registration = localization.registerParticipant(region.value);
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');

    const change = localization.changeLocale('ar-EG');
    const retrying = registration.retry();
    release(catalogKey('shell', 'ar-EG'));
    await change;
    const state = await retrying;

    expect(state.current?.targetLocale).toBe('ar-EG');
    expect(region.calls).toStrictEqual([
      'prepare en-US',
      'commit en-US',
      'prepare ar-EG',
      'commit ar-EG',
      'prepare ar-EG',
      'commit ar-EG',
    ]);
    localization.dispose();
  });

  it('is refused as unregistered when the participant is withdrawn while it waits', async () => {
    const region = participant('region');
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    await localization.initialize();
    const registration = localization.registerParticipant(region.value, {
      coordination: 'progressive',
    });
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');

    const change = localization.changeLocale('ar-EG');
    const retrying = registration.retry();
    registration.unregister();
    release(catalogKey('shell', 'ar-EG'));
    await change;

    await expect(rejectionOf(() => retrying)).resolves.toMatchObject({
      code: 'invalid-configuration',
      participantId: 'region',
    });
    localization.dispose();
  });
});
