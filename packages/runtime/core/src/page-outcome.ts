// What a page discovered about itself, and how it reaches the response.
//
// `specs/07-routing-rendering-and-seo.spec.md` section 5 separates three outcome classes and gives
// two of them facts an address cannot supply: whether the entity an address names is absent,
// whether it has been permanently removed, and whether the render itself failed. None of the three
// is visible to route resolution, so each is declared, and one type carries all three because the
// page and the renderer differ only in where the declaration is made.
//
// The carrier lives here rather than beside either of them. The declaration is written from the
// Angular render, in `@neolorn/equator/router`, and read by the request handler, in
// `@neolorn/equator/http`. Neither of those entry points may import the other, so the channel sits
// in the base both already depend on.

import { LocalizationError } from './contracts';
import type { RouteHttpDescriptor } from './routing';

/** An address that resolved to a route whose entity does not exist. */
export interface PageOutcomeAbsent {
  /** Distinguishes this member of the declaration union. */
  readonly outcome: 'absent';
}

/** An address that resolved to a route whose entity was permanently removed. */
export interface PageOutcomeGone {
  /** Distinguishes this member of the declaration union. */
  readonly outcome: 'gone';
}

/** The application's own answer about its own condition, carrying the status it chose. */
export interface PageOutcomeOperationalFailure {
  /** Distinguishes this member of the declaration union. */
  readonly outcome: 'operational-failure';
  /**
   * The status to send, which is the application's rather than Equator's.
   *
   * Section 5 fixes a status table for routing outcomes and states that an operational failure is
   * not one of them, so there is no table to derive this from.
   */
  readonly status: number;
}

/**
 * What a page or a renderer states about an outcome routing cannot see.
 *
 * The two routing arms carry the fact and not the status, because the status for an absent entity
 * and for a permanent removal is already fixed by section 5's table and an application writing one
 * here would be restating a rule Equator applies anyway. The operational arm carries its own
 * status, because nothing fixes that one.
 */
export type PageOutcomeDeclaration =
  PageOutcomeAbsent | PageOutcomeGone | PageOutcomeOperationalFailure;

const ABSENT: PageOutcomeAbsent = Object.freeze({ outcome: 'absent' });
const GONE: PageOutcomeGone = Object.freeze({ outcome: 'gone' });

/**
 * The entity this address names does not exist, which section 5's table answers with 404.
 *
 * ```ts
 * const article = await this.articles.load(slug);
 * if (article === undefined) this.outcome.declare(pageAbsent());
 * ```
 */
export function pageAbsent(): PageOutcomeAbsent {
  return ABSENT;
}

/**
 * The entity this address named was permanently removed, which section 5's table answers with 410.
 *
 * Distinct from an absence, and the distinction is the whole reason both exist: 410 tells a crawler
 * to drop the address rather than to come back for it.
 */
export function pageGone(): PageOutcomeGone {
  return GONE;
}

/**
 * The render could not produce this page, and the application states what that is worth.
 *
 * Serving maintenance and reporting a failed load are both this. The status is the caller's because
 * Equator has no table for one, and it is checked here rather than where the response is built, so
 * a value that could not be sent is refused at the call that names it, with the typed
 * configuration failure. The message names the kind of a value that is not a number and never
 * the value.
 */
export function pageOperationalFailure(
  status: number,
): PageOutcomeOperationalFailure {
  const given: unknown = status;
  if (!Number.isInteger(given) || status < 200 || status > 599) {
    throw new LocalizationError(
      Object.freeze({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        message: `A declared operational failure carries an HTTP status between 200 and 599; received ${typeof given === 'number' ? String(given) : `a value of type ${typeof given}`}.`,
        reason: 'malformed-input',
      }),
    );
  }
  return Object.freeze({ outcome: 'operational-failure', status });
}

/** The declaration made during one render, and nothing else about it. */
interface PageOutcomeChannel {
  declared?: PageOutcomeDeclaration;
}

/**
 * The declaration channel, keyed on the request object the render and the handler share.
 *
 * The same carrier `rawTargetOf` uses in `@neolorn/equator/http`, and for the same reasons. A
 * header is observable and a client can send one, so a declaration carried in one would reach the
 * handler as though the page had made it. An injection token provided by the host is the shape
 * Angular withdrew as `REQUEST_CONTEXT`: wiring documented nowhere and silent when omitted. A key
 * that is the request answers both, and it answers a third: a `Request` is created per request and
 * unreachable from the next one, so a declaration cannot outlive the render that made it.
 *
 * Held under a key in the global symbol registry rather than in this module, because a server
 * loads this module twice. Angular's builder bundles the server entry, where the handler opens and
 * takes, apart from the application, where the page declares, and each bundle carries its own
 * copy. A map in module scope would be two maps, and every declaration would land in the one the
 * handler never reads.
 */
const CHANNELS = Symbol.for('@neolorn/equator/page-outcome-channels');
const registry = globalThis as unknown as Record<
  symbol,
  WeakMap<Request, PageOutcomeChannel> | undefined
>;

// Created on first use rather than when this module loads, because importing an entry point adds
// nothing to global state (`specs/02-packages-and-platform.spec.md` section 8). Every copy of the
// module asks for the same key, so the first to use it creates the one map they all share.
const channels = (): WeakMap<Request, PageOutcomeChannel> =>
  (registry[CHANNELS] ??= new WeakMap<Request, PageOutcomeChannel>());

/**
 * Opens the channel for one render, which is also what makes a missing one detectable.
 *
 * Called by the request handler before it calls the renderer. Section 5 requires a wiring fault to
 * be reported rather than answered from the table as though the page had said nothing, and the two
 * produce the same response, so nothing downstream can tell them apart. Opening the channel first
 * is what separates them: a declaration against a request that was never opened is a request the
 * handler is not holding.
 */
export function ɵopenPageOutcomeChannel(request: Request): void {
  channels().set(request, {});
}

/**
 * Records a declaration against the render's own request, or reports that it cannot.
 *
 * `false` means the request this was called with is not the one the handler opened, which happens
 * when something between the two replaces it. The caller reports that during development; it does
 * not throw, because a page that declared an absence has already answered its own question and
 * failing the render would replace a wrong status with no page at all.
 */
export function ɵrememberPageOutcome(
  request: Request,
  declaration: PageOutcomeDeclaration,
): boolean {
  const channel = channels().get(request);
  if (channel === undefined) return false;
  channel.declared = declaration;
  return true;
}

/**
 * Takes the declaration this render made, and closes the channel.
 *
 * Read once and removed, because section 5 gives a declaration the render that made it and nothing
 * else. Holding it would leave the entry for a second read at the same address.
 */
export function ɵtakePageOutcome(
  request: Request,
): PageOutcomeDeclaration | undefined {
  const channel = channels().get(request);
  channels().delete(request);
  return channel?.declared;
}

/**
 * The response for an address whose page declared an outcome, as against what routing alone gave.
 *
 * `status` widens to a number because the operational arm carries the application's own, and 503
 * and 429 are not conclusions about an address. Everything else is a routing descriptor and is
 * read the same way.
 */
export interface DeclaredPageOutcomeDescriptor extends Omit<
  RouteHttpDescriptor,
  'status'
> {
  /** The status to send, which for the operational arm is whatever the declaration named. */
  readonly status: number;
}

/**
 * The response a declaration produces, given what the address resolved to on its own.
 *
 * The routing arms take their status from section 5's table and the classification that table
 * gives them, which is what `routeHttpDescriptor` already returns for a route resolution of the
 * same kind: not stored, and not indexed.
 *
 * The operational arm takes its own status and is classified private and not stored whatever the
 * address is, because a failure is not the address's representation and a shared cache holding one
 * hands it to the next visitor who asks. Its indexing is the address's own, untouched. Section 12
 * lets a declaration narrow an indexing class and not widen one, and an operational failure states
 * nothing about whether the address should be indexed: it says this render did not produce the
 * page, which is a fact about one response rather than about the address.
 */
export function pageOutcomeHttpDescriptor(
  declaration: PageOutcomeDeclaration,
  resolved: RouteHttpDescriptor,
): DeclaredPageOutcomeDescriptor {
  // The body is still in the language the address resolved to, chosen the same way whatever
  // status is sent, so how it was chosen travels with it.
  const language = {
    ...(resolved.contentLanguage === undefined
      ? {}
      : { contentLanguage: resolved.contentLanguage }),
    ...(resolved.variesBy === undefined ? {} : { variesBy: resolved.variesBy }),
  };
  if (declaration.outcome === 'operational-failure') {
    return Object.freeze({
      status: declaration.status,
      ...language,
      ...(resolved.robots === undefined ? {} : { robots: resolved.robots }),
      cache: 'private-no-store',
    });
  }
  // The narrower of the two: a withdrawn page is not indexed, and a route that also keeps its links
  // from being followed keeps that too, since section 12 lets a declaration narrow a class only.
  return Object.freeze({
    status: declaration.outcome === 'absent' ? 404 : 410,
    ...language,
    robots:
      resolved.robots === 'noindex, nofollow' ? 'noindex, nofollow' : 'noindex',
    cache: 'private-no-store',
  });
}
