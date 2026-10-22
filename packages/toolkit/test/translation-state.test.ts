import { describe, expect, it } from 'vitest';

import { parseCatalog } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';
import { testProjectConfiguration } from './fixtures.js';
import {
  TRANSLATION_STATE_PROFILE,
  formatTranslationState,
  parseTranslationState,
  reconcileTranslationState,
} from '../src/translation-state.js';

/**
 * The English wording changes and the old translation stays.
 *
 * Without a record of what a translation was written against, this produces success with an empty
 * diagnostics array, so Equator keeps that record itself.
 *
 * The property worth protecting is that a report survives being seen. An advisory derived from a
 * cache clears itself on the next run, and one derived from a marker a person deletes depends on
 * them remembering. Neither is a record; both are a reminder that expires.
 */

const configuration = testProjectConfiguration(['en-US', 'ar-EG']);

function catalog(role: 'source' | 'target', locale: string, text: string) {
  const result = parseCatalog(`messages:\n  nav.home: ${text}\n`, {
    role,
    providerId: 'home',
    scopeId: 'shell',
    locale,
    sourcePath: `i18n/shell/${locale}.yaml`,
  });
  if (!result.ok) throw new Error(`fixture ${locale} failed to parse`);
  return result.value;
}

function graphOf(english: string, arabic: string) {
  const analysis = analyzeCatalogSet({
    configuration,
    catalogs: [
      catalog('source', 'en-US', english),
      catalog('target', 'ar-EG', arabic),
    ],
  });
  if (!analysis.ok) throw new Error('fixture failed to analyse');
  return analysis.value;
}

describe('translation provenance', () => {
  it('records nothing to report the first time it sees a translation', () => {
    const reconciled = reconcileTranslationState(graphOf('Home', 'الرئيسية'));

    expect(reconciled.stale).toHaveLength(0);
    expect(Object.keys(reconciled.state.entries)).toHaveLength(1);
    expect(reconciled.changed).toBe(true);
  });

  it('reports a translation whose source has moved underneath it', () => {
    const first = reconcileTranslationState(graphOf('Home', 'الرئيسية'));
    const second = reconcileTranslationState(
      graphOf('Home page', 'الرئيسية'),
      first.state,
    );

    expect(second.stale).toHaveLength(1);
    expect(second.stale[0]?.messageId).toBe('nav.home');
    expect(second.stale[0]?.locale).toBe('ar-EG');
  });

  it('keeps reporting it until the translation actually changes', () => {
    // The whole reason the record is durable. A reminder that expires on the run that raises it
    // is worse than none, because a later clean run reads as "nothing wrong".
    const first = reconcileTranslationState(graphOf('Home', 'الرئيسية'));
    let state = first.state;

    for (let run = 0; run < 3; run += 1) {
      const reconciled = reconcileTranslationState(
        graphOf('Home page', 'الرئيسية'),
        state,
      );
      expect(reconciled.stale, `run ${run}`).toHaveLength(1);
      state = reconciled.state;
    }
  });

  it('clears itself when the translation is updated, with nothing asked of anyone', () => {
    const first = reconcileTranslationState(graphOf('Home', 'الرئيسية'));
    const stale = reconcileTranslationState(
      graphOf('Home page', 'الرئيسية'),
      first.state,
    );
    const updated = reconcileTranslationState(
      graphOf('Home page', 'الصفحة الرئيسية'),
      stale.state,
    );

    expect(updated.stale).toHaveLength(0);
  });

  it('says nothing when a translation changes on its own', () => {
    // Retranslating without a source change is ordinary work, not staleness.
    const first = reconcileTranslationState(graphOf('Home', 'الرئيسية'));
    const second = reconcileTranslationState(
      graphOf('Home', 'الصفحة الرئيسية'),
      first.state,
    );

    expect(second.stale).toHaveLength(0);
  });

  it('drops entries for messages that no longer exist', () => {
    const populated = reconcileTranslationState(
      graphOf('Home', 'الرئيسية'),
    ).state;
    const withStrayEntry = {
      ...populated,
      entries: {
        ...populated.entries,
        'home:shell:deleted:ar-EG': { source: 'sha256-x', target: 'sha256-y' },
      },
    };

    const reconciled = reconcileTranslationState(
      graphOf('Home', 'الرئيسية'),
      withStrayEntry,
    );

    expect(Object.keys(reconciled.state.entries)).toHaveLength(1);
  });

  it('reads nothing from a record it cannot read whole', () => {
    // Re-stamping an entry read as absent pronounces its translation current, so the caller is
    // told the record is unreadable rather than handed what could be salvaged from it.
    for (const text of [
      '',
      'not json',
      '{}',
      '{"profile":"other"}',
      '[]',
      `{"profile":"${TRANSLATION_STATE_PROFILE}","entries":{"a:b:c:ar-EG":{"source":"x"}}}`,
    ]) {
      expect(parseTranslationState(text)).toBeUndefined();
    }
  });

  it('round-trips and serialises deterministically', () => {
    const state = reconcileTranslationState(graphOf('Home', 'الرئيسية')).state;
    const text = formatTranslationState(state);

    expect(text).toContain(TRANSLATION_STATE_PROFILE);
    const parsed = parseTranslationState(text);
    expect(parsed).toEqual(state);
    if (parsed === undefined) return;
    expect(formatTranslationState(parsed)).toBe(text);
  });
});
