/**
 * Renaming or moving a message everywhere it is named, in one commit.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 17 requires resolved identities and semantic
 * analysis rather than a textual replacement, a preview of every affected file, and one
 * transactional commit, because a rename that half-lands leaves a project whose catalogs and
 * whose source disagree about what a message is called.
 */

import { requireArgument, type ArgumentShape } from './call-arguments.js';
import type { Catalog, CatalogMessage } from './catalog.js';
import { admitCatalogs, catalogText } from './catalog.js';
import {
  createAuthoredChangePlan,
  type AuthoredChangePlan,
  type AuthoredFileChangeInput,
} from './authoring-transaction.js';
import {
  toolkitDiagnostic,
  toolkitFailure,
  toolkitSuccess,
  type ToolkitResult,
} from './diagnostics.js';
import { parseMessageId, parseProviderId, parseScopeId } from './identities.js';
import type {
  AnalysisSource,
  ApplicationAnalysis,
  MessageUsage,
} from './static-analysis.js';
import { compareCodeUnit } from './sorted-records.js';

/** Where a message lives, as the three parts that identify it. */
export interface MessageRefactorIdentity {
  /** The package that owns it. */
  readonly providerId: string;
  /** The scope within that package. */
  readonly scopeId: string;
  /** Its key within that scope. */
  readonly messageId: string;
}

/** What moving a message needs: where it is, where it should be, and everything that names it. */
export interface MessageRefactorRequest {
  /** Where the message is now. Must exist. */
  readonly from: MessageRefactorIdentity;
  /** Where it should end up. Must not already be taken. */
  readonly to: MessageRefactorIdentity;
  /** Every catalog the message appears in, across all its locales. */
  readonly catalogs: readonly Catalog[];
  /**
   * The message usages, and nothing else the analysis knows.
   *
   * A refactor reads one field: where the message being moved is named. Asking for the whole
   * `ApplicationAnalysis` made a caller build six required fields to have one of them read,
   * and tied this signature to a type that grows: every field the analysis gains is a field a
   * caller of this function would have to invent. `Pick` says what is used, and a caller holding a
   * real analysis still passes it unchanged.
   */
  readonly analysis: Pick<ApplicationAnalysis, 'messageUsages'>;
  /** The text of the files those usages are in, so a rename can be worked out over them. */
  readonly sources: readonly AnalysisSource[];
}

/** A rename written down: every catalog and every call site the move touches, and nothing applied. */
export interface MessageRefactorPlan extends AuthoredChangePlan {
  readonly kind: 'refactor';
  /** The full identity being moved from, as one string. */
  readonly fromIdentity: string;
  /** The full identity being moved to. */
  readonly toIdentity: string;
  /** How many call sites this rewrites, which is worth seeing before applying it. */
  readonly affectedUsages: number;
}

function fullIdentity(identity: MessageRefactorIdentity): string {
  return `${identity.providerId}:${identity.scopeId}:${identity.messageId}`;
}

function projectPart(part: string): string {
  return part.replace(/-([a-z0-9])/gu, (_match, character: string) =>
    character.toUpperCase(),
  );
}

function projectedPath(messageId: string): string {
  return messageId.split('.').map(projectPart).join('.');
}

function conventionalCatalogPath(scopeId: string, locale: string): string {
  return `i18n/${scopeId}/${locale}.yaml`;
}

function catalogKey(
  catalog: Pick<Catalog, 'providerId' | 'scopeId' | 'locale'>,
): string {
  return `${catalog.providerId}\u0000${catalog.scopeId}\u0000${catalog.locale}`;
}

function catalogPath(catalog: Catalog): string {
  return (
    catalog.sourcePath ??
    conventionalCatalogPath(catalog.scopeId, catalog.locale)
  );
}

function sourceForPath(
  sources: readonly AnalysisSource[],
  path: string,
): AnalysisSource | undefined {
  const normalized = path.replaceAll('\\', '/');
  return sources.find((source) => {
    const candidate = source.path.replaceAll('\\', '/');
    return candidate === normalized || candidate.endsWith(`/${normalized}`);
  });
}

function rewriteUsage(
  source: string,
  usage: MessageUsage,
  fromMessageId: string,
  toMessageId: string,
): string | undefined {
  if (
    usage.start < 0 ||
    usage.end <= usage.start ||
    usage.end > source.length
  ) {
    return undefined;
  }
  const value = source.slice(usage.start, usage.end);
  const prior = projectedPath(fromMessageId);
  const next = projectedPath(toMessageId);
  if (value === prior) return next;
  if (value.endsWith(`.${prior}`)) {
    return `${value.slice(0, -prior.length)}${next}`;
  }
  return undefined;
}

function changedSourceFiles(
  request: MessageRefactorRequest,
  fromIdentity: string,
): ToolkitResult<readonly AuthoredFileChangeInput[]> {
  const byPath = new Map<string, MessageUsage[]>();
  for (const usage of request.analysis.messageUsages) {
    if (usage.identity !== fromIdentity) continue;
    const items = byPath.get(usage.sourcePath) ?? [];
    items.push(usage);
    byPath.set(usage.sourcePath, items);
  }
  const changes: AuthoredFileChangeInput[] = [];
  for (const [path, usages] of [...byPath.entries()].sort(([left], [right]) =>
    compareCodeUnit(left, right),
  )) {
    const source = sourceForPath(request.sources, path);
    if (source === undefined) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1805',
          `Semantic refactor cannot read analyzed source ${JSON.stringify(path)}.`,
        ),
      ]);
    }
    let contents = source.contents;
    for (const usage of [...usages].sort(
      (left, right) => right.start - left.start,
    )) {
      const replacement = rewriteUsage(
        source.contents,
        usage,
        request.from.messageId,
        request.to.messageId,
      );
      if (replacement === undefined) {
        return toolkitFailure([
          toolkitDiagnostic(
            'EQ1805',
            `Semantic refactor could not safely rewrite an analyzed ${usage.surface} handle.`,
            { path: ['sources', path] },
          ),
        ]);
      }
      contents = `${contents.slice(0, usage.start)}${replacement}${contents.slice(usage.end)}`;
    }
    changes.push({ path, before: source.contents, after: contents });
  }
  return toolkitSuccess(Object.freeze(changes));
}

function cloneCatalog(
  catalog: Catalog,
  messages: Readonly<Record<string, CatalogMessage>>,
  sourcePath?: string,
): Catalog {
  return Object.freeze({
    role: catalog.role,
    providerId: catalog.providerId,
    scopeId: catalog.scopeId,
    locale: catalog.locale,
    ...((sourcePath ?? catalog.sourcePath) === undefined
      ? {}
      : { sourcePath: sourcePath ?? catalog.sourcePath }),
    messages: Object.freeze(messages),
    families: catalog.families,
  });
}

function changedCatalogFiles(
  request: MessageRefactorRequest,
): ToolkitResult<readonly AuthoredFileChangeInput[]> {
  const catalogs = new Map(
    request.catalogs.map((catalog) => [catalogKey(catalog), catalog]),
  );
  const beforeByPath = new Map(
    request.catalogs.map((catalog) => [
      catalogPath(catalog),
      catalogText(catalog),
    ]),
  );
  const touched = new Set<string>();
  let found = false;

  for (const sourceCatalog of request.catalogs.filter(
    (catalog) =>
      catalog.providerId === request.from.providerId &&
      catalog.scopeId === request.from.scopeId &&
      catalog.messages[request.from.messageId] !== undefined,
  )) {
    found = true;
    const sourceKey = catalogKey(sourceCatalog);
    const currentSource = catalogs.get(sourceKey) as Catalog;
    const sourceMessages: Record<string, CatalogMessage> = Object.create(
      null,
    ) as Record<string, CatalogMessage>;
    Object.assign(sourceMessages, currentSource.messages);
    const moved = sourceMessages[request.from.messageId] as CatalogMessage;
    delete sourceMessages[request.from.messageId];

    if (request.from.scopeId === request.to.scopeId) {
      if (sourceMessages[request.to.messageId] !== undefined) {
        return toolkitFailure([
          toolkitDiagnostic(
            'EQ1805',
            'Semantic refactor destination message already exists.',
          ),
        ]);
      }
      sourceMessages[request.to.messageId] = moved;
      catalogs.set(sourceKey, cloneCatalog(currentSource, sourceMessages));
      touched.add(catalogPath(currentSource));
      continue;
    }

    if (Object.keys(sourceMessages).length === 0) {
      catalogs.delete(sourceKey);
    } else {
      catalogs.set(sourceKey, cloneCatalog(currentSource, sourceMessages));
    }
    touched.add(catalogPath(currentSource));

    const destinationKey = `${request.to.providerId}\u0000${request.to.scopeId}\u0000${currentSource.locale}`;
    const destination = catalogs.get(destinationKey);
    const destinationPath =
      destination === undefined
        ? conventionalCatalogPath(request.to.scopeId, currentSource.locale)
        : catalogPath(destination);
    const destinationMessages: Record<string, CatalogMessage> = Object.create(
      null,
    ) as Record<string, CatalogMessage>;
    if (destination !== undefined)
      Object.assign(destinationMessages, destination.messages);
    if (destinationMessages[request.to.messageId] !== undefined) {
      return toolkitFailure([
        toolkitDiagnostic(
          'EQ1805',
          'Semantic move destination message already exists.',
        ),
      ]);
    }
    destinationMessages[request.to.messageId] = moved;
    const destinationCatalog =
      destination ??
      Object.freeze({
        role: currentSource.role,
        providerId: currentSource.providerId,
        scopeId: request.to.scopeId as Catalog['scopeId'],
        locale: currentSource.locale,
        sourcePath: destinationPath,
        messages: Object.freeze({}),
        families: Object.freeze({}),
      });
    catalogs.set(
      destinationKey,
      cloneCatalog(destinationCatalog, destinationMessages, destinationPath),
    );
    touched.add(destinationPath);
  }
  if (!found) {
    return toolkitFailure([
      toolkitDiagnostic(
        'EQ1805',
        'Semantic refactor source message is unavailable.',
      ),
    ]);
  }

  const afterByPath = new Map<string, string>();
  for (const catalog of catalogs.values()) {
    afterByPath.set(catalogPath(catalog), catalogText(catalog));
  }
  const changes = [...touched].sort(compareCodeUnit).map((path) => ({
    path,
    ...(beforeByPath.get(path) === undefined
      ? {}
      : { before: beforeByPath.get(path) as string }),
    ...(afterByPath.get(path) === undefined
      ? {}
      : { after: afterByPath.get(path) as string }),
  }));
  return toolkitSuccess(Object.freeze(changes));
}

const IDENTITY_ARGUMENT: ArgumentShape = {
  required: { providerId: 'text', scopeId: 'text', messageId: 'text' },
};

/**
 * Works out everything a message rename touches, and writes nothing.
 *
 * Rewrites the message in every catalog that holds it, in every locale, and rewrites every place
 * the application names it. Returns a rename plan, or the reasons it could not be made.
 *
 * Fails for an identity that is malformed, a source message that does not exist, and a destination
 * that is already taken. Applying a rename plan is a separate step, and it is refused there if a
 * file it expects has changed since.
 */
export function planMessageRefactor(
  request: MessageRefactorRequest,
): ToolkitResult<MessageRefactorPlan> {
  requireArgument('planMessageRefactor', 'request', request, {
    required: {
      from: IDENTITY_ARGUMENT,
      to: IDENTITY_ARGUMENT,
      catalogs: ['record'],
      analysis: { required: { messageUsages: ['record'] } },
      sources: [{ required: { path: 'text', contents: 'text' } }],
    },
  });
  const catalogs = admitCatalogs(request.catalogs);
  if (!catalogs.ok) return catalogs;
  return planAdmittedMessageRefactor({ ...request, catalogs: catalogs.value });
}

function planAdmittedMessageRefactor(
  request: MessageRefactorRequest,
): ToolkitResult<MessageRefactorPlan> {
  const providerFrom = parseProviderId(request.from.providerId);
  const providerTo = parseProviderId(request.to.providerId);
  const scopeFrom = parseScopeId(request.from.scopeId);
  const scopeTo = parseScopeId(request.to.scopeId);
  const messageFrom = parseMessageId(request.from.messageId);
  const messageTo = parseMessageId(request.to.messageId);
  const identityDiagnostics = [
    ...providerFrom.diagnostics,
    ...providerTo.diagnostics,
    ...scopeFrom.diagnostics,
    ...scopeTo.diagnostics,
    ...messageFrom.diagnostics,
    ...messageTo.diagnostics,
  ];
  if (
    !providerFrom.ok ||
    !providerTo.ok ||
    !scopeFrom.ok ||
    !scopeTo.ok ||
    !messageFrom.ok ||
    !messageTo.ok ||
    request.from.providerId !== request.to.providerId ||
    fullIdentity(request.from) === fullIdentity(request.to)
  ) {
    return toolkitFailure([
      ...identityDiagnostics,
      toolkitDiagnostic(
        'EQ1805',
        'Version 1 semantic refactors require distinct identities within one application-local provider.',
      ),
    ]);
  }
  const fromIdentity = fullIdentity(request.from);
  const toIdentity = fullIdentity(request.to);
  const catalogs = changedCatalogFiles(request);
  if (!catalogs.ok) return catalogs;
  const sources = changedSourceFiles(request, fromIdentity);
  if (!sources.ok) return sources;
  const base = createAuthoredChangePlan(
    `message-refactor/${request.from.scopeId}-to-${request.to.scopeId}`,
    'refactor',
    [...catalogs.value, ...sources.value],
  );
  if (!base.ok) return base;
  return toolkitSuccess(
    Object.freeze({
      ...base.value,
      kind: 'refactor',
      fromIdentity,
      toIdentity,
      affectedUsages: request.analysis.messageUsages.filter(
        ({ identity }) => identity === fromIdentity,
      ).length,
    }),
    [...identityDiagnostics, ...base.diagnostics],
  );
}
