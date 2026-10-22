import {
  EXTENSION_REGISTRY_ARGUMENT,
  requireArgument,
  type ArgumentShape,
} from './call-arguments.js';
import { admitCatalogs, type Catalog } from './catalog.js';
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from './canonical-json.js';
import {
  admitConfiguration,
  type ProjectConfiguration,
} from './configuration.js';
import {
  toolkitFailure,
  toolkitSuccess,
  type ToolkitResult,
} from './diagnostics.js';
import type { ExtensionRegistry } from './extensions.js';
import {
  analyzeCatalogSet,
  type SemanticGraph,
  type SemanticMessage,
} from './semantic-model.js';
import { compareCodeUnit } from './sorted-records.js';

/**
 * What happened to one message between two versions of a project.
 *
 * Seven cases rather than added, removed and changed, because a translation team needs to tell them
 * apart: a changed source invalidates every translation of it, a changed translation invalidates
 * nothing, and a changed contract is a code change as well as a wording one.
 */
export type CatalogDiffKind =
  | 'added'
  | 'removed'
  | 'identity-contract-changed'
  | 'source-changed'
  | 'translation-changed'
  | 'stale-source'
  | 'fallback-impact';

/** One side of a comparison: a project's configuration and its catalogs at one moment. */
export interface CatalogDiffSnapshot {
  /** The configuration in force, which is what says which locales are expected. */
  readonly configuration: ProjectConfiguration;
  /** The catalogs as they stood. */
  readonly catalogs: readonly Catalog[];
  /**
   * The extension registry in force, when the catalogs name anything from one.
   *
   * A segment type, a slot kind or a message function is known only through the registry, so a
   * snapshot whose catalogs use one is refused without it, as a compilation is.
   */
  readonly extensions?: ExtensionRegistry;
}

/**
 * A message that was renamed, stated so the comparison does not read it as a deletion and an
 * addition.
 *
 * Without it a rename throws away every translation of the message, because nothing in the two
 * snapshots says the new identity is the old one under another name.
 */
export interface CatalogIdentityMove {
  /** What it was called before. Must exist in the earlier snapshot. */
  readonly from: string;
  /** What it is called now. Must exist in the later one. */
  readonly to: string;
}

/** What to compare: two snapshots, and any renames between them. */
export interface CatalogDiffRequest {
  /** The earlier state. */
  readonly before: CatalogDiffSnapshot;
  /** The later state. */
  readonly after: CatalogDiffSnapshot;
  /**
   * The messages that were renamed rather than replaced.
   *
   * Each identity may appear once on each side. A move naming something absent from its snapshot
   * fails the comparison rather than being ignored.
   */
  readonly identityMoves?: readonly CatalogIdentityMove[];
}

/** One thing that changed, and enough about it to act on without reading the catalogs again. */
export interface CatalogDiffEntry {
  /** What happened. */
  readonly kind: CatalogDiffKind;
  /** Which message, by its identity in the later snapshot. */
  readonly identity: string;
  /** What it was called before, on an entry that came from a rename. */
  readonly previousIdentity?: string;
  /** Which locale, on a change that is to one locale rather than to the message. */
  readonly locale?: string;
  /** A digest of what it was, absent when it did not exist before. */
  readonly beforeFingerprint?: string;
  /** A digest of what it is, absent when it no longer exists. */
  readonly afterFingerprint?: string;
}

/** Everything that changed between two snapshots, in a stable order. */
export interface CatalogDiff {
  /** The shape's version stamp. */
  readonly profile: 'equator-semantic-catalog-diff/1';
  /** The changes, sorted, so two runs over the same pair produce the same list. */
  readonly entries: readonly CatalogDiffEntry[];
  /** A digest of the whole comparison, for recognizing one that has already been acted on. */
  readonly digest: string;
}

function messageMap(
  graph: SemanticGraph,
): ReadonlyMap<string, SemanticMessage> {
  return new Map(
    graph.scopes.flatMap((scope) =>
      scope.messages.map((message) => [message.identity, message] as const),
    ),
  );
}

function contractFingerprint(message: SemanticMessage): string {
  return digestCanonicalJson('equator-message-contract/1', {
    resultKind: message.resultKind,
    inputs: message.inputs as unknown as CanonicalJsonValue,
    slots: message.slots as unknown as CanonicalJsonValue,
  });
}

function catalogMessageFingerprint(
  snapshot: CatalogDiffSnapshot,
  identity: string,
  locale: string,
): string | undefined {
  const [providerId, scopeId, messageId, ...remaining] = identity.split(':');
  if (
    providerId === undefined ||
    scopeId === undefined ||
    messageId === undefined ||
    remaining.length > 0
  ) {
    return undefined;
  }
  const message = snapshot.catalogs.find(
    (catalog) =>
      catalog.providerId === providerId &&
      catalog.scopeId === scopeId &&
      catalog.locale === locale,
  )?.messages[messageId];
  if (message === undefined) return undefined;
  return digestCanonicalJson('equator-translation-view/1', {
    kind: message.kind,
    source:
      message.kind === 'message' ? message.semantics.canonicalSource : null,
  });
}

function entryKey(entry: CatalogDiffEntry): string {
  return `${entry.identity}\u0000${entry.previousIdentity ?? ''}\u0000${entry.locale ?? ''}\u0000${entry.kind}`;
}

function addEntry(
  entries: Map<string, CatalogDiffEntry>,
  entry: CatalogDiffEntry,
): void {
  entries.set(entryKey(entry), Object.freeze(entry));
}

const SNAPSHOT_ARGUMENT: ArgumentShape = {
  required: { configuration: 'record', catalogs: ['record'] },
  optional: { extensions: EXTENSION_REGISTRY_ARGUMENT },
};

/** One snapshot with its configuration and its catalogs judged as their parsers judge them. */
function admitSnapshot(
  snapshot: CatalogDiffSnapshot,
): ToolkitResult<CatalogDiffSnapshot> {
  const configuration = admitConfiguration(snapshot.configuration);
  const catalogs = admitCatalogs(snapshot.catalogs, {
    extensions: snapshot.extensions,
  });
  if (!configuration.ok || !catalogs.ok) {
    return toolkitFailure([
      ...configuration.diagnostics,
      ...catalogs.diagnostics,
    ]);
  }
  return toolkitSuccess(
    Object.freeze({
      ...snapshot,
      configuration: configuration.value,
      catalogs: catalogs.value,
    }),
  );
}

/**
 * Compares two states of a project and says what a translation team has to do about it.
 *
 * Analyses both snapshots and compares them by message rather than by file, so a message that moved
 * between scopes is one entry rather than two and a reformatted catalog produces none at all.
 *
 * Returns the changes and a digest of them, or the reasons either snapshot could not be analysed.
 * A rename must be declared through `identityMoves`; without that it reads as a deletion and an
 * addition, which throws away the translations.
 */
export function diffCatalogSets(
  request: CatalogDiffRequest,
): ToolkitResult<CatalogDiff> {
  requireArgument('diffCatalogSets', 'request', request, {
    required: { before: SNAPSHOT_ARGUMENT, after: SNAPSHOT_ARGUMENT },
    optional: {
      identityMoves: [{ required: { from: 'text', to: 'text' } }],
    },
  });
  const admittedBefore = admitSnapshot(request.before);
  const admittedAfter = admitSnapshot(request.after);
  if (!admittedBefore.ok || !admittedAfter.ok) {
    return toolkitFailure([
      ...admittedBefore.diagnostics,
      ...admittedAfter.diagnostics,
    ]);
  }
  const before = analyzeCatalogSet(admittedBefore.value);
  const after = analyzeCatalogSet(admittedAfter.value);
  const diagnostics = [...before.diagnostics, ...after.diagnostics];
  if (!before.ok || !after.ok) return toolkitFailure(diagnostics);

  const beforeMessages = messageMap(before.value);
  const afterMessages = messageMap(after.value);
  const moves = new Map<string, string>();
  const reverseMoves = new Map<string, string>();
  for (const move of request.identityMoves ?? []) {
    if (
      moves.has(move.from) ||
      reverseMoves.has(move.to) ||
      !beforeMessages.has(move.from) ||
      !afterMessages.has(move.to)
    ) {
      return toolkitFailure([
        ...diagnostics,
        {
          code: 'EQ1805',
          severity: 'error',
          summary:
            'Semantic catalog diff received an ambiguous or unavailable identity move.',
          path: Object.freeze(['identityMoves']),
        },
      ]);
    }
    moves.set(move.from, move.to);
    reverseMoves.set(move.to, move.from);
  }

  const entries = new Map<string, CatalogDiffEntry>();
  const identities = new Set([
    ...beforeMessages.keys(),
    ...afterMessages.keys(),
  ]);
  for (const identity of [...identities].sort(compareCodeUnit)) {
    if (moves.has(identity) || reverseMoves.has(identity)) continue;
    const prior = beforeMessages.get(identity);
    const current = afterMessages.get(identity);
    if (prior === undefined && current !== undefined) {
      addEntry(entries, {
        kind: 'added',
        identity,
        afterFingerprint: current.sourceFingerprint,
      });
    } else if (prior !== undefined && current === undefined) {
      addEntry(entries, {
        kind: 'removed',
        identity,
        beforeFingerprint: prior.sourceFingerprint,
      });
    }
  }

  const pairs: Array<{
    readonly beforeIdentity: string;
    readonly afterIdentity: string;
    readonly moved: boolean;
  }> = [];
  for (const identity of [...beforeMessages.keys()].sort(compareCodeUnit)) {
    const target = moves.get(identity) ?? identity;
    if (afterMessages.has(target)) {
      pairs.push({
        beforeIdentity: identity,
        afterIdentity: target,
        moved: target !== identity,
      });
    }
  }

  for (const pair of pairs) {
    const prior = beforeMessages.get(pair.beforeIdentity) as SemanticMessage;
    const current = afterMessages.get(pair.afterIdentity) as SemanticMessage;
    const priorContract = contractFingerprint(prior);
    const currentContract = contractFingerprint(current);
    if (pair.moved || priorContract !== currentContract) {
      addEntry(entries, {
        kind: 'identity-contract-changed',
        identity: pair.afterIdentity,
        ...(pair.moved ? { previousIdentity: pair.beforeIdentity } : {}),
        beforeFingerprint: priorContract,
        afterFingerprint: currentContract,
      });
    }
    const sourceChanged = prior.sourceFingerprint !== current.sourceFingerprint;
    if (sourceChanged) {
      addEntry(entries, {
        kind: 'source-changed',
        identity: pair.afterIdentity,
        ...(pair.moved ? { previousIdentity: pair.beforeIdentity } : {}),
        beforeFingerprint: prior.sourceFingerprint,
        afterFingerprint: current.sourceFingerprint,
      });
    }
    const locales = new Set([
      ...request.before.configuration.locales,
      ...request.after.configuration.locales,
    ]);
    locales.delete(request.before.configuration.sourceLocale);
    locales.delete(request.after.configuration.sourceLocale);
    for (const locale of [...locales].sort(compareCodeUnit)) {
      const priorTarget = catalogMessageFingerprint(
        request.before,
        pair.beforeIdentity,
        locale,
      );
      const currentTarget = catalogMessageFingerprint(
        request.after,
        pair.afterIdentity,
        locale,
      );
      if (priorTarget !== currentTarget) {
        addEntry(entries, {
          kind: 'translation-changed',
          identity: pair.afterIdentity,
          ...(pair.moved ? { previousIdentity: pair.beforeIdentity } : {}),
          locale,
          ...(priorTarget === undefined
            ? {}
            : { beforeFingerprint: priorTarget }),
          ...(currentTarget === undefined
            ? {}
            : { afterFingerprint: currentTarget }),
        });
      }
      if (
        sourceChanged &&
        priorTarget !== undefined &&
        priorTarget === currentTarget
      ) {
        addEntry(entries, {
          kind: 'stale-source',
          identity: pair.afterIdentity,
          ...(pair.moved ? { previousIdentity: pair.beforeIdentity } : {}),
          locale,
          beforeFingerprint: priorTarget,
          afterFingerprint: currentTarget,
        });
      }
      if (priorTarget === undefined || currentTarget === undefined) {
        addEntry(entries, {
          kind: 'fallback-impact',
          identity: pair.afterIdentity,
          ...(pair.moved ? { previousIdentity: pair.beforeIdentity } : {}),
          locale,
          ...(priorTarget === undefined
            ? {}
            : { beforeFingerprint: priorTarget }),
          ...(currentTarget === undefined
            ? {}
            : { afterFingerprint: currentTarget }),
        });
      }
    }
  }
  const ordered = [...entries.values()].sort((left, right) =>
    compareCodeUnit(entryKey(left), entryKey(right)),
  );
  const digest = digestCanonicalJson(
    'equator-semantic-catalog-diff/1',
    ordered as unknown as CanonicalJsonValue,
  );
  return toolkitSuccess(
    Object.freeze({
      profile: 'equator-semantic-catalog-diff/1',
      entries: Object.freeze(ordered),
      digest,
    }),
    diagnostics,
  );
}
