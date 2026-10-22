import { describe, expect, it } from 'vitest';

import { createLocalizationContext } from '../src/localization.js';
import {
  type LocalizationContextOptions,
  type LocalizationParticipantContext,
  type LocalizationSetup,
} from '@neolorn/equator/core';

import { loadersFor } from './catalog-store-harness.js';
import { compiled } from './transaction-runtime-harness.js';

/**
 * Where the request context of a context built outside an injector can be read.
 *
 * `createLocalizationContext` takes something of the caller's own, usually the request a server
 * handler is answering, and a participant preparing content for that request is handed the same
 * value, so it needs no global to find it. The value is carried by reference: nothing reads it,
 * copies it or freezes it on the way.
 */

function context(options: Partial<LocalizationContextOptions> = {}) {
  const prepared: LocalizationParticipantContext[] = [];
  const localization = createLocalizationContext({
    setup: {
      configuration: compiled().configuration,
      catalogSet: compiled().descriptor,
      catalogLoaders: loadersFor(compiled()),
    } as unknown as LocalizationSetup,
    ...options,
  });
  const participant = {
    id: 'article',
    prepare: (handed: LocalizationParticipantContext) => {
      prepared.push(handed);
      return {
        status: 'ready',
        representation: { kind: 'language-independent' },
      } as const;
    },
  };
  return { localization, participant, prepared };
}

describe('the request context of a context built outside an injector', () => {
  it('is handed to a participant as the value the caller gave', async () => {
    const request = { headers: new Map([['accept-language', 'ar-EG']]) };
    const { localization, participant, prepared } = context({
      requestContext: request,
    });
    localization.registerParticipant(participant);

    await localization.initialize();

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.requestContext).toBe(request);
    expect(Object.isFrozen(request)).toBe(false);
    localization.dispose();
  });

  it('is handed to a participant of a child context that states none of its own', async () => {
    const request = { id: 7 };
    const parent = context({ requestContext: request });
    await parent.localization.initialize();
    const child = parent.localization.createChildContext();
    const prepared: LocalizationParticipantContext[] = [];
    child.registerParticipant({
      ...parent.participant,
      prepare: (handed) => {
        prepared.push(handed);
        return parent.participant.prepare(handed);
      },
    });

    await child.initialize();

    expect(prepared[0]?.requestContext).toBe(request);
    child.dispose();
    parent.localization.dispose();
  });

  it('is absent from what a participant is handed when the caller gave none', async () => {
    const { localization, participant, prepared } = context();
    localization.registerParticipant(participant);

    await localization.initialize();

    expect(prepared).toHaveLength(1);
    expect(Object.keys(prepared[0] ?? {})).not.toContain('requestContext');
    localization.dispose();
  });
});
