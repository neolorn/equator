/**
 * What a context hands over for transfer to the browser.
 *
 * `specs/06-runtime-and-angular.spec.md` section 10 has the server transfer the primary locale,
 * the formatting context, the admitted catalogs, the participant records, and the route projection
 * when routing is installed. A context that has committed nothing has no state to transfer, and
 * neither has a value that is no context of this runtime, so both answer with nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  localizationTransferSnapshot,
  type Localization,
} from '../src/localization.js';

import { route, runtime } from './transaction-runtime-harness.js';

describe('the transfer snapshot of a context', () => {
  it('is nothing before the first snapshot is committed', () => {
    const { localization } = runtime();

    expect(localizationTransferSnapshot(localization)).toBeUndefined();
    localization.dispose();
  });

  it('is nothing for a value this runtime did not build', () => {
    expect(
      localizationTransferSnapshot({} as unknown as Localization),
    ).toBeUndefined();
  });

  it('carries the route record the context committed', async () => {
    const { localization } = runtime({
      options: { initialRoute: route('/home') },
    });
    await localization.initialize();

    expect(localizationTransferSnapshot(localization)?.route).toStrictEqual(
      route('/home'),
    );
    localization.dispose();
  });

  it('has no route field where the context committed no route', async () => {
    const { localization } = runtime();
    await localization.initialize();

    expect(
      Object.keys(localizationTransferSnapshot(localization) ?? {}),
    ).toStrictEqual([
      'profile',
      'primaryLocale',
      'formatting',
      'catalogs',
      'participants',
    ]);
    localization.dispose();
  });
});
