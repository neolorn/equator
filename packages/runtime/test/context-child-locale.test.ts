/**
 * The locale a child context starts in, and when a context makes one.
 *
 * `specs/06-runtime-and-angular.spec.md` section 6: a child context is created for a route or a
 * component subtree and inherits what it does not state. Unless it is given a locale it starts in
 * the one its parent is showing when the child is made, which is the locale the reader is in and
 * not the one the parent happened to start with. A disposed context holds nothing a child could be
 * made from.
 */
import { describe, expect, it } from 'vitest';

import { diagnosticOf } from './catalog-store-harness.js';
import { runtime } from './transaction-runtime-harness.js';

describe('a child context', () => {
  it('starts in the locale its parent was moved to', async () => {
    const { localization } = runtime();
    await localization.initialize();
    await localization.changeLocale('ar-EG');

    const child = localization.createChildContext();
    const snapshot = await child.initialize();

    expect(snapshot.primaryLocale).toBe('ar-EG');
    child.dispose();
    localization.dispose();
  });

  it('starts in the locale it is given, whatever its parent is showing', async () => {
    const { localization } = runtime();
    await localization.initialize();

    const child = localization.createChildContext({ initialLocale: 'ar-EG' });
    const snapshot = await child.initialize();

    expect(snapshot.primaryLocale).toBe('ar-EG');
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    child.dispose();
    localization.dispose();
  });

  it('is refused by a disposed context', async () => {
    const { localization } = runtime();
    await localization.initialize();
    localization.dispose();

    expect(diagnosticOf(() => localization.createChildContext())).toMatchObject(
      { code: 'disposed' },
    );
  });
});
