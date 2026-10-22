/**
 * An identity the application supplied, on its way into a diagnostic.
 *
 * `specs/11-diagnostics-and-observability.spec.md` section 5: an identifier that reaches a
 * diagnostic is cut to a bounded length and has its control characters replaced, so a locale or a
 * scope id cannot rewrite the log line it lands in. A right-to-left override is the case that
 * matters: printed as is, it reverses everything after it on the line.
 */
import { describe, expect, it } from 'vitest';

import { RUNTIME_LIMITS } from '../src/runtime-safety.js';
import {
  compileSet,
  createStore,
  rejectionOf,
  scope,
} from './catalog-store-harness.js';

const OVERRIDE = '‮';
const NEWLINE = '\n';

describe('a hostile locale reported as unavailable', () => {
  const hostile = `en-${OVERRIDE}${NEWLINE}${'x'.repeat(400)}`;

  async function reported() {
    const store = createStore(compileSet());
    return rejectionOf(() =>
      store.preload(scope('shell'), hostile, new AbortController().signal),
    );
  }

  it('carries the locale with its control characters replaced', async () => {
    const diagnostic = await reported();
    expect(diagnostic?.code).toBe('scope-unavailable');
    expect(diagnostic?.targetLocale?.startsWith('en-��x')).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toMatch(/‮|\\n/u);
  });

  it('cuts the locale at the bound and marks the cut', async () => {
    const diagnostic = await reported();
    const characters = [...(diagnostic?.targetLocale ?? '')];
    expect(characters).toHaveLength(
      RUNTIME_LIMITS.diagnosticIdentifierCodePoints + 1,
    );
    expect(characters.at(-1)).toBe('…');
  });
});
