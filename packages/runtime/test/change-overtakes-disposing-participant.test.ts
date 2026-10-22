import { describe, expect, it } from 'vitest';

import type { LocalizationParticipant } from '@neolorn/equator/core';

import { catalogKey } from './catalog-store-harness.js';
import { observed, runtime } from './transaction-runtime-harness.js';

describe('a change left without a context by the work it overtook', () => {
  it('still asks for the catalogs of the locale it was changing to', async () => {
    const watched = observed();
    let made: ReturnType<typeof runtime> | undefined;
    let listening = 0;
    const region: LocalizationParticipant = {
      id: 'region',
      prepare: (context) => {
        listening += 1;
        context.signal.addEventListener(
          'abort',
          () => made?.localization.dispose(),
          { once: true },
        );
        return new Promise<never>(() => undefined);
      },
    };
    made = runtime({
      hold: [catalogKey('shell', 'en-US')],
      options: { observability: watched.emitter },
    });
    const { localization, release } = made;
    localization.registerParticipant(region, { coordination: 'progressive' });

    const initializing = localization.initialize();
    const change = localization.changeLocale('ar-EG');
    release(catalogKey('shell', 'en-US'));
    await initializing;
    const result = await change;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listening).toBe(1);
    expect(result.status).toBe('cancelled');
    expect(
      watched
        .phase('catalog')
        .filter(({ targetLocale }) => targetLocale === 'ar-EG').length,
    ).toBeGreaterThan(0);
  });
});
