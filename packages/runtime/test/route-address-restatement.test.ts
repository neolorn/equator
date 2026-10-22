/**
 * When a restated route counts as the route already committed, by the addresses it carries.
 *
 * `specs/06-runtime-and-angular.spec.md` section 4 makes the snapshot the one thing published, so
 * a route restated for the current locale supersedes the snapshot only when it says something the
 * committed one does not. The addresses are rebuilt on every projection, so they are compared by
 * what they hold: a route that gains them, loses them or gains one more is a different route, and
 * a route without them restated without them is the same one.
 */
import { describe, expect, it } from 'vitest';

import { route, runtime } from './transaction-runtime-harness.js';

const ENGLISH = { 'en-US': '/en-us/about' };
const BOTH = { ...ENGLISH, 'ar-EG': '/ar-eg/about' };

async function restatedWith(
  addresses: Readonly<Record<string, string>> | undefined,
) {
  const { localization } = runtime();
  await localization.initialize();
  const first = route(
    '/en-us/about',
    addresses === undefined ? {} : { addresses },
  );
  localization.ɵrestateRoute(first);
  return { localization, committed: localization.snapshot() };
}

describe('a route restated with other addresses than it was committed with', () => {
  it.each([
    ['gains its addresses', undefined, BOTH],
    ['gains one more address', ENGLISH, BOTH],
    ['loses one of its addresses', BOTH, ENGLISH],
  ])('is published when it %s', async (_label, before, after) => {
    const { localization, committed } = await restatedWith(before);
    const restated = route('/en-us/about', { addresses: after });

    localization.ɵrestateRoute(restated);

    expect(localization.snapshot()?.id).toBe((committed?.id ?? 0) + 1);
    expect(localization.snapshot()?.route).toStrictEqual(restated);
    localization.dispose();
  });

  it('is published without addresses when it loses them', async () => {
    const { localization, committed } = await restatedWith(BOTH);

    localization.ɵrestateRoute(route('/en-us/about'));

    expect(localization.snapshot()?.id).toBe((committed?.id ?? 0) + 1);
    expect(localization.snapshot()?.route).toStrictEqual(route('/en-us/about'));
    localization.dispose();
  });
});

describe('a route restated as it was committed', () => {
  it('publishes nothing when neither carries addresses', async () => {
    const { localization, committed } = await restatedWith(undefined);

    localization.ɵrestateRoute(route('/en-us/about'));

    expect(localization.snapshot()).toBe(committed);
    localization.dispose();
  });
});
