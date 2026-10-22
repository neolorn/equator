import { digestCanonicalJson } from './canonical-json.js';
import type { SemanticGraph } from './semantic-model.js';

/**
 * Which source each translation was written against.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 11 derives this from the normalized body
 * and the effective contracts rather than asking an author to maintain a revision field, and makes
 * the default report advisory.
 *
 * Without this record, changing the English wording while leaving the old Arabic in place produces
 * success with an empty diagnostics array: nothing records what a translation corresponds to, so
 * "the source moved and this translation did not" is not a question Equator can answer.
 *
 * Equator maintains this record itself. Nothing is asked of a translator and nothing is stamped by
 * hand: each entry carries the source fingerprint at the time of stamping *and* a digest of the
 * translation, and the second value is what removes the human from the loop.
 *
 *   - translation digest moved  -> the translation was updated, re-stamp, not stale
 *   - translation digest same, source fingerprint moved -> stale, and it stays stale until the
 *     translation actually changes
 *
 * A marker a person has to delete would depend on them remembering: forgetting leaves a false
 * flag, and deleting without translating silently clears a real one. Neither failure is visible.
 *
 * The record is committed rather than cached because a fresh checkout and a CI run must reach the
 * same answer as the machine the edit happened on. It cannot live under `.equator/`, which is
 * declared disposable, nor in the generated root, where deleting and regenerating must preserve
 * everything, and it is the one thing Equator owns that genuinely cannot be recomputed.
 *
 * Losing the file is not a correctness problem: every entry re-stamps as current and tracking
 * restarts, which reports nothing rather than reporting something false.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 8 is where that ownership is stated: this is
 * the consumer's own durable project data rather than derived output, and it does not belong
 * under a root a project ignores by default.
 */
export const TRANSLATION_STATE_PROFILE = 'equator-translation-state/1' as const;

/**
 * Owner-relative location, beside `equator.config.json` rather than inside `i18n/`.
 *
 * The catalog root holds authored content and refuses entries it does not recognize, which is a
 * property worth keeping rather than widening for a file Equator writes. Ownership reads correctly
 * this way too: `i18n/` is the translator's, and this is Equator's.
 */
export const TRANSLATION_STATE_PATH =
  '.equator-translation-state.json' as const;

export interface TranslationStateEntry {
  /** Source fingerprint this translation was written against. */
  readonly source: string;
  /** Digest of the translation itself, used to notice that it was updated. */
  readonly target: string;
}

export interface TranslationState {
  readonly profile: typeof TRANSLATION_STATE_PROFILE;
  readonly entries: Readonly<Record<string, TranslationStateEntry>>;
}

export interface StaleTranslation {
  readonly identity: string;
  readonly providerId: string;
  readonly scopeId: string;
  readonly messageId: string;
  readonly locale: string;
}

export interface TranslationStateReconciliation {
  readonly state: TranslationState;
  readonly stale: readonly StaleTranslation[];
  /** True when the reconciled state differs from what was read. */
  readonly changed: boolean;
}

export const EMPTY_TRANSLATION_STATE: TranslationState = Object.freeze({
  profile: TRANSLATION_STATE_PROFILE,
  entries: Object.freeze({}),
});

function stateKey(identity: string, locale: string): string {
  return `${identity}:${locale}`;
}

function translationDigest(canonicalSource: string | undefined): string {
  // An explicitly empty translation is a deliberate authored value and must be distinguishable
  // from an absent one, so it digests its own sentinel rather than the empty string.
  return digestCanonicalJson(
    'equator-translation',
    canonicalSource ?? { empty: true },
  );
}

/**
 * Read a translation state document, or `undefined` when the text is not one.
 *
 * Nothing in it is skipped or defaulted. An entry read as absent is re-stamped from the current
 * source and translation, which pronounces that translation current, so a record that cannot be
 * read whole is not read at all and the caller refuses it.
 */
export function parseTranslationState(
  text: string,
): TranslationState | undefined {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    typeof document !== 'object' ||
    document === null ||
    Array.isArray(document)
  ) {
    return undefined;
  }
  const record = document as Readonly<Record<string, unknown>>;
  if (record['profile'] !== TRANSLATION_STATE_PROFILE) {
    return undefined;
  }
  const rawEntries = record['entries'];
  if (
    typeof rawEntries !== 'object' ||
    rawEntries === null ||
    Array.isArray(rawEntries)
  ) {
    return undefined;
  }
  const entries: Record<string, TranslationStateEntry> = {};
  for (const [key, value] of Object.entries(
    rawEntries as Readonly<Record<string, unknown>>,
  )) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    const entry = value as Readonly<Record<string, unknown>>;
    const source = entry['source'];
    const target = entry['target'];
    if (typeof source !== 'string' || typeof target !== 'string') {
      return undefined;
    }
    entries[key] = Object.freeze({ source, target });
  }
  return Object.freeze({
    profile: TRANSLATION_STATE_PROFILE,
    entries: Object.freeze(entries),
  });
}

/** Serialise deterministically: sorted keys, stable shape, trailing newline. */
export function formatTranslationState(state: TranslationState): string {
  const keys = Object.keys(state.entries).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const lines = ['{', `  "profile": "${state.profile}",`, '  "entries": {'];
  keys.forEach((key, index) => {
    const entry = state.entries[key];
    if (entry === undefined) return;
    const comma = index === keys.length - 1 ? '' : ',';
    lines.push(
      `    ${JSON.stringify(key)}: { "source": ${JSON.stringify(entry.source)}, "target": ${JSON.stringify(entry.target)} }${comma}`,
    );
  });
  lines.push('  }', '}', '');
  return lines.join('\n');
}

/**
 * Compare the graph against the recorded state.
 *
 * Entries for messages or locales that no longer exist are dropped, so deleting a message does not
 * leave the record growing forever.
 */
export function reconcileTranslationState(
  graph: SemanticGraph,
  previous: TranslationState = EMPTY_TRANSLATION_STATE,
): TranslationStateReconciliation {
  const entries: Record<string, TranslationStateEntry> = {};
  const stale: StaleTranslation[] = [];

  for (const scope of graph.scopes) {
    for (const message of scope.messages) {
      for (const target of message.targets) {
        const key = stateKey(message.identity, target.locale);
        const digest = translationDigest(target.canonicalSource);
        const prior = previous.entries[key];

        if (prior === undefined || prior.target !== digest) {
          // Either the first time this translation has been seen, or it has just been updated.
          // In both cases it now corresponds to the current source.
          entries[key] = Object.freeze({
            source: message.sourceFingerprint,
            target: digest,
          });
          continue;
        }

        // The translation has not moved. If the source has, it no longer describes it, and the
        // record deliberately keeps the older fingerprint so the report persists across runs rather
        // than clearing itself the moment it is noticed.
        entries[key] = prior;
        if (prior.source !== message.sourceFingerprint) {
          stale.push(
            Object.freeze({
              identity: message.identity,
              providerId: message.providerId,
              scopeId: message.scopeId,
              messageId: message.messageId,
              locale: target.locale,
            }),
          );
        }
      }
    }
  }

  const state = Object.freeze({
    profile: TRANSLATION_STATE_PROFILE,
    entries: Object.freeze(entries),
  });

  return Object.freeze({
    state,
    stale: Object.freeze(stale),
    changed: formatTranslationState(state) !== formatTranslationState(previous),
  });
}
