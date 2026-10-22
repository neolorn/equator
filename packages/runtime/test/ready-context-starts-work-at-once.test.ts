import { describe, expect, it } from 'vitest';

import { localizationTransferSnapshot } from '../src/localization.js';

import { catalogKey, rejectionOf } from './catalog-store-harness.js';
import { LAZY, participant, runtime } from './transaction-runtime-harness.js';

describe('work asked of a ready context', () => {
  it('a retry has started its participant by the time retry() returns', async () => {
    const region = participant('region');
    const { localization } = runtime();
    await localization.initialize();
    const registration = localization.registerParticipant(region.value, {
      coordination: 'progressive',
    });
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');

    const retrying = registration.retry();
    const status = registration.state().attempt.status;
    await retrying;

    expect(status).toBe('preparing');
    localization.dispose();
  });

  it('a scope request has started loading by the time ensureScope() returns', async () => {
    const { localization, release } = runtime({
      hold: [catalogKey('lazy', 'en-US')],
    });
    await localization.initialize();
    const readiness = localization.scopeReadiness(LAZY);

    const ensuring = localization.ensureScope(LAZY);
    const status = readiness().status;
    release(catalogKey('lazy', 'en-US'));
    await ensuring;

    expect(status).toBe('loading');
    localization.dispose();
  });

  it('a scope request disposed in the same turn had asked its loader', async () => {
    const { localization, loads } = runtime();
    await localization.initialize();

    const ensuring = rejectionOf(() => localization.ensureScope(LAZY));
    localization.dispose();
    const diagnostic = await ensuring;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(diagnostic).toMatchObject({ code: 'disposed' });
    expect(loads[catalogKey('lazy', 'en-US')] ?? 0).toBe(1);
  });

  it('a ready context has a snapshot to transfer', async () => {
    const { localization } = runtime();
    await localization.initialize();

    const transferred = localizationTransferSnapshot(localization);

    expect(transferred).toMatchObject({
      profile: 'equator-transfer-state/1',
      primaryLocale: 'en-US',
    });
    expect(transferred?.catalogs).toHaveLength(1);
    localization.dispose();
  });

  it('a change is transitioning one turn after it was asked for', async () => {
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    await localization.initialize();

    const change = localization.changeLocale('ar-EG');
    await Promise.resolve();
    const lifecycle = localization.lifecycle();
    release(catalogKey('shell', 'ar-EG'));
    await change;

    expect(lifecycle).toBe('transitioning');
    localization.dispose();
  });

  it('a change cancelled one turn after it was asked for had asked its loader', async () => {
    const { localization, loads } = runtime();
    await localization.initialize();

    const change = localization.changeLocale('ar-EG');
    await Promise.resolve();
    localization.cancelTransition();
    const result = await change;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result.status).toBe('cancelled');
    expect(loads[catalogKey('shell', 'ar-EG')] ?? 0).toBe(1);
    localization.dispose();
  });
});
