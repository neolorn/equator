/**
 * What a failed initialization shows from the recovery payload, representation by representation.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 11 derives the payload from messages
 * the consumer already wrote. Each representation is the compiled body of one message in one
 * locale, under the identity its generated handle carries: provider, scope and message, in that
 * order, the first two never empty. The runtime evaluates a body as it would a catalog's, so a body of
 * several parts is shown whole, a body that selects is shown by the variant it selects, and a
 * representation that is no compiled body ends in a typed failure. The setup is handed over by
 * the application, so the cases build the payload by hand.
 */
import { describe, expect, it } from 'vitest';

import { PROVIDER, catalogKey, rejectionOf } from './catalog-store-harness.js';
import { expression, literal, local } from './compiled-artifact-harness.js';
import { TITLE, observed, runtime } from './transaction-runtime-harness.js';

const pattern = (parts: readonly unknown[]): unknown => ({
  kind: 'pattern',
  declarations: [],
  pattern: parts,
});

const representation = (
  body: unknown,
  locale = 'en-US',
  identity: string = TITLE.identity,
): Readonly<Record<string, unknown>> => ({
  identity,
  locale,
  sourceFingerprint: 'recovery-fixture',
  body,
});

/** A context whose startup catalog fails to load, left failed with the payload to show. */
async function failed(
  payload: readonly unknown[],
  identity: string = TITLE.identity,
  initialLocale = 'en-US',
) {
  const watched = observed();
  const { localization } = runtime({
    fail: { [catalogKey('shell', initialLocale)]: 1 },
    setup: { recoveryPayload: payload },
    options: {
      initialLocale,
      recoveryMessageIdentity: identity,
      observability: watched.emitter,
    },
  });
  const diagnostic = await rejectionOf(() => localization.initialize());
  return {
    localization,
    diagnostic,
    /** What the emitter was told of the initialization, in order. */
    told: () => watched.phase('initialization'),
  };
}

describe('the identity a recovery message is addressed by', () => {
  it.each([
    ['a provider of one character', 'p:shell:title'],
    ['a scope and a message of one character each', `${PROVIDER}:s:m`],
  ])('is read with %s', async (_label, identity) => {
    const { localization } = await failed(
      [representation(pattern(['Try again']), 'en-US', identity)],
      identity,
    );

    expect(localization.recovery()).toMatchObject({
      kind: 'text',
      value: 'Try again',
    });
    localization.dispose();
  });

  it.each([
    ['no provider', 'shell:title'],
    ['an empty provider', ':shell:title'],
    ['an empty scope', `${PROVIDER}::title`],
  ])('is not one with %s', async (_label, identity) => {
    const { localization, diagnostic } = await failed(
      [representation(pattern(['Try again']), 'en-US', identity)],
      identity,
    );

    expect(diagnostic).toMatchObject({ code: 'catalog-load-failed' });
    expect(localization.recovery()).toBeUndefined();
    localization.dispose();
  });

  it('names the provider and the scope of a message shown in the source locale', async () => {
    const { localization } = await failed(
      [representation(pattern(['Try again']))],
      TITLE.identity,
      'ar-EG',
    );

    expect(localization.recovery()).toMatchObject({
      value: 'Try again',
      targetLocale: 'ar-EG',
      supplyingLocale: 'en-US',
      fallback: true,
    });
    expect(localization.recovery()?.diagnostics).toStrictEqual([
      {
        code: 'message-unavailable',
        outcome: 'localized-representation-unavailable',
        message: expect.any(String) as string,
        targetLocale: 'ar-EG',
        supplyingLocale: 'en-US',
        providerId: PROVIDER,
        scopeId: 'shell',
      },
    ]);
    localization.dispose();
  });
});

describe('the body of a recovery message', () => {
  /** A body that selects on a number it declares itself, since a recovery message takes no input. */
  const selecting = (
    variants: readonly unknown[],
    extra: Readonly<Record<string, unknown>> = {},
  ): unknown => ({
    kind: 'select',
    declarations: [
      local('tries', expression(literal('1'), { name: 'number', options: {} })),
    ],
    selectors: ['tries'],
    variants,
    ...extra,
  });
  const exactly = (key: string, parts: unknown): unknown => ({
    keys: [literal(key)],
    pattern: parts,
  });
  const otherwise = (parts: unknown): unknown => ({
    keys: [{ kind: 'catchall' }],
    pattern: parts,
  });

  it('is shown whole when it has several parts', async () => {
    const { localization } = await failed([
      representation(pattern(['The page ', 'could not ', 'start.'])),
    ]);

    expect(localization.recovery()).toMatchObject({
      kind: 'text',
      value: 'The page could not start.',
    });
    localization.dispose();
  });

  it.each([
    [
      'the variant it selects, whole',
      selecting([
        exactly('1', ['One ', 'more ', 'try.']),
        otherwise(['Try again']),
      ]),
      'One more try.',
    ],
    [
      'a later variant of several parts',
      selecting([exactly('2', ['Twice']), otherwise(['Try ', 'again'])]),
      'Try again',
    ],
    [
      'its variants alone, whatever else it carries',
      selecting([otherwise(['Try ', 'again'])], { pattern: [] }),
      'Try again',
    ],
  ])('is shown by %s', async (_label, body, value) => {
    const { localization } = await failed([representation(body)]);

    expect(localization.recovery()).toMatchObject({ kind: 'text', value });
    localization.dispose();
  });

  it.each<readonly [string, unknown]>([
    ['is null', null],
    ['is missing', undefined],
    ['is text', 'Try again'],
    ['is of no known kind', { kind: 'other', declarations: [] }],
    ['is a pattern without its parts', { kind: 'pattern', declarations: [] }],
    ['selects without variants', selecting(undefined as never)],
    ['has a variant that is null', selecting([null, otherwise(['Try'])])],
    [
      'has a variant that is missing',
      selecting([undefined, otherwise(['Try'])]),
    ],
    ['selects a variant without its parts', selecting([otherwise(undefined)])],
  ])(
    'leaves the load failure as the failure, and shows nothing, when it %s',
    async (_label, body) => {
      const { localization, diagnostic, told } = await failed([
        representation(body),
      ]);

      expect(diagnostic).toMatchObject({ code: 'catalog-load-failed' });
      expect(localization.recovery()).toBeUndefined();
      expect(localization.lifecycle()).toBe('failed');
      expect(localization.targetLocale()).toBeUndefined();
      // The message that could not be evaluated is reported on its own, after the failure it
      // was meant to explain.
      expect(told()).toStrictEqual([
        { status: 'started', transitionId: 0 },
        {
          status: 'failed',
          reason: 'catalog-load-failed',
          targetLocale: 'en-US',
          transitionId: 0,
        },
        {
          status: 'unavailable',
          reason: 'invalid-rich-message',
          targetLocale: 'en-US',
          transitionId: 0,
        },
      ]);
      localization.dispose();
    },
  );
});
