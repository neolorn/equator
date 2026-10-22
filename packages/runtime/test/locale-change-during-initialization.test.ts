/**
 * A locale change asked for while the context is still initializing.
 *
 * `specs/06-runtime-and-angular.spec.md` section 7 has such a change wait for the initialization to
 * settle and then run, so that neither ends the other: the initialization commits what it was
 * preparing, required participants included, and the change then moves the reader on from there.
 * A change that waited for an initialization that failed reports that failure, and one that was
 * cancelled, overtaken or left without a context while it waited starts nothing.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';

import { catalogKey, rejectionOf } from './catalog-store-harness.js';
import {
  observed,
  participant,
  route,
  runtime,
  type Runtime,
} from './transaction-runtime-harness.js';

/** Every microtask and timer already due, for a case that states what did not happen. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('a locale change asked for while the context is initializing', () => {
  it('runs after the initialization has committed, and neither ends the other', async () => {
    const region = participant('region', { hold: ['en-US'] });
    const { localization } = runtime();
    localization.registerParticipant(region.value);
    const initializing = localization.initialize();
    await expect.poll(() => region.calls).toStrictEqual(['prepare en-US']);

    const change = localization.changeLocale('ar-EG');
    await settled();

    // The participant is still preparing for the initialization, and has not been told otherwise.
    expect(region.contexts[0]?.signal.aborted).toBe(false);
    expect(region.calls).toStrictEqual(['prepare en-US']);

    region.release('en-US');

    await expect(initializing).resolves.toMatchObject({
      primaryLocale: 'en-US',
    });
    await expect(change).resolves.toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'ar-EG' },
    });
    expect(region.calls).toStrictEqual([
      'prepare en-US',
      'commit en-US',
      'prepare ar-EG',
      'commit ar-EG',
    ]);
    localization.dispose();
  });

  it('overtakes what the initialization started beside itself, once the initialization has settled', async () => {
    const side = participant('side', { hold: ['en-US', 'ar-EG'] });
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'en-US'), catalogKey('shell', 'ar-EG')],
    });
    localization.registerParticipant(side.value, {
      coordination: 'progressive',
    });
    const initializing = localization.initialize();
    const change = localization.changeLocale('ar-EG');
    release(catalogKey('shell', 'en-US'));
    await initializing;
    await expect.poll(() => side.calls).toStrictEqual(['prepare en-US']);

    // The change has begun, and has committed nothing yet: the region is told at the start of the
    // change that its work for the locale being left is no longer wanted.
    await expect.poll(() => side.contexts[0]?.signal.aborted).toBe(true);
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(side.contexts[0]?.signal.reason).toMatchObject({
      diagnostic: { code: 'superseded' },
    });

    release(catalogKey('shell', 'ar-EG'));
    await expect(change).resolves.toMatchObject({ status: 'committed' });
    side.release('en-US');
    side.release('ar-EG');
    localization.dispose();
  });

  it('reports the failure of the initialization it waited for, and loads nothing of its own', async () => {
    const { localization, release, loads } = runtime({
      hold: [catalogKey('shell', 'en-US')],
      fail: { [catalogKey('shell', 'en-US')]: 1 },
    });
    const initializing = rejectionOf(() => localization.initialize());

    const change = localization.changeLocale('ar-EG');
    release(catalogKey('shell', 'en-US'));

    await expect(initializing).resolves.toMatchObject({
      code: 'catalog-load-failed',
    });
    await expect(change).resolves.toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: { code: 'catalog-load-failed' },
    });
    expect(loads[catalogKey('shell', 'ar-EG')]).toBeUndefined();
    expect(localization.lifecycle()).toBe('failed');
    localization.dispose();
  });

  it('is the later one, when two are asked for before the initialization settles', async () => {
    const region = participant('region', { hold: ['en-US'] });
    const { localization } = runtime();
    localization.registerParticipant(region.value);
    const initializing = localization.initialize();
    await expect.poll(() => region.calls).toStrictEqual(['prepare en-US']);

    const first = localization.changeLocale('ar-EG', {
      route: route('/ar-eg/first'),
    });
    const second = localization.changeLocale('ar-EG', {
      route: route('/ar-eg/second'),
    });
    region.release('en-US');

    await expect(initializing).resolves.toMatchObject({
      primaryLocale: 'en-US',
    });
    await expect(first).resolves.toMatchObject({ status: 'superseded' });
    await expect(second).resolves.toMatchObject({
      status: 'committed',
      snapshot: { route: { canonicalPath: '/ar-eg/second' } },
    });
    expect(region.calls).toStrictEqual([
      'prepare en-US',
      'commit en-US',
      'prepare ar-EG',
      'commit ar-EG',
    ]);
    localization.dispose();
  });

  it('starts nothing when it is cancelled while it waits, and the initialization still commits', async () => {
    const watched = observed();
    const { localization, release, loads } = runtime({
      hold: [catalogKey('shell', 'en-US')],
      options: { observability: watched.emitter },
    });
    const initializing = localization.initialize();

    const change = localization.changeLocale('ar-EG');
    localization.cancelTransition();
    release(catalogKey('shell', 'en-US'));

    await expect(change).resolves.toMatchObject({
      status: 'cancelled',
      diagnostic: { code: 'cancelled' },
    });
    await expect(initializing).resolves.toMatchObject({
      primaryLocale: 'en-US',
    });
    expect(loads[catalogKey('shell', 'ar-EG')]).toBeUndefined();
    expect(
      watched
        .phase('catalog')
        .filter((event) => event.targetLocale === 'ar-EG'),
    ).toStrictEqual([]);
    expect(localization.lifecycle()).toBe('ready');
    expect(localization.targetLocale()).toBeUndefined();
    localization.dispose();
  });

  it('starts nothing when the context is disposed between the initialization and its turn', async () => {
    let localization!: Runtime;
    const watched = observed();
    const leaving: LocalizationCommitHook = {
      apply: () => undefined,
      committed: () => localization.dispose(),
    };
    ({ localization } = runtime({
      options: { commitHooks: [leaving], observability: watched.emitter },
    }));

    const change = localization.changeLocale('ar-EG');

    await expect(change).resolves.toMatchObject({
      status: 'cancelled',
      targetLocale: 'ar-EG',
    });
    expect(
      watched
        .phase('catalog')
        .filter((event) => event.targetLocale === 'ar-EG'),
    ).toStrictEqual([]);
    expect(localization.lifecycle()).toBe('failed');
    expect(localization.targetLocale()).toBeUndefined();
  });
});
