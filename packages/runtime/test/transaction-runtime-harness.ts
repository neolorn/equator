import {
  createLocalizationRuntime,
  type LocalizationRuntimeOptions,
} from '../src/localization.js';
import type {
  LocalizationEventEmitter,
  LocalizationEventInput,
} from '../src/observability.js';
import {
  GENERATED_ABI,
  type LocalizationParticipant,
  type LocalizationParticipantContext,
  type LocalizationParticipantReport,
  type LocalizationRouteSnapshot,
  type LocalizationSetup,
  type MessageHandle,
} from '@neolorn/equator/core';

import {
  PROVIDER,
  compileSet,
  editedSet,
  loadersFor,
  scope,
  type CompiledSet,
} from './catalog-store-harness.js';

/**
 * A runtime over the compiled fixture whose catalog loaders a case can hold open, fail and count.
 *
 * The cases that use it are about what a runtime does between a request and its outcome, and that
 * interval exists only while something is still loading. Holding a loader is what makes the state
 * in between a state a case reads, where a timer would make it one a case races.
 */

export const SHELL = scope('shell');
export const LAZY = scope('lazy');
/** A scope the configuration declares and the set carries no catalog for, in any locale. */
export const UNCOMPILED = scope('uncompiled');

function plainHandle(
  scopeId: string,
  messageId: string,
): MessageHandle & { readonly resultKind: 'plain' } {
  return Object.freeze({
    generatedAbi: GENERATED_ABI,
    providerId: PROVIDER,
    scopeId,
    messageId,
    identity: `${PROVIDER}:${scopeId}:${messageId}`,
    resultKind: 'plain' as const,
    inputNames: Object.freeze([]),
    slotNames: Object.freeze([]),
  });
}

export const TITLE = plainHandle('shell', 'title');
export const HEADING = plainHandle('lazy', 'heading');

// Compiled on first use, so that importing this file runs none of the library.
let fixture: CompiledSet | undefined;
export const compiled = (): CompiledSet => (fixture ??= compileSet());

type Edit = Parameters<typeof editedSet>[1];
type Editable = Parameters<Edit>[0];

/** The compiled set with one field of its configuration replaced. */
export function configured(field: string, value: unknown): CompiledSet {
  return editedSet(compiled(), ({ configuration }) => {
    (configuration as Record<string, unknown>)[field] = value;
  });
}

/** The compiled set serving a third locale that no catalog was compiled for. */
export const withUntranslatedLocale = (): CompiledSet =>
  configured('locales', ['en-US', 'ar-EG', 'fr-FR']);

/** The compiled set declaring `UNCOMPILED` beside the scopes it has catalogs for. */
export const withUncompiledScope = (): CompiledSet =>
  editedSet(compiled(), ({ configuration }) => {
    const row = configuration.scopes.find(({ scopeId }) => scopeId === 'shell');
    (configuration as Record<string, unknown>)['scopes'] = [
      ...configuration.scopes,
      { ...row, scopeId: UNCOMPILED.scopeId },
    ];
  });

/** The compiled set with one catalog taken out of its descriptor. */
export function withoutCatalog(scopeId: string, locale: string): CompiledSet {
  const edited = editedSet(compiled(), ({ descriptor }: Editable) => {
    for (const provider of descriptor.providers) {
      const kept: unknown = provider.artifacts.filter(
        ({ address }) =>
          address.key['scopeId'] !== scopeId ||
          address.key['catalogLocale'] !== locale,
      );
      (provider as { artifacts: unknown }).artifacts = kept;
    }
  });
  return {
    ...edited,
    catalogs: edited.catalogs.filter(
      ({ key }) => key.scopeId !== scopeId || key.catalogLocale !== locale,
    ),
  };
}

export const route = (
  canonicalPath: string,
  overrides: Partial<LocalizationRouteSnapshot> = {},
): LocalizationRouteSnapshot => ({
  routeId: 'home',
  projectionIdentity: 'projection-fixture',
  canonicalPath,
  ...overrides,
});

export interface RuntimeFixture {
  readonly set?: CompiledSet;
  readonly options?: Partial<LocalizationRuntimeOptions>;
  /** Further fields of the setup: a fallback policy, a cache bound, a recovery payload. */
  readonly setup?: Readonly<Record<string, unknown>>;
  /** Catalog keys whose loader waits until the case releases it. */
  readonly hold?: readonly string[];
  /** How many times the loader of each catalog key fails before it answers. */
  readonly fail?: Readonly<Record<string, number>>;
}

export function runtime({
  set = compiled(),
  options = {},
  setup = {},
  hold = [],
  fail = {},
}: RuntimeFixture = {}) {
  const loads: Record<string, number> = {};
  const failures = new Map(Object.entries(fail));
  const gates = new Map(
    hold.map((key) => {
      let open!: () => void;
      const held = new Promise<void>((resolve) => {
        open = resolve;
      });
      return [key, { held, open }] as const;
    }),
  );
  const loaders = Object.fromEntries(
    Object.entries(loadersFor(set)).map(([key, load]) => [
      key,
      async () => {
        loads[key] = (loads[key] ?? 0) + 1;
        await gates.get(key)?.held;
        const remaining = failures.get(key) ?? 0;
        if (remaining > 0) {
          failures.set(key, remaining - 1);
          throw new Error('the loader under test failed');
        }
        return load();
      },
    ]),
  );
  const localization = createLocalizationRuntime({
    setup: {
      configuration: set.configuration,
      catalogSet: set.descriptor,
      catalogLoaders: loaders,
      ...setup,
    } as unknown as LocalizationSetup,
    bootstrapScopes: [SHELL],
    ...options,
  });
  return {
    localization,
    /** How often each catalog was asked for, by catalog key. */
    loads,
    release: (key: string): void => gates.get(key)?.open(),
  };
}

export type Runtime = ReturnType<typeof runtime>['localization'];

const READY: LocalizationParticipantReport = Object.freeze({
  status: 'ready',
  representation: Object.freeze({ kind: 'language-independent' }),
});

export interface ParticipantFixture {
  /** What `prepare` answers, by target locale. A locale left out answers ready. */
  readonly reports?: Readonly<Record<string, LocalizationParticipantReport>>;
  /** Target locales whose preparation waits until the case releases it. */
  readonly hold?: readonly string[];
}

/** A participant that records every callback it is given, in the order they arrive. */
export function participant(
  id: string,
  { reports = {}, hold = [] }: ParticipantFixture = {},
) {
  const calls: string[] = [];
  const contexts: LocalizationParticipantContext[] = [];
  const gates = new Map(
    hold.map((locale) => {
      let open!: () => void;
      const held = new Promise<void>((resolve) => {
        open = resolve;
      });
      return [locale, { held, open }] as const;
    }),
  );
  const value: LocalizationParticipant = {
    id,
    prepare: async (context) => {
      calls.push(`prepare ${context.targetLocale}`);
      contexts.push(context);
      await gates.get(context.targetLocale)?.held;
      return reports[context.targetLocale] ?? READY;
    },
    commit: (context) => {
      calls.push(`commit ${context.targetLocale}`);
    },
    discard: (context) => {
      calls.push(`discard ${context.targetLocale}`);
    },
  };
  return {
    value,
    calls,
    contexts,
    release: (locale: string): void => gates.get(locale)?.open(),
  };
}

/**
 * Resolves in the first turn of the microtask queue in which `reached` holds.
 *
 * For a case that has to act in the turn a state appears, which a timer-driven poll would step
 * over. Bounded, so a state that never appears is a failed case and not a hung one.
 */
export async function until(reached: () => boolean): Promise<void> {
  for (let turns = 0; turns < 10_000; turns += 1) {
    if (reached()) return;
    await Promise.resolve();
  }
  throw new Error('the state the case waits for never appeared');
}

/** An emitter that keeps what it is given, and the events of one phase with their codes left out. */
export function observed() {
  const events: LocalizationEventInput[] = [];
  const emitter: LocalizationEventEmitter = {
    emit: (input) => void events.push(input),
  };
  return {
    emitter,
    phase: (phase: LocalizationEventInput['phase']) =>
      events
        .filter((event) => event.phase === phase)
        .map(({ code: _code, phase: _phase, ...rest }) => rest),
  };
}
