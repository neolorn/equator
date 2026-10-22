/**
 * What a runtime is constructed from, and what it reads off each input before trusting it.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 4 has the runtime establish that a
 * generated set agrees with its configuration before one catalog is loaded. The configuration, the
 * per-locale tables in it, the scopes named at construction and afterwards, the catalogs and
 * participant records a server transfers, and the extensions a setup installs all arrive as data
 * from somewhere else, so each is read as an unknown value first. Every refusal below changes one
 * thing in a set the real compiler produced, and a case that sits on a bound is paired with the
 * largest value the bound admits.
 *
 * One file rather than one per input, because every case constructs a runtime and so every case
 * runs the same construction: split up, each file would pay for the compiler again to reach it.
 */
import { describe, expect, it } from 'vitest';

import { defineExtensionRegistry } from '../../toolkit/src/extensions.js';
import {
  createLocalizationRuntime,
  type LocalizationRuntimeOptions,
} from '../src/localization.js';
import type { ParticipantTransferRecord } from '../src/participant-runtime.js';
import type {
  LocalizationSetup,
  RuntimeFormattingAdapterBinding,
  RuntimeFormattingAdapterDescriptor,
} from '@neolorn/equator/core';

import {
  PROVIDER,
  catalogKey,
  compileSet,
  diagnosticOf,
  editedSet,
  loadersFor,
  scope,
  type CompiledSet,
} from './catalog-store-harness.js';

// Compiled on first use, so that importing this file runs none of the library.
let fixture: CompiledSet | undefined;
const compiled = (): CompiledSet => (fixture ??= compileSet());

type Configuration = Parameters<
  Parameters<typeof editedSet>[1]
>[0]['configuration'];

function construct(
  set: CompiledSet,
  options: Partial<LocalizationRuntimeOptions> = {},
  loaders: Record<string, () => unknown> = loadersFor(set),
  setup: Readonly<Record<string, unknown>> = {},
) {
  return createLocalizationRuntime({
    setup: {
      configuration: set.configuration,
      catalogSet: set.descriptor,
      catalogLoaders: loaders,
      ...setup,
    } as unknown as LocalizationSetup,
    bootstrapScopes: [scope('shell')],
    ...options,
  });
}

const edited = (configure: (configuration: Configuration) => void) =>
  editedSet(compiled(), ({ configuration }) => configure(configuration));

/** The diagnostic a runtime refuses the edited configuration with, or nothing when it accepts. */
const refusal = (configure: (configuration: Configuration) => void) =>
  diagnosticOf(() => construct(edited(configure)).dispose());

const assign = (
  configuration: Configuration,
  field: string,
  value: unknown,
): void => {
  (configuration as Record<string, unknown>)[field] = value;
};

const fieldRefusal = (field: string, value: unknown) =>
  refusal((configuration) => assign(configuration, field, value));

/** The set's loaders, each counting how often its catalog was asked for. */
function counted(set: CompiledSet) {
  const loads: Record<string, number> = {};
  const loaders = Object.fromEntries(
    Object.entries(loadersFor(set)).map(([key, load]) => [
      key,
      () => {
        loads[key] = (loads[key] ?? 0) + 1;
        return load();
      },
    ]),
  );
  return { loads, loaders };
}

const REFUSED = { code: 'invalid-configuration' };

interface EditableArtifact {
  address: Record<string, unknown> & { key: Record<string, string> };
}

/** The first provider's artifacts, as rows a case may rewrite. */
const artifactsOf = (descriptor: unknown): EditableArtifact[] =>
  (descriptor as { providers: { artifacts: EditableArtifact[] }[] })
    .providers[0]!.artifacts;

describe('a configuration stamped with another generated ABI', () => {
  it('is refused for the stamp, whatever else the runtime was handed', () => {
    // The scope named here is one nobody generated. Under a stamp this release reads, that is
    // an unknown scope; under one it does not read, nothing else in the request has a meaning yet.
    const unknown = { bootstrapScopes: [scope('unknown')] };
    expect(
      diagnosticOf(() => construct(compiled(), unknown).dispose()),
    ).toMatchObject({ code: 'scope-unavailable' });
    expect(
      diagnosticOf(() =>
        construct(
          edited((configuration) =>
            assign(configuration, 'generatedAbi', 'equator-generated/0'),
          ),
          unknown,
        ).dispose(),
      ),
    ).toMatchObject(REFUSED);
  });
});

describe('the locale list of a generated configuration', () => {
  it('is accepted as compiled', () => {
    expect(refusal(() => undefined)).toBeUndefined();
  });

  it.each<readonly [string, unknown]>([
    ['is not a list', 5],
    ['holds a member that is not a string', ['en-US', 'ar-EG', 5]],
    ['holds an empty member', ['en-US', 'ar-EG', '']],
    ['names a locale twice', ['en-US', 'ar-EG', 'ar-EG']],
    ['leaves out the source locale', ['ar-EG']],
    // `specs/03-locale-identity-and-resolution.spec.md` section 3: a locale identity is a well
    // formed tag in its canonical form, and a malformed one is rejected at this boundary.
    ['holds a member that is not a language tag', ['en-US', 'ar-EG', 'en_GB']],
    ['holds a tag in another case', ['en-US', 'ar-EG', 'fr-fr']],
    ['holds a tag the pinned data replaces', ['en-US', 'ar-EG', 'iw-IL']],
  ])('is refused when it %s', (_label, locales) => {
    expect(fieldRefusal('locales', locales)).toMatchObject(REFUSED);
  });

  it('holds at most 512 locales', () => {
    const locales = (count: number) => [
      'en-US',
      'ar-EG',
      ...Array.from({ length: count - 2 }, (_, index) => `en-x-l${index}`),
    ];
    expect(fieldRefusal('locales', locales(512))).toBeUndefined();
    expect(fieldRefusal('locales', locales(513))).toMatchObject(REFUSED);
  });

  it('holds locales of at most 128 code units', () => {
    const locales = (length: number) => [
      'en-US',
      'ar-EG',
      // Private use subtags of eight letters each, which is as long as a subtag may be.
      `en-x-${'abcdefgh-'.repeat(14)}`.slice(0, length - 1) + 'z',
    ];
    expect(fieldRefusal('locales', locales(128))).toBeUndefined();
    expect(fieldRefusal('locales', locales(129))).toMatchObject(REFUSED);
  });
});

/**
 * `specs/03-locale-identity-and-resolution.spec.md` section 5: an alias that names a locale the
 * consumer does not support refuses the configuration.
 */
describe('the alias table of a generated configuration', () => {
  it('resolves an alias to the locale it names', async () => {
    const localization = construct(
      edited((configuration) =>
        assign(configuration, 'aliases', { arabic: 'ar-EG' }),
      ),
      { initialLocale: 'arabic' },
    );
    await expect(localization.initialize()).resolves.toMatchObject({
      primaryLocale: 'ar-EG',
    });
    localization.dispose();
  });

  it.each<readonly [string, unknown]>([
    ['is not a record', ['ar-EG']],
    ['has an empty alias', { '': 'ar-EG' }],
    ['names a locale the configuration does not ship', { french: 'fr-FR' }],
    ['names something that is not a locale', { arabic: 5 }],
  ])('is refused when it %s', (_label, aliases) => {
    expect(fieldRefusal('aliases', aliases)).toMatchObject(REFUSED);
  });

  it('holds aliases of at most 128 code units', () => {
    const aliases = (length: number) => ({ ['a'.repeat(length)]: 'ar-EG' });
    expect(fieldRefusal('aliases', aliases(128))).toBeUndefined();
    expect(fieldRefusal('aliases', aliases(129))).toMatchObject(REFUSED);
  });

  it('holds at most 2,048 aliases', () => {
    const aliases = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `alias-${index}`,
          'ar-EG',
        ]),
      );
    expect(fieldRefusal('aliases', aliases(2_048))).toBeUndefined();
    expect(fieldRefusal('aliases', aliases(2_049))).toMatchObject(REFUSED);
  });
});

describe('the scope list of a generated configuration', () => {
  it('is refused when two rows carry one identity', () => {
    expect(
      refusal((configuration) =>
        assign(configuration, 'scopes', [
          ...configuration.scopes,
          structuredClone(configuration.scopes[0]),
        ]),
      ),
    ).toMatchObject(REFUSED);
  });

  it('admits a row that states whether the first render uses the scope', () => {
    expect(
      refusal((configuration) =>
        assign(
          configuration,
          'scopes',
          configuration.scopes.map((row) => ({
            ...row,
            startup: row.scopeId === 'shell',
          })),
        ),
      ),
    ).toBeUndefined();
  });

  it('is refused when a row carries a field the contract does not name', () => {
    expect(
      refusal((configuration) =>
        assign(
          configuration,
          'scopes',
          configuration.scopes.map((row) => ({ ...row, eager: true })),
        ),
      ),
    ).toMatchObject(REFUSED);
  });
});

/**
 * `specs/08-formatting-parsing-and-domain.spec.md` section 4 layers a locale's own formatting
 * entry over the application-wide context. A table keyed by a locale the application does not
 * ship, or naming an option nothing reads, was built against a different configuration.
 */
describe('the per-locale formatting table', () => {
  it('writes a locale the way its entry says', async () => {
    const entry = {
      numberingSystem: 'latn',
      calendar: 'gregory',
      hourCycle: 'h23',
    };
    const localization = construct(
      edited((configuration) =>
        assign(configuration, 'formatting', { 'ar-EG': entry }),
      ),
      { initialLocale: 'ar-EG' },
    );
    const snapshot = await localization.initialize();

    expect(snapshot.formatting).toStrictEqual({ locale: 'ar-EG', ...entry });
    expect(
      localization.formatNumber({ kind: 'decimal', value: '1234' }),
    ).toMatchObject({
      ok: true,
      value: {
        text: new Intl.NumberFormat('ar-EG', {
          numberingSystem: 'latn',
        }).format(1234),
      },
    });
    localization.dispose();
  });

  it.each(['h11', 'h12', 'h23', 'h24'])(
    'admits the hour cycle %s',
    (hourCycle) => {
      expect(
        fieldRefusal('formatting', { 'ar-EG': { hourCycle } }),
      ).toBeUndefined();
    },
  );

  it('admits an entry for every locale, and an entry that sets nothing', () => {
    expect(
      fieldRefusal('formatting', {
        'en-US': {},
        'ar-EG': { numberingSystem: 'arab' },
      }),
    ).toBeUndefined();
  });

  it.each<readonly [string, unknown]>([
    ['is a list', []],
    ['is not a record at all', 5],
    ['is keyed by a locale the configuration does not ship', { 'fr-FR': {} }],
    ['holds an entry that is a list', { 'ar-EG': [] }],
    [
      'holds an entry under an unshipped locale beside a well formed one',
      { 'ar-EG': { calendar: 'gregory' }, 'fr-FR': { calendar: 'gregory' } },
    ],
    [
      'spells an option name in another case',
      { 'ar-EG': { numberingsystem: 'latn' } },
    ],
    ['names an option nothing reads', { 'ar-EG': { timeZone: 'UTC' } }],
    [
      'names an hour cycle that does not exist',
      { 'ar-EG': { hourCycle: 'h25' } },
    ],
    [
      'gives a numbering system as a number',
      { 'ar-EG': { numberingSystem: 5 } },
    ],
    [
      'gives a numbering system as a list',
      { 'ar-EG': { numberingSystem: ['latn'] } },
    ],
    ['gives an empty calendar', { 'ar-EG': { calendar: '' } }],
  ])('is refused when it %s', (_label, table) => {
    expect(fieldRefusal('formatting', table)).toMatchObject(REFUSED);
  });

  it('holds option values of at most 128 code units', () => {
    const entry = (length: number) => ({
      'ar-EG': { calendar: 'g'.repeat(length) },
    });
    expect(fieldRefusal('formatting', entry(128))).toBeUndefined();
    expect(fieldRefusal('formatting', entry(129))).toMatchObject(REFUSED);
  });
});

/**
 * `specs/03-locale-identity-and-resolution.spec.md` section 4 resolves each locale's parents at
 * build time. A chain is trusted about what it means and never about its shape.
 */
describe('the generated fallback chains', () => {
  it('admits a chain of shipped locales', () => {
    expect(
      fieldRefusal('localeFallbacks', { 'ar-EG': ['en-US'] }),
    ).toBeUndefined();
  });

  const among = (locales: readonly string[], table: unknown) =>
    refusal((configuration) => {
      assign(configuration, 'locales', locales);
      assign(configuration, 'localeFallbacks', table);
    });

  it('admits chains that lead to one locale by different ways', () => {
    expect(
      among(['en-US', 'ar-EG', 'fr-FR', 'fr-CA'], {
        'ar-EG': ['en-US'],
        'fr-FR': ['en-US'],
        'fr-CA': ['fr-FR', 'en-US'],
      }),
    ).toBeUndefined();
  });

  it.each<readonly [string, readonly string[], unknown]>([
    [
      'two locales that inherit from each other',
      ['en-US', 'ar-EG'],
      { 'ar-EG': ['en-US'], 'en-US': ['ar-EG'] },
    ],
    [
      'three locales that inherit in a ring',
      ['en-US', 'ar-EG', 'fr-FR'],
      { 'ar-EG': ['en-US'], 'en-US': ['fr-FR'], 'fr-FR': ['ar-EG'] },
    ],
    [
      'a ring behind a locale that is not part of it',
      ['en-US', 'ar-EG', 'fr-FR', 'fr-CA'],
      { 'fr-CA': ['fr-FR'], 'fr-FR': ['ar-EG'], 'ar-EG': ['fr-FR'] },
    ],
  ])('are refused when they hold %s', (_label, locales, table) => {
    expect(among(locales, table)).toMatchObject(REFUSED);
  });

  it.each<readonly [string, unknown]>([
    ['is a list', []],
    ['is not a record at all', 5],
    [
      'is keyed by a locale the configuration does not ship',
      { 'fr-FR': ['en-US'] },
    ],
    ['holds a chain that is not a list', { 'ar-EG': { 0: 'en-US' } }],
    ['holds an empty chain', { 'ar-EG': [] }],
    ['names a parent the configuration does not ship', { 'ar-EG': ['ar'] }],
    ['names a parent that is not a string', { 'ar-EG': [5] }],
    ['puts a locale in its own chain', { 'ar-EG': ['ar-EG'] }],
    ['names one parent twice', { 'ar-EG': ['en-US', 'en-US'] }],
    [
      'holds a malformed chain beside a well formed one',
      { 'ar-EG': ['en-US'], 'en-US': ['en-US'] },
    ],
  ])('are refused when the table %s', (_label, table) => {
    expect(fieldRefusal('localeFallbacks', table)).toMatchObject(REFUSED);
  });
});

describe('the scopes a runtime is told to load first', () => {
  it.each<readonly [string, unknown]>([
    ['an empty list', []],
    ['something that is not a list', { length: 1 }],
    ['nothing at all', undefined],
  ])('are refused as %s', (_label, bootstrapScopes) => {
    expect(
      diagnosticOf(() =>
        construct(compiled(), {
          bootstrapScopes: bootstrapScopes as never,
        }).dispose(),
      ),
    ).toMatchObject(REFUSED);
  });
});

/**
 * A scope reaches the runtime from application code as well as from the generated configuration:
 * `scopeReadiness`, `ensureScope`, `preloadScope` and the scope lists of a locale change all take
 * one. `specs/05-compiled-artifacts-and-trust.spec.md` section 10 keeps consumer values out of
 * diagnostics and cache keys except as bounded safe identifiers, so a scope is admitted only as
 * two bounded own data strings, and one that is not is a malformed request rather than an unknown
 * scope. The cases read the difference off the diagnostic code: `invalid-configuration` for a
 * value that is not a scope, `scope-unavailable` for a well formed scope nobody generated.
 */
describe('a scope handed to the runtime', () => {
  function asked(value: unknown) {
    const localization = construct(compiled());
    try {
      return diagnosticOf(() => localization.scopeReadiness(value as never));
    } finally {
      localization.dispose();
    }
  }

  class ScopeLike {
    readonly providerId = PROVIDER;
    readonly scopeId = 'shell';
  }

  it('is admitted as a bare pair of identifiers', () => {
    expect(asked({ providerId: PROVIDER, scopeId: 'shell' })).toBeUndefined();
  });

  it('is admitted as the generated row, with every field the row may carry', () => {
    const row = compiled().configuration.scopes.find(
      ({ scopeId }) => scopeId === 'shell',
    );
    expect(asked({ ...row, startup: true })).toBeUndefined();
  });

  it.each<readonly [string, unknown]>([
    ['null', null],
    ['a list', [PROVIDER, 'shell']],
    ['an instance of a class', new ScopeLike()],
    ['a record with no scope identifier', { providerId: PROVIDER }],
    ['a record with no provider identifier', { scopeId: 'shell' }],
    [
      'a record with a field a scope does not have',
      { providerId: PROVIDER, scopeId: 'shell', locale: 'en-US' },
    ],
    [
      'a record with a symbol key',
      { providerId: PROVIDER, scopeId: 'shell', [Symbol('tag')]: true },
    ],
    [
      'a provider identifier behind a getter',
      {
        get providerId() {
          return PROVIDER;
        },
        scopeId: 'shell',
      },
    ],
    [
      'a provider identifier behind a setter',
      {
        set providerId(_value: string) {
          // Never called: the descriptor alone is what refuses it.
        },
        scopeId: 'shell',
      },
    ],
    [
      'a provider identifier that is a number',
      { providerId: 5, scopeId: 'shell' },
    ],
    ['an empty provider identifier', { providerId: '', scopeId: 'shell' }],
    [
      'a provider identifier of 257 code units',
      { providerId: 'p'.repeat(257), scopeId: 'shell' },
    ],
    [
      'a provider identifier carrying a control character',
      { providerId: `${PROVIDER}\u0000`, scopeId: 'shell' },
    ],
    [
      'a scope identifier behind a getter',
      {
        providerId: PROVIDER,
        get scopeId() {
          return 'shell';
        },
      },
    ],
    [
      'a scope identifier behind a setter',
      {
        providerId: PROVIDER,
        set scopeId(_value: string) {
          // Never called: the descriptor alone is what refuses it.
        },
      },
    ],
    [
      'a scope identifier that is a number',
      { providerId: PROVIDER, scopeId: 5 },
    ],
    ['an empty scope identifier', { providerId: PROVIDER, scopeId: '' }],
    [
      'a scope identifier of 129 code units',
      { providerId: PROVIDER, scopeId: 's'.repeat(129) },
    ],
    [
      'a scope identifier carrying a control character',
      { providerId: PROVIDER, scopeId: 'shell\u007f' },
    ],
  ])('is refused as malformed when it is %s', (_label, value) => {
    expect(asked(value)).toMatchObject(REFUSED);
  });

  it.each<readonly [string, unknown]>([
    [
      'a provider identifier of 256 code units',
      { providerId: 'p'.repeat(256), scopeId: 'shell' },
    ],
    [
      'a scope identifier of 128 code units',
      { providerId: PROVIDER, scopeId: 's'.repeat(128) },
    ],
  ])('is well formed and unknown with %s', (_label, value) => {
    expect(asked(value)).toMatchObject({ code: 'scope-unavailable' });
  });
});

/**
 * `specs/06-runtime-and-angular.spec.md` section 10. A transferred catalog that passes admission
 * is the catalog, so hydration does not fetch what the document already carried.
 */
describe('the catalogs a server hands over', () => {
  const transferred = (transferredCatalogs: unknown) =>
    diagnosticOf(() =>
      construct(compiled(), {
        transferredCatalogs: transferredCatalogs as never,
      }).dispose(),
    );

  it('are used without being loaded', async () => {
    const set = compiled();
    const { loads, loaders } = counted(set);
    const localization = construct(
      set,
      {
        transferredCatalogs: structuredClone(
          set.catalogs.filter(
            ({ key }) =>
              key.scopeId === 'shell' && key.catalogLocale === 'en-US',
          ),
        ),
      },
      loaders,
    );

    await expect(localization.initialize()).resolves.toMatchObject({
      primaryLocale: 'en-US',
      loadedScopes: [scope('shell')],
    });
    expect(loads[catalogKey('shell', 'en-US')]).toBeUndefined();
    localization.dispose();
  });

  it('are loaded when nothing was handed over', async () => {
    const set = compiled();
    const { loads, loaders } = counted(set);
    const localization = construct(set, {}, loaders);

    await localization.initialize();

    expect(loads[catalogKey('shell', 'en-US')]).toBe(1);
    localization.dispose();
  });

  it('are refused when they are not a list', () => {
    expect(transferred('catalogs')).toMatchObject(REFUSED);
  });

  it('number at most 512', () => {
    expect(
      transferred(Array.from({ length: 512 }, () => null)),
    ).toBeUndefined();
    expect(transferred(Array.from({ length: 513 }, () => null))).toMatchObject(
      REFUSED,
    );
  });
});

/**
 * The same section: a transferred participant record is the state its region starts from, so a
 * region the server finished is not reported as never having been asked.
 */
describe('a participant record the server transferred', () => {
  const current = Object.freeze({
    targetLocale: 'en-US',
    transitionId: 0,
    report: Object.freeze({
      status: 'ready' as const,
      representation: Object.freeze({
        kind: 'locale-bound' as const,
        supplyingLocale: 'en-US',
        direction: 'ltr' as const,
      }),
    }),
  });
  const record: ParticipantTransferRecord = Object.freeze({
    profile: 'equator-participant-state/1',
    participantId: 'feed',
    coordination: 'required',
    current,
  });
  const participant = Object.freeze({
    id: 'feed',
    prepare: () => current.report,
  });

  it('is the state its participant registers with', () => {
    const localization = construct(compiled(), {
      transferredParticipants: [record],
    });

    const registration = localization.registerParticipant(participant);

    expect(registration.state().current).toStrictEqual(current);
    localization.dispose();
  });

  it('is absent from a participant registered with nothing transferred', () => {
    const localization = construct(compiled());

    const registration = localization.registerParticipant(participant);

    expect(registration.state().current).toBeUndefined();
    localization.dispose();
  });
});

describe('a set whose catalog formats in the context time zone', () => {
  const zoned = () =>
    editedSet(compiled(), ({ descriptor }) => {
      artifactsOf(descriptor)[0]!.address['requiredFeatures'] = [
        'context-time-zone',
      ];
    });

  it('is refused by a runtime that was given no time zone', () => {
    expect(diagnosticOf(() => construct(zoned()).dispose())).toMatchObject(
      REFUSED,
    );
    expect(
      diagnosticOf(() =>
        construct(zoned(), {
          formattingContext: { numberingSystem: 'latn' },
        }).dispose(),
      ),
    ).toMatchObject(REFUSED);
  });

  it('is accepted by a runtime that names one', () => {
    expect(
      diagnosticOf(() =>
        construct(zoned(), {
          formattingContext: { timeZone: 'UTC' },
        }).dispose(),
      ),
    ).toBeUndefined();
  });
});

describe('a set of more catalogs than the formatter cache has entries for', () => {
  it('is accepted, with the cache held at its ceiling', () => {
    // 513 catalogs: one more than an eighth of the cache's 4,096 entries.
    const extra = Array.from({ length: 509 }, (_, index) => `extra-${index}`);
    const large = editedSet(compiled(), ({ configuration, descriptor }) => {
      const artifacts = artifactsOf(descriptor);
      const artifact = artifacts.find(
        ({ address }) =>
          address.key['scopeId'] === 'shell' &&
          address.key['catalogLocale'] === 'en-US',
      )!;
      const row = configuration.scopes.find(
        ({ scopeId }) => scopeId === 'shell',
      )!;
      assign(configuration, 'scopes', [
        ...configuration.scopes,
        ...extra.map((scopeId) => ({ ...row, scopeId })),
      ]);
      for (const scopeId of extra) {
        const copy = structuredClone(artifact);
        copy.address.key['scopeId'] = scopeId;
        artifacts.push(copy);
      }
    });
    const loaders = {
      ...loadersFor(large),
      ...Object.fromEntries(
        extra.map((scopeId) => [catalogKey(scopeId, 'en-US'), () => ({})]),
      ),
    };

    expect(
      diagnosticOf(() => construct(large, {}, loaders).dispose()),
    ).toBeUndefined();
  });
});

/**
 * `specs/06-runtime-and-angular.spec.md` section 1 composes a runtime from one setup, and an
 * adapter the setup installs is reachable from the localization that setup produced.
 */
describe('a formatting adapter', () => {
  /** Built through the compiler's registry, because the runtime checks the fingerprint it derives. */
  function adapter(): RuntimeFormattingAdapterBinding<string> {
    const registry = defineExtensionRegistry([
      {
        kind: 'formatting-adapter',
        id: 'test:code',
        inputType: 'test:code',
        result: 'text',
        maximumOutputLength: 16,
      },
    ]);
    if (!registry.ok) {
      throw new Error(
        `the descriptor under test was refused: ${registry.diagnostics
          .map(({ summary }) => summary)
          .join('; ')}`,
      );
    }
    const [descriptor] = registry.value.descriptors as unknown as readonly [
      RuntimeFormattingAdapterDescriptor,
    ];
    return Object.freeze<RuntimeFormattingAdapterBinding<string>>({
      descriptor,
      format: ({ value }) => ({ text: `#${value}` }),
    });
  }

  it('formats through a runtime whose setup installed it', async () => {
    const installed = adapter();
    const set = compiled();
    const localization = construct(set, {}, loadersFor(set), {
      extensions: [installed],
    });
    await localization.initialize();

    expect(localization.formatWithAdapter(installed, 'a1')).toMatchObject({
      ok: true,
      value: { text: '#a1' },
    });
    localization.dispose();
  });

  it('is refused by a runtime whose setup installed nothing', async () => {
    const localization = construct(compiled());
    await localization.initialize();

    expect(localization.formatWithAdapter(adapter(), 'a1')).toMatchObject({
      ok: false,
      diagnostic: { code: 'unsupported-formatting-capability' },
    });
    localization.dispose();
  });
});
