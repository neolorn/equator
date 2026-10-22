/**
 * How a locale change ends, and what it took into account on the way.
 *
 * `specs/06-runtime-and-angular.spec.md` section 7: a change is one transaction that ends in
 * exactly one of committed, cancelled, superseded, failed or redirected. In coordinated mode it
 * waits for every required scope and every required participant and leaves the current view as it
 * was when it does not commit; in progressive mode it commits the locale and lets registered
 * regions finish on their own, confining a region's failure to that region. A redirect carries an
 * address and no diagnostic, because nothing failed. Section 4 keeps the route on the snapshot, so
 * a change that names no route keeps the one committed and a change that names another commits it.
 */
import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  type LocalizationParticipantReport,
  type LocalizationSnapshot,
} from '@neolorn/equator/core';

import { catalogKey, diagnosticOf } from './catalog-store-harness.js';
import {
  LAZY,
  SHELL,
  observed,
  participant,
  route,
  runtime,
  until,
  type Runtime,
} from './transaction-runtime-harness.js';

async function ready(fixture: Parameters<typeof runtime>[0] = {}) {
  const made = runtime(fixture);
  const snapshot = await made.localization.initialize();
  return { ...made, snapshot };
}

/** The snapshot a change committed, or nothing when it did not commit. */
const committedBy = async (
  change: ReturnType<Runtime['changeLocale']>,
): Promise<LocalizationSnapshot | undefined> => {
  const result = await change;
  return result.status === 'committed' ? result.snapshot : undefined;
};

const FAILED: LocalizationParticipantReport = Object.freeze({
  status: 'failed',
  outcome: 'operational-failure',
  reason: 'environment-failure',
});

describe('the result of a locale change', () => {
  it('is coordinated unless the request says otherwise, and numbered after the transition before it', async () => {
    const { localization } = await ready();

    const first = await localization.changeLocale('ar-EG');
    const second = await localization.changeLocale('en-US', {
      mode: 'progressive',
    });

    expect(first).toMatchObject({
      status: 'committed',
      transitionId: 1,
      mode: 'coordinated',
      targetLocale: 'ar-EG',
    });
    expect(second).toMatchObject({
      status: 'committed',
      transitionId: 2,
      mode: 'progressive',
      targetLocale: 'en-US',
    });
    expect(localization.lastResult()).toBe(second);
    localization.dispose();
  });

  it('is a failure that names the locale when the locale is not supported', async () => {
    const { localization, snapshot } = await ready();

    const result = await localization.changeLocale('fr-FR', {
      mode: 'progressive',
    });

    expect(result).toMatchObject({
      status: 'failed',
      transitionId: 1,
      mode: 'progressive',
      targetLocale: 'fr-FR',
      diagnostic: { code: 'unsupported-locale' },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(localization.lastResult()).toBe(result);
    expect(localization.snapshot()).toBe(snapshot);
    // A refused request is still a transition, so the next one is numbered after it.
    await expect(localization.changeLocale('ar-EG')).resolves.toMatchObject({
      status: 'committed',
      transitionId: 2,
    });
    localization.dispose();
  });
});

describe('a locale change asked for before the first snapshot', () => {
  it('initializes the context first, then commits the locale asked for', async () => {
    const committed: string[] = [];
    const { localization } = runtime({
      options: {
        commitHooks: [
          {
            apply: (snapshot) =>
              void committed.push(`${snapshot.primaryLocale}#${snapshot.id}`),
          },
        ],
      },
    });

    const result = await localization.changeLocale('ar-EG');

    expect(result).toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'ar-EG', requiredScopes: [SHELL] },
    });
    expect(committed).toStrictEqual(['en-US#1', 'ar-EG#2']);
    localization.dispose();
  });
});

describe('a locale another origin serves', () => {
  const ADDRESS = 'https://ar.example/about';

  async function claimed() {
    const made = await ready();
    const asked: string[] = [];
    made.localization.ɵclaimLocaleChange((locale) => {
      asked.push(locale);
      return locale === 'ar-EG' ? ADDRESS : undefined;
    });
    return { ...made, asked };
  }

  it('ends the change as a redirect to the address, with nothing loaded or committed', async () => {
    const { localization, snapshot, loads } = await claimed();

    const result = await localization.changeLocale('ar-EG', {
      mode: 'progressive',
    });

    expect(result).toStrictEqual({
      status: 'redirected',
      transitionId: 1,
      mode: 'progressive',
      targetLocale: 'ar-EG',
      address: ADDRESS,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(localization.lastResult()).toBe(result);
    expect(localization.snapshot()).toBe(snapshot);
    expect(localization.lifecycle()).toBe('ready');
    expect(loads[catalogKey('shell', 'ar-EG')]).toBeUndefined();
    localization.dispose();
  });

  it('ends the change as failed where the address there is refused, with nothing loaded or committed', async () => {
    const { localization, snapshot, loads } = await ready();
    localization.ɵclaimLocaleChange(() => {
      throw new LocalizationError({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: 'The address of this page in that locale cannot be built.',
      });
    });

    const result = await localization.changeLocale('AR-eg');

    expect(result).toStrictEqual({
      status: 'failed',
      transitionId: 1,
      mode: 'coordinated',
      targetLocale: 'ar-EG',
      diagnostic: {
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: 'The address of this page in that locale cannot be built.',
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(localization.lastResult()).toBe(result);
    expect(localization.snapshot()).toBe(snapshot);
    expect(localization.lifecycle()).toBe('ready');
    expect(loads[catalogKey('shell', 'ar-EG')]).toBeUndefined();
    localization.dispose();
  });

  it('is asked about under the canonical locale, and the next transition is numbered after it', async () => {
    const { localization, asked } = await claimed();

    await localization.changeLocale('AR-eg');
    const next = await localization.changeLocale('en-US');

    expect(asked).toStrictEqual(['ar-EG', 'en-US']);
    expect(next).toMatchObject({ status: 'committed', transitionId: 2 });
    localization.dispose();
  });

  it('leaves a locale this origin serves to an ordinary change', async () => {
    const { localization } = await ready();
    localization.ɵclaimLocaleChange(() => undefined);

    await expect(localization.changeLocale('ar-EG')).resolves.toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'ar-EG' },
    });
    localization.dispose();
  });
});

describe('the route of a locale change', () => {
  const started = () =>
    ready({ options: { initialRoute: route('/en-us/about') } });

  it('stays the committed one when the change names none', async () => {
    const { localization } = await started();

    const snapshot = await committedBy(localization.changeLocale('ar-EG'));

    expect(snapshot).toMatchObject({
      primaryLocale: 'ar-EG',
      route: route('/en-us/about'),
    });
    localization.dispose();
  });

  it('is the one the change names', async () => {
    const { localization } = await started();

    const snapshot = await committedBy(
      localization.changeLocale('ar-EG', { route: route('/ar-eg/about') }),
    );

    expect(snapshot?.route).toStrictEqual(route('/ar-eg/about'));
    localization.dispose();
  });

  it('is cleared when the change says so', async () => {
    const { localization } = await started();

    const snapshot = await committedBy(
      localization.changeLocale('ar-EG', { route: null }),
    );

    expect(snapshot?.primaryLocale).toBe('ar-EG');
    expect(snapshot).not.toHaveProperty('route');
    localization.dispose();
  });
});

describe('a change to the committed locale', () => {
  const started = () =>
    ready({ options: { initialRoute: route('/en-us/about') } });

  it('answers with the committed snapshot when it names the committed route', async () => {
    const { localization, snapshot } = await started();

    await expect(
      committedBy(
        localization.changeLocale('en-US', { route: route('/en-us/about') }),
      ),
    ).resolves.toBe(snapshot);
    await expect(committedBy(localization.changeLocale('en-US'))).resolves.toBe(
      snapshot,
    );
    localization.dispose();
  });

  it('answers with the committed snapshot when there is no route and it clears the route', async () => {
    const { localization, snapshot } = await ready();

    await expect(
      committedBy(localization.changeLocale('en-US', { route: null })),
    ).resolves.toBe(snapshot);
    localization.dispose();
  });

  it.each([
    ['another route', route('/en-us/about', { routeId: 'about' })],
    [
      'another projection',
      route('/en-us/about', { projectionIdentity: 'projection-next' }),
    ],
    ['another path', route('/en-us/contact')],
  ])('commits a new snapshot when it names %s', async (_label, next) => {
    const { localization, snapshot } = await started();

    const committed = await committedBy(
      localization.changeLocale('en-US', { route: next }),
    );

    expect(committed).not.toBe(snapshot);
    expect(committed).toMatchObject({ primaryLocale: 'en-US', route: next });
    localization.dispose();
  });

  it('commits a new snapshot when it names a route and none was committed', async () => {
    const { localization, snapshot } = await ready();

    const committed = await committedBy(
      localization.changeLocale('en-US', { route: route('/en-us') }),
    );

    expect(committed).not.toBe(snapshot);
    expect(committed?.route).toStrictEqual(route('/en-us'));
    localization.dispose();
  });

  it('commits a new snapshot without a route when it clears the committed one', async () => {
    const { localization, snapshot } = await started();

    const committed = await committedBy(
      localization.changeLocale('en-US', { route: null }),
    );

    expect(committed).not.toBe(snapshot);
    expect(committed?.primaryLocale).toBe('en-US');
    expect(committed).not.toHaveProperty('route');
    localization.dispose();
  });

  it('stays ready throughout when it has nothing to prepare', async () => {
    const { localization } = await ready();
    const lifecycles = new Set<string>();
    const targets = new Set<string | undefined>();
    const progress = { settled: false };

    const change = localization.changeLocale('en-US').finally(() => {
      progress.settled = true;
    });
    // Read once in every turn of the microtask queue, so a state held for one turn is seen.
    await until(() => {
      lifecycles.add(localization.lifecycle());
      targets.add(localization.targetLocale());
      return progress.settled;
    });

    await expect(change).resolves.toMatchObject({ status: 'committed' });
    expect([...lifecycles]).toStrictEqual(['ready']);
    expect([...targets]).toStrictEqual([undefined]);
    localization.dispose();
  });

  it('prepares a required participant that has not committed for it yet', async () => {
    const { localization, snapshot } = await ready();
    const reports: LocalizationParticipantReport[] = [FAILED];
    const region = participant('region');
    const registration = localization.registerParticipant({
      ...region.value,
      prepare: async (context) =>
        reports.shift() ?? (await region.value.prepare(context)),
    });
    await expect.poll(() => registration.state().attempt.status).toBe('failed');

    const result = await localization.changeLocale('en-US');

    expect(result.status === 'committed' && result.snapshot).toBe(snapshot);
    expect(registration.state().current).toMatchObject({
      targetLocale: 'en-US',
      transitionId: result.transitionId,
    });
    expect(localization.lifecycle()).toBe('ready');
    expect(localization.targetLocale()).toBeUndefined();
    localization.dispose();
  });
});

describe('the scopes of a locale change', () => {
  it('takes, in progressive mode, a progressive scope the committed snapshot requires', async () => {
    const { localization } = await ready();
    await localization.changeLocale('en-US', { requiredScopes: [SHELL, LAZY] });

    await expect(
      localization.changeLocale('ar-EG', {
        mode: 'progressive',
        progressiveScopes: [LAZY],
      }),
    ).resolves.toMatchObject({ status: 'committed' });
    expect(
      localization.snapshot()?.requiredScopes.map((scope) => scope.scopeId),
    ).toStrictEqual(['shell']);
    localization.dispose();
  });

  it('keeps, in coordinated mode, a progressive scope the committed snapshot requires where it stood', async () => {
    const { localization } = await ready();
    await localization.changeLocale('en-US', { requiredScopes: [SHELL, LAZY] });

    await expect(
      localization.changeLocale('ar-EG', { progressiveScopes: [SHELL] }),
    ).resolves.toMatchObject({ status: 'committed', mode: 'coordinated' });
    // A coordinated change waits for the scope either way, so naming it moves it nowhere.
    expect(
      localization.snapshot()?.requiredScopes.map((scope) => scope.scopeId),
    ).toStrictEqual(['shell', 'lazy']);
    localization.dispose();
  });

  it('refuses a scope one call names as required and as progressive', async () => {
    const { localization } = await ready();

    for (const mode of ['coordinated', 'progressive'] as const) {
      expect(
        diagnosticOf(() =>
          localization.changeLocale('ar-EG', {
            mode,
            requiredScopes: [SHELL, LAZY],
            progressiveScopes: [LAZY],
          }),
        ),
      ).toMatchObject({ code: 'invalid-configuration' });
    }
    localization.dispose();
  });

  it('reports a scope whose load a later change overtook as superseded', async () => {
    const { localization, release } = await ready({
      hold: [catalogKey('lazy', 'ar-EG')],
    });

    const overtaken = localization.changeLocale('ar-EG', {
      requiredScopes: [SHELL, LAZY],
    });
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('loading');
    const later = localization.changeLocale('en-US');

    await expect(overtaken).resolves.toMatchObject({ status: 'superseded' });
    await expect(later).resolves.toMatchObject({ status: 'committed' });
    expect(localization.scopeReadiness(LAZY)()).toMatchObject({
      targetLocale: 'ar-EG',
      status: 'failed',
      transitionId: 1,
      diagnostic: { code: 'superseded' },
    });
    release(catalogKey('lazy', 'ar-EG'));
    localization.dispose();
  });
});

describe('the participants of a coordinated change', () => {
  it('holds the change until a required participant has prepared, and commits it with the snapshot', async () => {
    const region = participant('region', { hold: ['ar-EG'] });
    const { localization, snapshot } = await ready();
    const registration = localization.registerParticipant(region.value);
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');

    const change = localization.changeLocale('ar-EG');
    await expect
      .poll(() => registration.state().attempt)
      .toMatchObject({ status: 'preparing', targetLocale: 'ar-EG' });

    expect(localization.lifecycle()).toBe('transitioning');
    expect(localization.targetLocale()).toBe('ar-EG');
    expect(localization.snapshot()).toBe(snapshot);

    region.release('ar-EG');
    const result = await change;

    expect(result).toMatchObject({ status: 'committed' });
    expect(registration.state().current).toMatchObject({
      targetLocale: 'ar-EG',
      transitionId: result.transitionId,
    });
    localization.dispose();
  });

  it('fails when a required participant reports a failure, and keeps the committed snapshot', async () => {
    const region = participant('region', { reports: { 'ar-EG': FAILED } });
    const { localization, snapshot } = await ready();
    const registration = localization.registerParticipant(region.value);
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');

    const result = await localization.changeLocale('ar-EG');

    expect(result).toMatchObject({
      status: 'failed',
      diagnostic: { code: 'participant-failed', participantId: 'region' },
    });
    expect(localization.snapshot()).toBe(snapshot);
    expect(localization.lifecycle()).toBe('ready');
    expect(registration.state().current?.targetLocale).toBe('en-US');
    localization.dispose();
  });
});

describe('the participants of a progressive change', () => {
  it('commits before a required participant has prepared, and lets it finish afterwards', async () => {
    const region = participant('region', { hold: ['ar-EG'] });
    const { localization } = await ready();
    const registration = localization.registerParticipant(region.value);
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');

    const result = await localization.changeLocale('ar-EG', {
      mode: 'progressive',
    });

    expect(result).toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'ar-EG' },
    });
    expect(registration.state().current?.targetLocale).toBe('en-US');
    await expect
      .poll(() => registration.state().attempt)
      .toMatchObject({
        status: 'preparing',
        targetLocale: 'ar-EG',
        transitionId: result.transitionId,
      });

    region.release('ar-EG');
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('ar-EG');
    localization.dispose();
  });

  it('confines a required participant failure to that participant', async () => {
    const region = participant('region', { reports: { 'ar-EG': FAILED } });
    const { localization } = await ready();
    const registration = localization.registerParticipant(region.value);
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');

    const result = await localization.changeLocale('ar-EG', {
      mode: 'progressive',
    });

    expect(result).toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'ar-EG' },
    });
    await expect
      .poll(() => registration.state().attempt)
      .toMatchObject({ status: 'failed', targetLocale: 'ar-EG' });
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    expect(localization.lifecycle()).toBe('ready');
    localization.dispose();
  });
});

describe('a participant still preparing when a locale change is asked for', () => {
  it('is told its work was superseded, by name, and prepares again for the new locale', async () => {
    const region = participant('region', { hold: ['en-US'] });
    const { localization, release } = runtime({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    const registration = localization.registerParticipant(region.value, {
      coordination: 'progressive',
    });
    await localization.initialize();
    await expect
      .poll(() => registration.state().attempt.status)
      .toBe('preparing');

    const change = localization.changeLocale('ar-EG');
    await expect
      .poll(() => registration.state().attempt.status)
      .toBe('superseded');

    expect(registration.state().attempt).toMatchObject({
      status: 'superseded',
      targetLocale: 'en-US',
      transitionId: 0,
      diagnostic: { code: 'superseded', participantId: 'region' },
    });
    expect(region.contexts[0]?.signal.aborted).toBe(true);

    release(catalogKey('shell', 'ar-EG'));
    await expect(change).resolves.toMatchObject({ status: 'committed' });
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('ar-EG');
    localization.dispose();
  });
});

/**
 * `specs/03-locale-identity-and-resolution.spec.md` section 8: a restore reads the stores while
 * the reader can still act, and a change or a removal asked for since is the newer decision.
 */
describe('a restore that read the stores before the reader acted', () => {
  it('does not undo a move and a removal the reader asked for while it was reading', async () => {
    let stored: string | undefined;
    let reading: Promise<void> = Promise.resolve();
    const { localization, snapshot } = await ready({
      options: {
        persistence: [
          {
            id: 'memory',
            read: () => reading.then(() => stored),
            write: () => undefined,
          },
        ],
      },
    });
    stored = 'ar-EG';
    let finishReading!: () => void;
    reading = new Promise<void>((resolve) => {
      finishReading = resolve;
    });

    const restoring = localization.ɵrestoreLocale({ url: '/' });
    await localization.changeLocale('en-US', { remember: false });
    await localization.forgetRememberedLocale();
    finishReading();

    await expect(restoring).resolves.toBeUndefined();
    expect(localization.snapshot()).toBe(snapshot);
    localization.dispose();
  });

  it('moves the page to the stored locale when the reader asked for nothing meanwhile', async () => {
    let stored: string | undefined;
    const { localization } = await ready({
      options: {
        persistence: [
          { id: 'memory', read: () => stored, write: () => undefined },
        ],
      },
    });
    stored = 'ar-EG';

    await expect(
      localization.ɵrestoreLocale({ url: '/' }),
    ).resolves.toMatchObject({ status: 'committed', targetLocale: 'ar-EG' });
    localization.dispose();
  });
});

describe('a coordinated change a required participant fails', () => {
  it('lets go of the catalogs it had loaded', async () => {
    const state = { fail: true };
    const region = participant('region');
    const { localization, loads } = await ready({
      setup: { maximumCachedCatalogs: 1 },
    });
    const registration = localization.registerParticipant({
      ...region.value,
      prepare: async (context) =>
        state.fail && context.targetLocale === 'ar-EG'
          ? FAILED
          : await region.value.prepare(context),
    });
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');
    await expect(localization.changeLocale('ar-EG')).resolves.toMatchObject({
      status: 'failed',
    });

    state.fail = false;
    await expect(localization.changeLocale('ar-EG')).resolves.toMatchObject({
      status: 'committed',
    });

    // The cache has room for one catalog nobody holds, so the Arabic catalog was loaded a second
    // time only if the change that failed had let go of it.
    expect(loads[catalogKey('shell', 'ar-EG')]).toBe(2);
    localization.dispose();
  });

  it('is reported as an integration failure of that transition, by participant', async () => {
    const watched = observed();
    const region = participant('region', { reports: { 'ar-EG': FAILED } });
    const { localization } = await ready({
      options: { observability: watched.emitter },
    });
    const registration = localization.registerParticipant(region.value);
    await expect
      .poll(() => registration.state().current?.targetLocale)
      .toBe('en-US');

    const result = await localization.changeLocale('ar-EG');

    expect(watched.phase('integration')).toStrictEqual([
      {
        status: 'failed',
        reason: 'participant-failed',
        targetLocale: 'ar-EG',
        participantId: 'region',
        transitionId: result.transitionId,
      },
    ]);
    localization.dispose();
  });
});
