import {
  compileLocalArtifacts,
  type CompiledCatalog as ToolkitCompiledCatalog,
} from '../../toolkit/src/compiled-artifacts.js';
import { parseCatalog, parseConfiguration } from '../../toolkit/src/index.js';
import { analyzeCatalogSet } from '../../toolkit/src/semantic-model.js';
import { LocalCatalogStore } from '../src/catalog-runtime.js';
import type {
  CatalogLoaders,
  CatalogSetDescriptor,
  GeneratedConfiguration,
  LocalizationDiagnostic,
} from '@neolorn/equator/core';

/**
 * A generated set as the toolkit compiles it, handed to the store the runtime admits it with.
 *
 * The catalogs, the descriptor and their digests come from the real compiler, so a case that edits
 * one field is refused for that field and not for a digest this file computed differently. The
 * configuration is assembled from the descriptor because the runtime reads only the fields below,
 * and the generated TypeScript that normally carries it needs a project on disk.
 */

export const PROVIDER = '@example/catalog-store';
export const LOCALES = Object.freeze(['en-US', 'ar-EG']);

const SOURCES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  shell: {
    'en-US': 'messages:\n  title: Catalog store\n  greeting: "Hello {$name}"\n',
    'ar-EG': 'messages:\n  title: مخزن الفهارس\n  greeting: "مرحبا {$name}"\n',
  },
  lazy: {
    'en-US': 'messages:\n  heading: Lazy heading\n',
    'ar-EG': 'messages:\n  heading: عنوان مؤجل\n',
  },
};

export interface CompiledSet {
  readonly configuration: GeneratedConfiguration;
  readonly descriptor: CatalogSetDescriptor;
  readonly catalogs: readonly ToolkitCompiledCatalog[];
}

/**
 * Compiles the fixture, with `edit` applied to one scope's source text first.
 *
 * `further` adds scopes to the two the fixture has, for a case that needs more than one scope
 * loading at a time, and replaces one of the two where it names it. `locales` are the locales
 * the configuration serves, for a case whose scopes carry a catalog in another locale.
 */
export function compileSet(
  edit: (scopeId: string, locale: string, text: string) => string = (
    _scope,
    _locale,
    text,
  ) => text,
  further: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
  locales: readonly string[] = LOCALES,
): CompiledSet {
  const parsedConfiguration = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales,
    }),
  );
  if (!parsedConfiguration.ok) throw new Error('Configuration fixture failed');
  const catalogs = Object.entries({ ...SOURCES, ...further }).flatMap(
    ([scopeId, byLocale]) =>
      Object.entries(byLocale).map(([locale, text]) => {
        const parsed = parseCatalog(edit(scopeId, locale, text), {
          role: locale === 'en-US' ? 'source' : 'target',
          providerId: PROVIDER,
          scopeId,
          locale,
          sourcePath: `i18n/${scopeId}/${locale}.yaml`,
        });
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
        return parsed.value;
      }),
  );
  const graph = analyzeCatalogSet({
    configuration: parsedConfiguration.value,
    catalogs,
  });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  const compiled = compileLocalArtifacts({
    owner: { providerId: PROVIDER, generatedRootPath: 'src/generated/i18n' },
    graph: graph.value,
    catalogs,
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const descriptor = compiled.value
    .descriptor as unknown as CatalogSetDescriptor;
  const scopes = new Map<string, GeneratedConfiguration['scopes'][number]>();
  for (const provider of descriptor.providers) {
    for (const { address } of provider.artifacts) {
      scopes.set(address.key.scopeId, {
        providerId: address.key.providerId,
        scopeId: address.key.scopeId,
        applicationContractFingerprint: address.applicationContractFingerprint,
        semanticRegistryFingerprint: address.semanticRegistryFingerprint,
        requiredExtensions: address.requiredExtensions,
      });
    }
  }
  const configuration = {
    generatedAbi: descriptor.generatedAbi,
    sourceLocale: 'en-US',
    defaultLocale: 'en-US',
    locales,
    aliases: {},
    applicationContractFingerprint: descriptor.applicationContractFingerprint,
    semanticRegistryFingerprint: descriptor.semanticRegistryFingerprint,
    scopes: [...scopes.values()],
  } as GeneratedConfiguration;
  return { configuration, descriptor, catalogs: compiled.value.catalogs };
}

export function catalogKey(scopeId: string, locale: string): string {
  return `${PROVIDER}:${scopeId}:${locale}`;
}

/** One loader per compiled catalog, each answering a fresh deep copy. */
export function loadersFor(set: CompiledSet): Record<string, () => unknown> {
  return Object.fromEntries(
    set.catalogs.map((catalog) => [
      catalogKey(catalog.key.scopeId, catalog.key.catalogLocale),
      () => structuredClone(catalog),
    ]),
  );
}

export function createStore(
  set: CompiledSet,
  loaders: CatalogLoaders = loadersFor(set),
): LocalCatalogStore {
  return new LocalCatalogStore(set.configuration, set.descriptor, loaders);
}

/** A deep copy of the set that `edit` may change freely. */
export function editedSet(
  set: CompiledSet,
  edit: (copy: {
    configuration: Record<string, unknown> & GeneratedConfiguration;
    descriptor: CatalogSetDescriptor & {
      providers: Array<{
        artifacts: Array<{
          address: Record<string, unknown> & { key: Record<string, string> };
        }>;
      }>;
    };
  }) => void,
): CompiledSet {
  const copy = structuredClone({
    configuration: set.configuration,
    descriptor: set.descriptor,
  }) as unknown as Parameters<typeof edit>[0];
  edit(copy);
  return { ...set, ...copy } as CompiledSet;
}

export const scope = (scopeId: string) =>
  Object.freeze({ providerId: PROVIDER, scopeId });

/**
 * The diagnostic a store refusal carries, or `undefined` when the store accepted.
 *
 * Undefined rather than a throw, so an acceptance reads as a failed assertion on the diagnostic.
 */
export function diagnosticOf(
  action: () => unknown,
): LocalizationDiagnostic | undefined {
  try {
    action();
  } catch (error) {
    const diagnostic = (error as { diagnostic?: LocalizationDiagnostic })
      .diagnostic;
    if (diagnostic !== undefined) return diagnostic;
    throw error;
  }
  return undefined;
}

export async function rejectionOf(
  action: () => Promise<unknown>,
): Promise<LocalizationDiagnostic | undefined> {
  try {
    await action();
  } catch (error) {
    const diagnostic = (error as { diagnostic?: LocalizationDiagnostic })
      .diagnostic;
    if (diagnostic !== undefined) return diagnostic;
    throw error;
  }
  return undefined;
}
