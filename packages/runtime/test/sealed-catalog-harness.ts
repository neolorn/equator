import {
  digestCanonicalJson,
  stringifyCanonicalJson,
  type CanonicalJsonValue,
} from '../../toolkit/src/canonical-json.js';
import { LocalCatalogStore } from '../src/catalog-runtime.js';
import type { LocalizationDiagnostic } from '@neolorn/equator/core';

import {
  catalogKey,
  compileSet,
  editedSet,
  loadersFor,
  rejectionOf,
  scope,
  type CompiledSet,
} from './catalog-store-harness.js';

/**
 * One compiled catalog, edited by a case and then sealed the way the compiler seals one.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 3 is why this exists: a matching digest
 * proves byte identity and nothing else. A case that edits a catalog and leaves its digest stale is
 * refused for the digest, whatever else is wrong with it, so it says nothing about the condition it
 * meant to break. Here the decoded size is taken again from the edited content with the compiler's
 * own canonical form, the digest is taken again over the result, and the descriptor entry carries
 * both, so the one thing standing between the edited catalog and admission is the condition under
 * test.
 *
 * The counts in the summary other than the decoded size are left as the compiler wrote them. An
 * edit that changes one states the change itself, which keeps the arithmetic of a case in the case.
 */

/**
 * A source that compiles to every shape a message can take: plain text, an input with a description,
 * an explicit empty message, a selection over a formatted number, typed inputs with an enumeration,
 * and a structured message with paired, nested and standalone slots.
 */
const SOURCE = [
  'messages:',
  '  title: Catalog store',
  '  greeting:',
  '    message: "Hello {$name}"',
  '    inputs:',
  '      name:',
  '        type: string',
  '        description: "Who is greeted"',
  '  separator:',
  '    empty: true',
  '  count:',
  '    message: |-',
  '      .input {$count :number}',
  '      .match $count',
  '      one {{One item}}',
  '      * {{{$count} items}}',
  '    inputs:',
  '      count: number',
  '  flags:',
  '    message: "{$when :datetime} {$n :integer} {$kind}"',
  '    inputs:',
  '      when: date-time',
  '      n: integer',
  '      kind:',
  '        type: string',
  '        enum: [a, b]',
  '  rich:',
  '    message: "{#strong}Bold {#em}x{/em}{/strong} {#br/}"',
  '    slots:',
  '      strong:',
  '        kind: strong',
  '        description: "The emphasized phrase"',
  '      br:',
  '        shape: standalone',
  '      em:',
  '        kind: emphasis',
  '        within: [strong]',
  '',
].join('\n');

const TARGET = [
  'messages:',
  '  title: Catalog store',
  '  greeting: "Hello {$name}"',
  '  separator:',
  '    empty: true',
  '  count: |-',
  '    .input {$count :number}',
  '    .match $count',
  '    one {{One item}}',
  '    * {{{$count} items}}',
  '  flags: "{$when :datetime} {$n :integer} {$kind}"',
  '  rich: "{#strong}Bold {#em}x{/em}{/strong} {#br/}"',
  '',
].join('\n');

// Compiled on first use, so that importing this file runs none of the library.
let fixture: CompiledSet | undefined;

/** The fixture of `catalog-store-harness.ts` with the `shell` scope compiled from the source above. */
export const richSet = (): CompiledSet =>
  (fixture ??= compileSet((scopeId, locale, text) =>
    scopeId !== 'shell' ? text : locale === 'en-US' ? SOURCE : TARGET,
  ));

export interface EditableMessage {
  messageId: unknown;
  kind: unknown;
  resultKind: unknown;
  sourceFingerprint: unknown;
  inputs: Record<string, unknown>[];
  slots: Record<string, unknown>[];
  body: Record<string, unknown>;
  [field: string]: unknown;
}

export interface EditableResources {
  [count: string]: unknown;
  decodedBytes: number;
  messages: number;
  identifiers: number;
  literals: number;
  irNodes: number;
  depth: number;
  inputs: number;
  slots: number;
  outputParts: number;
  maximumMessage: Record<string, number>;
}

export interface EditableCatalog {
  [field: string]: unknown;
  key: Record<string, unknown>;
  messages: EditableMessage[];
  resources: EditableResources;
}

/** A copy of the compiled `shell` catalog in `en-US` that a case may change freely. */
export function richCatalog(): EditableCatalog {
  const catalog = richSet().catalogs.find(
    ({ key }) => key.scopeId === 'shell' && key.catalogLocale === 'en-US',
  );
  if (catalog === undefined)
    throw new Error('The fixture has no shell catalog');
  return structuredClone(catalog) as unknown as EditableCatalog;
}

/** One message of a catalog copy, by the identifier the source gave it. */
export function messageOf(
  catalog: EditableCatalog,
  messageId: string,
): EditableMessage {
  const message = catalog.messages.find(
    (candidate) => candidate.messageId === messageId,
  );
  if (message === undefined) throw new Error(`No message ${messageId}`);
  return message;
}

export interface SealedCatalog {
  readonly set: CompiledSet;
  readonly loaders: Record<string, () => unknown>;
  readonly catalog: EditableCatalog;
  readonly contentDigest: string;
}

const canonical = (value: unknown): CanonicalJsonValue =>
  value as CanonicalJsonValue;

/**
 * The `shell` catalog in `en-US` with `edit` applied, and a set whose entry for it matches.
 *
 * `measure: false` leaves the decoded size as the compiler wrote it, for a case about a catalog
 * that misreports its own size or whose summary is no longer a record.
 */
export function sealed(
  edit: (catalog: EditableCatalog) => void,
  { measure = true }: { readonly measure?: boolean } = {},
): SealedCatalog {
  const catalog = richCatalog();
  edit(catalog);
  if (measure) {
    const { resources, ...base } = catalog;
    resources.decodedBytes = Buffer.byteLength(
      stringifyCanonicalJson(canonical(base)),
      'utf8',
    );
  }
  const contentDigest = digestCanonicalJson(
    'equator-compiled-catalog/1',
    canonical(catalog),
  );
  const set = editedSet(richSet(), ({ descriptor }) => {
    for (const provider of descriptor.providers) {
      for (const artifact of provider.artifacts) {
        const { scopeId, catalogLocale } = artifact.address.key;
        if (scopeId !== 'shell' || catalogLocale !== 'en-US') continue;
        const address: Record<string, unknown> = artifact.address;
        address['contentDigest'] = contentDigest;
        (artifact as unknown as { resources: unknown }).resources =
          structuredClone(catalog.resources);
      }
    }
  });
  return {
    set,
    catalog,
    contentDigest,
    loaders: {
      ...loadersFor(richSet()),
      [catalogKey('shell', 'en-US')]: () => structuredClone(catalog),
    },
  };
}

/** The descriptor entry for the sealed catalog, for a case that changes what the set says of it. */
export function sealedEntry(set: CompiledSet): {
  address: Record<string, unknown>;
  resources: EditableResources;
} {
  for (const provider of set.descriptor.providers) {
    for (const artifact of provider.artifacts) {
      const { scopeId, catalogLocale } = artifact.address.key;
      if (scopeId === 'shell' && catalogLocale === 'en-US') {
        return artifact as unknown as ReturnType<typeof sealedEntry>;
      }
    }
  }
  throw new Error('The set has no entry for the shell catalog');
}

/**
 * A store over a set compiled from the source above.
 *
 * With a context time zone, because the source formats a date in it and a set that does is refused
 * where the application configured none.
 */
export function richStore(
  set: CompiledSet,
  loaders: Record<string, () => unknown>,
): LocalCatalogStore {
  return new LocalCatalogStore(
    set.configuration,
    set.descriptor,
    loaders,
    undefined,
    true,
  );
}

/** The failure loading the sealed catalog ends in, or `undefined` when it was admitted. */
export async function admissionFailure(
  { set, loaders }: Pick<SealedCatalog, 'set' | 'loaders'>,
  load: (store: LocalCatalogStore) => Promise<unknown> = (store) =>
    store.preload(scope('shell'), 'en-US', new AbortController().signal),
): Promise<unknown> {
  const store = richStore(set, loaders);
  try {
    await load(store);
  } catch (error) {
    return error;
  }
  return undefined;
}

/** The diagnostic loading the sealed catalog is refused with, or `undefined` when it was admitted. */
export function admission(
  candidate: Pick<SealedCatalog, 'set' | 'loaders'>,
): Promise<LocalizationDiagnostic | undefined> {
  return rejectionOf(async () => {
    const failure = await admissionFailure(candidate);
    if (failure !== undefined) throw failure;
  });
}
