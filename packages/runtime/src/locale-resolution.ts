/**
 * Where the locale of a first request comes from, and where a chosen locale is remembered.
 *
 * *Why these four are a module.* `resolveInitialLocale` walks the configured sources in order and
 * `readPersistedLocale` is one of those sources; `persistLocale` is what writes what that source
 * later reads. They are the only code that ever touched the two fields below, a high-water mark
 * and a serializing queue, which is what makes this a piece of state with a boundary rather than
 * four methods that happen to be adjacent.
 *
 * *It resolves and remembers; it does not switch.* Nothing here reads the active snapshot or knows a
 * transaction exists. `resolveInitialLocale` answers a question and the caller decides what to do
 * with the answer, which is why this could move while the switching operation stayed put.
 *
 * *The context is written out rather than passed as the options bag.* Locale resolution genuinely
 * consults five sources, so the list is long; a list is still narrower than a bag, and adding a
 * source costs one field here instead of a dependency on everything the runtime happens to carry.
 */

import {
  type LocaleUrlPolicy,
  type LocalizationSnapshot,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';
import { negotiateLocale } from '@neolorn/equator/core';
import {
  type LocalizationEventEmitter,
  RUNTIME_EVENT_CODES,
} from './observability';
import {
  type LocaleRemovalReport,
  type LocalizationPersistenceStore,
  type UnreachedLocaleStore,
} from './persistence';
import { asDiagnostic, waitForSignal } from './runtime-safety';

/**
 * Where the locale of a first request may come from.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 7 names four and gives their default
 * order, and it lets a consumer omit any of them or state another order. Explicit selection is not
 * among them because it is not consulted: `changeLocale` is a decision already taken rather than
 * a preference to be weighed against the others.
 */
export type LocalizationLocaleSource = 'url' | 'stored' | 'browser' | 'default';

/**
 * What reading a locale out of an address needs, which is the rule and the table together.
 *
 * Both or neither. A policy without a table has nothing to match a translated path against, and a
 * table without a policy has no statement of where in the address the locale sits.
 *
 * `withRouting()` takes these two as the required part of its options.
 */
export interface LocaleUrlResolutionSetup {
  /**
   * Where the locale lives in an address: a leading path segment, a host, or nowhere.
   *
   * The one routing decision that shows in every URL the application emits, so it belongs to the
   * deployment rather than to the generated table.
   */
  readonly policy: LocaleUrlPolicy;
  /**
   * The route projection the address is matched against, passed rather than restated.
   *
   * Carries the translated spellings of each route, the codecs for their parameters and the
   * outcomes of addresses that no longer exist, which is what lets an address written in one locale
   * resolve to the route it names rather than to nothing.
   *
   * One object, referenced wherever it is needed: `localizedServerRoutes()` takes this same value,
   * so the server route table and the runtime are never handed two copies that could differ.
   */
  readonly projection: RouteRuntimeProjection;
}

/**
 * The order used when a consumer declares none.
 *
 * The URL first because it is the only source that is a statement rather than a preference: a
 * shared link must open in the language it names. Then what this visitor chose before, then what
 * their client asked for, then the configured default.
 */
const DEFAULT_LOCALE_SOURCES: readonly LocalizationLocaleSource[] =
  Object.freeze(['url', 'stored', 'browser', 'default']);

/** The locale an address states, or nothing when it states none. */
export type LocaleFromAddress = (requestContext: unknown) => string | undefined;

/** Everything locale resolution consults, and nothing else. */
export interface LocaleResolutionContext {
  readonly persistence: readonly LocalizationPersistenceStore[] | undefined;
  readonly initialLocale: string | undefined;
  readonly requestContext: unknown;
  readonly preferredLanguages: readonly string[] | undefined;
  // A function rather than the policy and projection, so this module reaches no route resolution
  // code: `withRouting()` supplies it, and an application without routing ships none.
  readonly localeFromAddress: LocaleFromAddress | undefined;
  readonly localeSources: readonly LocalizationLocaleSource[] | undefined;
  readonly defaultLocale: string;
  readonly localeList: readonly string[];
  readonly supportedLocales: ReadonlySet<string>;
  readonly seeded: Promise<void>;
  readonly canonicalLocale: (locale: string) => string;
  readonly observability: LocalizationEventEmitter | undefined;
}

export class LocaleResolution {
  private persistenceHighWater = 0;
  private persistenceQueue: Promise<void> = Promise.resolve();

  constructor(private readonly context: LocaleResolutionContext) {}

  /**
   * The remembered locale, if any store still has one worth believing.
   *
   * Stores are read in the order the consumer declared, and the first believable answer wins:
   * `specs/03-locale-identity-and-resolution.spec.md` section 8 gives the consumer the authority
   * order, so Equator does not reorder it or merge answers. A value is believable only if it still
   * canonicalizes and is still a locale this application offers: a preference for a language that
   * was removed last release is stale, and restoring it would render an interface nobody can
   * supply.
   */
  async readPersistedLocale(signal: AbortSignal): Promise<string | undefined> {
    for (const store of this.context.persistence ?? []) {
      let stored: string | undefined;
      try {
        stored = await waitForSignal(Promise.resolve(store.read()), signal);
      } catch (error: unknown) {
        this.context.observability?.emit({
          code: RUNTIME_EVENT_CODES.persistence,
          phase: 'persistence',
          status: 'failed',
          reason: asDiagnostic(error).code,
          correlationId: store.id,
        });
        continue;
      }
      if (stored === undefined) continue;
      let canonical: string;
      try {
        canonical = this.context.canonicalLocale(stored);
      } catch {
        // Malformed rather than merely unknown. Excluded with a bounded diagnostic, never echoed:
        // the value came from a cookie, which is to say from the client.
        this.context.observability?.emit({
          code: RUNTIME_EVENT_CODES.persistence,
          phase: 'persistence',
          status: 'unavailable',
          reason: 'unsupported-locale',
          correlationId: store.id,
        });
        continue;
      }
      if (!this.context.supportedLocales.has(canonical)) {
        this.context.observability?.emit({
          code: RUNTIME_EVENT_CODES.persistence,
          phase: 'persistence',
          status: 'unavailable',
          reason: 'unsupported-locale',
          targetLocale: canonical,
          correlationId: store.id,
        });
        continue;
      }
      return canonical;
    }
    return undefined;
  }

  /**
   * Remember a deliberate choice, after the commit that made it real.
   *
   * Three rules, and they are the reason this lives here rather than in each store.
   *
   * It runs after a successful commit, so a transition that failed or was superseded leaves no
   * trace to restore on the next visit. It never throws into the caller:
   * `specs/06-runtime-and-angular.spec.md` section 11 reports a persistence failure without
   * rolling back an otherwise valid locale, and a locale
   * that changed correctly but was not remembered is a smaller failure than one that was rolled
   * back for it. And an older write can never overwrite a newer selection, because with
   * asynchronous stores a slow write for an abandoned choice would otherwise land last and win.
   */
  persistLocale(
    snapshot: LocalizationSnapshot,
    previousLocale: string | undefined,
  ): void {
    const stores = this.context.persistence ?? [];
    // A locale that did not change is not a choice to remember. The Router adapter runs a
    // transaction for every navigation, including navigations that stay in the same language, and
    // writing on each of them would mean an HTTP call per page view for a profile store.
    if (previousLocale === snapshot.primaryLocale) return;
    if (stores.length === 0 || snapshot.id <= this.persistenceHighWater) return;
    this.persistenceHighWater = snapshot.id;
    const snapshotId = snapshot.id;
    const locale = snapshot.primaryLocale;
    this.persistenceQueue = this.persistenceQueue.then(async () => {
      for (const store of stores) {
        // Checked before every write, not once at the top: a newer choice can arrive while an
        // earlier store is still being written, and the remaining stores then belong to the newer
        // write, which is already queued behind this one and will reach all of them. Checking only
        // at the top would also miss the common case entirely, since a queued write is usually
        // superseded while it waits rather than before it starts.
        if (snapshotId < this.persistenceHighWater) {
          this.context.observability?.emit({
            code: RUNTIME_EVENT_CODES.persistence,
            phase: 'persistence',
            status: 'superseded',
            targetLocale: locale,
            snapshotId,
          });
          return;
        }
        try {
          await store.write(locale);
          this.context.observability?.emit({
            code: RUNTIME_EVENT_CODES.persistence,
            phase: 'persistence',
            status: 'succeeded',
            targetLocale: locale,
            correlationId: store.id,
            snapshotId,
          });
        } catch (error: unknown) {
          this.context.observability?.emit({
            code: RUNTIME_EVENT_CODES.persistence,
            phase: 'persistence',
            status: 'failed',
            reason: asDiagnostic(error).code,
            targetLocale: locale,
            correlationId: store.id,
            snapshotId,
          });
        }
      }
    });
  }

  /**
   * Drops the remembered choice from every configured store, and says where it did not land.
   *
   * Queued behind whatever writes are already in flight rather than run beside them. A write that
   * was queued when this was called is a choice made before it, and letting the two race would
   * leave the store holding a value the reader has just asked to be rid of.
   *
   * `specs/03-locale-identity-and-resolution.spec.md` section 8 makes removal optional on the port
   * and requires a store that offers none to count as one the removal did not reach: a value
   * dropped from one store and still held by another is read back at the next visit, so a removal
   * reported as complete while any store still holds it leaves the choice in force.
   */
  forgetPersistedLocale(): Promise<LocaleRemovalReport> {
    const stores = this.context.persistence ?? [];
    const removal = this.persistenceQueue.then(async () => {
      const unreached: UnreachedLocaleStore[] = [];
      for (const store of stores) {
        const forget = store.forget?.bind(store);
        if (forget === undefined) {
          unreached.push(
            Object.freeze({ storeId: store.id, reason: 'no-removal' as const }),
          );
          // No `reason`: the store did not fail, it has nothing to fail with.
          this.context.observability?.emit({
            code: RUNTIME_EVENT_CODES.persistence,
            phase: 'persistence',
            status: 'unavailable',
            correlationId: store.id,
          });
          continue;
        }
        try {
          await forget();
          this.context.observability?.emit({
            code: RUNTIME_EVENT_CODES.persistence,
            phase: 'persistence',
            status: 'succeeded',
            correlationId: store.id,
          });
        } catch (error: unknown) {
          unreached.push(
            Object.freeze({ storeId: store.id, reason: 'failed' as const }),
          );
          this.context.observability?.emit({
            code: RUNTIME_EVENT_CODES.persistence,
            phase: 'persistence',
            status: 'failed',
            reason: asDiagnostic(error).code,
            correlationId: store.id,
          });
        }
      }
      return Object.freeze({
        complete: unreached.length === 0,
        unreached: Object.freeze(unreached),
      });
    });
    this.persistenceQueue = removal.then(
      () => undefined,
      () => undefined,
    );
    return removal;
  }

  /**
   * The stored locale, where a page shown without reading the stores should now be in it.
   *
   * A restored page comes back from memory without asking the server, so it shows the language it
   * had when the visitor left, whatever was chosen since. A page the server drew was decided
   * without the stores only the browser can read. Either way the stored choice is the one thing
   * that can differ. It applies only where the configured sources, run against the address the
   * page is at, would choose it now: an address that states its locale still decides, so only a
   * page whose address states none moves.
   */
  async restoredLocale(
    committed: string,
    // The address the page is at now, which a client navigation may have moved since setup read it.
    address: { readonly url: string; readonly origin?: string },
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const stored = await this.readPersistedLocale(signal);
    if (stored === undefined || stored === committed) return undefined;
    for (const source of this.sourceOrder) {
      const resolved =
        source === 'stored'
          ? stored
          : await this.resolveLocaleSource(source, signal, address);
      if (resolved !== undefined) {
        return resolved === stored ? stored : undefined;
      }
    }
    return undefined;
  }

  /**
   * The sources in the order the application declared, or the default order.
   *
   * One definition for every walk, so a restored page is asked about in the order its first request
   * was.
   */
  private get sourceOrder(): readonly LocalizationLocaleSource[] {
    return this.context.localeSources ?? DEFAULT_LOCALE_SOURCES;
  }

  async resolveInitialLocale(signal: AbortSignal): Promise<string> {
    await waitForSignal(this.context.seeded, signal);
    if (this.context.initialLocale !== undefined) {
      return this.context.canonicalLocale(this.context.initialLocale);
    }
    for (const source of this.sourceOrder) {
      const resolved = await this.resolveLocaleSource(source, signal);
      if (resolved !== undefined) return resolved;
    }
    return this.context.defaultLocale;
  }

  /**
   * One source's answer, or nothing at all.
   *
   * Every source may decline, and declining is what makes an order meaningful: a URL that carries
   * no locale prefix has stated nothing, and pre-empting the next source with a default would make
   * every later source unreachable. Only `default` always answers, which is why it belongs last
   * and why omitting it means an application can fall through to its configured default anyway,
   * since there is no coherent alternative to having one.
   */
  private async resolveLocaleSource(
    source: LocalizationLocaleSource,
    signal: AbortSignal,
    requestContext: unknown = this.context.requestContext,
  ): Promise<string | undefined> {
    if (source === 'default') return this.context.defaultLocale;
    if (source === 'stored') return this.readPersistedLocale(signal);
    if (source === 'url') {
      const read = this.context.localeFromAddress;
      if (read === undefined) return undefined;
      const stated = read(requestContext);
      if (stated === undefined) return undefined;
      // A URL is a statement, not a preference, so an unsupported one is not quietly replaced
      // here; route resolution has already rejected it, and anything that reaches this point is a
      // locale the policy itself declares.
      return this.context.supportedLocales.has(stated) ? stated : undefined;
    }
    return negotiateLocale(
      this.context.preferredLanguages ?? [],
      this.context.localeList,
      (value) => {
        try {
          return this.context.canonicalLocale(value);
        } catch {
          return undefined;
        }
      },
    );
  }
}
