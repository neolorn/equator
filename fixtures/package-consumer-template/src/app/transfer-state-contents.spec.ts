import { describe, expect, it } from 'vitest';

import {
  ApplicationInitStatus,
  PLATFORM_ID,
  TransferState,
  inject,
  makeStateKey,
  provideEnvironmentInitializer,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Localization,
  languagePresentation,
  provideLocalizationSetup,
  type LocalizationParticipant,
  type LocalizationParticipantContext,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';

import { runtimeExtensions } from './runtime-extensions';

import { claimCapability } from '../../tools/capability-claims-in-tests.ts';

/**
 * What a server render hands the browser, read from the transfer it wrote.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 2 names the fields and forbids a function,
 * a template or a consumer's domain payload among them. The participant below holds a domain record
 * of its own and reports only what the contract asks, so anything of that record in the transfer,
 * or any function anywhere in it, is something the runtime put there.
 */

const DOMAIN_MARKER = 'consumer-domain-record-body';

const TRANSFER_KEY = makeStateKey<unknown>(
  '@neolorn/equator:localization-state/1',
);

class ArticleRegion {
  readonly store = new Map<string, { readonly body: string }>();

  readonly participant: LocalizationParticipant = Object.freeze({
    id: 'article-region',
    prepare: (context: LocalizationParticipantContext) => {
      this.store.set(context.targetLocale, { body: DOMAIN_MARKER });
      return Object.freeze({
        status: 'ready' as const,
        representation: Object.freeze({
          kind: 'locale-bound' as const,
          supplyingLocale: context.targetLocale,
          direction: languagePresentation(context.targetLocale).direction,
        }),
      });
    },
  });
}

/** Every path in `value` that holds something other than JSON data. */
function nonDataPaths(value: unknown, path = '$'): string[] {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      nonDataPaths(item, `${path}[${index}]`),
    );
  }
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      nonDataPaths(item, `${path}.${key}`),
    );
  }
  return [`${path}: ${typeof value}`];
}

describe('the transfer a server render writes', () => {
  it('carries the named fields, bounded participant records, and no code or domain payload', async () => {
    const region = new ArticleRegion();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        provideLocalizationSetup(
          {
            configuration,
            catalogSet,
            catalogLoaders,
            recoveryPayload,
            extensions: runtimeExtensions,
          },
          withFormattingContext({ timeZone: 'UTC' }),
        ),
        provideEnvironmentInitializer(() => {
          inject(Localization).registerParticipant(region.participant);
        }),
      ],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    await TestBed.inject(Localization).initialize();

    const transfer = TestBed.inject(TransferState).get(TRANSFER_KEY, null) as
      (Record<string, unknown> & { participants?: unknown[] }) | null;
    expect(transfer).not.toBeNull();
    expect(region.store.size).toBeGreaterThan(0);

    const fields = Object.keys(transfer ?? {}).sort();
    expect(fields).toEqual(
      fields.includes('route')
        ? [
            'catalogs',
            'formatting',
            'participants',
            'primaryLocale',
            'profile',
            'route',
          ]
        : [
            'catalogs',
            'formatting',
            'participants',
            'primaryLocale',
            'profile',
          ],
    );
    expect(transfer?.['profile']).toBe('equator-transfer-state/1');
    expect(transfer?.participants).toHaveLength(1);
    for (const record of transfer?.participants ?? []) {
      expect(
        Object.keys(record as object).every((key) =>
          [
            'profile',
            'participantId',
            'coordination',
            'current',
            'attempt',
          ].includes(key),
        ),
      ).toBe(true);
    }
    expect(nonDataPaths(transfer)).toEqual([]);
    expect(JSON.stringify(transfer)).not.toContain(DOMAIN_MARKER);

    TestBed.inject(Localization).dispose();
    TestBed.resetTestingModule();
    claimCapability('entry:@neolorn/equator');
  });
});
