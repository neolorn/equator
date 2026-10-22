/**
 * A failed initialization that has no recovery message to show.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 11 derives the recovery payload from
 * messages the consumer already wrote, and an application may name a recovery message without
 * handing over a payload, or hand over one that does not carry the message. Neither is a message
 * the evaluator refused: there is nothing to evaluate. So the context shows nothing and reports
 * the initialization as failed once, without a second report about a message.
 */
import { describe, expect, it } from 'vitest';

import { catalogKey, rejectionOf } from './catalog-store-harness.js';
import { TITLE, observed, runtime } from './transaction-runtime-harness.js';

const representation = (
  identity: string,
): Readonly<Record<string, unknown>> => ({
  identity,
  locale: 'en-US',
  sourceFingerprint: 'recovery-fixture',
  body: { kind: 'pattern', declarations: [], pattern: ['Try again'] },
});

/** A context whose startup catalog fails to load, with a recovery message named. */
async function failed(
  setup: Readonly<Record<string, unknown>>,
  identity: string = TITLE.identity,
) {
  const watched = observed();
  const { localization } = runtime({
    fail: { [catalogKey('shell', 'en-US')]: 1 },
    setup,
    options: {
      recoveryMessageIdentity: identity,
      observability: watched.emitter,
    },
  });
  const diagnostic = await rejectionOf(() => localization.initialize());
  return {
    localization,
    diagnostic,
    /** How each report of the initialization ended, in order. */
    told: () => watched.phase('initialization').map(({ status }) => status),
  };
}

describe('a failed initialization with a recovery message named', () => {
  it.each<readonly [string, Readonly<Record<string, unknown>>, string]>([
    ['the setup carries no recovery payload', {}, TITLE.identity],
    ['the payload is empty', { recoveryPayload: [] }, TITLE.identity],
    [
      'the payload carries another message only',
      { recoveryPayload: [representation('other:shell:title')] },
      TITLE.identity,
    ],
    [
      'the payload carries it under an identity that names no provider',
      { recoveryPayload: [representation('shell:title')] },
      'shell:title',
    ],
  ])(
    'shows nothing and reports one failure when %s',
    async (_label, setup, identity) => {
      const { localization, diagnostic, told } = await failed(setup, identity);

      expect(diagnostic).toMatchObject({ code: 'catalog-load-failed' });
      expect(localization.recovery()).toBeUndefined();
      expect(told()).toStrictEqual(['started', 'failed']);
      localization.dispose();
    },
  );
});
